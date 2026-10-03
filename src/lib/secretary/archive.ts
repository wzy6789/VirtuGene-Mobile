import { db } from '../../db';
import { memorySourceTombstoneRepo } from '../../db/memory-source-tombstone-repo';
import type { SecretaryTask } from './types';
import { dailyReviewRequest, validateDailyReview, reviewActionSelected } from './daily-review';
import { SECRETARY_ACTION_KINDS } from './capabilities';
import { validateWorkPreferences } from './work-preferences';
import { parsePlanningContract } from './planning-contract';

/** Restore receipts and drafts as data. Transferred requests never run automatically. */
export async function importSecretaryTasks(userId: string, incoming: SecretaryTask[] = []): Promise<number> {
  let count = 0;
  for (const task of incoming) {
    if (task?.workPreferences != null) {
      try { task.workPreferences = validateWorkPreferences(task.workPreferences); } catch { continue; }
    }
    if (task?.dailyReview) {
      try {
        if (dailyReviewRequest(validateDailyReview(task.dailyReview)) !== task.request || task.results?.length && !task.reviewSources
          || task.reviewSources && (!Array.isArray(task.reviewSources.diaries) || !Array.isArray(task.reviewSources.todos)
          || [...task.reviewSources.diaries, ...task.reviewSources.todos].some(ref => !ref || typeof ref.id !== 'string' || !Number.isFinite(ref.version)))) continue;
      } catch { continue; }
    }
    if (!task || task.userId !== userId || !Array.isArray(task.results) || typeof task.request !== 'string' || !Number.isFinite(task.updatedAt)
      || !['planning', 'ready', 'finished', 'failed'].includes(task.status)
      || task.employmentId != null && typeof task.employmentId !== 'string'
      || task.assistantName != null && typeof task.assistantName !== 'string') continue;
    if (task.results.some(r => !r || !r.action || !SECRETARY_ACTION_KINDS.includes(r.action.kind)
      || task.dailyReview && !reviewActionSelected(r.action, task.dailyReview)
      || !['pending', 'done', 'draft', 'needs-input', 'failed', 'undone'].includes(r.status)
      || [r.beforeDiary, r.beforeTodo, r.beforeOccurrence].some(snapshot => snapshot && snapshot.userId !== userId))) continue;
    const [session, character, source, existing] = await Promise.all([
      db.sessions.get(task.sessionId), db.characters.get(task.characterId), db.messages.get(task.messageId), db.secretaryTasks.get(task.id),
    ]);
    if (!session || session.userId !== userId || session.characterId !== task.characterId || session.type === 'group'
      || !character || character.createdBy !== userId || character.agentProfile !== 'secretary' || character.isPreset
      || !source || source.role !== 'user' || source.sessionId !== task.sessionId || source.content !== task.request) continue;
    if (await memorySourceTombstoneRepo.blocksImport({ userId, sourceType: 'message', sourceId: source.id, sourceRevision: source.revision ?? 1 })) continue;
    if (await memorySourceTombstoneRepo.blocksImport({ userId, sourceType: 'message', sourceId: `secretary-reply:${task.messageId}`, sourceRevision: 1 })) continue;
    if (existing && (existing.userId !== userId || existing.updatedAt >= task.updatedAt)) continue;
    const results = task.results.map(r => r.status === 'pending' ? { ...r, status: 'needs-input' as const, detail: '这项安排已恢复，尚未执行。补充或重试后继续。' } : r);
    const replanning = !results.length && (task.status === 'planning' || task.status === 'failed');
    const restored: SecretaryTask = { ...task, privacyScope: 'unknown', pendingContext: undefined, planningContract: task.planningContract ? parsePlanningContract(task.planningContract as unknown as Record<string, unknown>) : undefined, results, leaseUntil: undefined, status: replanning ? 'failed' : 'finished' };
    await db.secretaryTasks.put(restored);
    if (replanning) await db.messages.update(source.id, { failed: true });
    else {
      const id = `secretary-reply:${source.id}`;
      if (!await db.messages.get(id)) await db.messages.add({ id, sessionId: task.sessionId, role: 'assistant', content: '助理记录已恢复。具体状态见下面的卡片，未完成的事项可以继续处理。', createdAt: task.updatedAt, isProactive: false, revision: 1, secretaryTaskId: task.id });
    }
    count++;
  }
  return count;
}
