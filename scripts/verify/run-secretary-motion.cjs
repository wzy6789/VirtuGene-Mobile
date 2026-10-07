// Requires build-secretary.mjs and the verification server on port 17899.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const output = path.resolve('.tmp-preview/secretary-motion-20261002');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const cdp = await context.newCDPSession(page), frames = [];
  cdp.on('Page.screencastFrame', event => {
    frames.push({ data: event.data, time: event.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  const thread = page.locator('.chat-thread');
  const position = () => thread.evaluate(el => ({ top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight }));
  const close = async () => {
    await page.getByRole('dialog').getByRole('button', { name: '返回', exact: true }).click();
    await page.waitForTimeout(240);
  };
  try {
    await page.goto('http://127.0.0.1:17899/secretary.html?virtugene-preview=mobile');
    await page.waitForFunction(() => !!window.secretaryTest);
    await page.evaluate(() => window.secretaryTest.mountChatHistory());
    await thread.waitFor(); await page.waitForTimeout(600);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await thread.evaluate(el => { el.scrollTop = 400; });
    const latest = page.getByRole('button', { name: '回到最新消息', exact: true });
    await latest.waitFor(); await page.waitForTimeout(80);
    const historyPosition = (await position()).top;
    await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(400);
    assert.ok(Math.abs((await position()).top - historyPosition) <= 2, 'viewport changes preserve actual chat history reading');
    const latestBox = await latest.boundingBox();
    assert.ok(latestBox.height >= 48 && latestBox.x >= 0 && latestBox.x + latestBox.width <= 390 && latestBox.y >= 0 && latestBox.y + latestBox.height <= 844, 'return-to-latest has a visible 48px target inside the viewport');
    await page.screenshot({ path: path.join(output, 'chat-history-latest-dark.png') });
    await latest.click(); await page.waitForTimeout(400);
    assert.ok((await position()).bottom < 3 && await latest.count() === 0, 'actual return-to-latest resumes anchoring and retires its control');
    console.log('PASS actual history control, viewport continuity and 48px latest target');
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      await thread.evaluate(el => { el.scrollTop = 250; });
      await page.waitForTimeout(100); const before = await position();
      await page.getByRole('button', { name: '展开更多办事', exact: true }).click();
      await page.waitForTimeout(440);
      assert.ok(Math.abs((await position()).top - before.top) <= 2, 'expanding tools preserves history scroll position');
      await page.getByRole('button', { name: '收起更多办事', exact: true }).click();
      await page.waitForTimeout(440);
      assert.ok(Math.abs((await position()).top - before.top) <= 2, 'collapsing tools preserves history scroll position');
      await thread.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(100);
      await page.getByRole('button', { name: '展开更多办事', exact: true }).click();
      await page.waitForTimeout(440);
      assert.ok((await position()).bottom < 3, 'latest message stays anchored during tool expansion');
      await page.getByRole('button', { name: '收起更多办事', exact: true }).click();
      await page.waitForTimeout(440);
      assert.ok((await position()).bottom < 3, 'latest message stays anchored during tool collapse');
      for (const action of ['助理管理 · 解雇与聘用', '办事收件箱', '每日整理', '办事习惯 · 格式、文风与提醒', '助理能力 · 已开放的功能']) {
        await page.getByRole('button', { name: '助理更多操作', exact: true }).click();
        await page.waitForTimeout(400);
        const menu = page.getByRole('dialog', { name: '助理工作台', exact: true });
        // Dispatch in-page so assertions run within the first animation frame.
        await menu.getByRole('button', { name: action, exact: true }).evaluate(el => el.click());
        await page.waitForFunction(() => document.querySelectorAll('.vg-modal-overlay').length === 1 && !document.querySelector('.vg-modal-overlay [role="dialog"]').textContent.includes('看看 TA 可以帮你做什么'));
        const handoff = await page.locator('.vg-modal-overlay').evaluate(el => ({
          opacity: Number(getComputedStyle(el).opacity),
          ghosts: el.querySelectorAll('.vg-modal-exit').length,
          safe: [...el.querySelectorAll('.vg-modal-exit')].every(ghost => ghost.inert && ghost.getAttribute('aria-hidden') === 'true' && !ghost.querySelector('[role="dialog"]')),
        }));
        assert.ok(handoff.opacity >= .99, `scrim does not restart fading during ${action}: ${JSON.stringify(handoff)}`);
        assert.equal(handoff.ghosts, 1, `previous panel crossfades during ${action}`);
        assert.ok(handoff.safe, 'outgoing panel is inert and has no dialog semantics');
        assert.equal(await page.getByRole('dialog').count(), 1);
        await page.waitForTimeout(400);
        assert.equal(await page.locator('.vg-modal-exit').count(), 0);
        assert.equal(await page.getByRole('dialog').evaluate(el => el.style.willChange), '');
        await close();
        assert.equal(await thread.count(), 1, 'sheet changes preserve a single live chat thread');
        assert.equal(await page.locator('.vg-secretary-tools').count(), 1, 'sheet changes preserve a single shortcut area');
      }
    }
    console.log('PASS light/dark history preservation, latest anchoring and all five assistant sheet handoffs');
    // Rebind the ResizeObserver when React replaces the keyed thread.
    await page.evaluate(() => window.secretaryTest.mountChatHistory());
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: '展开更多办事', exact: true }).click(); await page.waitForTimeout(440);
    assert.ok((await position()).bottom < 3, 'new chat thread receives its resize observer');
    await page.getByRole('button', { name: '助理更多操作', exact: true }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: '助理管理 · 解雇与聘用', exact: true }).evaluate(el => el.click());
    await page.waitForTimeout(30);
    await page.getByRole('dialog').getByRole('button', { name: '返回', exact: true }).evaluate(el => el.click());
    await page.getByRole('button', { name: '助理更多操作', exact: true }).evaluate(el => el.click());
    await page.waitForTimeout(30);
    assert.ok(await page.locator('.vg-modal-exit').count() <= 1, 'rapid reversals retain at most one outgoing panel');
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForFunction(() => !document.querySelector('.vg-modal-exit'));
    assert.equal(await page.locator('.vg-modal-exit').count(), 0, 'resize releases outgoing frames');
    await page.waitForTimeout(400); await close();
    await cdp.send('Page.stopScreencast');
    frames.forEach((frame, index) => fs.writeFileSync(path.join(output, `frame-${String(index).padStart(4, '0')}.jpg`), Buffer.from(frame.data, 'base64')));
    fs.writeFileSync(path.join(output, 'frames.json'), JSON.stringify(frames.map(frame => frame.time)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '助理更多操作', exact: true }).click();
    await page.getByRole('button', { name: '助理管理 · 解雇与聘用', exact: true }).click();
    assert.equal(await page.locator('.vg-modal-exit').count(), 0);
    assert.equal(await page.getByRole('dialog').evaluate(el => el.getAnimations().length), 0);
    await close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.txt'), 'PASS history preservation, latest anchoring, session replacement, five sheet handoffs, rapid reversal, resize cleanup, reduced motion and no browser errors\n');
    console.log('PASS session replacement, rapid reversal, resize cleanup, reduced motion and no browser errors');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
