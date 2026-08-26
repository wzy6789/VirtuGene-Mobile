/**
 * 本地通知（手机端系统通知）：封装 @capacitor/local-notifications。
 * 用于每日手账提醒等场景（桌面端走 Electron 系统通知，这里仅手机端生效）。
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { IS_CAPACITOR } from './platform';

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
