import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundle = await build({ entryPoints: ['scripts/verify/chat-policy.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' }, define: { 'import.meta.hot': 'undefined', 'import.meta.env': '{"DEV":true,"VITE_AI_GATEWAY_URL":"http://voice-fixture-gateway"}', __APP_VERSION__: '"test"' } });
const assets = 'dist/renderer/assets';
const css = readdirSync(assets).filter(f => f.endsWith('.css')).map(f => `<link rel="stylesheet" href="/assets/${f}">`).join('');
const server = createServer((req, res) => {
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url.startsWith('/assets/')) { try { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(readFileSync(join(assets, basename(req.url)))); } catch { res.writeHead(404); res.end(); } }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="app"></div><script src="/test.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', item => { if (item.type() === 'log') console.log(item.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => !!window.chatPolicy);
  const outcome = await page.evaluate(() => window.chatPolicy.run());
  let ui = 0; const check = (value, label) => { if (!value) throw Error(label); ui++; console.log(`ok ${label}`); };
  await page.getByRole('button', { name: '补全声音样本', exact: true }).click();
  await page.getByLabel('声音样本预览').waitFor();
  check((await page.getByLabel('声音样本预览').innerText()).includes('[角色声音样本]'), 'actual edit form previews independent marked block');
  check(!(await page.evaluate(id => window.chatPolicy.record(id), outcome.manualId)).voiceSamples, 'preview performs zero character writes');
  await page.getByRole('button', { name: '放弃这版', exact: true }).click();
  check(await page.getByLabel('声音样本预览').count() === 0, 'discard removes preview without adopting');
  await page.evaluate(() => window.chatPolicy.holdNext());
  await page.getByRole('button', { name: '补全声音样本', exact: true }).click();
  await page.waitForFunction(() => window.chatPolicy.held());
  await page.locator('input').filter({ visible: true }).first().fill('修改中的名字');
  await page.evaluate(() => window.chatPolicy.release());
  await page.getByRole('button', { name: '补全声音样本', exact: true }).waitFor();
  check(await page.getByLabel('声音样本预览').count() === 0, 'editing source while manual generation is pending rejects late preview');
  await page.getByRole('button', { name: '补全声音样本', exact: true }).click();
  await page.getByLabel('声音样本预览').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '320px voice preview has no horizontal overflow');
  check((await page.getByRole('button', { name: '采用声音样本', exact: true }).boundingBox()).height >= 44, 'adopt action retains mobile touch target');
  await page.getByRole('button', { name: '采用声音样本', exact: true }).click();
  check(!(await page.evaluate(id => window.chatPolicy.record(id), outcome.manualId)).voiceSamples, 'adoption stays local until explicit save-role action');
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  await page.waitForFunction(() => window.chatPolicy.closed());
  const saved = await page.evaluate(id => window.chatPolicy.record(id), outcome.manualId);
  check(saved.voiceSamples?.lines.length === 4 && saved.systemPrompt === outcome.originalPersona, 'actual save-role persists cache while preserving original persona');
  check(await page.evaluate(char => window.chatPolicy.voicePromptRevision(char), saved) === saved.voiceSamples.promptRevision, 'saved voice revision matches final edit form fields');
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`PASS chat-policy: ${outcome.checks} data checks + ${ui} real edit-form checks`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
