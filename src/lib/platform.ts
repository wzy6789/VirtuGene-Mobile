/**
 * 平台能力检测（模块加载时一次性判定，平台不会在运行中变化）。
 * - Electron 桌面：存在 window.virtugene（preload 注入）
 * - Capacitor 手机：存在 window.Capacitor 且 isNativePlatform() 为真
 * - 浏览器：以上皆无，按 UA 判定是否手机
 */

export function isElectronPlatform(): boolean {
  return typeof window !== 'undefined' && typeof (window as { virtugene?: unknown }).virtugene !== 'undefined';
}

export function isCapacitorPlatform(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor !== 'undefined' &&
    !!((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())
  );
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isCapacitorPlatform()) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export const IS_MOBILE = isMobileDevice();
export const IS_CAPACITOR = isCapacitorPlatform();
export const IS_ELECTRON = isElectronPlatform();
