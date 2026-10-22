import { chromium } from 'playwright';
import { starfieldPreview } from '../preview-starfield-upgrade.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// These cases catch truncated identity, old-history previews, hidden read errors,
// duplicate opens, stale private content and late navigation after leaving.
const out = `.tmp-preview/starfield-upgrade-20261017/P4b/checks/${Date.now()}`;
mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), checks: [], screenshots: [], errors: [], limits: ['Actual MobileLayout with synthetic IndexedDB records in an isolated origin, not the signed-in sidebar.', 'Held read uses Dexie.waitFor in test entry only. No physical-device or production-model inference.'] };
let server, browser, page;
const detail = () => page.locator('.vg-scene-constellation');
const action = () => detail().locator('.vg-sector-enter button');
async function check(name, run) {
  try { report.checks.push({ name, pass: true, detail: await run() }); }
  catch (error) { report.checks.push({ name, pass: false, error: String(error) }); await page.evaluate(() => window.starfieldPreview.releaseIdentity()).catch(() => {}); }
}
async function start(state = 'six') {
  await page.evaluate(state => window.starfieldPreview.setState(state), state);
  await page.getByRole('button', { name: '星域', exact: true }).click();
  await page.locator('[data-starfield-overview]').waitFor();
  await page.waitForFunction(() => history.state?.vgMobileNav === 'view' && history.state.depth === 2);
}
async function select(index = 0) {
  const row = page.locator('[data-scene-row]').nth(index);
  const id = await row.getAttribute('data-scene-row');
  const title = (await row.getAttribute('aria-label')).replace('查看场景：', '');
  await row.click(); await detail().waitFor();
  await page.getByText('正在读取这段经历…', { exact: true }).waitFor({ state: 'hidden' });
  return { id, title };
}
async function screenshot(file) { await page.screenshot({ path: out + '/' + file }); report.screenshots.push(file); }
try {
  server = await starfieldPreview({ port: 0, output: out + '/server' });
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page = await context.newPage(); page.setDefaultTimeout(3500); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(server.address + '/app?virtugene-preview=mobile'); await page.waitForFunction(() => window.starfieldReady);
  for (const theme of ['dark', 'light']) for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 844 });
    await page.evaluate(theme => window.starfieldPreview.theme(theme), theme);
    await start('long-scenes'); const selected = await select();
    for (const scale of [1, 1.25, 1.5]) {
      await page.evaluate(size => document.documentElement.style.fontSize = size + 'px', 15 * scale);
      await page.waitForFunction(size => parseFloat(getComputedStyle(document.documentElement).fontSize) === size, 15 * scale);
      await check(`${theme}-${width}-${scale}: full title and ordered readable detail`, async () => {
        assert.equal(await detail().getByRole('heading', { level: 2 }).innerText(), selected.title);
        const boxes = await detail().evaluate(node => {
          const box = el => { const r = el.getBoundingClientRect(); return { y: r.y, bottom: r.bottom, w: r.width, h: r.height }; };
          return { recent: box(node.querySelector('[aria-label="最近发生"]')), action: box([...node.querySelectorAll('button')].at(-1)), rootScroll: document.documentElement.scrollWidth, width: innerWidth };
        });
        assert(boxes.recent.bottom <= boxes.action.y, 'recent record must precede main action');
        assert(boxes.action.h >= 44); assert(boxes.rootScroll <= width); return boxes;
      });
      if (width === 390 && scale === 1 || width === 320 && scale === 1.5) await screenshot(`${theme}-${width}-${scale}-detail.png`);
    }
  }
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  await page.setViewportSize({ width: 390, height: 844 });
  await start('recent-entries');
  await page.getByText('第 1004 段记录', { exact: false }).first().waitFor();
  await page.evaluate(() => window.starfieldPreview.resetReads()); await select();
  await check('1005-entry scene previews the latest three using bounded indexed reads', async () => {
    const text = await detail().getByRole('region', { name: '最近发生' }).innerText();
    for (const index of [1002, 1003, 1004]) assert(text.includes(`第 ${index} 段记录`));
    assert(!text.includes('第 399 段记录'));
    const state = await page.evaluate(() => window.starfieldPreview.snapshot()); assert(state.reads.entryRows <= 16, JSON.stringify(state.reads)); return state.reads;
  });
  await check('latest content screenshot', () => screenshot('latest-records.png'));
  await check('system-only recent window does not claim the whole history is empty or scan 8105 unrelated entries', async () => {
    await page.evaluate(async () => { window.starfieldPreview.resetReads(); await window.starfieldPreview.addSystemTail(); });
    await page.waitForFunction(() => !document.querySelector('.vg-sector-recent')?.textContent.includes('第 1004 段记录'));
    const text = await detail().getByRole('region', { name: '最近发生' }).innerText();
    assert(!text.includes('这里还没有经历'), 'a bounded window is not proof that the scene has no earlier content');
    assert(!text.includes('另一场景')); assert(await action().isEnabled());
    const state = await page.evaluate(() => window.starfieldPreview.snapshot()); assert(state.reads.entryRows <= 16, JSON.stringify(state.reads)); return state.reads;
  });
  await start(); await page.evaluate(() => window.starfieldPreview.failNext('entries')); await page.locator('[data-scene-row]').nth(1).click();
  await check('entry read failure is explicit, retry preserves the selected scene', async () => {
    await page.getByRole('alert').filter({ hasText: /读取失败|暂未读到/ }).waitFor();
    assert(!await page.getByText('这里还没有经历', { exact: false }).isVisible());
    await screenshot('entry-read-failed.png');
    await page.getByRole('button', { name: '重新读取场景', exact: true }).click();
    await detail().getByRole('heading', { level: 2, name: '共同经历 2', exact: true }).waitFor();
  });
  for (const kind of ['delete', 'owner']) {
    await start(); const selected = await select(1);
    await check(`${kind}: revoked selection removes title, content and list marker`, async () => {
      await page.evaluate(({ id, kind }) => window.starfieldPreview.mutateScene(id, kind), { id: selected.id, kind });
      await detail().waitFor({ state: 'hidden' });
      await page.getByRole('alert').filter({ hasText: /不可用|变化|权限/ }).waitFor();
      assert(!await page.getByRole('heading', { name: selected.title, exact: true }).isVisible());
      await screenshot(`${kind}-selection.png`);
      await page.getByRole('button', { name: '返回星域', exact: true }).click();
      await page.locator('[data-starfield-overview]').waitFor();
      assert.equal(await page.locator(`[data-scene-row="${selected.id}"]`).count(), 0);
      assert.equal(await page.locator(`[data-scene-marker="${selected.id}"]`).count(), 0);
    });
  }
  await start(); const renamed = await select(1);
  await check('live edits update the selected identity without opening a different scene', async () => {
    await page.evaluate(id => window.starfieldPreview.mutateScene(id, 'rename'), renamed.id);
    await detail().getByRole('heading', { name: '修改后仍属于这一幕的完整标题', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).opens.length, 0);
  });
  await start(); let selected = await select(1);
  await check('same-frame double continue waits for one identity read and opens once', async () => {
    await page.evaluate(id => { window.starfieldPreview.resetReads(); window.starfieldPreview.holdIdentity(id); }, selected.id);
    await action().evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => { const s = window.starfieldPreview.snapshot(); return s.reads.heldIdentity > 0 || s.navigation.activeView === 'canvas'; });
    const state = await page.evaluate(() => window.starfieldPreview.snapshot());
    assert.equal(state.navigation.activeView, 'chat'); assert.equal(state.reads.heldIdentity, 1); assert(await action().isDisabled());
    await screenshot('opening-busy.png');
    await page.evaluate(() => window.starfieldPreview.releaseIdentity());
    await page.waitForFunction(() => window.starfieldPreview.snapshot().navigation.activeView === 'canvas');
    assert.deepEqual((await page.evaluate(() => window.starfieldPreview.snapshot())).opens, [selected.id]);
  });
  await start(); selected = await select(1);
  await check('failed identity check keeps selection, reports failure and permits retry', async () => {
    await page.evaluate(() => window.starfieldPreview.failNext('identity')); await action().click();
    await page.getByRole('alert').filter({ hasText: /暂未|失败/ }).waitFor();
    assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).opens.length, 0);
    assert.equal(await detail().getByRole('heading', { level: 2 }).innerText(), selected.title);
    await screenshot('open-failed.png');
    await action().click(); await page.waitForFunction(() => window.starfieldPreview.snapshot().navigation.activeView === 'canvas');
  });
  for (const exit of ['back', 'account']) {
    await start(); selected = await select(1);
    await check(`${exit}: late opening cannot navigate after leaving its scope`, async () => {
      await page.evaluate(id => window.starfieldPreview.holdIdentity(id), selected.id); await action().click();
      await page.waitForFunction(() => { const s = window.starfieldPreview.snapshot(); return s.reads.heldIdentity > 0 || s.navigation.activeView === 'canvas'; });
      assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).navigation.activeView, 'chat');
      if (exit === 'back') { await page.getByRole('button', { name: '返回星域', exact: true }).click(); await page.locator('[data-starfield-overview]').waitFor(); }
      else await page.evaluate(() => window.starfieldPreview.changeAccountOnly());
      await page.evaluate(() => window.starfieldPreview.releaseIdentity());
      await page.waitForFunction(() => !document.querySelector('.vg-scene-constellation'));
      assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).opens.length, 0);
    });
  }
  await start(); selected = await select(2);
  await check('finished scene uses readback action and still validates before opening', async () => {
    assert((await action().innerText()).includes('回看'));
    await page.evaluate(id => window.starfieldPreview.holdIdentity(id), selected.id); await action().click();
    await page.waitForFunction(() => { const s = window.starfieldPreview.snapshot(); return s.reads.heldIdentity > 0 || s.navigation.activeView === 'canvas'; });
    assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).navigation.activeView, 'chat');
    await page.evaluate(() => window.starfieldPreview.releaseIdentity()); await page.waitForFunction(() => window.starfieldPreview.snapshot().navigation.activeView === 'canvas');
  });
  await start();
  await check('browser back first leaves detail, retains list filter, then leaves starfield', async () => {
    const filters = page.getByRole('group', { name: '场景状态筛选' });
    await filters.getByRole('button', { name: '暂停', exact: true }).click(); const current = await select(1);
    await page.evaluate(() => history.back()); await page.locator('[data-starfield-overview]').waitFor();
    assert.equal(await filters.getByRole('button', { name: '暂停', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator(`[data-scene-row="${current.id}"]`).count(), 1);
    await page.evaluate(() => history.back()); await page.getByRole('heading', { name: '世界', exact: true }).waitFor();
  });
  await start(); selected = await select(1);
  await check('world owner revocation removes private detail immediately', async () => {
    await page.evaluate(() => window.starfieldPreview.revokeWorld());
    await detail().waitFor({ state: 'hidden' });
    await page.getByRole('alert').waitFor(); assert(!await page.getByRole('heading', { name: selected.title, exact: true }).isVisible());
  });
  await check('external model, audio, capture and native calls remain zero', async () => {
    const state = await page.evaluate(() => window.starfieldPreview.snapshot()); assert(Object.values(state.isolation).every(value => value === 0), JSON.stringify(state.isolation)); return state.isolation;
  });
  await check('compiled input hashes still match current source', () => {
    for (const input of server.manifest.inputs) assert.equal(createHash('sha256').update(readFileSync(input.path)).digest('hex'), input.sha256, input.path);
  });
} catch (error) { report.errors.push(String(error.stack || error)); }
finally {
  await page?.evaluate(() => window.starfieldPreview?.releaseIdentity()).catch(() => {});
  await browser?.close(); if (server) await new Promise(resolve => server.server.close(resolve));
  report.pass = report.checks.length === 40 && report.checks.every(c => c.pass) && !report.errors.length;
  writeFileSync(out + '/result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, pass: report.pass, checks: report.checks.length, failed: report.checks.filter(c => !c.pass), errors: report.errors }));
}
if (!report.pass) process.exitCode = 1;
