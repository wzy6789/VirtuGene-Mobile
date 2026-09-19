#!/usr/bin/env node
/**
 * 设计同步预览：启动 Vite 热更新，并用手机尺寸打开预览窗口。
 * 保存 React/CSS 后，页面会自动刷新，不需要重新生成 APK。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const VITE = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PORT = 5173;
const URL = `http://127.0.0.1:${PORT}/?virtugene-preview=mobile`;

const portIsInUse = () => new Promise((resolvePort) => {
  const socket = createConnection({ host: '127.0.0.1', port: PORT });
  socket.once('connect', () => {
    socket.destroy();
    resolvePort(true);
  });
  socket.once('error', () => {
    socket.destroy();
    resolvePort(false);
  });
});

const openAppWindow = (browser) => {
  try {
    spawnSync('cmd.exe', ['/c', 'start', '', browser, `--app=${URL}`, '--window-size=390,844'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
};

const start = async () => {
  const alreadyRunning = await portIsInUse();
  const vite = alreadyRunning
    ? null
    : spawn(process.execPath, [VITE, '--host', '127.0.0.1', '--port', String(PORT)], {
        cwd: ROOT,
        stdio: 'inherit',
        windowsHide: true,
      });

  setTimeout(() => {
    if (!openAppWindow('msedge.exe')) openAppWindow('chrome.exe');
    console.log(`\nVirtuGene 设计同步预览：${URL}`);
    console.log(alreadyRunning
      ? '检测到预览已在运行，已直接打开现有窗口。'
      : '窗口按手机尺寸打开；保存代码后会自动刷新。按 Ctrl+C 结束预览。');
  }, alreadyRunning ? 100 : 1200);

  const stop = () => {
    if (vite && !vite.killed) vite.kill('SIGTERM');
  };
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
  if (vite) vite.on('exit', (code) => process.exit(code ?? 0));
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
