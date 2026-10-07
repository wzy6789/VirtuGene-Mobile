import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundle = await build({ entryPoints: ['scripts/verify/chat-expression.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true,"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"test"' } });
const server = createServer((req, res) => {
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><script src="/test.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', item => { if (item.type() === 'log') console.log(item.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.chatExpression);
  const result = await page.evaluate(() => window.chatExpression.run());
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`PASS chat-expression: ${result.checks} checks`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
