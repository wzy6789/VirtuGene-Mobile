import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundle = await build({ entryPoints: ['scripts/verify/chat-stream.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env': '{"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"test"' } });
const assets = 'dist/renderer/assets';
const css = readdirSync(assets).filter(file => file.endsWith('.css')).map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('');
const server = createServer((req, res) => {
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url.startsWith('/assets/')) { try { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(readFileSync(join(assets, basename(req.url)))); } catch { res.writeHead(404); res.end(); } }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><div id="app"></div><script src="/test.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.chatStreamTest);
  const test = (name, ...args) => page.evaluate(({ name, args }) => window.chatStreamTest[name](...args), { name, args });
  const check = (ok, label) => { if (!ok) throw new Error(label); checks++; console.log(`ok ${label}`); };
  const waitRequests = count => page.waitForFunction(count => window.chatStreamTest.requests().length >= count, count);
  const done = () => page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden' });
  const ready = async history => { await test('setup', history); await page.getByRole('textbox', { name: '消息内容' }).waitFor({ state: 'visible' }); await page.waitForTimeout(100); };
  await ready(0);
  checks += await test('unitChecks'); console.log('ok transport and buffering checks');
  await test('submit', '你好', true); await waitRequests(1);
  await test('push', 0, '你好'); await page.locator('[data-streaming-reply]').waitFor();
  check((await test('requests'))[0].body.stream === true, 'real chat requests SSE');
  check((await test('records')).filter(m => m.role === 'user').length === 1, 'rapid double send saves one user message');
  check((await test('records')).filter(m => m.role === 'assistant').length === 0, 'visible draft precedes completion and is not a DB token write');
  check(await page.locator('.vg-typing-row').count() === 0, 'typing placeholder disappears on first visible text');
  await test('push', 0, '--'); await page.waitForTimeout(60);
  check(!(await page.locator('[data-streaming-reply]').innerText()).includes('--'), 'partial separator never flashes');
  await test('push', 0, '-我在这里。'); await test('finish', 0); await done();
  const split = (await test('records')).filter(m => m.role === 'assistant');
  check(split.map(m => m.content).join('|') === '你好|我在这里。' && split[0].replyBatchSize === 2, 'split replies saved once with batch metadata');
  check(await page.locator('[data-streaming-reply]').count() === 0, 'final rows replace preview');
  check(split[0].createdAt > (await test('records'))[0].createdAt && split[1].createdAt > split[0].createdAt, 'saved reply ordering survives reopening');

  await ready(0); await test('submit', '说说今天'); await waitRequests(1);
  await test('push', 0, '长长的第一条---嗯---啊---长长的第四条');
  await page.waitForFunction(() => document.querySelectorAll('.vg-streaming-part').length === 4);
  check((await test('records')).filter(m => m.role === 'assistant').length === 0, 'four visible bubbles remain transient until transport finishes');
  await test('push', 0, '---最后'); await test('finish', 0); await done();
  const fourRows = (await test('records')).filter(m => m.role === 'assistant');
  check(fourRows.length === 4 && fourRows.map(m => m.content).join('|') === '长长的第一条|嗯|啊|长长的第四条最后' && fourRows.every(m => m.replyBatchSize === 4), 'four streamed bubbles and overflow commit once with matching batch metadata');
  check((await page.evaluate(() => window.virtugeneChatQuality.report())).samples.at(-1).differenceRatio === 0, 'stream metrics compare actual raw text with all four persisted rows');

  await ready(0); await test('denyNext'); await test('submit', '凭据失败后重发'); await waitRequests(1); await done();
  check((await test('records'))[0].failed && (await test('requests')).length === 1, 'credential failure marks a retryable message without auto-retry');
  await page.getByTitle('发送失败，点击重发', { exact: true }).click(); await waitRequests(2);
  await test('push', 1, '这次收到你的消息了。'); await test('finish', 1); await done();
  check((await test('records')).filter(m => m.role === 'user').length === 1 && !(await test('records'))[0].failed, 'manual retry reuses the original user message');

  await ready(40);
  // Virtualized historical fixture can initially open mid-history. Establish
  // the user's explicit latest position before checking live following.
  const latest = page.getByRole('button', { name: '回到最新消息', exact: true });
  if (await latest.isVisible()) await latest.click();
  await page.waitForFunction(() => { const el = document.querySelector('.chat-thread'); return el.scrollHeight - el.scrollTop - el.clientHeight < 8; });
  await test('submit', '详细说说你的想法'); await waitRequests(1);
  await test('push', 0, '我想和你聊聊今天。'); await page.locator('[data-streaming-reply]').waitFor();
  const storeBefore = await test('storeChanges');
  await test('push', 0, '今天路过书店。'.repeat(100)); await page.waitForTimeout(200);
  check(await test('storeChanges') === storeBefore, 'stream updates do not invalidate the historical message store');
  const longGeometry = await page.locator('.chat-thread').evaluate(el => ({ height: el.scrollHeight, top: el.scrollTop, viewport: el.clientHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight }));
  check(longGeometry.gap < 8, `long reply follows bottom smoothly ${JSON.stringify(longGeometry)}`);
  await page.locator('.chat-thread').evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 })); el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  const readTop = await page.locator('.chat-thread').evaluate(el => el.scrollTop);
  await test('push', 0, '后来我又去看了展览。'.repeat(60)); await page.waitForTimeout(180);
  check(Math.abs(await page.locator('.chat-thread').evaluate(el => el.scrollTop) - readTop) < 8, 'reading history is not pulled back by stream');
  await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
  await page.waitForFunction(() => { const el = document.querySelector('.chat-thread'); return el.scrollHeight - el.scrollTop - el.clientHeight < 8; }, undefined, { timeout: 1500 });
  check(await page.locator('.chat-thread').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 8), 'return to latest resumes following');
  for (const width of [320, 390, 430]) { await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(70); check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `stream layout fits ${width}px`); }
  await page.setViewportSize({ width: 390, height: 844 });
  mkdirSync('.tmp-preview', { recursive: true }); await page.screenshot({ path: '.tmp-preview/chat-stream.png' });
  await page.getByRole('button', { name: '停止生成', exact: true }).click(); await done();
  const stopped = (await test('records')).filter(m => m.role === 'assistant' && !m.id.startsWith('history-'));
  check(stopped.length === 1 && stopped[0].stopped && stopped[0].interrupted && stopped[0].content.includes('展览'), 'stop retains complete received prefix with truthful status');
  check((await test('requests')).length === 1 && (await test('requests'))[0].aborted, 'stop aborts transport without retry');

  await ready(0); await test('submit', '在吗'); await waitRequests(1);
  await page.getByRole('button', { name: '停止生成', exact: true }).click(); await done();
  check((await test('records')).length === 1 && !(await test('records'))[0].failed, 'stop before text leaves user message without fake failure');

  await ready(0); await test('submit', '说点什么'); await waitRequests(1); await test('push', 0, '窗外正在下雨。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('fail', 0); await done();
  const partial = (await test('records')).filter(m => m.role === 'assistant');
  check(partial.length === 1 && partial[0].interrupted && !partial[0].stopped && partial[0].content === '窗外正在下雨。', 'network interruption saves partial response');
  check((await test('requests')).length === 1, 'visible response is never secretly regenerated');

  await ready(0); await test('submit', '给星遥的话'); await waitRequests(1); await test('push', 0, '星遥回复。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('switchTo', 'b'); await page.waitForTimeout(130);
  check(await page.locator('[data-streaming-reply]').count() === 0, 'old preview stays out of another conversation');
  await test('submit', '给林霜的话'); await waitRequests(2); await test('push', 1, '林霜回复。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('finish', 0); await page.waitForTimeout(150);
  check(await page.getByRole('button', { name: '停止生成', exact: true }).count() === 1, 'old request completion does not unlock current request');
  check((await test('records', 'b')).filter(m => m.role === 'assistant').length === 0, 'old reply is not written to current conversation');
  await test('switchTo', 'a'); await page.waitForTimeout(100);
  check((await test('records', 'a')).some(m => m.content === '星遥回复。'), 'background reply persists to its own session');
  await test('switchTo', 'b'); await page.waitForTimeout(100);
  check((await page.locator('[data-streaming-reply]').innerText()).includes('林霜回复。'), 'returning restores the live preview');
  await test('finish', 1); await done();
  check((await test('records', 'b')).some(m => m.content === '林霜回复。'), 'second conversation completes independently');

  await ready(0); await test('submit', '我要离开页面了'); await waitRequests(1); await test('push', 0, '这段话已经收到。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('unmount'); await page.waitForTimeout(250);
  check((await test('records')).some(m => m.role === 'assistant' && m.interrupted && m.content === '这段话已经收到。'), 'leaving page aborts and preserves received response');
  await ready(0); await test('submit', '我要切换账号了'); await waitRequests(1); await test('push', 0, '旧账号正文。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('logout'); await page.waitForTimeout(200);
  check(!(await test('records')).some(m => m.role === 'assistant'), 'account switch rejects late reply writes');
  check(await page.locator('[data-streaming-reply]').count() === 0, 'account switch clears the old live preview');
  check(await test('extraNetwork') === 0 && errors.length === 0, 'no real network or uncaught page errors');
  console.log(`PASS chat-stream: ${checks} checks`);
} finally { await browser.close(); server.close(); }
