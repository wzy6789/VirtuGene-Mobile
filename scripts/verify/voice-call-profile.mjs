import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const contextTest = process.argv.includes('--context');
const recordTest = process.argv.includes('--record');
const hostTest = process.argv.includes('--host');
const suite = hostTest ? 'host' : recordTest ? 'record' : contextTest ? 'context' : 'profile';
const bundle = await build({ entryPoints: [`scripts/verify/voice-call-${suite}.ts`], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' } });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.voiceProfileResult, { timeout: 30_000 });
  const result = await page.evaluate(() => window.voiceProfileResult);
  mkdirSync('.tmp-preview/voice-call', { recursive: true });
  writeFileSync(`.tmp-preview/voice-call/${suite}-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (result.error || result.checks !== (hostTest ? 41 : recordTest ? 45 : contextTest ? 53 : 16)) process.exitCode = 1;
} finally { await browser?.close(); server.close(); }
