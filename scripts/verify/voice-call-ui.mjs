import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundled = await build({ entryPoints: ['scripts/verify/voice-call-ui.tsx'], outfile: 'voice-call-ui.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true}', __APP_VERSION__: '"test"' } });
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file => file.path.endsWith('.css')).text;
const baseCss = readdirSync('dist/renderer/assets').filter(name => name.endsWith('.css')).map(name => readFileSync(`dist/renderer/assets/${name}`, 'utf8')).join('\n');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html;charset=utf-8');
  res.end(req.url === '/test.js' ? js : `<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseCss}\n${css}</style></head><body><div id="root"></div><script src="/test.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, checks = 0;
mkdirSync('.tmp-preview/voice-call', { recursive: true });
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let requests = 0; page.on('request', request => { if (request.url().includes('api.xiaomimimo.com')) requests++; });
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
  await page.waitForFunction(() => window.callUiTest); await page.evaluate(() => window.callUiTest.open());
  await page.getByRole('button', { name: '开始通话', exact: true }).waitFor(); checks++;
  await page.getByLabel('固定音色').selectOption('Dean');
  await page.getByRole('button', { name: '开始通话', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '需要 Android' }).waitFor();
  assert.equal((await page.evaluate(() => window.callUiTest.profile())).voice, 'Dean'); checks++;
  assert.equal(requests, 0); checks++;
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.evaluate(() => window.callUiTest.deferredStart());
  await page.evaluate(() => window.callUiTest.open());
  await page.waitForFunction(() => !document.querySelector('.vg-voice-call-connect')?.disabled);
  await page.evaluate(() => { const button = document.querySelector('.vg-voice-call-connect'); button.click(); button.click(); });
  assert.equal((await page.evaluate(() => window.deferredCall.result())).saves, 1); checks++;
  assert.ok(await page.getByRole('button', { name: '准备连接…', exact: true }).isDisabled()); checks++;
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(() => window.deferredCall.finish())).starts, 0); checks++;
  await page.evaluate(() => window.callUiTest.open()); await page.getByRole('button', { name: '开始通话', exact: true }).waitFor();
  await page.evaluate(() => window.callUiTest.historyFixture());
  await page.getByRole('button', { name: '查看通话记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '晓来 · 通话记录' }); await history.waitFor();
  await history.getByText('实际交流原文', { exact: true }).click(); await history.getByText('已经播完。', { exact: false }).waitFor();
  assert.ok(!(await history.innerText()).includes('未播放的秘密')); checks++;
  assert.equal(requests, 0); checks++;
  await page.screenshot({ path: '.tmp-preview/voice-call/history-dark-390.png' });
  await page.keyboard.press('Escape'); await history.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '开始通话', exact: true }).waitFor(); checks++;
  await page.evaluate(() => window.callUiTest.playing()); await page.locator('.vg-voice-call-captions p').filter({ hasText: '那就慢慢说，我在听。' }).waitFor();
  assert.ok(!(await page.locator('.vg-voice-call').innerText()).includes('内部动作')); checks++;
  await page.getByText(/外放可能受到回声影响/).waitFor(); checks++;
  await page.getByRole('button', { name: '隐藏字幕', exact: true }).click(); assert.equal(await page.locator('.vg-voice-call-captions').count(), 0); checks++;
  await page.getByRole('button', { name: '显示字幕', exact: true }).click();
  await page.getByRole('button', { name: '声音设备', exact: true }).click();
  const routeDialog = page.getByRole('dialog', { name: '声音设备', exact: true });
  await routeDialog.waitFor();
  assert.ok(await routeDialog.getByRole('button').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 48))); checks++;
  await page.evaluate(() => window.callUiTest.routing(true));
  assert.ok(await page.getByRole('button', { name: '切换设备中…', exact: true }).isDisabled());
  assert.ok(await page.locator('.vg-voice-call-routes').getByRole('button').first().isDisabled()); checks++;
  assert.ok(await page.getByRole('button', { name: '挂断', exact: true }).isEnabled()); checks++;
  await page.evaluate(() => window.callUiTest.emptyReply());
  assert.ok(!(await page.locator('.vg-voice-call-captions').innerText()).includes('正在播放')); checks++;
  await page.getByText('这次没有收到可播放的回应，已暂停；确认后可以继续说。', { exact: true }).waitFor(); checks++;
  assert.ok(await page.getByRole('button', { name: '继续通话', exact: true }).isEnabled()); checks++;
  await page.evaluate(() => window.callUiTest.routing(false));
  await page.keyboard.press('Escape'); await routeDialog.waitFor({ state: 'detached' });
  assert.ok(await page.getByRole('button', { name: '挂断', exact: true }).isVisible()); checks++;
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(t => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
    assert.ok(await page.locator('.vg-voice-call').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    assert.ok(await page.locator('.vg-voice-call-modal > .vg-modal-header').evaluate(e => getComputedStyle(e).display === 'none')); checks++;
    assert.ok(await page.locator('.vg-voice-call-controls button').evaluateAll(nodes => nodes.length === 3 && nodes.every(node => { const r=node.getBoundingClientRect(); return r.width >= 48 && r.height >= 48; }))); checks++;
    await page.screenshot({ path: `.tmp-preview/voice-call/ui-${theme}-${width}.png` }); checks++;
  }
  await page.evaluate(() => window.callUiTest.sourceWithdrawn());
  assert.ok(await page.getByRole('button', { name: '请挂断后重新连接', exact: true }).isDisabled()); checks++;
  assert.ok(await page.getByRole('button', { name: '挂断', exact: true }).isEnabled()); checks++;
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); checks++;
  await page.evaluate(() => window.callUiTest.hosted());
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.evaluate(() => window.callUiTest.chatBlocked()), true); checks++;
  for (const systemReduce of [true, false]) {
    await page.emulateMedia({ reducedMotion: systemReduce ? 'reduce' : 'no-preference' });
    await page.evaluate(systemReduce => {
      document.documentElement.dataset.vgReducedMotion = systemReduce ? 'false' : 'true';
      window.dispatchEvent(new Event('vg:motion-preference'));
    }, systemReduce);
    const button = page.getByRole('button', { name: '静音', exact: true });
    await button.hover(); await page.mouse.down();
    const pressedMotion = await button.evaluate(node => ({ transform: getComputedStyle(node).transform, duration: getComputedStyle(node).transitionDuration }));
    assert.ok(pressedMotion.transform === 'none' && pressedMotion.duration.split(',').every(value => parseFloat(value) === 0), JSON.stringify({ systemReduce, ...pressedMotion })); checks++;
    await page.mouse.up();
    const orb = page.locator('.vg-voice-call-soul svg');
    const snapshot = await orb.innerHTML(); await page.waitForTimeout(180);
    assert.equal(await orb.innerHTML(), snapshot); checks++;
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.dataset.vgReducedMotion = 'false');
  await page.getByRole('button', { name: '收起通话', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await page.getByRole('button', { name: '停下，听我说', exact: true }).evaluate(node => document.activeElement === node)); checks++;
  await page.keyboard.press('Tab');
  assert.ok(await page.getByRole('button', { name: '收起通话', exact: true }).evaluate(node => document.activeElement === node)); checks++;
  assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('vg:back-request', { cancelable: true }))), false); checks++;
  await page.getByRole('button', { name: /^返回与晓来的语音通话/ }).waitFor();
  assert.equal(await page.evaluate(() => window.hostedCall.ends()), 0); checks++;
  await page.getByRole('button', { name: /^返回与晓来的语音通话/ }).click();
  await page.evaluate(() => window.callUiTest.state('listening', true));
  await page.getByRole('status').filter({ hasText: '麦克风已静音' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '继续通话', exact: true }).count(), 0); checks++;
  await page.evaluate(() => window.callUiTest.state('paused'));
  await page.getByRole('button', { name: '继续通话', exact: true }).waitFor();
  assert.ok((await page.locator('.vg-voice-call-error').innerText()).includes('应用进入后台或锁屏')); checks++;
  await page.setViewportSize({ width: 320, height: 568 });
  // Simulate enlarged system text without changing the user's chat-only font preference.
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll('.vg-voice-call *, .vg-voice-call-footer *')].filter(node => node instanceof HTMLElement).map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
    sizes.forEach(([node, size]) => { node.style.fontSize = `${size * 1.3}px`; });
  });
  assert.ok(await page.locator('.vg-voice-call').evaluate(node => node.scrollWidth <= node.clientWidth + 1)); checks++;
  assert.ok(await page.locator('.vg-voice-call-controls button').evaluateAll(nodes => nodes.every(node => {
    const rect = node.getBoundingClientRect(); return rect.width >= 48 && rect.height >= 48 && rect.bottom <= innerHeight && rect.top >= 0;
  }))); checks++;
  await page.screenshot({ path: '.tmp-preview/voice-call/ui-large-text-320.png' });
  await page.evaluate(() => document.querySelectorAll('.vg-voice-call *, .vg-voice-call-footer *').forEach(node => node instanceof HTMLElement && node.style.removeProperty('font-size')));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.evaluate(() => window.callUiTest.playing());
  await page.getByRole('button', { name: '停下，听我说', exact: true }).waitFor(); checks++;
  await page.screenshot({ path: '.tmp-preview/voice-call/ui-playing-dark-390.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^返回与晓来的语音通话/ }).waitFor();
  assert.equal(await page.evaluate(() => window.hostedCall.ends()), 0); checks++;
  await page.evaluate(() => window.hostedCall.navigate());
  await page.getByText('世界页面', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.hostedCall.ends()), 0); checks++;
  await page.getByRole('button', { name: /^返回与晓来的语音通话/ }).click();
  await page.getByRole('button', { name: '挂断', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.hostedCall.ends()), 0); checks++;
  await page.getByRole('button', { name: '收起通话', exact: true }).click();
  await page.getByRole('button', { name: /^返回与晓来的语音通话/ }).click();
  assert.equal(await page.evaluate(() => window.hostedCall.ends()), 0); checks++;
  for (const [error, explanation, action] of [
    ['voice:permission', '麦克风权限未开启', '继续通话'],
    ['voice:network', '网络或服务暂不可用', '继续通话'],
    ['voice:quota', 'MiMo 额度不足', '查看服务与额度配置'],
    ['voice:key', '有效的 MiMo API Key', '检查声音服务配置'],
    ['bluetooth-connecting', '蓝牙通话连接还在建立', '检查声音设备'],
    ['voice:bluetooth_connecting', '蓝牙通话连接还在建立', '检查声音设备'],
    ['bluetooth-disconnected', '耳机或声音设备已断开', '检查声音设备'],
    ['route-lost', '耳机或声音设备已断开', '检查声音设备'],
    ['route-change', '声音设备已切换', '检查声音设备'],
    ['voice:route_failed', '声音设备未能切换成功', '检查声音设备'],
    ['capture-error', '麦克风收音中断', '继续通话'],
    ['native-unavailable', '原生音频服务暂不可用', '挂断'],
  ]) {
    await page.evaluate(error => window.callUiTest.problem(error), error);
    await page.getByRole('alert').filter({ hasText: explanation }).waitFor();
    assert.ok(await page.getByRole('button', { name: action, exact: true }).isEnabled()); checks++;
    if (action === '检查声音设备') {
      await page.getByRole('button', { name: action, exact: true }).click();
      await page.getByRole('dialog', { name: '声音设备', exact:true }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.hostedCall.ends()), 0); checks++;
    }
  }
  await page.getByRole('button', { name: '挂断', exact: true }).click();
  assert.equal(await page.evaluate(() => window.hostedCall.ends()), 1); checks++;
  await page.evaluate(() => window.callUiTest.finishing('saving'));
  await page.getByText('交流文字：正在保存…', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: '查看交流文字', exact: true }).isDisabled()); checks++;
  await page.evaluate(() => window.callUiTest.finishing('summary'));
  await page.getByText('摘要：正在整理…', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.callUiTest.chatBlocked()), false); checks++;
  assert.ok(await page.getByRole('button', { name: '查看交流文字', exact: true }).isEnabled()); checks++;
  await page.evaluate(() => window.callUiTest.finishing('memory'));
  await page.getByText('记忆检查：正在检查原话…', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: '再次通话', exact: true }).isDisabled()); checks++;
  await page.screenshot({ path: '.tmp-preview/voice-call/ui-finishing-dark-390.png' });
  await page.evaluate(() => window.callUiTest.finishing());
  assert.ok(await page.getByRole('button', { name: '再次通话', exact: true }).isEnabled()); checks++;
  await page.getByRole('button', {name:'返回',exact:true}).click();
  await page.evaluate(() => { window.callUiTest.restartClock(); window.hostedCall.navigate(); });
  // Reopen the same presentation target with a fresh call clock.
  await page.evaluate(() => window.callUiTest.hosted());
  await page.evaluate(() => window.callUiTest.restartClock());
  await page.getByRole('button', {name:'收起通话',exact:true}).click();
  assert.equal(await page.locator('.vg-voice-call-capsule time').innerText(),'00:00'); checks++;
  await page.evaluate(() => window.callUiTest.foreignPreparation());
  await page.getByRole('button',{name:/返回与另一个角色的语音通话/}).waitFor();
  assert.equal(await page.locator('.vg-voice-call-capsule-label').innerText(),'准备通话'); checks++;
  assert.equal(await page.locator('.vg-voice-call-capsule time').innerText(),'00:00'); checks++;
  await page.evaluate(() => window.hostedCall.cleanup());
  assert.deepEqual(errors, []); checks++;
  const result = { checks, realApiCalls: requests, modelTokens: 0, deviceTested: false, mode: 'presentation-fixture-and-browser-capability-guard' };
  writeFileSync('.tmp-preview/voice-call/ui-result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); server.close(); }
