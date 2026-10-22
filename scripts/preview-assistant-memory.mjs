import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
const evidence = resolve('.tmp-preview/character-portability-20261015/continuation-1/assistant-preview');
mkdirSync(evidence, { recursive: true });
const assets = resolve('dist/renderer/assets');
const names = new Set(readdirSync(assets));
const styles = [...names].filter(n => n.endsWith('.css')).map(n => readFileSync(join(assets, n), 'utf8')).join('\n');
const bundle = await build({ entryPoints: ['scripts/verify/assistant-memory-preview.tsx'], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"local-preview"' } });
const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  res.setHeader('Permissions-Policy', 'microphone=(), camera=()');
  if (path === '/preview.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
  const name = basename(path);
  if (path.startsWith('/assets/') && names.has(name)) { res.setHeader('Content-Type', name.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream'); res.end(readFileSync(join(assets, name))); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html class="dark" lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}html,body,#root{height:100%;margin:0}</style><div id="root">正在准备助理记忆隔离演示…</div><script type="module" src="/preview.js"></script></html>`);
});
const verify = process.argv.includes('--verify');
await new Promise(r => server.listen(verify ? 0 : 5192, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`;
console.log(`Real ChatWindow and assistant memory; synthetic data, local transport, microphone disabled: ${url}`);
if (verify) {
  const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.getByText('记录里你后来更正为：不是周五，是周四。', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('记录里你后来更正为：不是周五，是周四。', { exact: true }).waitFor();
    await page.screenshot({ path: join(evidence, 'assistant-chat-390.png') });
    await page.getByRole('button', { name: '助理更多操作', exact: true }).click();
    await page.getByRole('button', { name: '助理记忆 · 查看、纠正与忘记', exact: true }).click();
    await page.getByRole('button', { name: '纠正：我长期在杭州工作', exact: true }).waitFor();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw Error('Overflow at ' + width);
      await page.screenshot({ path: join(evidence, `assistant-memory-${width}.png`) });
    }
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ url, errors, realComponent: ['ChatWindow', 'SecretaryMemoryModal'], widths: [320, 390, 430], beforeVisual: false, ...await page.evaluate(() => window.assistantMemoryPreview) }, null, 2));
    if (errors.length) throw Error(errors.join('\n'));
    console.log('PASS real assistant chat, menu and memory manager; three widths');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
}
