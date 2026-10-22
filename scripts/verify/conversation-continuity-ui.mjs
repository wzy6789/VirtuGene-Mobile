import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const output = '.tmp-preview/conversation-continuity-20261013'; mkdirSync(output, { recursive: true });
const bundle = await build({ entryPoints: ['scripts/verify/conversation-continuity-ui.tsx'], bundle: true, write: false, outfile: 'test.js', platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true}', __APP_VERSION__: '"test"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
writeFileSync(join(output, 'fixture.js'), js);
const assetNames = new Set(readdirSync('dist/renderer/assets'));
const base = [...assetNames].filter(name => name.endsWith('.css')).map(name => readFileSync(join('dist/renderer/assets', name), 'utf8')).join('\n');
const server = createServer((req, res) => {
  const asset = req.url.split('?')[0].slice(1);
  if (assetNames.has(asset)) {
    res.setHeader('Content-Type', asset.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
    res.end(readFileSync(join('dist/renderer/assets', asset))); return;
  }
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  res.end(req.url === '/test.js' ? js : `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}\n${css}button,textarea{font:inherit}body{margin:0;background:var(--bg);font-family:var(--vg-font-ui,system-ui)}</style><div id="root"></div><script src="/test.js"></script></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Users/34568/AppData/Local/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executablePath, 'An already installed browser is required; this script never installs one');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const checks = [], errors = []; let blocked = 0;
page.on('pageerror', error => errors.push(error.stack || error.message));
await page.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); blocked++; return route.abort(); });
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
try {
  await page.goto(origin); await page.waitForFunction(() => window.continuityUI?.ready);
  check(await page.getByText('foreign private thread', { exact: true }).count() === 0 && await page.getByText('unrelated scene thread', { exact: true }).count() === 0, 'resume card hides foreign and unrelated scene threads');
  checks.push(...await page.evaluate(() => continuityUI.contracts()));
  await page.getByRole('button', { name: '记住本轮', exact: true }).click();
  await page.getByText('已记住', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'saved-memory-receipt.png'), fullPage: true });
  await page.evaluate(() => continuityUI.owner('other'));
  check(await page.locator('.vg-memory-receipt').count() === 0, 'account change immediately hides memory receipt');
  await page.evaluate(() => continuityUI.owner('continuity-owner'));
  await page.waitForTimeout(50); await page.evaluate(() => continuityUI.republish());
  check(await page.locator('.vg-chat-context-card[aria-label="这条回应的情境线索"]').count() === 0, 'chat no longer inserts a reply context card');
  await page.getByRole('button', { name: '查看记忆与来源', exact: true }).click();
  await page.getByText('周五三点在北港旧钟楼见。', { exact: true }).waitFor();
  check(true, 'receipt opens exactly the saved memory');
  await page.getByRole('button', { name: '看当时说的话', exact: true }).click();
  await page.getByText('周五三点在北港旧钟楼见。', { exact: true }).nth(1).waitFor(); check(true, 'saved memory opens the actual source');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await page.getByText('已撤销这次记忆', { exact: true }).waitFor();
  check(await page.evaluate(() => continuityUI.count()) === 0, 'undo removes the committed memory');
  await page.getByRole('button', { name: '继续这一幕', exact: true }).click();
  await page.getByRole('button', { name: '自由空间', exact: true }).click();
  check(await page.evaluate(() => continuityUI.continues === 1 && continuityUI.free === 1), 'resume and free-space actions stay available');
  await page.getByRole('button', { name: /此刻/ }).click(); await page.getByRole('button', { name: '窗边', exact: true }).click();
  await page.getByText('场景设定已保存', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  await page.locator('[aria-label="刚保存的场景设定"] summary').click(); check(await page.getByText(/只作用于本会话/).isVisible(), 'scene change expands in place');
  await page.getByRole('textbox', { name: '自由输入', exact: true }).fill('仍然可以自由说话'); check(true, 'context cards retain free input');
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await page.evaluate(() => { document.querySelector('main').scrollTop = 0; window.scrollTo(0, 0); });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}-${width} no horizontal overflow`);
    check(await page.evaluate(() => {
      const summary = document.querySelector('[aria-label="刚保存的场景设定"] summary');
      const probe = document.createElement('span'); probe.style.color = 'var(--text)'; document.body.append(probe);
      const matches = getComputedStyle(summary).color === getComputedStyle(probe).color; probe.remove(); return matches;
    }), `${theme}-${width} scene title uses theme text color`);
    await page.screenshot({ path: join(output, `${theme}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => document.body.style.zoom = '1.25');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'short viewport with 125 percent zoom has no horizontal overflow');
  await page.getByRole('textbox').scrollIntoViewIfNeeded();
  check(await page.getByRole('textbox').isVisible(), 'free input remains reachable on a short enlarged viewport');
  await page.screenshot({ path: join(output, 'light-320-short-zoom125.png'), fullPage: true });
  await page.evaluate(() => document.body.style.zoom = '1');
  await page.evaluate(() => continuityUI.call());
  await page.getByRole('button', { name: /返回与林舟的语音通话/ }).waitFor();
  await page.getByRole('button', { name: /返回与林舟的语音通话/ }).click(); await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => { const state = continuityUI.callState(); return state.busy && state.minimized; }), 'back minimizes the persistent host without ending the call');
  await page.evaluate(() => continuityUI.call('paused'));
  check(await page.getByText('通话已暂停', { exact: true }).isVisible(), 'minimized label follows actual paused state');
  await page.evaluate(() => continuityUI.stopFixture());
  check(errors.length === 0, 'no page exceptions'); check(blocked === 0, 'zero external requests');
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors, blockedExternalRequests: blocked, realModelCalls: 0, nativeAudioUsed: false }, null, 2));
  process.stdout.write(`PASS conversation-continuity: ${checks.length} checks, isolated IndexedDB, no external requests\n`);
} catch (error) {
  const scripts = await page.evaluate(() => Array.from(document.scripts).map(script => ({ src: script.src, text: script.textContent?.slice(0, 200) }))).catch(() => []);
  const sceneElements = await page.evaluate(() => Array.from(document.querySelectorAll('.scene-card > button')).map(element => {
    const parents = []; for (let parent = element.parentElement; parent; parent = parent.parentElement) parents.push({ tag: parent.tagName, id: parent.id, className: parent.className });
    return { html: element.outerHTML, parents };
  })).catch(() => []);
  writeFileSync(join(output, `failure-${Date.now()}.json`), JSON.stringify({ checks, errors, scripts, sceneElements, error: String(error) }, null, 2)); throw error;
}
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
