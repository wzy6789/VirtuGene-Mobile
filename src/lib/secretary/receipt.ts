import { db, type Todo, type TodoReminder } from '../../db';
import { occurrenceId } from '../../db/todo-repo';
import { useAuthStore } from '../../store/auth-store';
import type { SecretaryMissingField } from './planning-contract';
import type { SecretaryResult } from './types';
import { DISPATCH_LABELS } from './dispatch-status';

export interface ReceiptViewModel {
  operationState: SecretaryResult['status'];
  operationLabel: string;
  missingFields: SecretaryMissingField[];
  entityState?: 'todo' | 'completed' | 'cancelled' | 'unavailable';
  entityRef?: { kind: 'todo' | 'diary' | 'moment'; id: string };
  entityVersion?: number;
  /** Historical receipts alone cannot establish current native scheduling. */
  notificationState: 'not-requested' | 'needs-time' | 'unverified';
  undoAvailable: boolean;
}

export interface NotificationReceipt { states: (TodoReminder['status'] | 'needs-time')[]; retry: boolean; permission: boolean }

/** A saved native acknowledgement must still match the live todo and occurrence versions. */
export async function readNotificationReceipt(userId: string, todoId: string, date?: string): Promise<NotificationReceipt | undefined> {
  if (useAuthStore.getState().userId !== userId) return;
  const todo = await db.todos.get(todoId);
  if (todo?.userId !== userId || todo.status !== 'todo' || !todo.reminderMinutes?.length) return;
  if (date) {
    const occurrence = await db.todoOccurrences.get(occurrenceId(todoId, date));
    if (occurrence?.userId === userId && occurrence.status !== 'todo') return;
  }
  if (!todo.dueDate || !todo.dueTime) return { states: ['needs-time'], retry: false, permission: false };
  const rows = await db.todoReminders.where('todoId').equals(todoId).filter(r => r.userId === userId && !['cancelled', 'expired', 'fired'].includes(r.status) && (!date || r.occurrenceId === occurrenceId(todoId, date) || r.status === 'cancel-pending')).toArray();
  const occurrences = await db.todoOccurrences.bulkGet(rows.map(r => r.occurrenceId));
  if (useAuthStore.getState().userId !== userId) return;
  const states: NotificationReceipt['states'] = [...new Set(rows.map((r, i) => {
    if (r.status === 'cancel-pending') return r.status;
    const occurrence = occurrences[i];
    if (r.todoVersion !== todo.updatedAt || occurrence?.userId !== userId || occurrence.updatedAt !== r.occurrenceVersion || occurrence.status !== 'todo') return 'queued' as const;
    if (r.remindAt <= Date.now()) return 'expired' as const;
    return r.status;
  }))];
  return { states: states.length ? states : ['queued'], retry: !states.length || states.some(s => ['failed', 'cancel-pending', 'queued'].includes(s)), permission: states.includes('needs-permission') };
}

export function receiptViewModel(result: SecretaryResult): ReceiptViewModel {
  const action = result.action;
  let operationLabel: string;
  if (result.status !== 'done') operationLabel = { pending: '处理中', draft: '草稿', 'needs-input': '待补充', failed: '未办成', undone: '已撤销' }[result.status];
  else {
    const labels: Partial<Record<typeof action.kind, string>> = { 'todo.create': '已添加', 'diary.save': '已保存', 'moment.publish': '已发布', 'todo.update': '已修改', 'todo.reschedule': '已修改', 'todo.cancel': '已取消', 'todo.reopen': '已恢复', 'todo.list': '已查到', 'diary.search': '已查到', 'moment.search': '已查到', 'app.open': '入口已就绪' };
    operationLabel = action.kind === 'todo.steps' ? action.stepMode === 'add' ? '已添加步骤' : action.stepMode === 'reopen' ? '已恢复步骤' : '已完成步骤' : labels[action.kind] ?? '已完成';
  }
  const missingFields: SecretaryMissingField[] = [];
  if (result.dispatch) operationLabel = DISPATCH_LABELS[result.dispatch.state];
  if (result.status === 'needs-input') {
    if (result.detail === '记成待办还是日记？') missingFields.push('purpose');
    else if (result.candidates?.length || result.stepCandidates?.length) missingFields.push('target');
    else if (action.kind === 'todo.create') {
      if (!action.title) missingFields.push('title');
      if ((action.reminder || action.time || action.recurrence && action.recurrence !== 'none') && !action.date) missingFields.push('date');
      if (action.reminder && !action.time) missingFields.push('time');
    }
  }
  const kind = action.kind.startsWith('todo.') ? 'todo' : action.kind.startsWith('diary.') ? 'diary' : action.kind.startsWith('moment.') ? 'moment' : undefined;
  return { operationState: result.status, operationLabel, missingFields,
    ...(kind && result.targetId ? { entityRef: { kind, id: result.targetId } } : {}), entityVersion: result.afterTodoVersion ?? result.afterVersion,
    notificationState: !action.reminder ? 'not-requested' : !action.date || !action.time ? 'needs-time' : 'unverified',
    undoAvailable: result.status === 'done' && !!result.targetId && Number.isFinite(result.afterVersion) };
}

/** Live entity state is separate from the historical operation receipt. No write side effects. */
export async function readTodoReceipt(userId: string, todoId: string, date?: string): Promise<{ todo?: Todo; entityState: ReceiptViewModel['entityState']; entityVersion?: number }> {
  if (useAuthStore.getState().userId !== userId) return { entityState: 'unavailable' };
  const item = await db.todos.get(todoId);
  if (item?.userId !== userId || item.status === 'deleted') return { entityState: 'unavailable' };
  const occurrence = date && item.recurrence.kind !== 'none' ? await db.todoOccurrences.get(occurrenceId(item.id, date)) : undefined;
  if (useAuthStore.getState().userId !== userId) return { entityState: 'unavailable' };
  const todo = occurrence?.userId === userId && item.status !== 'cancelled' ? { ...item, status: occurrence.status === 'completed' ? 'completed' as const : 'todo' as const } : item;
  return { todo, entityState: todo.status as 'todo' | 'completed' | 'cancelled', entityVersion: item.updatedAt };
}
