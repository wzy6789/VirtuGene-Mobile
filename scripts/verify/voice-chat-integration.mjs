import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const before = process.argv.includes('--before'), raceBefore = process.argv.includes('--race-red'), snapshotMode = before || raceBefore;
const mode = raceBefore ? 'race-before' : before ? 'before' : 'after';
const preview = process.argv.includes('--preview');
const evidence = `.tmp-preview/ui-overhaul-20261016/voice-chat-integration/${mode}`;
mkdirSync(evidence, { recursive: true });
for (const path of ['src/components/chat/ChatWindow.tsx', 'src/components/chat/ChatHeaderMoreMenu.tsx', 'src/store/voice-call-store.ts']) {
  const snapshot = `${evidence}/${path.split('/').at(-1)}`;
  if (!snapshotMode || !existsSync(snapshot)) copyFileSync(path, snapshot);
}
const bundle = await build({ entryPoints: ['scripts/verify/voice-chat-integration.tsx'], outfile: 'integration.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"test"' },
  plugins: [{ name: 'inert-controller-no-audio-or-model', setup(builder) {
    builder.onLoad({ filter: /voice-call[\\/]controller\.ts$/ }, () => ({ contents: readFileSync('scripts/verify/voice-chat-integration.controller.ts', 'utf8'), loader: 'ts' }));
    if (snapshotMode) builder.onLoad({ filter: /[\\/](ChatWindow|ChatHeaderMoreMenu|voice-call-store)\.tsx?$/ }, args => ({ contents: readFileSync(`${evidence}/${args.path.split(/[\\/]/).at(-1)}`, 'utf8'), resolveDir: dirname(args.path), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' }));
  } }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const baseCss = readdirSync('dist/renderer/assets').filter(name => name.endsWith('.css')).map(name => readFileSync(`dist/renderer/assets/${name}`, 'utf8')).join('\n');
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/test.js' ? 'application/javascript' : 'text/html;charset=utf-8');
  response.end(request.url === '/test.js' ? js : `<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'self'; media-src 'none'"><style>${baseCss}\n${css}</style></head><body><div id="root"></div><script>
    if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Microphone disabled in isolated preview')};
    HTMLMediaElement.prototype.play=async()=>{throw Error('Playback disabled in isolated preview')};
    for(const Constructor of [window.SpeechRecognition,window.webkitSpeechRecognition])if(Constructor)Constructor.prototype.start=function(){throw Error('Speech recognition disabled in isolated preview')};
    if(window.speechSynthesis)window.speechSynthesis.speak=function(){throw Error('Speech playback disabled in isolated preview')};
  </script><script src="/test.js"></script>${preview ? `<script>window.voiceChatIntegration.setup().then(()=>{const phase=new URLSearchParams(location.search).get('call');if(phase)window.voiceChatIntegration.callFixture(false,phase)})</script>` : ''}</body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
if (preview) {
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, pausedPreview: `http://127.0.0.1:${server.address().port}/?call=paused`, microphone: 'disabled', playback: 'disabled', externalRequests: 'blocked by CSP', realCallController: false, requiresLocalServer: true }));
  await new Promise(resolve => process.once('SIGINT', resolve)); await new Promise(resolve => server.close(resolve)); process.exit(0);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
const checks = [], errors = []; let blockedExternal = 0;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => { if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue(); blockedExternal++; return route.abort(); });
await page.addInitScript(() => {
  window.integrationDevices = { microphone: 0, playback: 0 };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.integrationDevices.microphone++; throw Error('Microphone forbidden in UI verification'); };
  HTMLMediaElement.prototype.play = async function () { window.integrationDevices.playback++; throw Error('Audio playback forbidden in UI verification'); };
});
const check = (name, actual, expected) => { try { assert.deepEqual(actual, expected); checks.push({ name, passed: true }); } catch { checks.push({ name, passed: false, actual, expected }); } };
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
  await page.waitForFunction(() => window.voiceChatIntegration); await page.evaluate(() => window.voiceChatIntegration.setup());
  await page.locator('.chat-header').waitFor();
  await page.screenshot({ path: `${evidence}/chat-entry-320.png` });
  const phone = page.locator('.chat-header > button[aria-label*="语音通话"]');
  check('visible phone entry in chat header', await phone.count(), 1);
  if (await phone.count()) {
    check('phone target is at least 44px and does not shrink', await phone.evaluate(node => { const box = node.getBoundingClientRect(); return box.width >= 44 && box.height >= 44 && getComputedStyle(node).flexShrink === '0'; }), true);
    await phone.click(); await page.getByRole('button', { name: '开始通话', exact: true }).waitFor();
    check('direct entry opens existing full-screen orb', await page.locator('.vg-voice-call-soul').count(), 1);
    await page.screenshot({ path: `${evidence}/full-screen-orb-320.png` });
    await page.locator('.vg-voice-call-minimize').click();
  }
  check('320px header has no overflow', await page.locator('.chat-header').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  check('long role title is ellipsized', await page.locator('.vg-chat-identity-copy [role=heading]').evaluate(node => getComputedStyle(node).textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth), true);
  check('presence stays on one line', await page.locator('.vg-chat-presence').evaluate(node => getComputedStyle(node).whiteSpace === 'nowrap'), true);
  check('all header controls retain 44px touch targets', await page.locator('.chat-header button').evaluateAll(nodes => nodes.every(node => { const rect = node.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44; })), true);
  // Emulate text enlargement only, leaving 44px touch controls and viewport fixed.
  const enlarged = await page.addStyleTag({ content: '.chat-header .vg-chat-identity-copy [role=heading]{font-size:34px!important}.chat-header .vg-chat-presence{font-size:22px!important}' });
  check('320px header with 200% text has no horizontal overflow', await page.locator('.chat-header').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  check('200% text keeps role name ellipsis', await page.locator('.vg-chat-identity-copy [role=heading]').evaluate(node => getComputedStyle(node).textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth), true);
  check('200% text keeps all header touch targets', await page.locator('.chat-header button').evaluateAll(nodes => nodes.every(node => { const rect = node.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44; })), true);
  await page.screenshot({ path: `${evidence}/chat-entry-text-200-320.png` }); await enlarged.evaluate(node => node.remove());
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.screenshot({ path: `${evidence}/chat-entry-light-390.png` });
  await page.evaluate(() => document.documentElement.classList.add('dark')); await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: '聊天设置', exact: true }).click();
  const profiles = await page.evaluate(() => window.voiceChatIntegration.profiles());
  const history = page.getByRole('button', { name: '本会话通话记录', exact: true });
  check('settings has direct call history', await history.count(), 1);
  if (await history.count()) {
    await history.click(); await page.getByRole('dialog', { name: /通话记录/ }).waitFor();
    check('history opens without a call target', await page.evaluate(() => window.voiceChatIntegration.target()), undefined);
    check('history does not create a voice profile', await page.evaluate(() => window.voiceChatIntegration.profiles()), profiles);
    check('history shows matching session audit', await page.getByText('本会话交流原文', { exact: true }).count(), 1);
    check('history hides foreign accounts and sessions', await page.getByText(/其他(?:会话|账号)的私有交流/).count(), 0);
    await page.screenshot({ path: `${evidence}/direct-history-320.png` });
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.voiceChatIntegration.callFixture(false, 'paused'));
  await page.locator('.vg-voice-call-capsule').waitFor();
  const status = page.locator('[data-chat-call-status]');
  check('minimized call has a chat status notice', await status.count(), 1);
  await page.screenshot({ path: `${evidence}/chat-paused-320.png` });
  if (await status.count()) {
    check('paused status reflects controller', await status.innerText().then(text => text.includes('通话已暂停')), true);
    await status.getByRole('button', { name: '返回通话', exact: true }).click();
    await page.getByRole('button', { name: '继续通话', exact: true }).waitFor();
    check('restoring call does not resume audio', await page.evaluate(() => window.voiceChatIntegration.resumeCalls()), 0);
    await page.getByRole('button', { name: '收起通话', exact: true }).click();
    await page.evaluate(() => window.voiceChatIntegration.phase('playing'));
    await status.getByRole('status').filter({ hasText: '正在回应' }).waitFor();
    const commits = await page.evaluate(() => window.voiceChatIntegration.commits());
    await page.evaluate(() => window.voiceChatIntegration.level()); await page.waitForTimeout(100);
    check('capture levels do not rerender entire chat', await page.evaluate(() => window.voiceChatIntegration.commits()), commits);
    await page.screenshot({ path: `${evidence}/chat-call-status-320.png` });
  }
  await page.evaluate(() => { window.voiceChatIntegration.resetCall(); window.voiceChatIntegration.callFixture(true); });
  const foreignEntry = page.locator('.chat-header > button[aria-label="返回与另一位角色的语音通话"]');
  check('foreign call entry names its actual role', await foreignEntry.count(), 1);
  if (await foreignEntry.count()) { await foreignEntry.click(); check('foreign call restores original target', await page.evaluate(() => window.voiceChatIntegration.target()), '另一位角色'); }
  await page.evaluate(() => window.voiceChatIntegration.resetCall());
  for (const initialCount of [199, 405]) {
    const result = await page.evaluate(count => window.voiceChatIntegration.pagination(count), initialCount);
    writeFileSync(`${evidence}/pagination-${initialCount}.json`, JSON.stringify(result, null, 2));
    check(`${initialCount} archive keeps older message access`, result.hasMore, true);
    check(`${initialCount} archive can load earlier messages`, result.afterLoadEarlier, Math.min(initialCount + 4, 400));
    check(`${initialCount} archive uses bounded 200-row page`, result.returnedRows, 200);
    check(`${initialCount} archive refresh uses count and no full-read`, { page: result.pageCalls, count: result.countCalls, all: result.fullReads }, { page: 1, count: 1, all: 0 });
    check(`${initialCount} archive page uses composite index`, result.queries.some(query => query.index === '[sessionId+createdAt+id]' && query.rows === 200), true);
    check(`${initialCount} archive count uses session index`, result.counts.some(query => query.index === 'sessionId'), true);
  }
  for (const guard of ['session', 'account']) {
    const result = await page.evaluate(value => window.voiceChatIntegration.pagination(199, value), guard);
    writeFileSync(`${evidence}/pagination-guard-${guard}.json`, JSON.stringify(result, null, 2));
    check(`late ${guard} change does not set stale pagination`, result.hasMore, false);
    if (guard === 'session') check('late session change keeps new chat empty', result.loaded, 0);
  }
  if (!before) for (const [guard, count] of [['earlier', 299], ['new-message', 199]]) {
    const result = await page.evaluate(({ guard, count }) => window.voiceChatIntegration.pagination(count, guard), { guard, count });
    writeFileSync(`${evidence}/pagination-race-${guard}.json`, JSON.stringify(result, null, 2));
    check(`delayed count preserves same-session ${guard} window`, result.windowPreserved, true);
    check(`delayed count preserves same-session ${guard} pagination flag`, result.hasMorePreserved, true);
    check(`same-session ${guard} race keeps call speech queryable`, result.laterCallMessages, 4);
    check(`same-session ${guard} race avoids full archive reads`, result.fullReads, 0);
    if (guard === 'new-message') check('message sent during count remains visible', result.freshMessageVisible, true);
    else check('history loaded during count remains visible', result.loaded, 299);
  }
  check('no microphone or playback use', await page.evaluate(() => window.integrationDevices), { microphone: 0, playback: 0 });
  check('no uncaught browser errors', errors, []);
} catch (error) { checks.push({ name: 'runner completion', passed: false, error: error.stack }); await page.screenshot({ path: `${evidence}/failure.png` }); }
finally {
  const result = { mode, checks, passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length, blockedExternal, realModelCalls: 0, modelTokens: 0, androidTested: false,
    isolation: 'Fresh Chromium context and synthetic IndexedDB account; all external requests blocked; real ChatWindow/Host/History/store persistence with inert call controller; microphone/playback forbidden; existing dist CSS, no Vite build.' };
  writeFileSync(`${evidence}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  await browser.close(); await new Promise(resolve => server.close(resolve));
  if (result.failed) process.exitCode = 1;
}
