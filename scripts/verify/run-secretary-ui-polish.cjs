// Run build-secretary.mjs after the renderer build. Uses isolated fixture data.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');

(async () => {
  const output = path.resolve('.tmp-preview/secretary-ui-polish-20261002');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const name = path.basename(req.url.split('?')[0]) || 'secretary.html';
    fs.readFile(path.join(__dirname, name), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  let count = 0;
  const pass = label => { count++; console.log(`PASS ${label}`); };
  const settle = async () => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    });
  };
  const capture = async name => { await settle(); await page.screenshot({ path: path.join(output, `${name}.png`) }); };
  const close = async () => {
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); await settle();
  };
  const fits = async label => {
    for (const width of [320, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 }); await settle();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} page overflow at ${width}px`);
      const panel = page.getByRole('dialog');
      if (await panel.count()) {
        const box = await panel.boundingBox();
        assert.ok(box.x >= -1 && box.x + box.width <= width + 1 && box.y >= -1 && box.y + box.height <= 845, `${label} dialog outside viewport at ${width}px`);
        assert.ok(await panel.locator('[data-modal-scroll]').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label} scroll content overflow at ${width}px`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 }); pass(`${label} fits 320/390/430/768px`);
  };
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/secretary.html?virtugene-preview=mobile`);
    await page.waitForFunction(() => !!window.secretaryTest);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.evaluate(() => window.secretaryTest.mountHome());
    const card = page.locator('.vg-secretary-workspace');
    await card.getByText('在职 · 为你办事', { exact: true }).waitFor(); await settle();
    assert.equal(await card.locator('.vg-secretary-toggle').getAttribute('aria-expanded'), 'false');
    assert.ok(Math.abs((await card.boundingBox()).height - (await page.locator('.vg-conversation-row').first().boundingBox()).height) <= 4);
    await capture('home-collapsed-dark'); pass('assistant starts at ordinary conversation size');
    await card.getByRole('button', { name: '展开生活助理工作台', exact: true }).click(); await settle();
    await fits('home overview'); await capture('home-expanded-dark');

    const fixture = await page.evaluate(() => window.secretaryTest.mountInboxChat());
    await page.getByRole('button', { name: '办事收件箱', exact: true }).click();
    const inbox = page.getByRole('dialog', { name: '办事收件箱', exact: true });
    await inbox.getByRole('button', { name: /^待处理（[1-9]/ }).waitFor();
    await inbox.getByRole('article', { name: '办事请求' }).first().waitFor();
    await fits('inbox and pending result'); await capture('inbox-attention-dark');
    await page.setViewportSize({ width: 320, height: 844 });
    const filters = await inbox.getByRole('group', { name: '办事记录分类' }).getByRole('button').all();
    const boxes = await Promise.all(filters.map(button => button.boundingBox()));
    assert.ok(boxes.every(box => box.height >= 48 && Math.abs(box.y - boxes[0].y) < 1));
    for (const button of filters) assert.ok(await button.evaluate(el => el.scrollWidth <= el.clientWidth));
    await inbox.locator('[data-modal-scroll]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const bounds = await inbox.locator('[data-modal-scroll]').boundingBox();
    const category = await inbox.getByRole('group', { name: '办事记录分类' }).boundingBox();
    assert.ok(category.y >= bounds.y - 1 && category.y < bounds.y + bounds.height - category.height);
    pass('four readable touch categories stay visible while inbox scrolls');
    await inbox.getByRole('button', { name: /^朋友圈草稿（/ }).click();
    await inbox.getByRole('textbox', { name: '朋友圈文案' }).waitFor();
    await fits('draft editing'); await inbox.locator('[data-modal-scroll]').evaluate(el => { el.scrollTop = 0; });
    await capture('inbox-draft-dark');
    assert.equal(await page.evaluate(() => window.secretaryTest.useChatStore.getState().currentSessionId), fixture.currentSession);
    assert.equal(await page.evaluate(() => window.secretaryTest.db.moments.count()), 0);
    pass('category navigation preserves current chat and unpublished draft');
    await close();

    await page.getByRole('button', { name: '助理更多操作', exact: true }).click();
    await page.getByRole('dialog', { name: '助理工作台', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await fits('workbench'); await capture('workbench-dark');
    const workbench = page.getByRole('dialog', { name: '助理工作台', exact: true });
    for (const label of ['查看日记', '查看朋友圈', '查看待办']) {
      const box = await workbench.getByRole('button', { name: label, exact: true }).boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 844);
    }
    const recordY = (await workbench.getByRole('button', { name: '查看日记', exact: true }).boundingBox()).y;
    await workbench.locator('[data-modal-scroll]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(Math.abs((await workbench.getByRole('button', { name: '查看日记', exact: true }).boundingBox()).y - recordY) < 1);
    pass('record destinations stay accessible while workbench scrolls');
    await page.getByRole('button', { name: '助理记忆 · 查看、纠正与忘记', exact: true }).click();
    await page.getByRole('dialog', { name: '助理记忆', exact: true }).waitFor();
    await page.getByText('还没有长期记忆。', { exact: false }).waitFor();
    await fits('memory'); await capture('memory-dark'); await close();
    await page.getByRole('button', { name: '助理管理', exact: true }).click();
    await page.getByRole('dialog', { name: '助理管理', exact: true }).waitFor();
    await page.getByRole('textbox', { name: '助理名字', exact: true }).waitFor();
    await fits('management'); await capture('management-dark');
    for (const height of [844, 568]) {
      await page.setViewportSize({ width: 320, height }); await settle();
      const panel = page.getByRole('dialog');
      const save = await panel.getByRole('button', { name: '保存助理资料', exact: true }).boundingBox();
      assert.ok(save.y >= 0 && save.y + save.height <= height);
      await panel.locator('[data-modal-scroll]').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const after = await panel.getByRole('button', { name: '保存助理资料', exact: true }).boundingBox();
      assert.ok(Math.abs(after.y - save.y) <= 1);
    }
    pass('management save stays visible on short screens while form scrolls'); await close();
    await page.setViewportSize({ width: 390, height: 844 });

    const habitsOwner = await page.evaluate(() => window.secretaryTest.mountWorkPreferences());
    await page.getByRole('button', { name: '保存办事习惯', exact: true }).waitFor();
    await fits('work preferences'); await capture('work-preferences-dark');
    const choices = page.getByRole('combobox');
    for (const choice of await choices.all()) assert.ok(await choice.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
    const scroll = page.getByRole('dialog').locator('[data-modal-scroll]');
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await page.getByRole('button', { name: '保存办事习惯', exact: true }).isVisible());
    pass('readable preference inputs and fixed save action');
    const proactiveChoice = page.getByRole('checkbox', { name: '开启主动协助', exact: true });
    assert.equal(await proactiveChoice.isChecked(), false);
    const expectedHabits = { diaryFormat: 'sections', momentStyle: 'warm', replyLength: 'normal', todoPriority: 'important', reminderMinutes: 15, proactiveHelp: false };
    for (const [label, value] of [['日记格式', 'sections'], ['朋友圈文风', 'warm'], ['助理回应长度', 'normal'], ['新待办默认优先级', 'important']]) {
      const select = page.getByRole('combobox', { name: label, exact: true });
      for (let i = 0; i < 3; i++) {
        await select.selectOption({ index: 0 }); await select.selectOption(value);
        assert.equal(await select.inputValue(), value);
      }
    }
    await page.getByRole('spinbutton', { name: '默认提前提醒分钟', exact: true }).fill('15');
    await page.getByRole('button', { name: '保存办事习惯', exact: true }).click();
    await page.getByText('办事习惯已保存，下次新请求开始沿用。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(async id => (await window.secretaryTest.db.secretaryBindings.get(id)).workPreferences, habitsOwner), expectedHabits);
    await close(); await page.evaluate(() => window.secretaryTest.mountWorkPreferences());
    await page.waitForFunction(() => document.querySelector('[aria-label="默认提前提醒分钟"]')?.value === '15');
    assert.equal(await page.getByRole('combobox', { name: '日记格式', exact: true }).inputValue(), 'sections');
    assert.equal(await proactiveChoice.isChecked(), false);
    pass('repeated preference changes save and reopen with the actual chosen values'); await close();

    await page.evaluate(() => window.secretaryTest.mountReviewProgress());
    await page.getByRole('checkbox', { name: '日记整理建议', exact: true }).waitFor();
    await fits('daily review'); await capture('daily-review-dark');
    const diaryChoice = page.getByRole('checkbox', { name: '日记整理建议', exact: true });
    const before = await page.evaluate(() => window.secretaryTest.db.secretaryTasks.count());
    await diaryChoice.uncheck(); assert.equal(await diaryChoice.isChecked(), false);
    assert.equal(await page.evaluate(() => window.secretaryTest.db.secretaryTasks.count()), before);
    pass('output selection changes the actual choice without starting a request');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await capture('daily-review-light'); await fits('light review');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await close();
    assert.equal(await page.getByRole('dialog').count(), 0);
    pass('reduced-motion dialog closes cleanly');
    assert.deepEqual(errors, []); pass('no browser exceptions');
    const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    await page.evaluate(() => { document.documentElement.classList.add('dark'); return window.secretaryTest.mountHome(); });
    await page.getByText('在职 · 为你办事', { exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.vg-secretary-toggle .text-base' });
    const fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
    assert.ok(fonts.some(font => font.isCustomFont && font.glyphCount >= 6), 'Chinese assistant name actually uses the bundled face');
    pass('real Chinese glyphs use local variable font');
    await page.context().setOffline(true);
    await page.getByRole('button', { name: '展开生活助理工作台', exact: true }).click(); await settle();
    assert.ok(await page.getByRole('button', { name: /^与助理.+对话$/ }).isVisible());
    const offlineDoc = await cdp.send('DOM.getDocument');
    const offlineButton = await cdp.send('DOM.querySelector', { nodeId: offlineDoc.root.nodeId, selector: '.vg-secretary-chat' });
    assert.ok((await cdp.send('CSS.getPlatformFontsForNode', { nodeId: offlineButton.nodeId })).fonts.some(font => font.isCustomFont && font.glyphCount >= 4));
    pass('loaded typography and workspace work offline');
    console.log(`ALL PASS ${count} assistant UI checks; screenshots: ${output}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
