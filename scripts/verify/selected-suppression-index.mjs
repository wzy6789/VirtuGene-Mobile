import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const output = '.tmp-preview/voice-selected-suppression-20261015/migration-result.json'; mkdirSync(dirname(output), { recursive: true });
const bundle = await build({ entryPoints: ['scripts/verify/selected-suppression-index.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' } });
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8'); res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const browser = await chromium.launch({ channel: 'chrome', headless: true }); let result;
try { const page = await browser.newPage(); await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()); await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !!window.selectedSuppressionChecks); result = await page.evaluate(() => window.selectedSuppressionChecks()); }
catch (error) { result = { complete: false, error: error.message }; process.exitCode = 1; }
finally { await browser.close(); await new Promise(r => server.close(r)); writeFileSync(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
