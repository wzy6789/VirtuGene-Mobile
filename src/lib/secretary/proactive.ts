import { db } from '../../db';
import { localDateKey, expandOccurrenceDates, occurrenceId } from '../../db/todo-repo';
import { useAuthStore } from '../../store/auth-store';
import { saveWorkPreferences, workPreferencesOrDefault } from './work-preferences';
import { readActionDay } from '../action-cabin/query';

export interface SecretarySuggestion { key: string; text: string; kind: 'todo' | 'pending' | 'review'; todoId?: string; date?: string }
const owned = (userId: string) => useAuthStore.getState().userId === userId;
const hash = (value: string) => { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(36); };

/** Read-only suggestions: no model, no occurrence materialisation, no private diary access. */
export async function readSecretarySuggestion(userId: string, now = new Date(), visibleKey?: string): Promise<SecretarySuggestion | undefined> {
  if (!owned(userId)) return;
  const binding = await db.secretaryBindings.get(userId);
  if (!binding || binding.status === 'dismissed' || !binding.workPreferences?.proactiveHelp) return;
  const today = localDateKey(now), suggestions: SecretarySuggestion[] = [];
  if (binding.pendingFocusTaskId) {
    const task = await db.secretaryTasks.get(binding.pendingFocusTaskId);
    if (task?.userId === userId && task.characterId === binding.characterId && task.employmentId === binding.employmentId && task.pendingContext?.state === 'waiting') {
      try {
        const { assertPendingSources, pendingQuestion } = await import('./pending-context');
        if (!owned(userId)) return;
        await assertPendingSources(task);
        suggestions.push({ key: `pending:${task.id}:${task.updatedAt}`, kind: 'pending', text: `还有一件事待补充：${pendingQuestion(task.pendingContext)}` });
      } catch { /* Invalid references must never become a prompt to resume stale work. */ }
    }
  }
  const snapshot=await readActionDay(userId,now);
  const pending=snapshot.dueOrOverdue.map(r=>({todo:{...r.todo,dueTime:r.occurrence.dueTime},date:r.occurrence.dueDate}));
  const todayRows = pending.filter(r => r.date === today);
  for (const row of todayRows) {
    if (!row.todo.dueTime) continue;
    const sameTime = todayRows.filter(r => r.todo.dueTime === row.todo.dueTime);
    if (sameTime.length > 1) {
      suggestions.push({ key: `conflict:${today}:${hash(sameTime.map(r => `${r.todo.id}:${r.todo.updatedAt}`).sort().join('|'))}`, kind: 'todo', todoId: row.todo.id, date: today,
        text: `今天${row.todo.dueTime}有${sameTime.length}项安排，可以检查是否需要调整。` }); break;
    }
  }
  pending.sort((a, b) => ({ urgent: 0, important: 1, normal: 2 }[a.todo.priority] - { urgent: 0, important: 1, normal: 2 }[b.todo.priority]) || a.date.localeCompare(b.date) || (a.todo.dueTime ?? '').localeCompare(b.todo.dueTime ?? ''));
  const first = pending[0];
  if (first) suggestions.push({ key: `todo:${first.todo.id}:${first.todo.updatedAt}:${first.date}`, kind: 'todo', todoId: first.todo.id, date: first.date,
    text: `${first.date < today ? '还有一件逾期事项' : '今天可以先关注'}：${first.todo.title}${first.todo.dueTime ? `（${first.todo.dueTime}）` : ''}。${first.todo.subtasks?.find(s => !s.completed)?.title ? `下一步：${first.todo.subtasks.find(s => !s.completed)!.title}。` : ''}` });
  if (now.getHours() >= 20 && todayRows.length) suggestions.push({ key: `review:${today}:${hash(todayRows.map(r => `${r.todo.id}:${r.todo.updatedAt}`).join('|'))}`, kind: 'review', text: '今晚可以整理一下今天的实际安排，进入对话后选择“每日整理”。' });
  if (!owned(userId)) return;
  const available = suggestions.filter(s => !binding.suggestionDismissals?.some(d => d.key === s.key && (!d.until || d.until > now.getTime())));
  const shown = binding.suggestionShown;
  if (!shown) return available[0];
  const snooze = binding.suggestionDismissals?.find(d => d.key === shown.key)?.until;
  const requestedAgain = snooze != null && snooze > shown.at && snooze <= now.getTime();
  // Keep the card currently being read. Reopening the app is not another exposure.
  if (shown.day === today) return available.find(s => s.key === shown.key && (visibleKey === s.key || requestedAgain));
  return available.find(s => s.key !== shown.key || visibleKey === s.key || requestedAgain);
}

/** Called after the card mounts; querying suggestions alone does not consume the daily slot. */
export async function markSecretarySuggestionShown(userId: string, key: string, now = new Date()): Promise<void> {
  if (!owned(userId)) return;
  await db.transaction('rw', db.secretaryBindings, async () => {
    const binding = await db.secretaryBindings.get(userId);
    if (!binding || !owned(userId) || binding.status === 'dismissed' || !binding.workPreferences?.proactiveHelp) return;
    const shown = binding.suggestionShown, day = localDateKey(now);
    const snooze = binding.suggestionDismissals?.find(d => d.key === key)?.until;
    if (shown?.day === day && !(shown.key === key && snooze != null && snooze > shown.at && snooze <= now.getTime())) return;
    await db.secretaryBindings.update(userId, { suggestionShown: { key, day, at: now.getTime() } });
  });
}

export async function dismissSecretarySuggestion(userId: string, key: string, until?: number): Promise<void> {
  if (!owned(userId)) return;
  await db.transaction('rw', db.secretaryBindings, async () => {
    const binding = await db.secretaryBindings.get(userId);
    if (!binding || !owned(userId)) return;
    const dismissals = [...(binding.suggestionDismissals ?? []).filter(d => d.key !== key), { key, ...(until ? { until } : {}) }].slice(-64);
    await db.secretaryBindings.update(userId, { suggestionDismissals: dismissals });
  });
}

export async function disableSecretarySuggestions(userId: string) {
  const binding = await db.secretaryBindings.get(userId);
  if (!binding || !owned(userId)) return;
  return saveWorkPreferences(userId, { ...workPreferencesOrDefault(binding.workPreferences), proactiveHelp: false },
    { characterId: binding.characterId, employmentId: binding.employmentId, version: binding.workPreferencesUpdatedAt ?? 0 });
}
