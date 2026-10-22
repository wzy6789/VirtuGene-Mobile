import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve, basename } from 'node:path';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const output = resolve('.tmp-preview/character-portability-20261015');
const assets = resolve('dist/renderer/assets');
const assetNames = new Set(readdirSync(assets));
const styles = [...assetNames].filter(name => name.endsWith('.css')).map(name => readFileSync(join(assets, name), 'utf8')).join('\n');
const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import './scripts/verify/character-portability';
import {createRoot} from 'react-dom/client';
import {ChatWindow} from './src/components/chat/ChatWindow';
import {useUIStore} from './src/store/ui-store';
const result=await window.characterPortability();
window.portabilityPreviewResult=result;
if(!result.complete)throw Error('Portability checks failed');
useUIStore.setState({activeView:'chat'});
createRoot(document.getElementById('root')).render(<ChatWindow/>);
` }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"test"' } });
const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/preview.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(result.outputFiles[0].text); return; }
  const name = basename(path);
  if (path.startsWith('/assets/') && assetNames.has(name)) { res.setHeader('Content-Type', name.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream'); res.end(readFileSync(join(assets, name))); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Permissions-Policy', 'microphone=(), camera=()');
  res.end(`<!doctype html><html class="dark" lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}html,body,#root{height:100%;margin:0}</style><div id="root">正在准备隔离记忆预览……</div><script type="module" src="/preview.js"></script></html>`);
});
const verify = process.argv.includes('--verify');
await new Promise(r => server.listen(verify ? 0 : 5191, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`;
console.log('Actual ChatWindow; isolated IndexedDB, deterministic local transport, microphone disabled: ' + url);
if (verify) {
  const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.getByPlaceholder('发消息…').waitFor({ timeout: 60000 });
    await page.getByText('你说改从西门会合，不走北门。', { exact: true }).waitFor();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw Error('Overflow at ' + width);
      await page.screenshot({ path: join(output, `actual-chat-${width}.png`) });
    }
    const checks = await page.evaluate(() => window.portabilityPreviewResult);
    writeFileSync(join(output, 'actual-chat-preview.json'), JSON.stringify({ checks: checks.checks, errors, widths: [320, 390, 430], actualComponent: 'ChatWindow', modelCalls: 0, noMicrophone: true, beforeVisual: false }, null, 2));
    if (errors.length) throw Error(errors.join('\n'));
    console.log('PASS actual ChatWindow memory preview at 320/390/430px');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
}
