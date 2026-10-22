import type { CapacitorConfig } from '@capacitor/cli';

/**
 * VirtuGene 手机版（安卓/iOS）配置。
 * webDir 指向 Vite 渲染层构建产物（dist/renderer），本地优先、无远程服务器。
 *
 * - 数据同步：通过「局域网直连」与桌面端互传（见 electron/services/sync-server.ts 与
 *   src/components/settings/SyncSection.tsx）：桌面端开启 HTTP 同步服务，手机端填 IP 拉取/推送。
 * - cleartext/mixedContent：允许手机端以 http:// 直连局域网内的桌面同步服务。
 */
const config: CapacitorConfig = {
  appId: 'com.virtugene.app',
  appName: 'VirtuGene',
  webDir: 'dist/renderer',
  android: {
    // Capacitor's bridge otherwise logs native arguments in debug builds;
    // voice requests include credentials and private audio/text payloads.
    loggingBehavior: 'none',
    allowMixedContent: true,
    // Edge-TTS 语音接口按 User-Agent 校验：只认桌面 Chrome/Edge UA（手机 UA 返回 403）。
    // 浏览器 WebSocket 无法自定义请求头，故全局覆写为桌面 UA —— 实测任意 Origin 均可直连，
    // 手机端不依赖电脑、不需要代理即可获得与桌面同款微软神经网络音色。
    overrideUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0F0F1A',
    },
    SystemBars: {
      // 状态栏/导航栏固定深色样式（白色图标），配合 app 品牌深色，避免顶部白色
      style: 'DARK',
      // 新 WebView 用 CSS 变量报告剩余安全区；旧 WebView 可由原生先避让并报告0。
      // 页面读取 --safe-area-inset-*，不要再叠加固定状态栏高度。
      insetsHandling: 'css',
    },
  },
};

export default config;
