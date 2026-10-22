import { chromium } from 'playwright';
import { starfieldPreview } from '../preview-starfield-upgrade.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Breaks caught: archives buried below a 50-scene list, primary map below
// secondary tools, and missing exit while the world query is pending/failed.
const out = `.tmp-preview/starfield-upgrade-20261017/P4a/checks/${Date.now()}`;
mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), checks: [], screenshots: [], errors: [] };
let server, browser;
async function check(name, run) {
  try { report.checks.push({ name, pass: true, detail: await run() }); }
  catch (error) { report.checks.push({ name, pass: false, error: String(error) }); }
}
async function enter(page, state) {
  await page.evaluate(state => window.starfieldPreview.setState(state), state);
  await page.getByRole('button', { name: '星域', exact: true }).click();
  await page.locator('[data-starfield-overview]').waitFor();
  await page.waitForFunction(() => history.state?.vgMobileNav === 'view' && history.state.depth === 2);
  await page.evaluate(async () => { await document.fonts.ready; });
}
try {
  server = await starfieldPreview({ port: 0, output: out + '/server' });
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(server.address + '/app?virtugene-preview=mobile');
  await page.waitForFunction(() => window.starfieldReady);
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => window.starfieldPreview.theme(theme), theme);
    await enter(page, 'many');
    await check(`${theme}-${width}: map, resume, archives precede the full 50-scene list`, async () => {
      const boxes = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; };
        return { map: box('[data-starfield-map]'), resume: box('[aria-label="继续上次那一幕"]'), archives: box('[aria-label="世界档案"]'), list: box('[data-starfield-list]'), viewport: innerWidth, scroll: document.documentElement.scrollWidth };
      });
      assert(boxes.map.bottom <= boxes.resume.top, 'map must precede resumable scene');
      assert(boxes.resume.bottom <= boxes.archives.top, 'scene context must precede archives');
      assert(boxes.archives.bottom <= boxes.list.top, 'archives must precede all 50 scene rows');
      assert.equal(await page.locator('[data-scene-row]').count(), 50);
      assert(boxes.scroll <= width, 'no horizontal overflow');
      return boxes;
    });
    if (width === 390) {
      await page.locator('.vg-world-page').evaluate(el => el.scrollTop = 0);
      const file = `${theme}-390-top.png`; await page.screenshot({ path: out + '/' + file }); report.screenshots.push(file);
      await page.getByRole('navigation', { name: '世界档案', exact: true }).scrollIntoViewIfNeeded();
      const file2 = `${theme}-390-archives.png`; await page.screenshot({ path: out + '/' + file2 }); report.screenshots.push(file2);
    }
  }
  for (const [label, view] of [['关系', 'relations'], ['记忆', 'memory'], ['年表', 'timeline'], ['设定', 'worldSettings']]) {
    await enter(page, 'many');
    await check(`${label}: native button opens existing archive and browser back returns to starfield`, async () => {
      const button = page.getByRole('navigation', { name: '世界档案', exact: true }).getByRole('button', { name: new RegExp(label) });
      await button.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(view => window.starfieldPreview.snapshot().navigation.activeView === view, view);
      await page.waitForFunction(() => document.querySelector('.vg-page-transition') && !document.querySelector('[data-starfield-overview]'));
      await page.waitForFunction(() => history.state?.vgMobileNav === 'view' && history.state.depth === 3);
      await page.evaluate(() => history.back());
      await page.locator('[data-starfield-overview]').waitFor();
      assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).navigation.activeView, 'chat');
    });
  }
  for (const state of ['loading', 'load-error']) {
    await page.evaluate(state => window.starfieldPreview.setState(state), state);
    await page.getByRole('button', { name: '星域', exact: true }).click();
    await (state === 'loading' ? page.getByRole('status').filter({ hasText: '正在读取' }).first() : page.getByRole('alert').filter({ hasText: '没有读到' })).waitFor();
    await check(`${state}: return remains available while content is unavailable`, async () => {
      const back = page.getByRole('button', { name: '返回世界', exact: true });
      assert(await back.isVisible(), 'starfield must provide an exit independent of data loading');
      assert(await back.isEnabled()); await back.click();
      await page.getByRole('heading', { name: '世界', exact: true }).waitFor();
    });
  }
  await enter(page, 'long-scenes');
  await page.setViewportSize({ width: 320, height: 740 });
  for (const size of [18.75, 22.5]) {
    await page.evaluate(size => document.documentElement.style.fontSize = size + 'px', size);
    await page.waitForFunction(size => parseFloat(getComputedStyle(document.documentElement).fontSize) === size, size);
    await check(`320-${size}: archive controls remain readable and touchable with enlarged text`, async () => {
      const bounds = await page.getByRole('navigation', { name: '世界档案', exact: true }).getByRole('button').evaluateAll(nodes => nodes.map(n => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height, scroll: n.scrollWidth, client: n.clientWidth })));
      assert.equal(bounds.length, 4); assert(bounds.every(b => b.w >= 44 && b.h >= 44 && b.scroll <= b.client));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      return bounds;
    });
  }
  await check('no external model, microphone, playback or native invocation', async () => {
    const state = await page.evaluate(() => window.starfieldPreview.snapshot()); assert(Object.values(state.isolation).every(value => value === 0)); return state.isolation;
  });
  await check('compiled source remains current', () => {
    for (const input of server.manifest.inputs) assert.equal(createHash('sha256').update(readFileSync(input.path)).digest('hex'), input.sha256, input.path);
  });
} catch (error) { report.errors.push(String(error.stack || error)); }
finally {
  await browser?.close(); if (server) await new Promise(resolve => server.server.close(resolve));
  report.pass = report.checks.length === 16 && report.checks.every(c => c.pass) && !report.errors.length;
  writeFileSync(out + '/result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, pass: report.pass, checks: report.checks.length, failed: report.checks.filter(c => !c.pass), errors: report.errors }));
}
if (!report.pass) process.exitCode = 1;
