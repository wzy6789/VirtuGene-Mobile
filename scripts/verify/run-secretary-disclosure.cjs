// Exercise the actual home fixture while recording disclosure geometry per frame.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const { build } = require('esbuild');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');

(async () => {
  const result = await build({ entryPoints: ['scripts/verify/secretary.tsx'], outdir: '.tmp-preview/secretary-disclosure-bundle', write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_AI_GATEWAY_URL: '', VITE_AI_GATEWAY_TOKEN: '' }), __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync('package.json', 'utf8')).version) } });
  const script = result.outputFiles.find(file => file.path.endsWith('.js')).contents;
  const cssFile = fs.readdirSync('dist/renderer/assets').find(name => name.endsWith('.css'));
  const css = fs.readFileSync(path.join('dist/renderer/assets', cssFile), 'utf8') + '\n' + fs.readFileSync('src/styles/secretary-ui.css', 'utf8');
  const html = '<!doctype html><html lang="zh-CN" class="dark"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/test.css"><body class="bg-app text-ink"><div id="root"></div><script src="/test.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    const url = request.url.split('?')[0];
    if (url.endsWith('.woff2')) {
      const fontPath = path.join('dist/renderer/assets', path.basename(url));
      if (!fs.existsSync(fontPath)) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', 'font/woff2'); response.end(fs.readFileSync(fontPath)); return;
    }
    response.setHeader('Content-Type', url === '/test.js' ? 'text/javascript' : url === '/test.css' ? 'text/css' : 'text/html; charset=utf-8');
    response.end(url === '/test.js' ? script : url === '/test.css' ? css : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = path.resolve('.tmp-preview/secretary-disclosure-20261002');
  fs.mkdirSync(output, { recursive: true });
  const card = page.locator('.vg-secretary-workspace');
  const details = card.locator('.vg-secretary-details');
  const toggle = card.locator('.vg-secretary-toggle');
  const height = () => details.evaluate(el => el.getBoundingClientRect().height);
  const settle = () => details.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
    await page.waitForFunction(() => !!window.secretaryTest);
    await page.evaluate(() => window.secretaryTest.mountHome());
    await page.getByText('在职 · 为你办事', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await height(), 0);
    assert.ok(Math.abs((await card.boundingBox()).height - (await page.locator('.vg-conversation-row').first().boundingBox()).height) <= 4);
    assert.equal(await details.evaluate(el => el.inert), true);
    console.log('PASS default ordinary-row footprint and inaccessible closed actions');

    await toggle.focus();
    await page.keyboard.press('Enter');
    const opening = await details.evaluate(el => new Promise(resolve => {
      const frames = [];
      const start = performance.now();
      const sample = () => {
        frames.push({ time: performance.now() - start, height: el.getBoundingClientRect().height, animations: el.getAnimations().length });
        if (performance.now() - start < 450) requestAnimationFrame(sample); else resolve(frames);
      };
      requestAnimationFrame(sample);
    }));
    const expandedHeight = await height();
    assert.ok(expandedHeight > 150);
    assert.ok(new Set(opening.map(frame => Math.round(frame.height))).size >= 6, 'opening contains intermediate frames');
    assert.ok(opening.every((frame, index) => index === 0 || frame.height >= opening[index - 1].height - 1), 'opening moves in one direction');
    assert.equal(await details.evaluate(el => el.style.height), '', 'resting layout releases measured height');
    assert.equal(await details.evaluate(el => el.inert), false);
    console.log('PASS measured keyboard expansion, smooth intermediate geometry, natural final height');

    await toggle.evaluate(el => el.click());
    await page.waitForTimeout(75);
    const beforeReverse = await height();
    await toggle.evaluate(el => el.click());
    const afterReverse = await height();
    assert.ok(Math.abs(afterReverse - beforeReverse) < 18, 'reversal starts from the displayed height');
    assert.ok(afterReverse < expandedHeight - 8, 'reversal does not restart at the expanded endpoint');
    await settle();
    assert.ok(Math.abs(await height() - expandedHeight) < 1);
    console.log('PASS mid-flight reversal preserves current geometry');

    for (const wait of [55, 40, 65, 30, 40]) {
      await toggle.evaluate(el => el.click());
      await page.waitForTimeout(wait);
      assert.ok(await details.evaluate(el => el.getAnimations().length) <= 1, 'rapid toggles keep at most one height animation');
    }
    await settle();
    assert.equal(await height(), 0);
    assert.equal(await details.evaluate(el => el.inert), true);
    assert.equal(await details.evaluate(el => el.dataset.disclosureState), 'closed');
    console.log('PASS five rapid reversals settle closed without queued animations');

    await toggle.evaluate(el => el.click());
    await settle();
    // Late content and font/layout changes exercise the same observed geometry.
    await card.locator('.vg-secretary-details-content').evaluate(el => {
      const extra = document.createElement('div'); extra.dataset.geometryProbe = ''; extra.style.height = '96px'; el.append(extra);
    });
    await page.waitForTimeout(45);
    const resizingHeight = await height();
    assert.ok(resizingHeight > expandedHeight && resizingHeight < expandedHeight + 96, 'content resize is interpolated');
    await settle();
    assert.ok(Math.abs(await height() - expandedHeight - 96) < 1);
    await card.locator('[data-geometry-probe]').evaluate(el => el.remove());
    await page.waitForTimeout(30); await settle();
    for (const width of [320, 430, 390]) {
      await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(30); await settle();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await details.evaluate(el => Math.abs(el.getBoundingClientRect().height - el.firstElementChild.getBoundingClientRect().height) < 1));
    }
    await page.screenshot({ path: path.join(output, 'expanded-dark.png') });
    console.log('PASS dynamic content and 320/390/430px layout retargeting');

    await toggle.evaluate(el => el.click()); await page.waitForTimeout(40);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await height(), 0);
    assert.equal(await details.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    await toggle.evaluate(el => el.click());
    assert.ok(await height() > 150);
    assert.equal(await details.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    console.log('PASS reduced-motion change cancels live motion and future toggles are immediate');

    await page.evaluate(() => window.secretaryTest.auth('another-home-owner', null));
    await page.waitForFunction(() => document.querySelector('.vg-secretary-toggle')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await details.evaluate(el => el.inert), true);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'frames.json'), JSON.stringify(opening, null, 2));
    fs.writeFileSync(path.join(output, 'result.txt'), 'PASS compact default, keyboard expansion, frame geometry, rapid reversal, late content resizing, narrow screens, reduced motion, owner change, no page errors\n');
    console.log('PASS account replacement hides old controls and no browser errors');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
