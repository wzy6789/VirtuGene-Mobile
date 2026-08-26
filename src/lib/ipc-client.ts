/**
 * 平台 API 入口：Electron 环境走 preload 暴露的 window.virtugene（IPC 代理），
 * 其它环境（浏览器 / Capacitor 手机 WebView）走 webApi —— 直接 fetch DeepSeek。
 */
import { webApi } from './web-api';

export const ipc: VirtuGeneAPI = window.virtugene ?? webApi;
