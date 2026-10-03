import { db } from '../../db';
import { localDateKey, expandOccurrenceDates, occurrenceId } from '../../db/todo-repo';
import { useAuthStore } from '../../store/auth-store';
import { matchesSecretaryInbox, readSecretaryInbox } from './inbox';

/** Dashboard counts come from owned, source-validated work. This never resumes tasks. */
export async function readSecretaryWorkspace(userId: string) {
  if (!userId || useAuthStore.getState().userId !== userId) return;
  const character = await db.characters.where('createdBy').equals(userId)
    .filter(c => c.agentProfile === 'secretary' && !c.isPreset).first();
  if (!character) return;
  const tasks = await readSecretaryInbox(userId, character.id);
  const today = localDateKey();
  const todayCount = await db.transaction('r', db.todos, db.todoOccurrences, async () => {
    const todos = await db.todos.where('userId').equals(userId).filter(t => !['deleted', 'cancelled'].includes(t.status)).toArray();
    const occurrences = await db.todoOccurrences.where('userId').equals(userId).toArray();
    const byId = new Map(occurrences.map(o => [o.id, o]));
    return todos.filter(t => {
      if (!t.dueDate || t.status === 'completed' && t.recurrence.kind === 'none') return false;
      const date = t.recurrence.kind === 'none' ? t.dueDate <= today ? t.dueDate : undefined : expandOccurrenceDates(t, today, today)[0];
      if (!date) return false;
      const occurrence = byId.get(occurrenceId(t.id, date));
      return !occurrence || occurrence.status === 'todo';
    }).length;
  });
  if (useAuthStore.getState().userId !== userId) return;
  return { character, todayCount, attention: tasks.filter(t => matchesSecretaryInbox(t, 'attention')).length,
    drafts: tasks.reduce((count, task) => count + task.results.filter(r => r.status === 'draft' && r.action.kind.startsWith('moment.')).length, 0),
    failed: tasks.filter(t => matchesSecretaryInbox(t, 'failed')).length };
}
