import { db } from '../../db';
import { readActionDay } from '../action-cabin/query';
import { useAuthStore } from '../../store/auth-store';
import { matchesSecretaryInbox, readSecretaryInbox } from './inbox';

/** Dashboard counts come from owned, source-validated work. This never resumes tasks. */
export async function readSecretaryWorkspace(userId: string) {
  if (!userId || useAuthStore.getState().userId !== userId) return;
  const character = await db.characters.where('createdBy').equals(userId)
    .filter(c => c.agentProfile === 'secretary' && !c.isPreset).first();
  if (!character) return;
  const tasks = await readSecretaryInbox(userId, character.id);
  const todayCount = (await readActionDay(userId)).dueOrOverdue.length;
  if (useAuthStore.getState().userId !== userId) return;
  return { character, todayCount, attention: tasks.filter(t => matchesSecretaryInbox(t, 'attention')).length,
    drafts: tasks.reduce((count, task) => count + task.results.filter(r => r.status === 'draft' && r.action.kind.startsWith('moment.')).length, 0),
    failed: tasks.filter(t => matchesSecretaryInbox(t, 'failed')).length };
}
