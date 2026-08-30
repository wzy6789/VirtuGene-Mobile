#!/usr/bin/env node
/**
 * 桌面测试版（手机尺寸）：构建渲染层 → 本地静态服务 → Edge app 模式打开 390×844 窗口。
 * 用法：npm run desktop:preview
 * ⚠️ 浏览器环境限制：语音识别/录音/系统通知等原生能力不可用；对话/群聊/设置等核心功能可测。
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist/renderer');
const PORT = 5174;

// 1. 构建渲染层
console.log('🔨 构建渲染层…');
execSync('node node_modules/vite/bin/vite.js build', { cwd: ROOT, stdio: 'inherit' });

// 2. 静态服务（SPA fallback）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    let filePath = resolve(DIST, '.' + urlPath);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(filePath)) filePath = resolve(DIST, 'index.html'); // SPA 路由回退
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`✅ 桌面测试版已启动：${url}（手机尺寸窗口 390×844）`);
  console.log('   ⚠️ 浏览器环境：语音识别/录音/系统通知不可用；对话/群聊/设置/多模型可测');
  console.log('   ⚠️ 退出：关闭命令行窗口或 Ctrl+C');
  // Edge app 模式打开手机尺寸窗口（优先 Edge，失败提示手动访问）
  try {
    execSync(`start msedge --app=${url} --window-size=390,844`, { shell: 'cmd.exe' });
  } catch {
    try {
      execSync(`start chrome --app=${url} --window-size=390,844`, { shell: 'cmd.exe' });
    } catch {
      console.log(`   未能自动打开浏览器，请手动访问 ${url}，并把窗口缩到手机尺寸`);
    }
  }
});
