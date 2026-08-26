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
    allowMixedContent: true,
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
      // insetsHandling: 'css' 让 WebView 全屏沉浸，由 CSS safe-area 变量接管状态栏区域
      insetsHandling: 'css',
    },
  },
};

export default config;
