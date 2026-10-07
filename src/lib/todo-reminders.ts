import { db, type Todo, type TodoOccurrence, type TodoReminder } from '../db';
import { useAuthStore } from '../store/auth-store';
import { IS_CAPACITOR } from './platform';
import { cancelTodoNotification, pendingTodoNotifications, scheduleTodoNotification, todoNotificationId, todoNotificationPermission } from './notify';

/** Only native acknowledgements can produce scheduled; delivery is never inferred. */
export interface TodoNotificationAdapter {
  supported: boolean;
  permission(): Promise<boolean>;
  pending(): Promise<number[]>;
  schedule(todo: Todo, occurrence: TodoOccurrence, at: number): Promise<{ id: number; ok: boolean }>;
  cancel(id: number): Promise<boolean>;
}
const native: TodoNotificationAdapter = { supported: IS_CAPACITOR, permission: todoNotificationPermission,
  pending: pendingTodoNotifications, schedule: scheduleTodoNotification, cancel: cancelTodoNotification };
const queues = new Map<string, Promise<void>>();
const owned = (userId: string) => useAuthStore.getState().userId === userId;
const nextTime = (row: TodoReminder) => Math.max(Date.now(), row.updatedAt + 1);

export const REMINDER_STATUS_LABELS: Record<TodoReminder['status'], string> = {
  queued: '排队中', 'needs-permission': '待开通知权限', unsupported: '需在手机应用中启用',
  scheduled: '系统已安排', failed: '安排失败', 'cancel-pending': '旧提醒待取消',
  cancelled: '已取消', expired: '提醒时间已过', fired: '历史提醒已结束',
};

async function patch(row: TodoReminder, changes: Partial<TodoReminder>) {
  await db.transaction('rw', db.todoReminders, async () => {
    if (!owned(row.userId)) return;
    const current = await db.todoReminders.get(row.id);
    if (current?.updatedAt !== row.updatedAt) return;
    await db.todoReminders.update(row.id, { ...changes, updatedAt: nextTime(row) });
  });
}

async function source(row: TodoReminder) {
  const [todo, occurrence] = await Promise.all([db.todos.get(row.todoId), db.todoOccurrences.get(row.occurrenceId)]);
  if (!owned(row.userId) || todo?.userId !== row.userId || occurrence?.userId !== row.userId
    || todo.updatedAt !== row.todoVersion || occurrence.updatedAt !== row.occurrenceVersion
    || todo.status !== 'todo' || occurrence.status !== 'todo' || !occurrence.dueTime || !todo.reminderMinutes?.length) return;
  const dueAt = new Date(`${occurrence.dueDate}T${occurrence.dueTime}:00`).getTime();
  if (!todo.reminderMinutes.some(m => dueAt - m * 60000 === row.remindAt)) return;
  return { todo, occurrence };
}

/** Compensate only the native request this invocation already sent while authorised.
 * A logout cannot make its late notification permanent. Never edits life records.
 */
async function retractLateSchedule(row: TodoReminder, adapter: TodoNotificationAdapter): Promise<void> {
  const cancelling = await db.transaction('rw', db.todoReminders, async () => {
    const current = await db.todoReminders.get(row.id);
    if (current?.userId !== row.userId || current.updatedAt !== row.updatedAt || current.notificationId !== row.notificationId) return;
    const next: TodoReminder = { ...current, status: 'cancel-pending', updatedAt: nextTime(current), error: undefined };
    await db.todoReminders.put(next);
    return next;
  });
  if (!cancelling) return;
  const ok = await adapter.cancel(cancelling.notificationId).catch(() => false);
  await db.transaction('rw', db.todoReminders, async () => {
    const current = await db.todoReminders.get(cancelling.id);
    if (current?.userId !== row.userId || current.updatedAt !== cancelling.updatedAt) return;
    await db.todoReminders.update(current.id, { status: ok ? 'cancelled' : 'cancel-pending', updatedAt: nextTime(current),
      error: ok ? undefined : '旧提醒取消失败，返回原账号后重试。' });
  });
}

/** Persist cancellation before crossing the native boundary, retaining failed work for recovery. */
export async function cancelReminderRows(userId: string, rows: TodoReminder[], adapter = native): Promise<void> {
  for (const row of rows) {
    if (!owned(userId) || row.userId !== userId || ['cancelled', 'expired', 'fired'].includes(row.status)) continue;
    await patch(row, { status: 'cancel-pending', error: undefined });
    const pending = await db.todoReminders.get(row.id);
    if (!pending || pending.status !== 'cancel-pending' || !owned(userId)) continue;
    const ok = await adapter.cancel(pending.notificationId).catch(() => false);
    await patch(pending, { status: ok ? 'cancelled' : 'cancel-pending', error: ok ? undefined : '旧提醒取消失败，返回前台时将重试。' });
  }
}

export async function reconcileTodoReminders(userId: string, rows: { todo: Todo; occurrence: TodoOccurrence }[], adapter = native): Promise<void> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    if (!owned(userId)) return;
    const desired = new Map<string, TodoReminder>();
    for (const { todo, occurrence } of rows) {
      if (todo.userId !== userId || occurrence.userId !== userId || todo.status !== 'todo' || occurrence.status !== 'todo' || !occurrence.dueTime) continue;
      const dueAt = new Date(`${occurrence.dueDate}T${occurrence.dueTime}:00`).getTime();
      for (const minutes of (todo.reminderMinutes ?? []).slice(0, 3)) {
        const at = dueAt - minutes * 60000; if (at <= Date.now() || !Number.isFinite(at)) continue;
        const id = `todo-reminder:${todo.id}:${occurrence.id}:${at}`;
        desired.set(id, { id, userId, todoId: todo.id, occurrenceId: occurrence.id,
          notificationId: todoNotificationId(todo.id, occurrence.id, at), remindAt: at,
          todoVersion: todo.updatedAt, occurrenceVersion: occurrence.updatedAt, status: 'queued', createdAt: Date.now(), updatedAt: Date.now() });
      }
    }
    const existing = await db.todoReminders.where('userId').equals(userId).toArray();
    const obsolete = existing.filter(r => !desired.has(r.id) || r.status === 'cancel-pending'
      || desired.get(r.id)?.todoVersion !== r.todoVersion || desired.get(r.id)?.occurrenceVersion !== r.occurrenceVersion);
    await cancelReminderRows(userId, obsolete, adapter);
    // Do not install replacement alerts until older alerts for that todo have been cancelled.
    const blocked = new Set((await db.todoReminders.where('userId').equals(userId).filter(r => r.status === 'cancel-pending').toArray()).map(r => r.todoId));
    const permission = adapter.supported && await adapter.permission().catch(() => false);
    let pending: number[] | undefined;
    if (permission) pending = await adapter.pending().catch(() => undefined);
    for (const planned of desired.values()) {
      if (!owned(userId)) return;
      let row = await db.todoReminders.get(planned.id);
      if (blocked.has(planned.todoId)) continue;
      if (row?.status === 'scheduled' && row.todoVersion === planned.todoVersion && row.occurrenceVersion === planned.occurrenceVersion
        && permission && pending?.includes(row.notificationId)) continue;
      row = { ...planned, createdAt: row?.createdAt ?? planned.createdAt, updatedAt: row ? nextTime(row) : planned.updatedAt };
      await db.todoReminders.put(row);
      const actual = await source(row);
      if (!actual) { await patch(row, { status: 'cancelled' }); continue; }
      if (!adapter.supported || !permission) {
        await patch(row, { status: adapter.supported ? 'needs-permission' : 'unsupported' }); continue;
      }
      if (!pending) { await patch(row, { status: 'failed', error: '无法核对系统中的提醒，请重试。' }); continue; }
      const result = await adapter.schedule(actual.todo, actual.occurrence, row.remindAt).catch(() => ({ id: row!.notificationId, ok: false }));
      if (result.id !== row.notificationId || !await source(row)) {
        await retractLateSchedule(row, adapter); continue;
      }
      await patch(row, { status: result.ok ? 'scheduled' : 'failed', error: result.ok ? undefined : '系统未确认安排，请重试。' });
    }
  });
  queues.set(userId, work);
  try { await work; } finally { if (queues.get(userId) === work) queues.delete(userId); }
}
