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
  // Vite 开发服务器是移动端设计预览，根地址也应与 APK 使用同一套布局。
  if (import.meta.env.DEV) return true;
  // 设计同步预览通过查询参数强制使用手机端布局，方便在桌面浏览器里直接验收移动 UI。
  // 只影响当前预览地址，不改变正式浏览器或 Capacitor 的平台判断。
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('virtugene-preview') === 'mobile') return true;
  }
  if (typeof navigator === 'undefined') return false;
  if (isCapacitorPlatform()) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export const IS_MOBILE = isMobileDevice();
export const IS_CAPACITOR = isCapacitorPlatform();
export const IS_ELECTRON = isElectronPlatform();
