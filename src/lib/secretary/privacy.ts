import { db } from '../../db';
import type { SecretaryTask } from './types';

/** Metadata generated locally, not a classifier supplied by the model. Old unknowns stay hidden. */
export function diaryProtectedTask(task: SecretaryTask): boolean {
  return task.privacyScope !== 'plain' || /日记|手账/u.test(task.request) || !!task.dailyReview?.includeDiary
    || !!task.memoryReferences?.requiresDiaryUnlocked || task.results.some(r => r.action.kind.startsWith('diary.'));
}

export async function taskPrivacyScope(task: SecretaryTask): Promise<'plain' | 'diary' | 'unknown'> {
  if (/日记|手账/u.test(task.request) || task.dailyReview?.includeDiary || task.memoryReferences?.requiresDiaryUnlocked || task.results.some(r => r.action.kind.startsWith('diary.'))) return 'diary';
  const sourceIds = [...new Set([task.pendingContext?.originTaskId, ...(task.pendingContext?.sources ?? []).map(s => s.taskId), ...task.results.map(r => r.sourceTaskId)].filter((id): id is string => !!id && id !== task.id))];
  const sources = await db.secretaryTasks.bulkGet(sourceIds);
  if (sources.some(s => !s || s.userId !== task.userId || s.characterId !== task.characterId || s.privacyScope === 'unknown' || s.privacyScope == null)) return 'unknown';
  return sources.some(s => s && diaryProtectedTask(s)) ? 'diary' : 'plain';
}
