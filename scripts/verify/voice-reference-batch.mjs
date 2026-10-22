import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const selected = process.argv.includes('--selected');
const evidence = selected ? '.tmp-preview/voice-selected-suppression-20261015' : '.tmp-preview/voice-reference-batch-20261015'; mkdirSync(evidence, { recursive: true });
const report = { results: [], errors: [], apiCalls: 0 }; const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const label of ['before', 'after']) {
    const bundle = await build({ entryPoints: ['scripts/verify/voice-reference-batch.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' }, plugins: label === 'after' ? [] : [{ name: 'before-memory', setup(b) { b.onLoad({ filter: /[\\/]lib[\\/]character-memory\.ts$/ }, args => ({ contents: readFileSync(join(evidence, 'before/character-memory.ts'), 'utf8'), loader: 'ts', resolveDir: dirname(args.path) })); } }] });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8'); res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); const context = await browser.newContext();
    try { const page = await context.newPage(); await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()); const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !!window.voiceReferenceBatch); const data = await page.evaluate(async () => { try { return await window.voiceReferenceBatch(); } catch (error) { throw Error(error.name + ': ' + error.message + '\n' + error.stack); } }); report.results.push({ label, ...data }); console.log(JSON.stringify({ label, ...data })); }
    finally { await context.close(); await new Promise(r => server.close(r)); }
  }
  report.renderedUnchanged = new Set(report.results.map(r => r.renderedHash)).size === 1;
  if (!report.renderedUnchanged) throw Error('validated reference text changed');
} catch (error) { report.errors.push(error.message); process.exitCode = 1; }
finally { await browser.close(); writeFileSync(join(evidence, 'comparison.json'), JSON.stringify(report, null, 2)); }
