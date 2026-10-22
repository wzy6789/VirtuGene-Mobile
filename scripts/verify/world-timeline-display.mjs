import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const output = process.argv[2];
const bundle = await build({
  entryPoints: ['scripts/verify/world-timeline-display.ts'], bundle: true, write: false, platform: 'browser', format: 'iife',
  loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' },
});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
  response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><title>Timeline isolated verification</title><script src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
let report;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const runs = [];
  for (const timezoneId of ['Asia/Shanghai', 'America/New_York']) {
    const context = await browser.newContext({ timezoneId });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => typeof window.worldTimelineDisplayChecks === 'function');
      runs.push(await page.evaluate(() => window.worldTimelineDisplayChecks()));
    } finally { await context.close(); }
  }
  report = { complete: true, runs };
} catch (error) {
  report = { complete: false, error: error.stack ?? error.message };
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
