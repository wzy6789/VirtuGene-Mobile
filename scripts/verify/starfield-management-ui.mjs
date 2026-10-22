import { chromium } from 'playwright';
import { starfieldPreview } from '../preview-starfield-upgrade.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out = `.tmp-preview/starfield-upgrade-20261017/P4c/checks/${Date.now()}`;
mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), checks: [], screenshots: [], errors: [] };
let server, browser, page;
async function check(name, run) { try { report.checks.push({ name, pass: true, detail: await run() }); } catch (error) { report.checks.push({ name, pass: false, error: String(error) }); } }
async function starfield(state) {
  await page.evaluate(state => window.starfieldPreview.setState(state), state);
  await page.getByRole('button', { name: '星域', exact: true }).click();
  await page.locator('[data-starfield-overview]').waitFor();
}
async function manage(state = 'long-scenes') {
  await starfield(state); await page.getByRole('button', { name: '管理全部场景', exact: true }).click(); await page.locator('.vg-stage-room').waitFor();
}
try {
  server = await starfieldPreview({ port: 0, output: out + '/server' }); browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page = await context.newPage(); page.setDefaultTimeout(4000); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(server.address + '/app?virtugene-preview=mobile'); await page.waitForFunction(() => window.starfieldReady);
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(theme => window.starfieldPreview.theme(theme), theme);
    await manage();
    await check(`${theme}-${width}: full scene identity, stable navigation and 44px list actions`, async () => {
      assert(await page.getByRole('heading', { name: '场景管理', exact: true }).isVisible());
      const title = '我们在街角旧书店聊到天黑，那些尚未说完的心事与很长很长的场景名称 1';
      assert(await page.getByText(title, { exact: true }).isVisible());
      const bounds = await page.locator('.vg-stage-room li button').evaluateAll(nodes => nodes.map(n => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height })));
      assert(bounds.every(n => n.w >= 44 && n.h >= 44)); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); return { bounds };
    });
    if (width === 390) { const file = `${theme}-390-management.png`; await page.screenshot({ path: out + '/' + file }); report.screenshots.push(file); }
    await starfield('empty'); await page.locator('[data-starfield-overview]').getByRole('button', { name: '开启新场景', exact: true }).last().click(); await page.locator('.vg-stage-create').waitFor();
    await check(`${theme}-${width}: create form uses the same readable surface in both themes`, async () => {
      const computed = await page.locator('.vg-stage-create').evaluate(node => {
        const style = getComputedStyle(node), input = node.querySelector('input'), field = getComputedStyle(input);
        return { surface: style.backgroundColor, backgroundImage: style.backgroundImage, color: style.color, inputBackground: field.backgroundColor, inputColor: field.color, overflow: node.scrollWidth > node.clientWidth };
      });
      assert.equal(computed.backgroundImage, 'none'); assert(!computed.overflow);
      assert(await page.getByRole('heading', { name: '开启新场景', exact: true }).isVisible());
      assert(!await page.getByText('WORLD INITIALIZER', { exact: true }).isVisible()); return computed;
    });
    if (width === 390) { const file = `${theme}-390-create.png`; await page.screenshot({ path: out + '/' + file }); report.screenshots.push(file); }
  }
  await check('cancel retains draft when reopening; all form controls fit enlarged narrow layouts', async () => {
    await page.getByRole('textbox', { name: '起始地点', exact: true }).fill('你们散步经过的旧街口');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '开启新场景', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '起始地点', exact: true }).inputValue(), '你们散步经过的旧街口');
    await page.setViewportSize({ width: 320, height: 740 });
    await page.evaluate(() => document.documentElement.style.fontSize = '22.5px');
    await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).fontSize) === 22.5);
    const controls = await page.locator('.vg-stage-create button,.vg-stage-create input').evaluateAll(nodes => nodes.map(n => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height, scroll: n.scrollWidth, client: n.clientWidth })));
    assert(controls.every(n => n.w >= 44 && n.h >= 44 && n.scroll <= n.client)); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: out + '/light-320-150-create.png' }); report.screenshots.push('light-320-150-create.png');
  });
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  await manage('one');
  await check('deletion requires confirmation; cancel keeps the original scene', async () => {
    await page.getByRole('button', { name: '删除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除场景记录', exact: true }); await dialog.waitFor();
    assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).opens.length, 0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert(await page.getByText('雨后的站台', { exact: true }).isVisible());
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await page.getByRole('heading', { name: '还没有共同场景', exact: true }).waitFor();
    assert(!await page.getByText('雨后的站台', { exact: true }).isVisible());
  });
  await manage('long-scenes');
  await check('readback preserves the full title and returns to management', async () => {
    await page.locator('.vg-stage-list > li').filter({ has: page.getByRole('heading', { name: '我们在街角旧书店聊到天黑，那些尚未说完的心事与很长很长的场景名称 1', exact: true }) }).getByRole('button', { name: '回看', exact: true }).click(); await page.locator('.vg-stage-active').waitFor();
    assert.equal(await page.locator('.vg-stage-active-title h1').innerText(), '我们在街角旧书店聊到天黑，那些尚未说完的心事与很长很长的场景名称 1');
    assert.equal(await page.locator('.vg-stage-transcript').getAttribute('tabindex'), '0');
    await page.getByRole('button', { name: '返回', exact: true }).click(); await page.getByRole('heading', { name: '场景管理', exact: true }).waitFor();
    await page.getByRole('button', { name: '返回星域', exact: true }).click(); await page.locator('[data-starfield-overview]').waitFor();
  });
  await check('creation saves one local scene with selected memory mode and opens the existing canvas', async () => {
    await starfield('empty'); await page.locator('[data-starfield-overview]').getByRole('button', { name: '开启新场景', exact: true }).last().click();
    await page.getByRole('textbox', { name: '起始地点', exact: true }).fill('你们散步经过的旧街口');
    await page.getByRole('textbox', { name: '场景简称', exact: true }).fill('雨后闲谈');
    await page.locator('.vg-stage-cast button').first().click();
    await page.getByRole('button', { name: /从此刻开始参与/ }).click();
    await page.getByRole('button', { name: '开启场景', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => window.starfieldPreview.snapshot().navigation.activeView === 'canvas');
    const rows = await page.evaluate(() => window.starfieldPreview.ownedScenes());
    assert.equal(rows.length, 1); assert.equal(rows[0].title, '雨后闲谈'); assert.equal(rows[0].place, '你们散步经过的旧街口'); assert.equal(rows[0].state.participants[0].entryMemoryMode, 'present');
    assert.equal((await page.evaluate(() => window.starfieldPreview.snapshot())).opens.length, 1);
  });
  await check('readback deletion clears selected private content without changing accounts', async () => {
    await manage('six'); await page.locator('.vg-stage-list > li').filter({ has: page.getByRole('heading', { name: '共同经历 2', exact: true }) }).getByRole('button', { name: '回看', exact: true }).click(); await page.locator('.vg-stage-active').waitFor();
    const id = await page.evaluate(() => window.starfieldPreview.snapshot().sceneIds[1]);
    await page.evaluate(id => window.starfieldPreview.mutateScene(id, 'delete'), id);
    await page.locator('.vg-stage-active').waitFor({ state: 'hidden' }); await page.getByRole('alert').filter({ hasText: /删除|权限/ }).waitFor();
    assert(!await page.getByRole('heading', { name: '共同经历 2', exact: true }).isVisible());
  });
  await check('revoked world ownership clears the management page', async () => {
    await manage('one'); await page.evaluate(() => window.starfieldPreview.revokeWorld());
    await page.getByRole('heading', { name: '场景读取失败', exact: true }).waitFor(); assert(!await page.getByText('雨后的站台', { exact: true }).isVisible());
  });
  await check('a scene transferred away disappears from the already-open management list', async () => {
    await manage('six'); const id = await page.evaluate(() => window.starfieldPreview.snapshot().sceneIds[1]);
    await page.evaluate(id => window.starfieldPreview.mutateScene(id, 'owner'), id);
    await page.getByRole('heading', { name: '共同经历 2', exact: true }).waitFor({ state: 'hidden' });
  });
  await check('scene list read failure is explicit and retry recovers it', async () => {
    await starfield('six'); await page.evaluate(() => window.starfieldPreview.failNext('load'));
    await page.getByRole('button', { name: '管理全部场景', exact: true }).click(); await page.getByRole('heading', { name: '场景读取失败', exact: true }).waitFor();
    await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByText('雨后的站台', { exact: true }).waitFor();
  });
  await check('loading management can return before the pending query finishes', async () => {
    await starfield('six'); await page.evaluate(() => window.starfieldPreview.holdLoading());
    await page.getByRole('button', { name: '管理全部场景', exact: true }).click(); await page.getByRole('status', { name: '正在读取星域…', exact: true }).waitFor();
    await page.getByRole('button', { name: '返回星域', exact: true }).click(); await page.getByRole('heading', { name: '星域', exact: true }).waitFor();
    await page.evaluate(() => window.starfieldPreview.releaseLoading()); await page.locator('[data-starfield-overview]').waitFor();
  });
  await check('no-character state offers the existing character page, not a dead creation button', async () => {
    await starfield('empty'); await page.evaluate(() => window.starfieldPreview.clearCharacters());
    await page.locator('[data-starfield-overview]').getByRole('button', { name: '开启新场景', exact: true }).last().click();
    await page.getByRole('heading', { name: '先认识一位同行者', exact: true }).waitFor();
    await page.getByRole('button', { name: '去认识角色', exact: true }).click();
    await page.waitForFunction(() => window.starfieldPreview.snapshot().navigation.mobileTab === 'characters');
  });
  await check('management reaches scenes beyond the first fifty without changing the runtime', async () => {
    await manage('many-more'); assert.equal(await page.locator('.vg-stage-list > li').count(), 50);
    const more = page.getByRole('button', { name: '加载更多场景', exact: true }); assert(await more.isVisible(), 'older records require a real reachable list entry');
    await more.click(); await page.waitForFunction(() => document.querySelectorAll('.vg-stage-list > li').length === 73);
    assert.equal(await page.getByRole('heading', { name: '共同经历 73', exact: true }).count(), 1); assert(!await more.isVisible());
  });
  await check('no model, capture, audio or native invocation', async () => { const s = await page.evaluate(() => window.starfieldPreview.snapshot()); assert(Object.values(s.isolation).every(n => n === 0)); return s.isolation; });
  await check('compiled source fingerprints match current files', () => { for (const input of server.manifest.inputs) assert.equal(createHash('sha256').update(readFileSync(input.path)).digest('hex'), input.sha256); });
} catch (error) { report.errors.push(String(error.stack || error)); }
finally { await browser?.close(); if (server) await new Promise(resolve => server.server.close(resolve)); report.pass = report.checks.length === 25 && report.checks.every(c => c.pass) && !report.errors.length; writeFileSync(out + '/result.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, pass: report.pass, checks: report.checks.length, failed: report.checks.filter(c => !c.pass), errors: report.errors })); }
if (!report.pass) process.exitCode = 1;
