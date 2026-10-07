import { db, type TodoOccurrence } from '../../db';
import { occurrenceId, expandOccurrenceDates, type TodoWithOccurrence } from '../../db/todo-repo';
import { scheduleDate, UNPLANNED_DATE } from '../action-cabin/query';
import { useAuthStore } from '../../store/auth-store';
import { validWorkDate } from '../../db/todo-work';

export interface SecretaryTodoContext {
  userId: string;
  todoId: string;
  occurrenceId: string;
  scheduledDate: string;
  todoVersion: number;
  occurrenceVersion: number;
}
export function todoConversationContext(row: TodoWithOccurrence): SecretaryTodoContext {
  return { userId: row.todo.userId, todoId: row.todo.id, occurrenceId: row.occurrence.id, scheduledDate: scheduleDate(row.occurrence), todoVersion: row.todo.updatedAt, occurrenceVersion: row.occurrence.updatedAt };
}

/** Re-read only this occurrence. Names and notes come from owned current data, never snapshots. */
export async function readConversationTodo(userId: string, context: SecretaryTodoContext, checkVersion = true): Promise<TodoWithOccurrence> {
  if (context.userId !== userId || useAuthStore.getState().userId !== userId || typeof context.todoId !== 'string' || !validWorkDate(context.scheduledDate) || !Number.isFinite(context.todoVersion) || !Number.isFinite(context.occurrenceVersion) || context.occurrenceId !== occurrenceId(context.todoId, context.scheduledDate)) throw new Error('这件事的来源已变化，请从今日页重新选择。');
  const todo = await db.todos.get(context.todoId);
  const stored = await db.todoOccurrences.get(context.occurrenceId);
  if (!todo || todo.userId !== userId || ['deleted', 'cancelled'].includes(todo.status) || stored && (stored.userId !== userId || stored.todoId !== todo.id || stored.status === 'skipped')) throw new Error('这件事已移除，请从今日页重新选择。');
  if (!stored && (todo.dueDate ? !expandOccurrenceDates(todo, context.scheduledDate, context.scheduledDate).length : context.scheduledDate !== UNPLANNED_DATE)) throw new Error('这次安排已变化，请从今日页重新选择。');
  if (checkVersion && (todo.updatedAt !== context.todoVersion || (stored?.updatedAt ?? 0) !== context.occurrenceVersion)) throw new Error('这件事后来已修改，请从今日页重新选择后再操作。');
  const occurrence: TodoOccurrence = stored ?? { id: context.occurrenceId, todoId: todo.id, userId, scheduledDate: context.scheduledDate, originalDueDate: todo.dueDate ?? context.scheduledDate, dueDate: context.scheduledDate, dueTime: todo.dueTime, status: todo.status === 'completed' && todo.recurrence.kind === 'none' ? 'completed' : 'todo', createdAt: todo.createdAt, updatedAt: 0 };
  if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换，操作已停止。');
  return { todo, occurrence };
}
