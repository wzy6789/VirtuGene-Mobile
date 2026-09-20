/**
 * 本地通知（手机端系统通知）：封装 @capacitor/local-notifications。
 * 用于每日手账提醒等场景（桌面端走 Electron 系统通知，这里仅手机端生效）。
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { IS_CAPACITOR } from './platform';
import type { Todo, TodoOccurrence } from '../db';

/** 请求通知权限（首次使用时调用；拒绝后静默） */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!IS_CAPACITOR) return false;
  try {
    const perm = await LocalNotifications.requestPermissions();
    return perm.display === 'granted';
  } catch {
    return false;
  }
}

/**
 * 发送一条本地通知。
 * @returns 是否成功发送
 */
export async function notifyLocal(title: string, body: string): Promise<boolean> {
  if (!IS_CAPACITOR) return false;
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() / 1000) % 1000000,
          title,
          body,
          smallIcon: 'ic_stat_icon',
          iconColor: '#6C5CE7',
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** 待办通知使用稳定 id，编辑任务时可以精确取消旧提醒。 */
export function todoNotificationId(todoId: string, occurrenceId: string, remindAt: number): number {
  let hash = 2166136261;
  for (const char of `${todoId}:${occurrenceId}:${remindAt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 1000000 + ((hash >>> 0) % 1900000000);
}

export async function cancelTodoNotification(notificationId: number): Promise<void> {
  if (!IS_CAPACITOR) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: notificationId }] }); } catch { /* desktop/web no-op */ }
}

export async function scheduleTodoNotification(todo: Todo, occurrence: TodoOccurrence, remindAt: number): Promise<{ id: number; ok: boolean }> {
  const id = todoNotificationId(todo.id, occurrence.id, remindAt);
  if (!IS_CAPACITOR || remindAt <= Date.now()) return { id, ok: false };
  try {
    await LocalNotifications.schedule({ notifications: [{
      id,
      title: todo.title,
      body: todo.note?.trim() || '该做这件事了。',
      schedule: { at: new Date(remindAt), allowWhileIdle: true },
      smallIcon: 'ic_stat_icon',
      iconColor: '#6C5CE7',
      extra: { type: 'todo-reminder', todoId: todo.id, occurrenceId: occurrence.id },
    }] });
    return { id, ok: true };
  } catch { return { id, ok: false }; }
}
