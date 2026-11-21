import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { writeFileSync,readFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundle = await build({ entryPoints: ['scripts/verify/luxueqi-preset.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' } });
const server = createServer((request, response) => {
  if(/^\/assets\/preset-avatars\/preset-[a-z]+\.jpg$/.test(request.url||'')){response.setHeader('Content-Type','image/jpeg');response.end(readFileSync('public'+request.url));return;}
  response.setHeader('Content-Type', request.url === '/test.js' ? 'text/javascript' : 'text/html; charset=utf-8');
  response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><html><body><script src="/test.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => !!window.luXueQiTest);
  const result = await page.evaluate(() => window.luXueQiTest.run());
  const output = process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'docs/LUXUEQI-PRESET-FINAL-2026-10-10.json';
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(`PASS luxueqi-preset: ${result.checks} local integration checks; zero model calls`);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
