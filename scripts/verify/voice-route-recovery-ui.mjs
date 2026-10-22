import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
const evidence = '.tmp-preview/voice-route-recovery-20261016/ui';
const serve = process.argv.includes('--serve'), beforeOnly = process.argv.includes('--before-only');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 4196 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local preview port');
mkdirSync(evidence, { recursive: true });
const snapshots = new Map([
  [resolve('src/components/chat/VoiceCallDialog.tsx'), 'VoiceCallDialog.tsx'],
  [resolve('src/styles/voice-call.css'), 'voice-call.css'],
  [resolve('src/store/voice-call-store.ts'), 'voice-call-store.ts'],
]);
async function bundle(before) {
  return build({ entryPoints: ['scripts/verify/voice-route-recovery-ui.tsx'], outfile: 'route-recovery.js', bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.webp': 'dataurl', '.png': 'dataurl' },
    define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"isolated-preview"' },
    plugins: before ? [{ name: 'untouched-working-copy-ui', setup(b) {
      b.onLoad({ filter: /(?:VoiceCallDialog\.tsx|voice-call\.css|voice-call-store\.ts)$/ }, args => {
        const file = snapshots.get(args.path);
        if (file) return { contents: readFileSync(`${evidence}/before/${file}`, 'utf8'), loader: file.endsWith('.css') ? 'css' : file.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(args.path) };
      });
    } }] : [] });
}
const bundles = new Map();
for (const label of serve ? ['after'] : beforeOnly ? ['before'] : ['before', 'after']) bundles.set(label, await bundle(label === 'before'));
const assets = 'dist/renderer/assets';
const baseCss = readdirSync(assets).filter(name => name.endsWith('.css')).map(name => readFileSync(join(assets, name), 'utf8')).join('\n');
const server = createServer((req, res) => {
  const label = req.url?.startsWith('/before') ? 'before' : 'after';
  const current = bundles.get(label) ?? bundles.values().next().value;
  res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; img-src 'self' data: blob:");
  res.setHeader('Permissions-Policy', 'microphone=(), camera=()');
  if (req.url?.split('?')[0].endsWith('.js')) { res.setHeader('Content-Type', 'application/javascript'); res.end(current.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  res.end(`<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>声音设备恢复 · 本地隔离预览</title><style>${baseCss}\n${current.outputFiles.find(file => file.path.endsWith('.css')).text}</style></head><body><div id="root"></div><script>navigator.mediaDevices && (navigator.mediaDevices.getUserMedia=()=>Promise.reject(Error('preview microphone blocked')));window.Audio=function(){throw Error('preview audio blocked')};</script><script src="/${label}.js"></script></body></html>`);
});
await new Promise(done => server.listen(serve ? port : 0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
if (serve) {
  console.log(`Actual component preview: ${origin}/after?virtugene-preview=mobile (local service required; simulated state, microphone/model/sound blocked)`);
} else {
  const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let checks = 0, external = 0;
  const errors = [], cases = [];
  const check = (value, label) => { assert.ok(value, label); checks++; };
  async function open(label) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-16T10:00:00+08:00') });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external++, route.abort()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/${label}?virtugene-preview=mobile`);
    await page.waitForFunction(() => window.routeRecoveryUi?.ready);
    await page.getByRole('dialog', { name: '晓来 · 语音通话' }).waitFor();
    await page.clock.pauseAt(new Date('2026-10-16T10:00:30+08:00'));
    return { context, page };
  }
  try {
    const { context, page } = await open('before');
    await page.getByRole('button', { name: '声音设备', exact: true }).click();
    await page.getByRole('button', { name: '蓝牙耳机 · 隔离预览', exact: true }).click();
    await page.clock.runFor(4200);
    await page.screenshot({ path: `${evidence}/before-wait-4200ms.png` });
    check(await page.getByRole('button', { name: '取消等待，保持暂停', exact: true }).count() === 0, 'baseline has no cancellation action after 4.2s');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${evidence}/before-call-wait-4200ms.png` });
    await context.close();
    cases.push('before: saved working-copy component/CSS/store, same simulated request at 4.2s');
    if (!beforeOnly) {
      const current = await open('after'); const page = current.page;
      await page.getByRole('button', { name: '声音设备', exact: true }).click();
      await page.getByRole('button', { name: '蓝牙耳机 · 隔离预览', exact: true }).click();
      await page.clock.runFor(3990);
      check(await page.getByRole('button', { name: '取消等待，保持暂停', exact: true }).count() === 0, 'recovery actions wait until the threshold');
      await page.clock.runFor(210);
      const routeDialog = page.getByRole('dialog', { name: '声音设备', exact: true });
      await routeDialog.getByRole('button', { name: '取消等待，保持暂停', exact: true }).waitFor();
      await page.screenshot({ path: `${evidence}/after-wait-4200ms.png` });
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${evidence}/after-call-wait-4200ms.png` });
      check((await page.evaluate(() => window.routeRecoveryUi.stats())).selected.join(',') === '11', 'waiting does not select a fallback by itself');
      await page.getByRole('button', { name: '收起通话', exact: true }).click();
      await page.clock.runFor(5000);
      await page.getByRole('button', { name: /^返回与晓来的语音通话/ }).click();
      await page.getByRole('button', { name: '取消等待，保持暂停', exact: true }).waitFor(); checks++;
      await page.getByRole('button', { name: '改用听筒', exact: true }).click();
      await page.getByRole('button', { name: '继续通话', exact: true }).waitFor();
      let stats = await page.evaluate(() => window.routeRecoveryUi.stats());
      check(stats.cancels === 1 && stats.selected.join(',') === '11,12' && stats.phase === 'paused' && stats.resumes === 0, 'earpiece explicitly cancels first, changes route, and remains paused');
      await page.getByRole('button', { name: '继续通话', exact: true }).click();
      check((await page.evaluate(() => window.routeRecoveryUi.stats())).resumes === 1, 'only the explicit continue action resumes');
      await page.evaluate(() => window.routeRecoveryUi.finishOld(true));
      await page.clock.runFor(20);
      check(await page.getByText('已取消设备切换等待，通话保持暂停。确认声音设备后可手动继续。', { exact: true }).count() === 0, 'late cancelled device promise cannot overwrite successful recovery');
      cases.push('4秒阈值、收起后重开、无自动降级、明确切听筒后手动继续、旧设备Promise独立锁');
      await page.evaluate(() => window.routeRecoveryUi.wait(5000));
      await page.getByRole('button', { name: '使用扬声器', exact: true }).click();
      stats = await page.evaluate(() => window.routeRecoveryUi.stats());
      check(stats.selected.at(-1) === 13 && stats.phase === 'paused' && stats.resumes === 1, 'speaker selection requires explicit user action and does not resume');
      await page.evaluate(() => { window.routeRecoveryUi.wait(5000, true); window.routeRecoveryUi.holdCancel(true); });
      const cancel = page.getByRole('button', { name: '取消等待，保持暂停', exact: true });
      await cancel.click();
      await page.getByRole('button', { name: '正在取消等待…', exact: true }).waitFor();
      check(await page.getByRole('button', { name: '继续通话', exact: true }).isDisabled(), 'continue remains locked until native cancellation acknowledges');
      await page.evaluate(() => window.routeRecoveryUi.finishCancel());
      await page.getByText('已取消设备切换等待，通话保持暂停。确认声音设备后可手动继续。', { exact: true }).waitFor(); checks++;
      await page.screenshot({ path: `${evidence}/after-cancelled-paused.png` });
      cases.push('明确扬声器、旧SCO等待恢复、取消确认期间禁止继续、固定取消文案');
      for (const mode of ['unavailable', 'failed']) {
        const failure = await open('after');
        await failure.page.evaluate(mode => { window.routeRecoveryUi.mode(mode); window.routeRecoveryUi.wait(5000); }, mode);
        const before = await failure.page.evaluate(() => window.routeRecoveryUi.stats().selected.length);
        await failure.page.getByRole('button', { name: '使用扬声器', exact: true }).click();
        await failure.page.getByRole('button', { name: '请挂断后重新连接', exact: true }).waitFor();
        check(await failure.page.getByRole('button', { name: '请挂断后重新连接', exact: true }).isDisabled(), `${mode}: recovery requires reconnect`);
        check((await failure.page.evaluate(() => window.routeRecoveryUi.stats())).selected.length === before, `${mode}: failed cancellation never selects speaker`);
        await failure.context.close();
      }
      await page.evaluate(() => { window.routeRecoveryUi.mode('ok'); window.routeRecoveryUi.wait(5000); window.routeRecoveryUi.noEarpiece(); });
      check(await page.getByRole('button', { name: '改用听筒', exact: true }).count() === 0, 'no earpiece fallback advertised when absent');
      await page.evaluate(() => window.routeRecoveryUi.legacyWired());
      check(await page.getByRole('button', { name: '改用听筒', exact: true }).count() === 0, 'legacy system route -2 with wired type is never called earpiece');
      cases.push('缺取消hook及释放失败保持暂停并要求重连、无听筒/旧API有线路由不伪称听筒');
      await page.evaluate(() => { window.routeRecoveryUi.wait(5000); window.routeRecoveryUi.holdCancel(true); });
      await page.getByRole('button', { name: '使用扬声器', exact: true }).click();
      await page.getByRole('button', { name: '正在取消等待…', exact: true }).waitFor();
      const selectedBeforeRestart = await page.evaluate(() => window.routeRecoveryUi.stats().selected.length);
      await page.evaluate(() => { window.routeRecoveryUi.restart(); window.routeRecoveryUi.finishCancel(); });
      await page.clock.runFor(20);
      check((await page.evaluate(() => window.routeRecoveryUi.stats())).selected.length === selectedBeforeRestart, 'cancel completion from an older call cannot select speaker in a new call');
      cases.push('取消跨越通话身份变化时不执行旧降级选择');
      await current.context.close();
      {
        const test = await open('after');
        const dialog = test.page.getByRole('dialog', { name: '声音设备', exact: true });
        await test.page.getByRole('button', { name: '声音设备', exact: true }).click();
        await dialog.getByRole('button', { name: '蓝牙耳机 · 隔离预览', exact: true }).click();
        await test.page.clock.runFor(4200);
        await dialog.getByRole('button', { name: '取消等待，保持暂停', exact: true }).click();
        await dialog.getByRole('button', { name: '扬声器', exact: true }).waitFor();
        check(await dialog.getByRole('button', { name: '扬声器', exact: true }).isEnabled(), 'the unresolved old selection does not lock ordinary route rows after cancellation');
        await dialog.getByRole('button', { name: '扬声器', exact: true }).click();
        check((await test.page.evaluate(() => window.routeRecoveryUi.stats())).selected.join(',') === '11,13', 'ordinary post-cancel route selection is accepted while the old promise remains pending');
        await test.page.evaluate(() => window.routeRecoveryUi.finishOld(true));
        await test.page.clock.runFor(20);
        check(await dialog.getByRole('alert').count() === 0, 'late old selection rejection cannot add a fresh modal error');
        await test.context.close();
      }
      cases.push('普通设备列表在取消后也可重选，旧Promise未完成不锁死、不写迟到错误');
      {
        const test = await open('after');
        await test.page.evaluate(() => { window.routeRecoveryUi.wait(5000); window.routeRecoveryUi.holdCancel(true); });
        await test.page.getByRole('button', { name: '使用扬声器', exact: true }).click();
        await test.page.getByRole('button', { name: '正在取消等待…', exact: true }).waitFor();
        await test.page.evaluate(() => { window.routeRecoveryUi.restart(); window.routeRecoveryUi.wait(5000); window.routeRecoveryUi.failCancel(); });
        await test.page.clock.runFor(20);
        check(await test.page.getByRole('button', { name: '请挂断后重新连接', exact: true }).count() === 0, 'old cancellation rejection cannot add reconnect error to a new call');
        check(await test.page.getByRole('button', { name: '使用扬声器', exact: true }).isEnabled(), 'old call recovery lock does not lock a new call');
        await test.context.close();
      }
      cases.push('旧通话取消迟到失败不写新错误、不阻挡新通话恢复');
      {
        const test = await open('after');
        await test.page.evaluate(() => {
          window.routeRecoveryUi.wait();
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await test.page.clock.runFor(6000);
        check(await test.page.getByRole('button', { name: '取消等待，保持暂停', exact: true }).count() === 0, 'hidden page does not keep a recovery UI timer running');
        await test.page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: false });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await test.page.getByRole('button', { name: '取消等待，保持暂停', exact: true }).waitFor(); checks++;
        await test.context.close();
      }
      cases.push('页面挂起后按原startedAt补算，重新可见即显示恢复操作');
      for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
        const test = await open('after');
        await test.page.setViewportSize({ width, height: 844 });
        await test.page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        await test.page.evaluate(() => window.routeRecoveryUi.wait(5000));
        await test.page.getByRole('button', { name: '取消等待，保持暂停', exact: true }).waitFor();
        check(await test.page.locator('.vg-voice-call-route-recovery').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${theme}/${width}: no recovery overflow`);
        check(await test.page.locator('.vg-voice-call-route-recovery button').evaluateAll(nodes => nodes.every(node => { const r = node.getBoundingClientRect(); return r.width >= 48 && r.height >= 48; })), `${theme}/${width}: touch targets >=48px`);
        await test.page.screenshot({ path: `${evidence}/after-${theme}-${width}.png` });
        await test.context.close();
      }
      cases.push('深浅主题320/390/430宽度真实组件无横溢，恢复按钮至少48px');
    }
    check(errors.length === 0, JSON.stringify(errors));
    check(external === 0, 'no external requests');
    const hashes = [...snapshots.entries()].map(([source, name]) => ({ source,
      beforeSha256: createHash('sha256').update(readFileSync(`${evidence}/before/${name}`)).digest('hex'),
      currentSha256: createHash('sha256').update(readFileSync(source)).digest('hex') }));
    const report = { beforeOnly, checks, cases, errors, hashes, blockedExternalRequests: external, providerRequests: 0, microphone: false, sound: false,
      scope: 'actual dialog/host with isolated presentation actions; not Android, native cancellation or acoustic validation', evidence };
    writeFileSync(`${evidence}/${beforeOnly ? 'before' : 'ui'}-result.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); server.close(); }
}
