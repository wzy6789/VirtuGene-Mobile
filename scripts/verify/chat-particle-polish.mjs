import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';

const origin = process.env.VG_SCENE_ORIGIN ?? 'http://127.0.0.1:5324';
const out = process.env.VG_SCENE_EVIDENCE ?? '.tmp-preview/chat-particle-polish-20261020/after';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, recordVideo: { dir: out, size: { width: 390, height: 844 } } });
const page = await context.newPage();
const report = { origin, scenes: [], errors: [], external: [], scope: 'Actual mobile ChatWindow and GPU particle renderer; isolated synthetic local messages, no model or microphone. Desktop browser, not Android.' };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if(message.type()==='error'&&/THREE|WebGL|shader|VALIDATE_STATUS/i.test(message.text()))report.errors.push(message.text()); });
page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) report.external.push(request.url()); });
try {
  await page.goto(origin);
  await page.waitForFunction(() => window.sceneTest);
  await page.evaluate(async () => { await window.backgroundTest.setup(0); await window.sceneTest.stock(2); });
  for (const id of (process.env.VG_SCENE_CAPTURE_IDS ?? 'guofeng-tea-room,urban-window-seat,snow-study,hearth-cabin').split(',')) {
    await page.evaluate(async id => { await window.backgroundTest.theme('dark'); await window.sceneTest.scene(id, 'auto', { renderer: 'auto', parallaxEnabled: false }); }, id);
    await page.waitForFunction(() => { const s = window.sceneTest.inspect()[0]; return s?.state === 'ready' && s.backend === 'webgl2' && s.particles.frames > 3; });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}/${id}-dark.png` });
    await page.locator('.vg-scene-webgl').screenshot({ path: `${out}/${id}-particles.png` });
    const start = await page.evaluate(() => window.sceneTest.inspect()[0]);
    await page.waitForTimeout(3200);
    report.scenes.push({ id, start, end: await page.evaluate(() => window.sceneTest.inspect()[0]) });
    await page.evaluate(() => window.backgroundTest.theme('light'));
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${out}/${id}-light.png` });
  }
  report.status = report.errors.length || report.external.length ? 'failed' : 'pass';
} catch (error) { report.status = 'failed'; report.failure = String(error); process.exitCode = 1; }
finally {
  const video = await page.video().path();
  await context.close(); renameSync(video, `${out}/actual-particles.webm`);
  await browser.close(); writeFileSync(`${out}/capture.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, scenes: report.scenes.length, errors: report.errors, failure: report.failure, video: `${out}/actual-particles.webm` }));
}
