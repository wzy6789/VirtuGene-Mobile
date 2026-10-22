import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const before = process.argv.includes('--before');
const out = '.tmp-preview/ui-overhaul-20261017/style-learning';
mkdirSync(out, { recursive: true });
const production = resolve('src/components/character');
const bundle = await build({ entryPoints: ['scripts/verify/character-style-learning.tsx'], bundle: true, write: false, jsx: 'automatic', format: 'iife', platform: 'browser', loader: { '.css': 'empty', '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"test"' }, plugins: before ? [{ name: 'frozen-source', setup(b) { b.onLoad({ filter: /(?:ChatStyleImport|CreateGeneTab)\.tsx$/ }, args => ({ contents: readFileSync(`${out}/source-before/${args.path.split(/[\\/]/).pop()}`, 'utf8'), loader: 'tsx', resolveDir: production })); } }] : [] });
const css = readdirSync('dist/renderer/assets').filter(f => f.endsWith('.css')).map(f => readFileSync('dist/renderer/assets/' + f, 'utf8')).join('\n');
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html;charset=utf-8'); res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : `<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:16px}</style><div id="root" class="mobile-layout"></div><script src="/test.js"></script></html>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [], defects = [], errors = []; let external = 0;
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => { if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue(); external++; return route.abort(); });
const pause = () => page.waitForTimeout(40);
const callCount = () => page.evaluate(() => styleLearningTest.calls.length);
const start = () => page.getByRole('button', { name: /^(重新学习|提炼说话方式)$/ }).click();
const stop = () => page.getByRole('button', { name: '停止学习', exact: true });
const raw = Array.from({ length: 6 }, (_, i) => `阿岚：样本 ${i}\n我：不属于目标人的内容 ${i}`).join('\n');
async function fill() {
  await page.getByRole('button', { name: /学习说话方式/ }).click();
  await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).fill(raw);
  await page.getByRole('combobox', { name: '学习对象', exact: true }).selectOption('阿岚');
  await page.getByRole('checkbox', { name: /同意将所选对象/ }).check();
}
async function resolveCall(index, rules) { await page.evaluate(({ index, rules }) => styleLearningTest.calls[index].resolve(rules), { index, rules }); await pause(); }
async function request() { const index = await callCount(); await start(); await page.waitForFunction(count => styleLearningTest.calls.length > count, index); return index; }
async function record(value, text) { assert.ok(value, text); checks.push(text); }
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`); await page.waitForFunction(() => window.styleLearningTest);
  await page.evaluate(async () => { await styleLearningTest.reset(); styleLearningTest.mount(); }); await fill();
  if (before) {
    const index = await request();
    if (await stop().count() === 0) defects.push('Pending style learning has no stop action');
    await page.evaluate(() => styleLearningTest.active(false)); await pause();
    if (!(await page.evaluate(i => styleLearningTest.calls[i].signal?.aborted, index))) defects.push('Hidden mounted learner does not abort actual task fetch');
    await resolveCall(index, '隐藏后迟到的旧结果');
    if (await page.evaluate(() => styleLearningTest.commits.some(value => value?.rules === '隐藏后迟到的旧结果'))) defects.push('Old result updates the hidden draft after leaving creation');
    assert.equal(defects.length, 3); await page.evaluate(() => styleLearningTest.active(true)); await pause(); await page.screenshot({ path: `${out}/before.png` });
  } else {
    const first = await request();
    await stop().click(); await record(await page.evaluate(i => styleLearningTest.calls[i].signal.aborted, first), 'Stop propagates abort through actual taskChat/llm fetch');
    await record(await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).inputValue() === raw && await page.getByRole('combobox', { name: '学习对象', exact: true }).inputValue() === '阿岚', 'Stop preserves source records and selected speaker');
    await record(await page.getByRole('textbox', { name: '学习的表达方式', exact: true }).inputValue() === '原来确认的表达方式', 'Stop preserves previously confirmed style');
    const second = await request(); await resolveCall(first, '旧轮不得覆盖');
    await record(await stop().isVisible() && await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).isDisabled(), 'Old success/finally cannot replace style or unlock a newer request');
    await record(await page.getByRole('textbox', { name: '学习的表达方式', exact: true }).inputValue() === '原来确认的表达方式', 'Cancelled result never commits');
    await resolveCall(second, '新一轮表达方式'); await page.getByRole('textbox', { name: '学习的表达方式', exact: true }).waitFor();
    await record(await page.getByRole('textbox', { name: '学习的表达方式', exact: true }).inputValue() === '新一轮表达方式', 'Retry commits only the newest result');
    const failed = await request(); await page.evaluate(i => styleLearningTest.calls[i].reject(Error('受控学习失败')), failed); await page.getByRole('alert').waitFor();
    await record(await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).inputValue() === raw && !await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).isDisabled(), 'Failure preserves records and re-enables retry');
    const hidden = await request(); await page.evaluate(() => styleLearningTest.active(false)); await pause();
    await record(await page.evaluate(i => styleLearningTest.calls[i].signal.aborted, hidden), 'Hiding without unmount aborts learning');
    await page.evaluate(() => styleLearningTest.active(true)); const afterHidden = await request(); await resolveCall(hidden, '隐藏旧结果');
    await record(await stop().isVisible(), 'Hidden request finally cannot release retry busy state'); await resolveCall(afterHidden, '返回后的表达方式');
    const owner = await request(); await page.evaluate(() => styleLearningTest.owner('other-owner')); await pause(); await page.evaluate(() => styleLearningTest.owner('style-lifecycle-owner')); await pause();
    await record(await page.evaluate(i => styleLearningTest.calls[i].signal.aborted, owner), 'Account change aborts even when returning to the original owner');
    await resolveCall(owner, '跨账号旧结果'); await record(await page.getByRole('textbox', { name: '学习的表达方式', exact: true }).inputValue() === '返回后的表达方式', 'Returning account does not resurrect old style result');
    await page.getByLabel('导入聊天文本', { exact: true }).setInputFiles({ name: 'held-old.txt', mimeType: 'text/plain', buffer: Buffer.from('deferred') }); await page.waitForFunction(() => styleLearningTest.reads.length === 1);
    await page.getByRole('button', { name: '停止读取', exact: true }).click(); const duringRead = await request();
    await page.evaluate(() => styleLearningTest.reads[0].resolve('阿岚：迟到文件不得替换原文')); await pause();
    await record(await stop().isVisible() && await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).inputValue() === raw, 'Cancelled file read cannot overwrite records or release a newer learning lock');
    await resolveCall(duringRead, '文件取消后的表达方式');
    await page.getByLabel('导入聊天文本', { exact: true }).setInputFiles({ name: 'success.txt', mimeType: 'text/plain', buffer: Buffer.from('阿岚：追加本机文本') }); await page.waitForFunction(() => document.querySelector('[aria-label="核对聊天记录"]').value.includes('追加本机文本'));
    await record(!await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).isDisabled(), 'Successful file commit clears its own busy state and preserves existing records');
    await record(!await page.getByRole('checkbox', { name: /同意将所选对象/ }).isChecked(), 'Import invalidates previous consent without uploading records');
    await page.getByRole('checkbox', { name: /同意将所选对象/ }).check(); const unmounted = await request(); await page.evaluate(() => styleLearningTest.unmount());
    await record(await page.evaluate(i => styleLearningTest.calls[i].signal.aborted, unmounted), 'Unmount aborts the owned learning transport'); await resolveCall(unmounted, '卸载后旧结果');
    await record(await page.locator('#root').innerText() === '', 'Unmounted response creates no UI or updates');
    await page.evaluate(async () => { await styleLearningTest.reset(); styleLearningTest.mountModal(); });
    await page.getByRole('button', { name: '创造基因', exact: true }).click(); await page.getByPlaceholder('为数字灵魂命名').fill('学习取消验收'); await page.getByRole('button', { name: '表达', exact: true }).click();
    await page.getByText('从聊天记录学习（可选）', { exact: true }).click(); await fill(); const modal = await request();
    await page.getByRole('button', { name: '返回基因库', exact: true }).click(); await page.getByRole('button', { name: '创造基因', exact: true }).waitFor();
    await record(await page.evaluate(i => styleLearningTest.calls[i].signal.aborted, modal), 'Actual CharacterAddModal back hides the mounted creation page and aborts learning');
    await page.getByRole('button', { name: '创造基因', exact: true }).click(); await page.getByRole('button', { name: '表达', exact: true }).click();
    await record(await page.getByRole('textbox', { name: '核对聊天记录', exact: true }).inputValue() === raw, 'Returning to actual creation restores its original records');
    const modalNew = await request(); await resolveCall(modal, '实际弹层迟到结果'); await record(await stop().isVisible(), 'Real parent hidden result cannot overwrite new busy state');
    await page.getByRole('button', { name: '性格', exact: true }).click(); await record(await page.evaluate(i => styleLearningTest.calls[i].signal.aborted, modalNew), 'Moving away from the expression step cancels hidden learning'); await resolveCall(modalNew, '换步骤迟到结果');
    await page.getByRole('button', { name: '表达', exact: true }).click(); const visible = await request(); await page.getByRole('button', { name: /学习说话方式/ }).click();
    await record(await stop().isVisible(), 'Stop remains reachable when the learner is collapsed');
    for (const [theme, width] of [['dark', 390], ['light', 320]]) { await page.setViewportSize({ width, height: 844 }); await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark'); await stop().scrollIntoViewIfNeeded(); await record(await stop().evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.right <= innerWidth; }), `${theme}/${width}: stop remains an unobstructed 44px target`); await page.screenshot({ path: `${out}/pending-${theme}-${width}.png` }); }
    await stop().click(); await resolveCall(visible, '末轮迟到结果'); await page.evaluate(() => styleLearningTest.unmount());
    assert.equal(external, 0); assert.deepEqual(errors, []);
  }
} finally {
  writeFileSync(`${out}/${before ? 'before' : 'after'}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), mode: before ? 'frozen sources substituted in isolated bundle' : 'current production components', checks, defects, errors, externalRequests: external, actualModelCalls: 0, mediaCalls: 0, scope: 'Actual ChatStyleImport, CreateGeneTab, CharacterAddModal and task fetch chain with controlled deferred text responses; no Android/OCR/provider cancellation claim' }, null, 2));
  await browser.close(); await new Promise(r => server.close(r));
}
console.log(before ? `REPRODUCED ${defects.length} before defects` : `PASS ${checks.length} style learning checks`);
