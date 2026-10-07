// Uses the real settings fixture and production CSS on the verification server.
const { createRequire } = require('module');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 640 }, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const output = path.resolve('.tmp-preview/settings-motion-20261002'); fs.mkdirSync(output, { recursive: true });
  const click = text => page.getByRole('button', { name: text }).evaluate(el => el.click());
  const settle = () => page.waitForTimeout(330);
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const live = document.querySelector('.vg-settings-detail:not(.vg-settings-detail-exit)');
    const ghost = document.querySelector('.vg-settings-detail-exit');
    resolve({ ghosts: document.querySelectorAll('.vg-settings-detail-exit').length,
      // The shared snapshot preserves SVG paint resources, but strips HTML IDs/roles.
      // Resource IDs must remain unique across the outgoing copy and live page.
      safe: !ghost || ghost.inert && ghost.getAttribute('aria-hidden') === 'true' && !ghost.querySelector('[role]') && [...ghost.querySelectorAll('[id]')].every(node=>node instanceof SVGElement && [...document.querySelectorAll('[id]')].filter(other=>other.id===node.id).length===1),
      liveX: live && getComputedStyle(live).transform !== 'none' ? new DOMMatrixReadOnly(getComputedStyle(live).transform).m41 : 0,
      focus: document.activeElement?.getAttribute('role'), scrollTop: live.closest('[data-modal-scroll]').scrollTop,
    });
  }))));
  try {
    await page.goto('http://127.0.0.1:17899/settings-ui.html?virtugene-preview=mobile');
    await page.waitForFunction(() => !!window.settingsUITest);
    await page.evaluate(() => window.settingsUITest.mount('settings')); await settle();
    const row = page.getByRole('button', { name: /外观与阅读/ });
    // Capture makes a release-outside click reach the original control, as in a
    // held gesture. The real document-level cancellation must still block it.
    await row.evaluate(el => el.addEventListener('pointerdown', event => el.setPointerCapture(event.pointerId)));
    let rect = await row.boundingBox();
    const x = rect.x + 30, y = rect.y + rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(100);
    assert.notEqual(await row.getAttribute('data-touch-pressed'), null);
    assert.ok(await row.evaluate(el => Number(getComputedStyle(el, '::after').opacity) > .5));
    await page.screenshot({ path: path.join(output, 'touch-light.png') });
    await page.mouse.move(x, rect.y + rect.height + 12);
    assert.notEqual(await row.getAttribute('data-press-cancelled'), null);
    assert.equal(await row.getAttribute('data-touch-pressed'), null);
    await page.mouse.up(); assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 1);
    assert.equal(await row.evaluate(el => el.style.getPropertyValue('--vg-touch-x')), '30px');
    await row.evaluate(el => new Promise(resolve => setTimeout(resolve, 330)));
    assert.equal(await row.evaluate(el => el.style.getPropertyValue('--vg-touch-x')), '');
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, rect.y + rect.height + 12); await page.mouse.move(x, y);
    assert.equal(await row.getAttribute('data-press-cancelled'), null);
    assert.notEqual(await row.getAttribute('data-touch-pressed'), null);
    await page.mouse.up(); await settle();
    assert.equal(await page.getByRole('dialog', { name: '外观与阅读', exact: true }).count(), 1);
    assert.equal(await page.locator('[data-touch-pressed]').count(), 0);
    await click('返回设置'); await settle();
    await page.keyboard.press('Tab'); await row.focus();
    await page.screenshot({ path: path.join(output, 'keyboard-focus.png') });
    await page.keyboard.press('Enter'); await settle();
    assert.equal(await page.getByRole('dialog', { name: '外观与阅读', exact: true }).count(), 1);
    const toggle = page.getByRole('switch', { name: '减少动态效果', exact: true });
    const toggleRect = await toggle.boundingBox();
    assert.ok(toggleRect.width >= 48 && toggleRect.height >= 48);
    await click('返回设置'); await settle();
    console.log('PASS touch-origin light, slide-out cancellation, re-entry, release cleanup, keyboard activation and 48px targets');

    // A real browser touch pan must scroll rather than open its starting row.
    const cdp = await page.context().newCDPSession(page);
    const touchScroll = page.getByRole('dialog').locator('[data-modal-scroll]');
    await touchScroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const scrollBefore = await touchScroll.evaluate(el => el.scrollTop);
    const lowerRow = page.getByRole('button', { name: /数据与设备/ });
    rect = await lowerRow.boundingBox();
    const tx = Math.round(rect.x + rect.width / 2), ty = Math.round(rect.y + rect.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
    for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx, y: ty + step * 12 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle();
    assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 1);
    assert.ok(await touchScroll.evaluate(el => el.scrollTop) < scrollBefore);
    assert.equal(await page.locator('[data-touch-pressed],[data-press-cancelled]').count(), 0);
    await cdp.detach();
    console.log('PASS actual touch scrolling cancels its held settings action');
    await click(/外观与阅读/);
    let state = await frame(); assert.equal(state.ghosts, 1); assert.ok(state.safe); assert.equal(state.focus, 'dialog');
    assert.ok(state.liveX > 0);
    await page.screenshot({ path: path.join(output, 'forward.png') });
    await settle();
    await click('返回设置'); state = await frame(); assert.ok(state.liveX < 0); assert.equal(state.ghosts, 1);
    for (let i = 0; i < 6; i++) {
      await click(/外观与阅读/); await page.waitForTimeout(20); await click('返回设置');
      state = await frame(); assert.ok(state.ghosts <= 1 && state.safe);
    }
    await settle();
    assert.equal(await page.locator('.vg-settings-detail-exit').count(), 0);
    assert.equal(await page.locator('.vg-settings-detail').evaluate(el => el.style.willChange), '');
    console.log('PASS directional handoff, one inert visual, rapid reversal and animation cleanup');
    const scroll = page.getByRole('dialog').locator('[data-modal-scroll]');
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const saved = await scroll.evaluate(el => el.scrollTop);
    await click(/数据与设备/); await settle(); await click('返回设置');
    state = await frame(); assert.ok(Math.abs(state.scrollTop - saved) < 2); await settle();
    console.log('PASS scroll position restored before the returning page paints');
    await click(/AI 连接/); await settle(); await click(/账号绑定密钥/); await settle();
    await click('返回设置'); state = await frame(); assert.equal(state.ghosts, 0);
    console.log('PASS credential detail never retains an outgoing visual');
    await settle(); await click('返回设置'); await page.setViewportSize({ width: 320, height: 520 });
    assert.equal(await page.locator('.vg-settings-detail-exit').count(), 0);
    await settle(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.settingsUITest.mount('chat')); await settle();
    await click('聊天设置'); await settle();
    const summary = page.locator('summary').filter({ hasText: '外观与阅读' });
    const details = summary.locator('..');
    const closedHeight = await details.evaluate(el => el.getBoundingClientRect().height);
    await summary.evaluate(el => el.click()); await page.waitForTimeout(70);
    const intermediate = await details.evaluate(el => el.getBoundingClientRect().height);
    await settle(); const openedHeight = await details.evaluate(el => el.getBoundingClientRect().height);
    if (await page.evaluate(() => CSS.supports('interpolate-size', 'allow-keywords'))) {
      assert.ok(intermediate > closedHeight + 2 && intermediate < openedHeight - 2);
    }
    await summary.evaluate(el => el.click()); await page.waitForTimeout(60); await summary.evaluate(el => el.click());
    await settle(); assert.ok(Math.abs((await details.evaluate(el => el.getBoundingClientRect().height)) - openedHeight) < 2);
    console.log('PASS native detail expansion and interrupted reversal');
    await page.evaluate(() => window.settingsUITest.mount('settings')); await settle();
    await page.emulateMedia({ reducedMotion: 'reduce' }); await click(/外观与阅读/);
    assert.equal(await page.locator('.vg-settings-detail-exit').count(), 0);
    assert.equal(await page.locator('.vg-settings-detail').evaluate(el => el.getAnimations().length), 0);
    await click('返回设置'); await settle();
    await page.getByRole('dialog').getByRole('button', { name: '返回', exact: true }).click();
    await settle(); assert.equal(await page.locator('.vg-settings-detail-exit').count(), 0); assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 1024, height: 768 });
    // DEV intentionally forces mobile layout; use the production platform branch
    // to inspect a desktop dialog rather than a large mobile preview.
    await page.route('**/settings-ui.bundle.js', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('scripts/verify/settings-ui-desktop.bundle.js') }));
    await page.goto('http://127.0.0.1:17899/settings-ui.html');
    await page.waitForFunction(() => !!window.settingsUITest);
    await page.evaluate(() => window.settingsUITest.mount('settings')); await settle();
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    let dialogRect = await page.getByRole('dialog').boundingBox();
    assert.ok(dialogRect.width <= 560 && dialogRect.y >= 0 && dialogRect.y + dialogRect.height <= 768);
    await page.screenshot({ path: path.join(output, 'desktop-dark.png') });
    await click(/外观与阅读/); await settle();
    await page.getByRole('radio', { name: /^浅色/ }).check();
    assert.ok(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).colorScheme === 'light'));
    await page.screenshot({ path: path.join(output, 'desktop-light.png') });
    assert.deepEqual(errors, []);
    console.log('PASS resize, narrow screen, reduced motion, close cleanup and no runtime errors');
    console.log('PASS desktop dialog layout and light-theme compatibility');
    fs.writeFileSync(path.join(output, 'result.txt'), 'PASS settings motion interaction checks\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
