import { db } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import type { SecretaryTask } from './types';
import { receiptViewModel } from './receipt';

export type SecretaryInboxFilter = 'attention' | 'drafts' | 'failed' | 'done' | 'input' | 'review';
export const SECRETARY_INBOX_FILTERS: { id: SecretaryInboxFilter; label: string }[] = [
  { id: 'attention', label: '待处理' }, { id: 'drafts', label: '朋友圈草稿' }, { id: 'failed', label: '未办成' }, { id: 'done', label: '最近完成' },
];

export function matchesSecretaryInbox(task: SecretaryTask, filter: SecretaryInboxFilter): boolean {
  const receipts = task.results.map(receiptViewModel);
  if (filter === 'input') return ['waiting', 'paused'].includes(task.pendingContext?.state ?? '') || receipts.some(r => r.operationState === 'needs-input') || task.status === 'planning' || task.status === 'ready';
  if (filter === 'review') return receipts.some(r => r.operationState === 'draft');
  if (filter === 'attention') return ['waiting', 'paused'].includes(task.pendingContext?.state ?? '') || task.status === 'planning' || task.status === 'ready' || receipts.some(r => ['pending', 'needs-input', 'failed', 'draft'].includes(r.operationState)) || task.status === 'failed' && !task.results.length;
  if (filter === 'drafts') return task.results.some((r, i) => r.action.kind.startsWith('moment.') && receipts[i].operationState === 'draft');
  if (filter === 'failed') return receipts.some(r => r.operationState === 'failed') || task.status === 'failed' && !task.results.length;
  return receipts.some(r => r.operationState === 'done');
}

/** Read only: opening the inbox must never resume work from an earlier employment. */
export async function readSecretaryInbox(userId: string, characterId: string): Promise<SecretaryTask[]> {
  if (!userId || useAuthStore.getState().userId !== userId) return [];
  return db.transaction('r', db.characters, db.sessions, db.messages, db.secretaryTasks, async () => {
    const character = await db.characters.get(characterId);
    if (!character || character.createdBy !== userId || character.isPreset || character.agentProfile !== 'secretary') return [];
    const sessions = await db.sessions.where('[characterId+userId]').equals([characterId, userId]).toArray();
    const owned = new Set(sessions.map(s => s.id));
    const candidates = await db.secretaryTasks.where('characterId').equals(characterId).filter(t => t.userId === userId && owned.has(t.sessionId)).toArray();
    const sources = await db.messages.bulkGet(candidates.map(t => t.messageId));
    if (useAuthStore.getState().userId !== userId) return [];
    return candidates.filter((task, i) => {
      const source = sources[i];
      return source?.role === 'user' && source.sessionId === task.sessionId && source.content === task.request;
    }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  });
}

export async function readOwnedSecretaryTask(userId: string, taskId: string): Promise<SecretaryTask | undefined> {
  if (!userId || useAuthStore.getState().userId !== userId) return;
  return db.transaction('r', db.characters, db.sessions, db.messages, db.secretaryTasks, async () => {
    const task = await db.secretaryTasks.get(taskId);
    if (!task || task.userId !== userId) return;
    const character = await db.characters.get(task.characterId);
    const session = await db.sessions.get(task.sessionId);
    const source = await db.messages.get(task.messageId);
    if (character?.createdBy === userId && character.agentProfile === 'secretary' && !character.isPreset
      && session?.userId === userId && session.characterId === character.id && source?.sessionId === session.id
      && source.role === 'user' && source.content === task.request && useAuthStore.getState().userId === userId) return task;
  });
}
