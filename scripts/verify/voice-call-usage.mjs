import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const evidence = '.tmp-preview/voice-latency-native-20261015';
const before = process.argv.includes('--before');
const plugins = before ? [{ name: 'original-usage-host', setup(context) {
  context.onLoad({ filter: /[\\/]src[\\/]store[\\/]voice-call-store\.ts$/ }, args => ({
    contents: readFileSync(join(evidence, 'voice-call-store.before-usage.ts'), 'utf8'), loader: 'ts', resolveDir: dirname(args.path),
  }));
} }] : [];
const bundle = await build({ entryPoints: ['scripts/verify/voice-call-usage.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', plugins,
  loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' } });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.voiceUsageResult, { timeout: 30000 });
  const result = await page.evaluate(() => window.voiceUsageResult);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, `usage-${before ? 'before' : 'after'}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (result.error || result.failures?.length || result.checks !== 17) process.exitCode = 1;
} finally { await browser?.close(); server.close(); }
