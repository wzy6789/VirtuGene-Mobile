import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const before = process.argv.includes('--record-before');
const evidence = resolve(process.env.VG_CHAT_FOCUS_OUTPUT || '.tmp-preview/ui-overhaul-20261016/chat-reading-focus');
const out = join(evidence, before ? 'before' : 'after');
mkdirSync(out, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['src/components/chat/ChatWindow.tsx', 'src/components/chat/ChatInput.tsx',
  'src/components/ui/useLatestMessageScroll.ts', 'scripts/verify/chat-stream.tsx', 'scripts/verify/chat-stream-ui.tsx'];
if (before) {
  const snapshot = join(evidence, 'before-files');
  mkdirSync(snapshot, { recursive: true });
  for (const file of sources) copyFileSync(file, join(snapshot, basename(file)));
}
const assets = 'dist/renderer/assets';
const cssFiles = readdirSync(assets).filter(file => file.endsWith('.css'));
const css = cssFiles.map(file => readFileSync(join(assets, file), 'utf8')).join('\n');
writeFileSync(join(out, 'styles.css'), css);
const bundle = await build({ entryPoints: ['scripts/verify/chat-stream-ui.tsx'], bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' },
  define: { 'import.meta.hot': 'undefined', 'import.meta.env': '{"DEV":true,"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"focus-test"' } });
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
  else if (req.url.startsWith('/assets/')) {
    try { res.setHeader('Content-Type', 'font/woff2'); res.end(readFileSync(join(assets, basename(req.url)))); }
    catch { res.writeHead(404); res.end(); }
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><div id="app" class="mobile-layout"></div><script src="/fixture.js"></script></body></html>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = {
  phase: before ? 'before' : 'after', cwd: process.cwd(), checks: [], observations: [], screenshots: [], errors: [],
  sources: sources.map(file => ({ file, sha256: sha256(readFileSync(file)) })),
  css: { source: 'Existing dist CSS, read only; no dist build', files: cssFiles, sha256: sha256(css) },
  isolation: { blockedExternalRequests: 0, unexpectedFixtureNetwork: 0, microphoneCalls: 0, audioCalls: 0, realModelCalls: 0 },
  limits: ['Desktop Chrome mobile viewport; viewport resize simulates layout changes, not Android IME.',
    'Synthetic isolated IndexedDB, controlled in-page transport, no credentials or real microphone/audio.',
    'Model and reasoning strength unconfirmed; coding token/cost metering unavailable.'],
};
const check = (ok, label, detail) => { result.checks.push({ label, pass: !!ok, ...(detail ? { detail } : {}) }); };
try {
  for (const width of before ? [390] : [320, 390, 430]) for (const theme of before ? ['dark'] : ['dark', 'light']) {
    const height = width === 320 ? 568 : width === 430 ? 932 : 844;
    const label = `${theme}-${width}`;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true,
      ...(width === 390 && theme === 'dark' ? { recordVideo: { dir: join(out, 'video'), size: { width, height } } } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => result.errors.push({ label, message: error.message }));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      result.isolation.blockedExternalRequests++; return route.abort();
    });
    await page.addInitScript(() => {
      window.focusTestIsolation = { microphoneCalls: 0, audioCalls: 0 };
      const rejectMedia = () => { window.focusTestIsolation.microphoneCalls++; return Promise.reject(new Error('Isolated focus fixture')); };
      if (navigator.mediaDevices) { navigator.mediaDevices.getUserMedia = rejectMedia; navigator.mediaDevices.getDisplayMedia = rejectMedia; }
      for (const key of ['SpeechRecognition', 'webkitSpeechRecognition']) if (key in window) window[key] = class { start() { window.focusTestIsolation.microphoneCalls++; throw new Error('Isolated recognition'); } stop() {} abort() {} };
      HTMLMediaElement.prototype.play = function () { window.focusTestIsolation.audioCalls++; return Promise.reject(new Error('Isolated playback')); };
      if (window.speechSynthesis) window.speechSynthesis.speak = () => { window.focusTestIsolation.audioCalls++; };
    });
    await page.goto(origin);
    await page.waitForFunction(() => !!window.chatStreamTest);
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    const test = (name, ...args) => page.evaluate(({ name, args }) => window.chatStreamTest[name](...args), { name, args });
    const input = page.locator('.chat-composer textarea');
    const sample = () => page.locator('.chat-thread').evaluate(node => ({ top: node.scrollTop,
      gap: node.scrollHeight - node.scrollTop - node.clientHeight,
      following: document.querySelector('.vg-latest-message-anchor')?.getAttribute('aria-hidden') === 'true' }));
    const history = async () => {
      await page.locator('.chat-thread').evaluate(node => { node.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 })); node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
      await page.waitForTimeout(100);
      return sample();
    };
    const latest = () => page.waitForFunction(() => { const node = document.querySelector('.chat-thread'); return node.scrollHeight - node.scrollTop - node.clientHeight < 8; });
    const shot = async suffix => { const path = join(out, `${label}-${suffix}.png`); await page.screenshot({ path }); result.screenshots.push(path); };
    await test('setup', 40); await input.waitFor(); await page.waitForTimeout(500);
    const initial = await history();
    if (width === 390 && theme === 'dark') await shot('history-before-focus');
    await input.focus(); await page.waitForTimeout(400);
    const focused = await sample();
    check(Math.abs(focused.top - initial.top) < 2 && !focused.following, `${label}: focusing composer preserves history reading`, { initial, focused });
    if (width === 390 && theme === 'dark') await shot('history-after-focus');
    await history(); await input.tap(); await page.waitForTimeout(400);
    const clicked = await sample();
    check(clicked.top < 2 && !clicked.following, `${label}: clicking the already focused composer preserves history`, clicked);
    await history(); await input.fill('Reading an earlier message.\nA local draft.\nStill reading.'); await page.waitForTimeout(150);
    const grownInput = await sample();
    check(grownInput.top < 2 && !grownInput.following, `${label}: growing the input preserves history`, grownInput);
    await page.setViewportSize({ width, height: height - 220 }); await page.waitForTimeout(400);
    const historyShrunk = await sample();
    check(historyShrunk.top < 2 && !historyShrunk.following, `${label}: focused viewport shrink preserves history`, historyShrunk);
    await page.setViewportSize({ width, height }); await page.waitForTimeout(400);
    const historyRestored = await sample();
    check(historyRestored.top < 2 && !historyRestored.following, `${label}: focused viewport restoration preserves history`, historyRestored);
    await page.locator('.vg-latest-message-button').tap(); await latest();
    await input.fill('A short draft.'); await input.tap(); await page.waitForTimeout(400);
    check((await sample()).gap < 8, `${label}: focusing at the bottom keeps the last message visible`);
    await page.setViewportSize({ width, height: height - 220 }); await page.waitForTimeout(400);
    check((await sample()).gap < 8, `${label}: the bottom follows a focused viewport shrink`);
    await page.setViewportSize({ width, height }); await page.waitForTimeout(400);
    check((await sample()).gap < 8, `${label}: the bottom follows viewport restoration`);
    await history(); await input.fill('Send from history.'); await page.locator('.chat-composer-send').tap();
    await page.waitForFunction(() => window.chatStreamTest.requests().length === 1); await page.waitForTimeout(400);
    check((await sample()).gap < 8 && (await sample()).following, `${label}: explicit send from history resumes latest`, await sample());
    await test('push', 0, '今天路过书店。'.repeat(80)); await page.locator('[data-streaming-reply]').waitFor(); await page.waitForTimeout(200); await latest();
    check((await sample()).gap < 8, `${label}: the bottom follows a long streaming reply`);
    await history(); await test('push', 0, '后来又看了一场展览。'.repeat(60)); await page.waitForTimeout(180);
    check((await sample()).top < 2 && !(await sample()).following, `${label}: further streaming text preserves history reading`, await sample());
    await page.setViewportSize({ width, height: height - 220 }); await page.waitForTimeout(300);
    check((await sample()).top < 2 && !(await sample()).following, `${label}: streaming viewport changes preserve history`);
    await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
    if (width === 390 && theme === 'dark') await shot('streaming-history');
    await page.locator('.vg-latest-message-button').tap(); await latest();
    check((await sample()).gap < 8 && (await sample()).following, `${label}: explicit latest still resumes follow during streaming`);
    await test('push', 0, '我们慢慢聊。'); await page.waitForTimeout(180); await latest();
    await test('finish', 0); await page.locator('.chat-composer-send[data-generating=true]').waitFor({ state: 'hidden' }); await page.waitForTimeout(300);
    check((await sample()).gap < 8 && !await input.isDisabled(), `${label}: stream completion preserves latest and restores input`);
    if (width === 390 && theme === 'dark') await shot('completed-latest');
    if (before) {
      await test('setup'); await input.waitFor(); await input.fill('draft only for role A'); await test('switchTo', 'b'); await page.waitForTimeout(100);
      result.observations.push({ issue: 'Unchanged: unsent draft survives direct conversation switch', draft: await input.inputValue(), header: await page.locator('.chat-header-title').innerText() });
      await test('setup'); await input.waitFor(); await test('holdUserWrite'); await test('submit', 'stop while local write pending');
      await page.waitForFunction(() => window.chatStreamTest.userWriteHeld()); await page.waitForTimeout(850);
      await page.locator('.chat-composer-send').tap(); await page.waitForTimeout(600);
      result.observations.push({ issue: 'Stopped local write: presentation ended while persistence remains locked',
        stoppedButtonVisible: await page.locator('.chat-composer-send[data-generating=true]').count() === 1,
        inputDisabled: await input.isDisabled(), header: await page.locator('.chat-header').innerText(), mockRequests: (await test('requests')).length });
      check(!await input.isDisabled()&&await page.locator('.chat-composer-send[data-generating=true]').count()===0,'Stopping a pending local write restores editing without generating controls');
      await shot('deferred-stop-pending-write'); await test('releaseUserWrite'); await page.waitForTimeout(150);
    }
    result.isolation.unexpectedFixtureNetwork += await test('extraNetwork');
    const media = await page.evaluate(() => window.focusTestIsolation);
    result.isolation.microphoneCalls += media.microphoneCalls; result.isolation.audioCalls += media.audioCalls;
    await context.close();
  }
  check(result.errors.length === 0, 'no browser runtime exceptions');
  check(Object.values(result.isolation).every(value => value === 0), 'zero external/model/microphone/audio calls', result.isolation);
  result.status = result.checks.every(item => item.pass) ? 'pass' : before ? 'baseline-regression-observed' : 'failed';
} catch (error) { result.status = 'failed'; result.failure = error.stack; }
finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, passed: result.checks.filter(item => item.pass).length, failed: result.checks.filter(item => !item.pass), failure: result.failure, evidence: join(out, 'result.json') }, null, 2));
}
if (result.status === 'failed') process.exitCode = 1;
