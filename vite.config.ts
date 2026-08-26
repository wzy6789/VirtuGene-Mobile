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
  },
  server: {
    port: 5173,
    strictPort: true,
    // 允许局域网设备（手机）通过开发服务器预览
    host: true,
  },
});
