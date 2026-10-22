import { productPreview } from '../preview-product-upgrade.mjs';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const out = '.tmp-preview/ui-overhaul-20261015/baseline';
mkdirSync(out, { recursive: true });
const preview = await productPreview({ frozen: true, port: 0 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const shots = [], errors = [], blocked = [];
let data;
try {
  for (const width of [320, 390, 430]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ width, theme, error: e.message }));
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== preview.address) { blocked.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${preview.address}/app?theme=${theme}`);
    await page.waitForFunction(() => window.productUpgradeReady, { timeout: 60000 });
    data ??= await page.evaluate(() => window.productUpgradeFixture);
    await page.evaluate(() => document.fonts.ready);
    for (const screen of ['home', 'characters', 'profile', 'chat', 'call', 'call-connected']) {
      await page.evaluate(async screen => { await window.productUpgradeTest.go(screen); }, screen);
      await page.waitForTimeout(850);
      const file = `${screen}-${theme}-${width}.png`;
      await page.screenshot({ path: join(out, file), fullPage: false });
      const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, text: document.body.innerText, isolation: window.previewIsolation }));
      shots.push({ screen, theme, width, height: 844, file, sha256: createHash('sha256').update(readFileSync(join(out, file))).digest('hex'), state });
    }
    await context.close();
  }
  writeFileSync(join(out, 'baseline-result.json'), JSON.stringify({ capturedAt: new Date().toISOString(), browser: browser.version(), browserEnvironment: 'Windows Chrome desktop mobile emulation; not Android', scope: 'frozen real production components + current pre-change dist CSS, synthetic fixture', fixtureSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'), fixture: data, shots, errors, blocked }, null, 2));
  console.log(JSON.stringify({ screenshots: shots.length, errors, blocked, out }));
} finally { await browser.close(); await new Promise(resolve => preview.server.close(resolve)); }
