// A few cancellation/ownership assertions for the actual component, with no app data or transports.
const { build } = require('esbuild');
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');

(async () => {
  const result = await build({ entryPoints: ['scripts/verify/elastic-navigation.tsx'], outfile: 'fixture.js', bundle: true, write: false, jsx: 'automatic', format: 'iife', logLevel: 'warning' });
  const javascript = result.outputFiles.find(file => file.path.endsWith('.js')).contents;
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  const html = fs.readFileSync('scripts/verify/elastic-navigation.html', 'utf8').replace('<script type="module" src="./elastic-navigation.tsx"></script>', '<style>' + css + '</style><script src="/fixture.js"></script>');
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
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => !!window.elasticNavigationTest);
    await page.waitForTimeout(80);
    const snapshot = () => page.evaluate(() => window.elasticNavigationTest.snapshot());
    const tabs = page.getByRole('tablist', { name: '聊天频道' });
    const box = await tabs.boundingBox();
    const y = box.y + box.height / 2;
    // Direction tracking must leave vertical reading alone.
    await page.mouse.move(120, y); await page.mouse.down(); await page.mouse.move(126, y + 25); await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal((await snapshot()).commits.length, 0, 'vertical motion cannot choose a channel');

    // A click changes content now; the independent material may still be settling.
    await page.getByRole('tab', { name: '群聊' }).click();
    assert.equal((await snapshot()).value, 'groups', 'click cannot wait for an animation to navigate');
    await page.waitForTimeout(25);
    await page.mouse.move(190, y); await page.mouse.down();
    const grabbed = await snapshot();
    assert.ok(Math.abs(grabbed.lastGrab.before - grabbed.lastGrab.after) < 1, 're-grab preserves the displayed position');
    const label = page.locator('[data-elastic-label]').first();
    const before = await label.boundingBox();
    await page.mouse.move(70, y, { steps: 5 });
    const after = await label.boundingBox();
    assert.ok(Math.abs(before.width - after.width) < .1 && Math.abs(before.height - after.height) < .1, 'label geometry stays rigid during dragging');
    await page.mouse.up(); await page.waitForTimeout(500);
    assert.deepEqual((await snapshot()).commits, ['groups','all'], 'one commit per accepted click/release; old animation cannot submit again');

    // Resize and account ownership both cancel a release before it can navigate.
    await page.evaluate(() => window.elasticNavigationTest.clearCommits());
    await page.mouse.move(90, y); await page.mouse.down(); await page.mouse.move(180, y, { steps: 4 });
    await page.evaluate(() => document.querySelector('[data-elastic-tabs]').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await page.mouse.up(); await page.waitForTimeout(450);
    assert.equal((await snapshot()).commits.length, 0, 'pointercancel cannot choose a channel');
    await page.getByRole('tab', { name: '对话' }).click();
    assert.equal((await snapshot()).value,'dialogue');
    await page.evaluate(() => window.elasticNavigationTest.clearCommits());
    await page.waitForTimeout(35);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(450);
    assert.equal((await snapshot()).commits.length, 0, 'resize cannot replay an accepted selection');
    await page.getByRole('tab', { name: '助理' }).click();
    await page.waitForTimeout(35);
    await page.evaluate(() => window.elasticNavigationTest.changeOwner());
    await page.waitForTimeout(450);
    assert.equal((await snapshot()).commits.length, 0, 'old account completion cannot commit');
    assert.deepEqual(errors, [], 'no component errors');
    console.log('PASS: immediate selection, direction, interrupted reversal/rigid labels, pointercancel/resize/owner cancellation');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
