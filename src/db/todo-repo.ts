import { db, type Todo, type TodoOccurrence, type TodoRecurrence, type TodoReminder } from './index';
import { cancelTodoNotification, scheduleTodoNotification, todoNotificationId } from '../lib/notify';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

export type TodoWithOccurrence = { todo: Todo; occurrence: TodoOccurrence };

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addLocalDays(dateKey: string, amount: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const value = new Date(y, m - 1, d);
  value.setDate(value.getDate() + amount);
  return localDateKey(value);
}

export function dateDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function dateLabel(dateKey: string): string {
  const today = localDateKey();
  if (dateKey === today) return '今天';
  if (dateKey === addLocalDays(today, 1)) return '明天';
  if (dateKey === addLocalDays(today, -1)) return '昨天';
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${m}月${d}日` + (y === new Date().getFullYear() ? '' : ` · ${y}`);
}

export function occurrenceId(todoId: string, date: string): string {
  return `todo-occ:${todoId}:${date}`;
}

function matchesRecurrence(recurrence: TodoRecurrence, original: string, date: string): boolean {
  const distance = dateDiff(original, date);
  if (distance < 0) return false;
  if (recurrence.kind === 'none') return distance === 0;
  if (recurrence.kind === 'daily') return distance % Math.max(1, recurrence.interval ?? 1) === 0;
  const dayOfWeek = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8))).getDay();
  if (recurrence.kind === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
  if (recurrence.kind === 'weekly') {
    const weekdays = recurrence.weekdays.length ? recurrence.weekdays : [dayOfWeek];
    return weekdays.includes(dayOfWeek) && Math.floor(distance / 7) % Math.max(1, recurrence.interval ?? 1) === 0;
  }
  if (recurrence.kind === 'interval') return distance % Math.max(1, recurrence.days) === 0;
  const [oy, om] = original.split('-').map(Number);
  const [y, m] = date.split('-').map(Number);
  if (m < om || (y === oy && m === om && distance === 0)) return m === om && y === oy && recurrence.day === Number(original.slice(8));
  const months = (y - oy) * 12 + (m - om);
  return months % Math.max(1, recurrence.interval ?? 1) === 0 && Number(date.slice(8)) === Math.min(recurrence.day, new Date(y, m, 0).getDate());
}

export function expandOccurrenceDates(todo: Todo, from: string, to: string): string[] {
  if (!todo.dueDate || todo.status === 'deleted' || todo.status === 'cancelled') return [];
  const start = todo.dueDate > from ? todo.dueDate : from;
  const result: string[] = [];
  for (let date = start; date <= to; date = addLocalDays(date, 1)) {
    if (matchesRecurrence(todo.recurrence, todo.dueDate, date)) result.push(date);
  }
  return result;
}

async function ensureOccurrence(todo: Todo, date: string): Promise<TodoOccurrence> {
  const id = occurrenceId(todo.id, date);
  const existing = await db.todoOccurrences.get(id);
  if (existing) return existing;
  const now = Date.now();
  const row: TodoOccurrence = {
    id, userId: todo.userId, todoId: todo.id, dueDate: date, dueTime: todo.dueTime,
    status: todo.status === 'completed' && todo.recurrence.kind === 'none' ? 'completed' : 'todo',
    originalDueDate: todo.dueDate ?? date, createdAt: now, updatedAt: now,
  };
  await db.todoOccurrences.put(row);
  return row;
}

export const todoRepo = {
  async list(userId: string, from: string, to: string, includeUnplanned = true): Promise<TodoWithOccurrence[]> {
    const todos = await db.todos.where('userId').equals(userId).filter((todo) => todo.status !== 'deleted' && todo.status !== 'cancelled').toArray();
    const rows: TodoWithOccurrence[] = [];
    for (const todo of todos) {
      if (!todo.dueDate) {
        if (includeUnplanned) rows.push({ todo, occurrence: await ensureOccurrence(todo, '9999-12-31') });
        continue;
      }
      for (const date of expandOccurrenceDates(todo, from, to)) rows.push({ todo, occurrence: await ensureOccurrence(todo, date) });
    }
    return rows.sort((a, b) => {
      const ad = a.occurrence.dueDate.localeCompare(b.occurrence.dueDate);
      if (ad) return ad;
      if (!!a.todo.dueTime !== !!b.todo.dueTime) return a.todo.dueTime ? 1 : -1;
      return (a.todo.dueTime ?? '').localeCompare(b.todo.dueTime ?? '') || (b.todo.priority === 'urgent' ? 1 : 0) - (a.todo.priority === 'urgent' ? 1 : 0);
    });
  },
  async get(userId: string, id: string) {
    const row = await db.todos.get(id);
    return row?.userId === userId ? row : undefined;
  },
  async create(input: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: Todo['status'] }): Promise<Todo> {
    const now = Date.now();
    const todo: Todo = { ...input, id: crypto.randomUUID(), status: input.status ?? 'todo', createdAt: now, updatedAt: now };
    await db.todos.put(todo);
    return todo;
  },
  async update(userId: string, id: string, patch: Partial<Todo>): Promise<Todo> {
    const current = await this.get(userId, id);
    if (!current) throw new Error('todo:not-found');
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    const todo = { ...current, ...patch, id, userId, updatedAt };
    const sharingChanged = ('visibility' in patch && patch.visibility !== current.visibility)
      || ('visibleTo' in patch && JSON.stringify([...(patch.visibleTo ?? [])].sort()) !== JSON.stringify([...(current.visibleTo ?? [])].sort()));
    const todoContentChanged = ['title', 'note', 'dueDate', 'dueTime'].some((key) => key in patch && patch[key as keyof Todo] !== current[key as keyof Todo]);
    await db.transaction('rw', [db.todos, db.todoOccurrences, db.memorySourceTombstones], async () => {
      if (patch.status === 'cancelled' && current.status !== 'cancelled') {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'todo', sourceId: id, sourceRevision: current.updatedAt, status: 'withdrawn' });
      } else if (patch.status === 'deleted' && current.status !== 'deleted') {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'todo', sourceId: id, sourceRevision: current.updatedAt, status: 'deleted' });
      }
      if (sharingChanged || todoContentChanged || (patch.status === 'cancelled' && current.status !== 'cancelled') || (patch.status === 'deleted' && current.status !== 'deleted')) {
        const occurrences = await db.todoOccurrences.where('todoId').equals(id).filter((row) => row.userId === userId).toArray();
        for (const occurrence of occurrences) {
          await memorySourceTombstoneRepo.record({
            userId,
            sourceType: 'todoOccurrence',
            sourceId: occurrence.id,
            sourceRevision: occurrence.updatedAt,
            status: patch.status === 'deleted' ? 'deleted' : sharingChanged ? 'withdrawn' : 'superseded',
          });
          if (sharingChanged || todoContentChanged) await db.todoOccurrences.update(occurrence.id, { updatedAt: Math.max(updatedAt, occurrence.updatedAt + 1) });
        }
      }
      await db.todos.put(todo);
    });
    return todo;
  },
  async complete(userId: string, todoId: string, date: string): Promise<void> {
    const todo = await this.get(userId, todoId);
    if (!todo) return;
    const row = await ensureOccurrence(todo, date);
    const now = Math.max(Date.now(), row.updatedAt + 1);
    await db.todoOccurrences.update(row.id, { status: 'completed', completedAt: now, updatedAt: now });
    if (todo.recurrence.kind === 'none') await this.update(userId, todoId, { status: 'completed', completedAt: Date.now() });
  },
  async reopen(userId: string, todoId: string, date: string): Promise<void> {
    const todo = await this.get(userId, todoId);
    if (!todo) return;
    const row = await ensureOccurrence(todo, date);
    const now = Math.max(Date.now(), row.updatedAt + 1);
    await db.todoOccurrences.update(row.id, { status: 'todo', completedAt: undefined, updatedAt: now });
    if (todo.recurrence.kind === 'none') await this.update(userId, todoId, { status: 'todo', completedAt: undefined });
  },
  async remove(userId: string, id: string): Promise<void> {
    const todo = await this.get(userId, id);
    if (!todo) return;
    await this.update(userId, id, { status: 'deleted', deletedAt: Date.now() });
    const reminders = await db.todoReminders.where('todoId').equals(id).filter((item) => item.userId === userId).toArray();
    await Promise.all(reminders.filter((item) => item.notificationId > 0).map((item) => cancelTodoNotification(item.notificationId)));
    await db.todoReminders.where('todoId').equals(id).filter((item) => item.userId === userId).modify({ status: 'cancelled', updatedAt: Date.now() });
  },
  async visibleForCharacter(userId: string, characterId: string, limit = 5): Promise<Todo[]> {
    return (await this.visibleOccurrencesForCharacter(userId, characterId, limit)).map(({ todo }) => todo);
  },
  async visibleOccurrencesForCharacter(userId: string, characterId: string, limit = 5): Promise<TodoWithOccurrence[]> {
    const today = localDateKey();
    const rows = await this.list(userId, today, addLocalDays(today, 30), true);
    const seen = new Set<string>();
    return rows.filter(({ todo, occurrence }) => {
      if (todo.visibility !== 'selected' || !todo.visibleTo?.includes(characterId) || occurrence.status !== 'todo' || seen.has(todo.id)) return false;
      seen.add(todo.id);
      return true;
    }).slice(0, limit);
  },
  async completedVisibleForAudience(userId: string, audienceIds: string[], limit = 8, includeOlderHistory = false): Promise<{ todo: Todo; occurrence?: TodoOccurrence; completedAt: number }[]> {
    const audience = [...new Set(audienceIds)];
    if (!audience.length) return [];
    const todos = (await db.todos.where('userId').equals(userId).toArray()).filter((todo) =>
      todo.visibility === 'selected' && audience.every((id) => todo.visibleTo?.includes(id)) && todo.status !== 'deleted' && todo.status !== 'cancelled',
    );
    if (!todos.length) return [];
    const todoById = new Map(todos.map((todo) => [todo.id, todo]));
    const cutoff = Date.now() - 90 * 86400000;
    const occurrences = await db.todoOccurrences.where('todoId').anyOf(todos.map((todo) => todo.id)).toArray();
    const results: { todo: Todo; occurrence?: TodoOccurrence; completedAt: number }[] = occurrences
      .filter((occurrence) => occurrence.userId === userId && occurrence.status === 'completed' && (includeOlderHistory || (occurrence.completedAt ?? 0) >= cutoff))
      .flatMap((occurrence) => {
        const todo = todoById.get(occurrence.todoId);
        return todo ? [{ todo, occurrence, completedAt: occurrence.completedAt ?? occurrence.updatedAt }] : [];
      });
    for (const todo of todos) {
      if (todo.status === 'completed' && todo.completedAt && (includeOlderHistory || todo.completedAt >= cutoff) && !occurrences.some((occurrence) => occurrence.todoId === todo.id && occurrence.status === 'completed')) {
        results.push({ todo, completedAt: todo.completedAt });
      }
    }
    return results.sort((a, b) => b.completedAt - a.completedAt).slice(0, Math.max(0, limit));
  },
  async reminders(userId: string, todoId?: string): Promise<TodoReminder[]> {
    return db.todoReminders.where('userId').equals(userId).filter((r) => !todoId || r.todoId === todoId).toArray();
  },
  /** 打开待办页时重建未来 60 天的本地提醒；系统通知丢失后也能恢复。 */
  async rebuildReminders(userId: string): Promise<void> {
    const from = localDateKey();
    const rows = await this.list(userId, from, addLocalDays(from, 60), false);
    for (const { todo, occurrence } of rows) {
      if (!todo.dueTime || !todo.reminderMinutes?.length || occurrence.status !== 'todo') continue;
      const dueAt = new Date(`${occurrence.dueDate}T${todo.dueTime}:00`).getTime();
      for (const minutes of todo.reminderMinutes.slice(0, 3)) {
        const remindAt = dueAt - minutes * 60000;
        if (remindAt <= Date.now()) continue;
        const notificationId = todoNotificationId(todo.id, occurrence.id, remindAt);
        const existing = await db.todoReminders.where('notificationId').equals(notificationId).first();
        if (existing?.status === 'scheduled') continue;
        const scheduled = await scheduleTodoNotification(todo, occurrence, remindAt);
        await db.todoReminders.put({ id: `todo-reminder:${todo.id}:${occurrence.id}:${remindAt}`, userId, todoId: todo.id, occurrenceId: occurrence.id, notificationId: scheduled.id, remindAt, status: scheduled.ok ? 'scheduled' : 'failed', createdAt: Date.now(), updatedAt: Date.now() });
      }
    }
  },
};
