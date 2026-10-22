import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const output = '.tmp-preview/voice-chain-speed-20261016/session-key-scope.json';
mkdirSync(dirname(output), { recursive: true });
const bundle = await build({ entryPoints: ['scripts/verify/voice-session-key-scope.ts'], bundle: true, write: false,
  platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' },
  define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' } });
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
  response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><script src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, result;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !!window.voiceSessionKeyScope);
  result = await page.evaluate(() => window.voiceSessionKeyScope());
} catch (error) { result = { complete: false, error: error.stack ?? error.message }; process.exitCode = 1; }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  writeFileSync(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, output }));
}
