import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  define: {
    // 注入应用版本号（webApi.app.getVersion 使用；Electron 走 app.getVersion）
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
          if (id.includes('/dexie/')) return 'storage-vendor';
          if (id.includes('/@tanstack/react-virtual/')) return 'virtual-list-vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 允许局域网设备（手机）通过开发服务器预览
    host: true,
    // 本地视觉验收会生成浏览器缓存，开发服务器无需监听这些临时文件。
    watch: {
      ignored: ['**/.tmp-preview/**'],
    },
  },
});
