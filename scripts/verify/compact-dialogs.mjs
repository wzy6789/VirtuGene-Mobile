import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundle = await build({ entryPoints: ['scripts/verify/compact-dialogs.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"test"' } });
const assets = 'dist/renderer/assets';
const css = readdirSync(assets).filter(f => f.endsWith('.css')).map(f => `<link rel="stylesheet" href="/assets/${f}">`).join('');
const server = createServer((req, res) => {
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url.startsWith('/assets/')) { res.end(readFileSync(join(assets, basename(req.url)))); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><div id="app" class="mobile-layout"></div><script src="/test.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = process.env.VG_DIALOG_EVIDENCE || '.tmp-preview/compact-dialogs-20261011'; mkdirSync(output, { recursive: true });
let checks = 0; const evidence = [], errors = [];
const check = (ok, label) => { if (!ok) throw Error(label); checks++; console.log('ok ' + label); };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
  await page.waitForFunction(() => !!window.compactDialogs);
  const setup = view => page.evaluate(view => window.compactDialogs.setup(view), view);
  const row = () => page.locator('button.vg-conversation-row').filter({ hasText: '待整理的对话' });
  const compact = async label => {
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    const geometry = await dialog.evaluate(el => {
      const r = el.getBoundingClientRect();
      const motion = el.getAnimations().flatMap(a => a.effect.getKeyframes()).filter(f => f.transform);
      return { width: r.width, height: r.height, x: r.x, y: r.y, vw: innerWidth, vh: innerHeight,
        centered: el.classList.contains('vg-mobile-dialog'), page: el.classList.contains('vg-mobile-page'),
        verticalMotion: motion.some(f => Math.abs(new DOMMatrixReadOnly(f.transform).m42) > .01) };
    });
    check(geometry.centered && !geometry.page && geometry.width <= geometry.vw - 40 && geometry.height < geometry.vh - 40
      && geometry.x >= 20 && geometry.y >= 20 && !geometry.verticalMotion, label + ' stays compact and never drops or rises');
    evidence.push({ label, geometry });
  };
  const composer = async name => {
    await setup('composer');
    const field = page.getByRole('textbox', { name: '消息内容' });
    const send = page.getByRole('button', { name: '发送消息', exact: true });
    await field.waitFor();
    check(await send.isDisabled(), 'empty composer keeps send unavailable ' + name);
    await field.fill('这是一句准备发送的中文消息。');
    await field.focus();
    await page.waitForTimeout(220);
    const geometry = await field.evaluate(el => {
      const r = el.getBoundingClientRect(); const style = getComputedStyle(el);
      const button = document.querySelector('.chat-composer-send').getBoundingClientRect();
      const shell = document.querySelector('.chat-composer');
      return { fieldWidth: r.width, buttonWidth: button.width, buttonHeight: button.height,
        font: parseFloat(style.fontSize), overflow: shell.scrollWidth > shell.clientWidth + 1,
        focusShadow: style.boxShadow, inputOutline: style.outlineStyle };
    });
    check(geometry.fieldWidth >= 120 && geometry.buttonWidth >= 44 && geometry.buttonHeight >= 44
      && geometry.font >= 14 && !geometry.overflow && geometry.inputOutline === 'none' && geometry.focusShadow !== 'none', 'composer fits and has subtle focus plus touch targets ' + name);
    await page.screenshot({ path: `${output}/composer-${name}.png` });
    await send.click();
    check((await page.evaluate(() => window.compactDialogs.sent())).length === 1 && await field.inputValue() === '', 'send commits once and clears draft ' + name);
    await page.evaluate(() => window.compactDialogs.generating(true));
    const stop = page.getByRole('button', { name: '停止生成', exact: true });
    await stop.waitFor(); check(await stop.isEnabled(), 'streaming stop remains available ' + name);
    await stop.click(); await send.waitFor();
  };
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    const name = `${theme}-${width}`;
    await composer(name);
    await setup('chats'); await row().click({ button: 'right' }); await compact('conversation ' + name);
    await page.waitForTimeout(320); await page.screenshot({ path: `${output}/conversation-${name}.png` });
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await setup('roles'); await page.getByRole('button', { name: '管理待整理的对话', exact: true }).click(); await compact('role actions ' + name);
    await page.waitForTimeout(320); await page.screenshot({ path: `${output}/role-${name}.png` });
    await setup('password'); await page.getByRole('button', { name: '修改密码', exact: true }).click(); await compact('password ' + name);
    await page.waitForTimeout(320); await page.screenshot({ path: `${output}/password-${name}.png` });
    await page.getByRole('dialog').getByPlaceholder('原密码', { exact: true }).fill('not-a-real-password');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    check(await page.locator('.vg-modal-exit').count() === 0, 'password exit retains no visual copy ' + name);
    await setup('backup'); await page.getByRole('button', { name: '立即备份', exact: true }).click(); await compact('backup ' + name);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '从备份恢复', exact: true }).click(); await compact('restore ' + name);
    await setup('pin'); await page.getByPlaceholder('设置密码（至少 4 位）').fill('test-only-pin'); await compact('diary lock ' + name);
    await setup('moments'); await page.getByRole('button', { name: '朋友圈设置', exact: true }).click();
    check(await page.getByRole('dialog').evaluate(el => el.classList.contains('vg-mobile-page')), 'complete settings retain their page ' + name);
    await page.getByRole('button', { name: /允许角色查看我的历史动态/ }).click(); await compact('history range ' + name);
    await page.waitForTimeout(320); await page.screenshot({ path: `${output}/history-${name}.png` });
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    check(await page.getByRole('dialog', { name: '朋友圈设置', exact: true }).count() === 1, 'history dialog returns to settings ' + name);
    await page.getByRole('button', { name: /允许角色查看我的历史动态/ }).click();
    await page.getByRole('button', { name: '最近 3 天', exact: true }).click();
    check(await page.evaluate(() => window.compactDialogs.history()) === '3d', 'history selection persists ' + name);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await setup('chats');
  await row().click(); check(await page.evaluate(() => window.compactDialogs.selected()) === 1, 'ordinary tap still opens conversation exactly once');
  const rect = await row().boundingBox(); const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.getByRole('dialog').waitFor(); await page.mouse.up();
  check(await page.evaluate(() => window.compactDialogs.selected()) === 1, 'releasing a long press never also opens conversation');
  await page.getByRole('button', { name: '标为已读', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check(await page.evaluate(() => window.compactDialogs.unread()) === 0, 'mark read changes actual session unread count');
  await row().focus(); await page.keyboard.press('Shift+F10'); await compact('keyboard context action');
  await page.getByRole('button', { name: '置顶聊天', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check((await page.evaluate(() => window.compactDialogs.record())).pinned === true, 'pin action persists');
  await row().focus(); await page.keyboard.press('Shift+F10');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  check(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)), 'keyboard focus remains inside dialog');
  await page.keyboard.press('Escape');
  check(await row().evaluate(el => el === document.activeElement), 'closing restores focus to original conversation');
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.getByRole('dialog').waitFor();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(await page.evaluate(() => window.compactDialogs.selected()) === 1, 'native touch long press opens dialog without click-through');
  await page.keyboard.press('Escape'); await touch.detach();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 25); await page.waitForTimeout(650); await page.mouse.up();
  check(await page.getByRole('dialog').count() === 0, 'vertical drag cancels long press');
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 100, y, { steps: 8 });
  await page.waitForTimeout(650); await page.mouse.up();
  check(await page.getByRole('dialog').count() === 0, 'horizontal swipe cancels long press');
  check(await row().locator('xpath=ancestor::div[@data-swipe-action-item]').getByRole('button', { name: '删除', exact: true }).isVisible(), 'existing swipe actions still work');
  await page.keyboard.press('ArrowRight');
  await row().dispatchEvent('pointerdown', { pointerId: 9, isPrimary: true, button: 0, clientX: x, clientY: y });
  await row().dispatchEvent('pointercancel', { pointerId: 9 }); await page.waitForTimeout(650);
  check(await page.getByRole('dialog').count() === 0, 'cancelled touch never opens menu');
  await row().dispatchEvent('pointerdown', { pointerId: 10, isPrimary: true, button: 0, clientX: x, clientY: y });
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(650);
  check(await page.getByRole('dialog').count() === 0, 'window blur cancels held gesture');
  await row().click({ button: 'right' });
  await page.getByRole('button', { name: '从聊天列表移除', exact: true }).click();
  await row().waitFor({ state: 'hidden' });
  check((await page.evaluate(() => window.compactDialogs.record())).chatListHidden === true && await page.evaluate(() => window.compactDialogs.messages()) === 1, 'remove affects list visibility and preserves role and messages');
  await setup('chats'); await row().click({ button: 'right' }); await page.evaluate(() => window.compactDialogs.switchAccount());
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check(await page.locator('.vg-modal-exit').count() === 0, 'account change removes old actions and rejects their exit snapshot');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await setup('chats'); await row().click({ button: 'right' }); await compact('reduced motion');
  check(await page.getByRole('dialog').evaluate(el => el.getAnimations().length === 0), 'reduced motion opens without displacement animation');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 450 }); await setup('password'); await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await compact('short viewport password');
  const save = await page.getByRole('button', { name: '确认修改', exact: true }).boundingBox();
  check(save && save.y + save.height <= 450, 'password action stays reachable in short viewport');
  check(await page.evaluate(() => window.compactDialogs.network()) === 0 && errors.length === 0, 'no model calls or unhandled browser errors');
  writeFileSync(`${output}/result.json`, JSON.stringify({ status: 'PASS', checks, paidCalls: 0, evidence, errors }, null, 2) + '\n');
  console.log(`PASS compact-dialogs: ${checks} checks`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
