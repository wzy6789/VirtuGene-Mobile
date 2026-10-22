// The real sheet with a stub image action: cancellation, takeover, and one synchronous action.
const { build } = require('esbuild');
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');

(async () => {
  const result = await build({ entryPoints: ['scripts/verify/attachment-sheet.tsx'], outfile: 'fixture.js', bundle: true, write: false, jsx: 'automatic', format: 'iife', define: { 'import.meta.env': '{}' }, logLevel: 'warning' });
  const javascript = result.outputFiles.find(file => file.path.endsWith('.js')).contents;
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  const html = fs.readFileSync('scripts/verify/attachment-sheet.html', 'utf8').replace('<script type="module" src="./attachment-sheet.tsx"></script>', '<style>' + css + '</style><script src="/fixture.js"></script>');
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/fixture.js' ? javascript : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    await page.waitForTimeout(400);
    const snapshot = () => page.evaluate(() => window.attachmentSheetTest.snapshot());
    const handle = page.locator('.vg-attachment-drag-region');
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2, y = box.y + 24;
    const label = page.getByRole('heading', { name: '添加附件', level: 3 });
    const before = await label.boundingBox();
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 60, { steps: 4 });
    const after = await label.boundingBox();
    assert.ok(Math.abs(before.width - after.width) < .1 && Math.abs(before.height - after.height) < .1, 'sheet text stays rigid during dragging');
    await handle.evaluate(node => node.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await page.mouse.up(); await page.waitForTimeout(450);
    assert.equal((await snapshot()).closes, 0, 'pointercancel rebounds without closing');
    assert.equal((await snapshot()).images, 0, 'pointercancel never selects an image');

    // Release a short drag at rest, then grab its running rebound without a jump.
    const next = await handle.boundingBox();
    const nextY = next.y + 24;
    await page.mouse.move(x, nextY); await page.mouse.down(); await page.mouse.move(x, nextY + 35, { steps: 3 });
    await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(25);
    const rebounding = await handle.boundingBox();
    await page.mouse.move(x, rebounding.y + 20); await page.mouse.down();
    assert.ok(Math.abs((await snapshot()).lastGrab.before - (await snapshot()).lastGrab.after) < 1, 're-grab retains the currently displayed pose');
    await page.mouse.move(x, rebounding.y - 10, { steps: 3 }); await page.mouse.up(); await page.waitForTimeout(450);
    assert.equal((await snapshot()).closes, 0, 'reverse takeover invalidates the old release');

    // The original click chooses the file once; a second click in that turn cannot duplicate it.
    await page.getByRole('button', { name: /选择图片/ }).evaluate(node => { node.click(); node.click(); });
    await page.waitForTimeout(60);
    let state = await snapshot();
    assert.equal(state.images, 1, 'image action commits once');
    assert.equal(state.closes, 1, 'image action dismisses once');
    assert.equal(state.imageInsideClick, true, 'file-picker callback stays inside the click turn');

    await page.evaluate(() => window.attachmentSheetTest.open()); await page.waitForTimeout(350);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForTimeout(30); await page.evaluate(() => window.attachmentSheetTest.unmount()); await page.waitForTimeout(450);
    state = await snapshot();
    assert.equal(state.closes, 1, 'unmount invalidates the old close completion');
    assert.deepEqual(errors, [], 'no sheet errors');
    console.log('PASS: rigid sheet/pointercancel, rebound takeover, one synchronous image action, unmount cancellation');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
