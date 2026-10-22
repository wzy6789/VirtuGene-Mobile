import { productPreview } from '../preview-product-upgrade.mjs';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = '.tmp-preview/ui-overhaul-20261016/memory-library/demo';
mkdirSync(out, { recursive: true });
const preview = await productPreview({ port: 0 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = { scope: 'Unpaused production component recording; synthetic IndexedDB; no model, microphone, audio or Android.' };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, recordVideo: { dir: out, size: { width: 390, height: 844 } } });
  const page = await context.newPage();
  await page.goto(preview.address + '/app');
  await page.evaluate(async () => { while (!window.productUpgradeReady) await new Promise(requestAnimationFrame); await productUpgradeTest.go('memory'); });
  const list = page.locator('.vg-memory-exhibit-list');
  await list.locator('li').nth(1).waitFor();
  await page.waitForTimeout(900);
  await page.getByRole('searchbox').fill('\u7a0b\u781a');
  await page.waitForTimeout(800);
  await page.getByRole('searchbox').fill('');
  await list.locator('li').first().getByRole('button').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.waitForTimeout(1400);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(() => productUpgradeTest.theme('light'));
  await page.waitForTimeout(1200);
  result.isolation = await page.evaluate(() => productUpgradeTest.snapshot().isolation);
  assert.ok(Object.values(result.isolation).every(n => n === 0));
  result.video = await page.video().path();
  await context.close();
  result.status = 'pass';
} catch (error) { result.status = 'failed'; result.failure = error.stack; throw error; }
finally { await browser.close(); await new Promise(resolve => preview.server.close(resolve)); writeFileSync(out + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
