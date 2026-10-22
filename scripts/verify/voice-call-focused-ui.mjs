import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';

const output = resolve(process.env.VG_VOICE_FOCUSED_OUTPUT || '.tmp-preview/ui-cinematic-20261021/P3/voice-focused');
mkdirSync(output, { recursive: true });
const report = { at: new Date().toISOString(), viewport: { width: 390, height: 844 }, theme: 'dark', checks: [], errors: [], screenshots: [], limits: ['Actual call UI with controlled presentation state and isolated IndexedDB.', 'No real model, microphone, native route, audio or Android latency validation.'] };
const inheritedIndex = process.argv.indexOf('--continue-from');
if (inheritedIndex >= 0) {
  const path = resolve(process.argv[inheritedIndex + 1]), previous = JSON.parse(readFileSync(path, 'utf8'));
  report.inheritedFrom = path;
  report.checks = previous.checks.filter(check => check.pass).map(check => ({ ...check, inheritedFrom: path }));
  report.screenshots = previous.screenshots.filter(path => !path.endsWith('failure.png'));
}
const inheritedNames = new Set(report.checks.map(check => check.name));
const sha = value => createHash('sha256').update(value).digest('hex');
const bundle = await build({ entryPoints: ['scripts/verify/voice-call-ui.tsx'], outfile: 'voice-call-focused.js', bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"focused-call-ui"' } });
const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const localCss = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
const baseCssPaths = readdirSync('dist/renderer/assets').filter(file => file.endsWith('.css')).map(file => `dist/renderer/assets/${file}`);
const css = baseCssPaths.map(file => readFileSync(file, 'utf8')).join('\n') + '\n' + localCss;
writeFileSync(resolve(output, 'source-hashes.json'), JSON.stringify({ at: report.at, bundle: sha(javascript), inputs: Object.keys(bundle.metafile.inputs).filter(existsSync).map(path => ({ path, sha256: sha(readFileSync(path)) })), baseCss: baseCssPaths.map(path => ({ path, sha256: sha(readFileSync(path)) })) }, null, 2));
const guards = `window.voiceIsolation={network:0,microphone:0,audio:0,native:0};const iso=window.voiceIsolation;window.fetch=async()=>{iso.network++;throw Error('Call UI blocks model/network')};XMLHttpRequest.prototype.open=function(){iso.network++;throw Error('Call UI blocks XHR')};for(const key of ['WebSocket','EventSource'])window[key]=class{constructor(){iso.network++;throw Error('Call UI blocks sockets')}};navigator.sendBeacon=()=>false;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{iso.microphone++;throw Error('Call UI blocks capture')};HTMLMediaElement.prototype.play=async()=>{iso.audio++;throw Error('Call UI blocks audio')};for(const key of ['AudioContext','webkitAudioContext'])window[key]=class{constructor(){iso.audio++;throw Error('Call UI blocks audio')}};window.Capacitor={getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>false,nativePromise:async()=>{iso.native++;throw Error('Call UI blocks native')},nativeCallback:()=>{iso.native++;throw Error('Call UI blocks native')}};`;
const server = createServer((request, response) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(javascript); return; }
  if (path.startsWith('/fonts/')) {
    const font = resolve('dist/renderer', '.' + path);
    if (font.startsWith(resolve('dist/renderer') + '/') || font.startsWith(resolve('dist/renderer') + '\\')) {
      if (existsSync(font)) { response.setHeader('Content-Type', extname(font) === '.woff2' ? 'font/woff2' : 'application/octet-stream'); response.end(readFileSync(font)); return; }
    }
    response.writeHead(404).end(); return;
  }
  if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'");
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  response.end(`<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}\nhtml,body,#root{height:100%;margin:0}body{background:var(--bg);color:var(--text)}</style><script>${guards}</script></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
let browser, page;
async function check(name, action) { if (inheritedNames.has(name)) return; const evidence = await action(); report.checks.push({ name, pass: true, evidence }); }
async function screenshot(name) {
  const path = resolve(output, name + '.png'), bytes = await page.screenshot({ path }); report.screenshots.push(path);
  assert.equal(bytes.readUInt32BE(16), report.viewport.width); assert.equal(bytes.readUInt32BE(20), report.viewport.height);
  report.layout ??= {};
  report.layout[name] = await page.evaluate(() => { const box = node => { if (!node) return null; const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }; return { header: box(document.querySelector('.vg-voice-call-header')), identity: box(document.querySelector('.vg-voice-call-identity')), controls: [...document.querySelectorAll('.vg-voice-call-controls>button')].map(node => ({ text: node.textContent, ...box(node) })), mini: box(document.querySelector('.vg-voice-call-capsule')), viewport: { width: innerWidth, height: innerHeight } }; });
}
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  report.address = `http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: report.viewport, reducedMotion: 'reduce', colorScheme: 'dark' });
  page.setDefaultTimeout(10000); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(report.address); await page.waitForFunction(() => window.callUiTest);
  await page.evaluate(() => window.callUiTest.typed());
  await page.getByRole('button', { name: '开始通话', exact: true }).click();
  const menuButton = () => page.getByRole('button', { name: '通话菜单', exact: true });
  const menu = () => page.getByRole('dialog', { name: '通话菜单', exact: true });
  const snapshot = () => page.evaluate(() => window.typedCallUi.snapshot());
  if (process.argv.includes('--capture-restored')) {
    await page.getByRole('button', { name: '收起通话', exact: true }).click();
    await page.getByRole('button', { name: /返回与晓来的语音通话/ }).click();
    await page.getByRole('button', { name: '挂断', exact: true }).waitFor();
    await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
    await screenshot('dark-restored-stable');
  }

  await check('four primary controls and one unchanged call identity', async () => {
    await page.getByRole('button', { name: '挂断', exact: true }).waitFor();
    assert.equal(await page.locator('.vg-voice-call-controls>button').count(), 4);
    assert.deepEqual(await page.locator('.vg-voice-call-controls>button').allTextContents(), ['静音', '扬声器', '文字', '结束通话']);
    assert.equal((await page.evaluate(() => window.typedCallUi.starts())).length, 1);
    return snapshot();
  });
  await check('mute and each real presentation phase keep accurate text', async () => {
    await page.getByRole('button', { name: '静音', exact: true }).click();
    await page.getByText('麦克风已静音', { exact: true }).waitFor();
    assert.equal((await snapshot()).muted, true);
    await page.getByRole('button', { name: '取消静音', exact: true }).click();
    const statuses = [];
    for (const phase of ['recognizing', 'generating', 'playing', 'connecting', 'listening']) {
      await page.evaluate(phase => window.typedCallUi.phase(phase), phase);
      await page.waitForFunction(phase => document.querySelector('.vg-voice-call-status')?.getAttribute('data-phase') === phase, phase);
      statuses.push({ phase, text: await page.locator('.vg-voice-call-status').innerText() });
    }
    assert.match(statuses[0].text, /听清/); assert.match(statuses[1].text, /想回应/); assert.match(statuses[2].text, /回应/); assert.match(statuses[3].text, /连接/); assert.match(statuses[4].text, /听你说/);
    await page.evaluate(() => { window.typedCallUi.phase('playing'); window.callUiTest.captionText('今天的事情可以慢慢说，我会认真听。'); });
    await screenshot('dark-fullscreen'); return statuses;
  });
  await check('menu toggles captions and font size, retaining the same call', async () => {
    const before = (await snapshot()).recordId;
    await menuButton().click(); await menu().getByRole('button', { name: '大字', exact: true }).click();
    await menu().getByRole('switch', { name: '实时字幕' }).click(); await screenshot('dark-menu'); await menu().getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.locator('.vg-voice-call-caption-area').isVisible(), false);
    await menuButton().click(); await menu().getByRole('switch', { name: '实时字幕' }).click(); await menu().getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.locator('.vg-voice-call-captions.is-large-text').isVisible(), true);
    assert.equal((await snapshot()).recordId, before); return { recordId: before };
  });
  await check('input mode moves through the menu and retains text draft on recovery', async () => {
    await page.evaluate(() => window.typedCallUi.phase('listening'));
    await menuButton().click(); await menu().getByRole('button', { name: '文字输入', exact: true }).click(); await menu().getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('textbox').fill('暂时保留的通话草稿'); assert.equal((await snapshot()).inputMode, 'text');
    await page.evaluate(() => window.typedCallUi.phase('paused')); assert.equal(await page.getByRole('textbox').inputValue(), '暂时保留的通话草稿');
    await page.getByRole('button', { name: '继续通话', exact: true }).click();
    await menuButton().click(); await menu().getByRole('button', { name: '语音输入', exact: true }).click(); await menu().getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal((await snapshot()).inputMode, 'voice'); return { modes: await page.evaluate(() => window.typedCallUi.modes()) };
  });
  await check('completed captions remain scrollable while current speech changes', async () => {
    await page.evaluate(() => window.typedCallUi.completedCaptions());
    await page.getByRole('button', { name: /本次记录 · 16/ }).click();
    await page.locator('.vg-voice-caption-history').evaluate(node => { node.scrollTop = 30; });
    const before = await page.locator('.vg-voice-caption-history').evaluate(node => ({ top: node.scrollTop, height: node.clientHeight }));
    await page.evaluate(() => window.callUiTest.captionText('新的当前句，不应把历史字幕拉回末尾。'));
    const after = await page.locator('.vg-voice-caption-history').evaluate(node => ({ top: node.scrollTop, height: node.clientHeight }));
    assert.equal(after.top, before.top); assert.equal(after.height, before.height); assert.equal(await page.getByText('未播放的内部草稿', { exact: true }).count(), 0);
    await screenshot('dark-captions-history'); await page.getByRole('button', { name: '返回当前', exact: true }).click(); return { before, after };
  });
  await check('requested route stays separate from current route and is recoverable', async () => {
    await page.getByRole('button', { name: '声音设备', exact: true }).click();
    const routes = page.getByRole('dialog', { name: '声音设备', exact: true });
    await routes.getByRole('button', { name: '听筒', exact: true }).click();
    await routes.getByText('正在切换声音设备…', { exact: true }).waitFor();
    assert.equal((await snapshot()).routes.find(route => route.selected).id, 2);
    await routes.getByRole('button', { name: '取消等待，保持暂停', exact: true }).click({ timeout: 8000 });
    assert.equal((await snapshot()).routeWait, undefined); assert.equal((await snapshot()).phase, 'paused');
    await routes.getByRole('button', { name: '听筒', exact: true }).click(); await page.evaluate(() => window.typedCallUi.confirmRoute());
    await routes.getByRole('button', { name: '听筒 · 当前', exact: true }).waitFor();
    await screenshot('dark-route-confirmed'); await routes.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('button', { name: '继续通话', exact: true }).click();
    return snapshot();
  });
  await check('menu opens saved transcripts without unplayed generated text', async () => {
    await page.evaluate(() => window.callUiTest.historyFixture()); await menuButton().click(); await menu().getByRole('button', { name: '通话记录', exact: true }).click();
    const history = page.getByRole('dialog', { name: '晓来 · 通话记录', exact: true }); await history.waitFor();
    await history.getByText('实际交流原文', { exact: true }).first().click();
    await history.getByText('已经播完。', { exact: false }).waitFor();
    assert.ok((await history.innerText()).includes('已经播完。')); assert.ok(!(await history.innerText()).includes('未播放的秘密'));
    await page.keyboard.press('Escape'); await history.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => window.typedCallUi.ends()), 0); await screenshot('dark-fullscreen-tail'); return { ends: 0 };
  });
  await check('top mini window restores the same call without restarting', async () => {
    const before = await snapshot(); await page.getByRole('button', { name: '收起通话', exact: true }).click();
    await page.getByRole('group', { name: '应用内语音通话小窗' }).waitFor();
    const box = await page.locator('.vg-voice-call-capsule').boundingBox(); assert.ok(box.y >= 56 && box.y + box.height < 200);
    await screenshot('dark-miniwindow'); await page.getByRole('button', { name: /返回与晓来的语音通话/ }).click();
    await page.getByRole('button', { name: '挂断', exact: true }).waitFor(); const after = await snapshot(); assert.equal(after.recordId, before.recordId); assert.equal(await page.evaluate(() => window.typedCallUi.starts().length), 1); assert.equal(await page.evaluate(() => window.typedCallUi.ends()), 0); return { box, recordId: after.recordId };
  });
  await check('mini window ends once even when activated twice in one frame', async () => {
    await page.getByRole('button', { name: '收起通话', exact: true }).click();
    await page.getByRole('button', { name: '结束小窗通话', exact: true }).evaluate(button => { button.click(); button.click(); });
    assert.equal(await page.evaluate(() => window.typedCallUi.ends()), 1); assert.equal((await snapshot()).busy, false); return { ends: 1 };
  });
  if (!inheritedNames.has('a stale mini end button cannot terminate a foreign-account owner')) {
    await page.evaluate(() => window.typedCallUi.cleanup()); await page.evaluate(() => window.callUiTest.typed()); await page.getByRole('button', { name: '开始通话', exact: true }).click();
  }
  await check('a stale mini end button cannot terminate a foreign-account owner', async () => {
    await page.getByRole('button', { name: '收起通话', exact: true }).click(); await page.getByRole('button', { name: '结束小窗通话', exact: true }).waitFor();
    await page.evaluate(() => window.typedCallUi.foreignEndAttempt()); assert.equal(await page.evaluate(() => window.typedCallUi.ends()), 0); assert.equal((await snapshot()).busy, true); return snapshot();
  });
  await page.evaluate(() => window.typedCallUi.cleanup());
  report.isolation = await page.evaluate(() => window.voiceIsolation); assert.ok(Object.values(report.isolation).every(value => value === 0), JSON.stringify(report.isolation)); assert.equal(report.errors.length, 0);
} catch (error) {
  report.errors.push(error.stack || String(error)); if (page) { try { await screenshot('failure'); writeFileSync(resolve(output, 'failure.html'), await page.content()); } catch {} }
} finally {
  await browser?.close(); if (server.listening) await new Promise(done => server.close(done)); report.serverClosed = true;
  report.pass = report.checks.length === 10 && report.errors.length === 0; writeFileSync(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, pass: report.pass, checks: report.checks.length, errors: report.errors, screenshots: report.screenshots, serverClosed: true }, null, 2));
}
if (!report.pass) process.exitCode = 1;
