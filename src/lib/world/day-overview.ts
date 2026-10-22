import {useEffect, useState} from 'react';
import {liveQuery} from 'dexie';
import {db, type Todo, type TodoOccurrence} from '../../db';
import {expandOccurrenceDates, localDateKey, occurrenceId} from '../../db/todo-repo';
import {useAuthStore} from '../../store/auth-store';

const UNPLANNED_DATE = '9999-12-31';
export interface WorldDayOverview {day: string; today: number; unplanned: number}

/** Two explicit units for the world entry, not the action cabin's historical pending total.
 * Recurrence expansion covers today only. Historical rows enter only when due today;
 * original schedule IDs are read separately so postponing today's instance suppresses
 * the virtual original. No occurrence materialization, history scan or write occurs. */
export async function readWorldDayOverview(userId: string, now = new Date()): Promise<WorldDayOverview> {
  const day = localDateKey(now);
  return db.transaction('r', db.todos, db.todoOccurrences, async () => {
    const templates = (await db.todos.where('userId').equals(userId).toArray())
      .filter(todo => todo.userId === userId && !['deleted', 'cancelled'].includes(todo.status));
    const byId = new Map(templates.map(todo => [todo.id, todo]));
    const dueToday = (await db.todoOccurrences.where('[userId+dueDate]').equals([userId, day]).toArray())
      .filter(row => row.userId === userId && byId.has(row.todoId));
    const todayRows = new Map(dueToday.filter(row => byId.get(row.todoId)?.recurrence.kind !== 'none' && row.status === 'todo').map(row => [row.id, row]));
    const planned = templates.filter(todo => todo.recurrence.kind !== 'none' && expandOccurrenceDates(todo, day, day).length > 0);
    const overrides = await db.todoOccurrences.bulkGet(planned.map(todo => occurrenceId(todo.id, day)));
    for (let index = 0; index < planned.length; index++) {
      const todo = planned[index], actual = overrides[index];
      if (actual) {
        // A foreign/corrupt collision never authorizes a virtual owned occurrence.
        if (actual.userId === userId && actual.todoId === todo.id && actual.status === 'todo' && actual.dueDate === day) todayRows.set(actual.id, actual);
      } else {
        const id = occurrenceId(todo.id, day);
        todayRows.set(id, {id, userId, todoId: todo.id, dueDate: day, originalDueDate: day, status: 'todo', createdAt: todo.createdAt, updatedAt: 0});
      }
    }

    let singlesToday = 0, unplanned = 0;
    const todaySingleIds = new Set(dueToday.filter(row => byId.get(row.todoId)?.recurrence.kind === 'none').map(row => row.todoId));
    const singles = templates.filter(todo => todo.recurrence.kind === 'none' && todo.status === 'todo'
      && (!todo.dueDate || todo.dueDate === day || todaySingleIds.has(todo.id)));
    await Promise.all(singles.map(async todo => {
      const actual = await canonicalSingle(todo, userId);
      if (actual) {
        if (actual.userId !== userId || actual.todoId !== todo.id || actual.status !== 'todo') return;
        if (actual.dueDate === day) singlesToday++;
        if (!todo.dueDate && actual.dueDate === UNPLANNED_DATE) unplanned++;
      } else if (todo.dueDate === day) singlesToday++;
      else if (!todo.dueDate) unplanned++;
    }));
    return {day, today: todayRows.size + singlesToday, unplanned};
  });
}

/** One-off IDs survive date edits. Match the existing canonical non-skipped identity,
 * never enumerate recurring history. The unplanned canonical has an exact known ID. */
async function canonicalSingle(todo: Todo, userId: string): Promise<TodoOccurrence | undefined> {
  const canonical = await db.todoOccurrences.get(occurrenceId(todo.id, todo.dueDate ?? UNPLANNED_DATE));
  if (canonical) return canonical;
  const owned = db.todoOccurrences.where('todoId').equals(todo.id).filter(row => row.userId === userId);
  const activeIdentity = await owned.clone().filter(row => !['skipped', 'cancelled'].includes(row.status)).first();
  // Cancelled/skipped one-offs must suppress the virtual template as well.
  return activeIdentity ?? await owned.first();
}

/** Recompute at the next local day and on visible/focus restoration; no polling loop. */
export function useWorldDayOverview(userId: string | null, enabled: boolean) {
  const [summary, setSummary] = useState<{owner: string; data: WorldDayOverview} | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setSummary(null);
    if (!userId || !enabled) return;
    let active = true;
    const current = () => active && useAuthStore.getState().userId === userId;
    const subscription = liveQuery(() => readWorldDayOverview(userId)).subscribe({
      next: data => {if (current()) setSummary({owner: userId, data});},
      error: () => {if (current()) setSummary(null);},
    });
    const refresh = () => {if (current() && !document.hidden) setRevision(value => value + 1);};
    const now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(refresh, Math.max(1, midnight.getTime() - now.getTime() + 50));
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => {active = false; subscription.unsubscribe(); window.clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh);};
  }, [userId, enabled, revision]);
  return enabled && summary?.owner === userId ? summary.data : null;
}
