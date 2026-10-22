import { createRequire } from 'node:module';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const output = resolve(process.env.VG_SETUP_UI_EVIDENCE ?? '.tmp-preview/entry-setup-ui-20261013');
mkdirSync(output, { recursive: true });
const root = resolve('dist/renderer'), html = readFileSync(join(root, 'index.html'), 'utf8');
const styles = [...html.matchAll(/<link[^>]*href=["']([^"']+\.css)["']/g)].map(m => m[1]);
for (const file of readdirSync(join(root, 'assets')).filter(f => f.endsWith('.css'))) if (readFileSync(join(root, 'assets', file), 'utf8').includes('.vg-assistant-preferences')) styles.push('./assets/' + file);
const uniqueStyles = [...new Set(styles)];
const bundled = await build({ entryPoints: ['scripts/verify/entry-setup-ui.tsx'], write: false, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty', '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) } });
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end('<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + uniqueStyles.map(href => `<link rel="stylesheet" href="${href}">`).join('') + '</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
  if (pathname === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundled.outputFiles[0].text); return; }
  const file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', ({ '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.js': 'application/javascript' })[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [], errors = [], external = [], screenshots = [];
const check = (ok, label, detail) => { assert.ok(ok, label + (detail ? ': ' + JSON.stringify(detail) : '')); checks.push({ label, detail }); console.log('PASS ' + label); };
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
const fresh = async () => { await page.evaluate(() => setupUI.reset()); };
const open = async () => { await page.evaluate(() => setupUI.open()); await page.getByRole('dialog').waitFor(); };
const save = () => page.getByRole('button', { name: '创建助理', exact: true });
const shot = async name => { const file = join(output, name + '.png'); await page.screenshot({ path: file }); screenshots.push(file); };
try {
  await page.goto(origin + '/?virtugene-preview=mobile'); await page.waitForFunction(() => !!window.setupUI);
  await fresh(); await page.evaluate(() => setupUI.holdRead()); await open();
  await page.getByRole('status', { name: '正在读取助理资料', exact: true }).waitFor();
  check(await save().isDisabled() && await page.getByLabel('助理名字', { exact: true }).count() === 0, '读取中使用骨架，未读取完不展示可提交的默认表单');
  await page.evaluate(() => setupUI.releaseRead()); await page.getByLabel('助理名字', { exact: true }).waitFor();
  check(await save().isDisabled(), '空名字不能创建');
  await page.getByLabel('助理名字', { exact: true }).fill('星'.repeat(21));
  check(await save().isDisabled() && await page.getByLabel('助理名字', { exact: true }).getAttribute('aria-invalid') === 'true', '21字名字本地阻止提交并有可达错误状态');
  await page.keyboard.press('Escape'); check(await page.evaluate(() => setupUI.closed()) === 1, '引导可按Escape稍后再说');
  await fresh(); await page.evaluate(() => setupUI.failRead()); await open();
  await page.getByRole('alert').waitFor(); check(await save().isDisabled() && await page.getByLabel('助理名字', { exact: true }).count() === 0, '读取失败保留重试入口，禁止把未知状态当新助理');
  await shot('read-failure'); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByLabel('助理名字', { exact: true }).waitFor();
  check(await page.getByRole('alert').count() === 0, '重试重新读取真实本地资料并解除错误');
  await page.getByLabel('助理名字', { exact: true }).fill('小星'); await page.getByLabel('助理补充偏好', { exact: true }).fill('回复简短，先听我说完');
  await page.evaluate(() => setupUI.failWrite()); await save().click(); await page.getByRole('alert').waitFor();
  check(await page.getByLabel('助理名字', { exact: true }).inputValue() === '小星' && await page.getByLabel('助理补充偏好', { exact: true }).inputValue() === '回复简短，先听我说完', '真实IndexedDB写入失败保留姓名和补充偏好');
  check(await page.evaluate(() => setupUI.db.characters.count()) === 0, '失败事务没有留下半个助理');
  await save().click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const created = await page.evaluate(async () => ({ rows: await setupUI.db.characters.toArray(), binding: await setupUI.db.secretaryBindings.get(setupUI.owner), closed: setupUI.closed(), view: setupUI.view() }));
  check(created.rows.length === 1 && created.rows[0].name === '小星' && created.binding.status === 'active', '重试只创建一位真实助理并保留绑定');
  check(created.closed === 1 && created.view === 'actionCabin', '完成创建后才关闭并进入助理空间');
  await fresh(); await open(); await page.getByLabel('助理名字', { exact: true }).fill('A账号未保存姓名'); await page.evaluate(() => setupUI.switchOwner('setup-second-owner')); await page.getByLabel('助理名字', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('input[placeholder="你想叫 TA 什么？"]')?.value === '');
  check(await save().isDisabled(), '换账号销毁旧姓名草稿与读取状态');
  await fresh(); await page.evaluate(() => setupUI.seedExisting()); await open(); await page.getByRole('dialog', { name: '助理管理', exact: true }).waitFor();
  check(await page.getByRole('button', { name: '保存助理资料', exact: true }).isVisible(), '已有助理进入原管理流程，不重复创建');
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await fresh(); await page.evaluate(theme => setupUI.theme(theme), theme); await open(); await page.getByLabel('助理名字', { exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    const metrics = await page.getByRole('dialog').evaluate(el => ({ box: el.getBoundingClientRect().toJSON(), overflow: el.scrollWidth > el.clientWidth + 1 || [...el.querySelectorAll('[data-modal-scroll]')].some(n => n.scrollWidth > n.clientWidth + 1), small: [...el.querySelectorAll('p,label,small,button,legend')].filter(n => n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).map(n => n.textContent), targets: [...el.querySelectorAll('button')].filter(n => n.getClientRects().length && (n.getBoundingClientRect().width < 43.5 || n.getBoundingClientRect().height < 43.5)).map(n => n.textContent) }));
    check(metrics.box.left >= 0 && metrics.box.right <= width + 1 && !metrics.overflow, `${theme} ${width} 引导无横向溢出`);
    check(metrics.small.length === 0 && metrics.targets.length === 0, `${theme} ${width} 最小字阶12px与按钮44px`, metrics);
    await shot(`${theme}-${width}-intro`); await page.getByRole('group', { name: '性格示例场景', exact: true }).scrollIntoViewIfNeeded(); await shot(`${theme}-${width}-personality`);
  }
  await page.setViewportSize({ width: 320, height: 460 });
  const buttons = await save().boundingBox(); check(buttons && buttons.y >= 0 && buttons.y + buttons.height <= 461, '短视口底部创建与稍后操作仍可见'); await shot('short-viewport');
  if (process.env.VG_SETUP_FONT_MATRIX === '1') {
    for (const theme of ['dark', 'light']) for (const [width, height] of [[320, 844], [390, 844], [320, 460]]) {
      await page.setViewportSize({ width, height }); await fresh(); await page.evaluate(theme => setupUI.theme(theme), theme); await open(); await page.getByLabel('助理名字', { exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
      await page.getByRole('dialog').evaluate(root => {
        const sizes = [root, ...root.querySelectorAll('*')].filter(n => n instanceof HTMLElement && !n.closest('[aria-hidden="true"]')).map(n => { const s = getComputedStyle(n); return [n, parseFloat(s.fontSize), parseFloat(s.lineHeight)]; });
        for (const [n, font, line] of sizes) { n.style.fontSize = `${font * 2}px`; if (Number.isFinite(line)) n.style.lineHeight = `${line * 2}px`; }
      });
      const metrics = await page.getByRole('dialog').evaluate(root => ({
        overflow: root.scrollWidth > root.clientWidth + 1 || [...root.querySelectorAll('[data-modal-scroll]')].some(n => n.scrollWidth > n.clientWidth + 1),
        inputFont: parseFloat(getComputedStyle(root.querySelector('input')).fontSize),
        smallTargets: [...root.querySelectorAll('button')].filter(n => n.getClientRects().length && (n.getBoundingClientRect().width < 43.5 || n.getBoundingClientRect().height < 43.5)).map(n => n.textContent),
      }));
      check(!metrics.overflow && metrics.inputFont >= 28 && !metrics.smallTargets.length, `${theme} ${width}×${height} 实际字号与行高200%无横向溢出、触控面积完整`, metrics);
      const footer = await save().boundingBox(); check(footer && footer.y >= 0 && footer.y + footer.height <= height + 1, `${theme} ${width}×${height} 放大字底部操作仍在视口内`, footer);
      await page.getByLabel('助理名字', { exact: true }).scrollIntoViewIfNeeded(); const field = await page.getByLabel('助理名字', { exact: true }).boundingBox(); check(field && field.y >= 0 && field.y + field.height <= height + 1, `${theme} ${width}×${height} 放大字姓名字段可滚动到达`, field);
      await shot(`${theme}-${width}-${height}-font200-intro`);
    }
  }
  check(errors.length === 0, '无未捕获界面错误', errors); check(external.length === 0, '零外部请求与真实模型调用', external);
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors, external, screenshots, modelCalls: 0, actualApiTokens: 0, rendererEntry: html.match(/assets\/index-[^"']+\.js/)?.[0], css: uniqueStyles.map(href => ({ href, sha256: createHash('sha256').update(readFileSync(resolve(root, href))).digest('hex') })), sourceCssSupplement: false, limitations: '生产组件源码夹具与真实隔离IndexedDB，CSS来自统一生产构建。非完整App、无原生系统键盘或Android设备验证。' }, null, 2));
  console.log(`${checks.length} setup checks PASS`);
} catch (error) { await shot('failure').catch(() => {}); writeFileSync(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, external }, null, 2)); throw error; }
finally { await browser.close(); await new Promise(done => server.close(done)); }
