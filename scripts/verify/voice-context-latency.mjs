import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const evidence = '.tmp-preview/voice-context-latency-20261015';
mkdirSync(evidence, { recursive: true });
const regression = process.argv.includes('--regression');
const selected = process.argv.includes('--selected');
const batch = selected || process.argv.includes('--batch');
const rich = batch || process.argv.includes('--rich');
const labels = process.argv.includes('--before-only') ? ['before'] : ['before', 'after'];
const report = { results: [], apiCalls: 0, errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const label of labels) {
    const beforePath = selected ? '.tmp-preview/voice-selected-suppression-20261015/before/character-memory.ts' : batch ? '.tmp-preview/voice-reference-batch-20261015/before/character-memory.ts' : join(evidence, 'before/context.ts');
    const bundle = await build({ entryPoints: [regression ? 'scripts/verify/voice-call-context.ts' : 'scripts/verify/voice-context-latency.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' }, plugins: label !== 'before' ? [] : [{ name: 'before-context', setup(b) {
      b.onLoad({ filter: batch ? /[\\/]lib[\\/]character-memory\.ts$/ : /[\\/]voice-call[\\/]context\.ts$/ }, args => ({ contents: readFileSync(beforePath, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
      if (selected) b.onLoad({ filter: /[\\/]voice-call[\\/]context\.ts$/ }, args => ({ contents: readFileSync('.tmp-preview/voice-selected-suppression-20261015/before/context.ts', 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8'); res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><script src="/test.js"></script>'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); const context = await browser.newContext();
    try {
      const page = await context.newPage(); await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
      const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(regression ? () => !!window.voiceProfileResult : () => !!window.voiceContextLatency);
      const result = await page.evaluate(regression ? () => window.voiceProfileResult : flags => window.voiceContextLatency(flags.rich, flags.batch), { rich, batch }); report.results.push({ label, ...result });
      if (rich && label === 'after' && result.sourceResults.some(r => !r.rejected || r.error !== 'voice:context_changed')) throw Error('rich source withdrawal was not rejected');
      console.log(JSON.stringify(regression ? { label, ...result } : { label, samples: result.samples.length, preparationMs: result.samples.map(s => s.prepareMs), validationMs: result.samples.map(s => s.validations.reduce((n, v) => n + v.ms, 0) / s.validations.length) }));
    } finally { await context.close(); await new Promise(r => server.close(r)); }
  }
  if (!regression) {
    report.promptUnchanged = new Set(report.results.flatMap(r => r.samples.map(s => s.promptHash))).size === 1;
    if (!report.promptUnchanged) throw Error('model context changed');
    const median = values => { const a = [...values].sort((a, b) => a - b); return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2; };
    const summary = report.results.map(result => {
      const checks = result.samples.flatMap(sample => sample.validations), sortedMs = checks.map(c => c.ms).sort((a, b) => a - b);
      return { label: result.label, prepareMedianMs: median(result.samples.map(s => s.prepareMs)), assertMedianMs: median(sortedMs), assertP95Ms: sortedMs[Math.ceil(sortedMs.length * .95) - 1], transactions: checks[0].transactions, rows: checks[0].rows,
        scopes: [0, 2].map(matched => ({ matched, suppressedRows: [...new Set(result.samples.filter(s => s.matching === matched).flatMap(s => s.validations.map(v => v.tables.memorySourceTombstones)))] })), checks: result.checks };
    });
    writeFileSync(join(evidence, selected ? 'selected-summary.json' : batch ? 'batch-summary.json' : rich ? 'rich-summary.json' : 'summary.json'), JSON.stringify({ summary, promptUnchanged: report.promptUnchanged, caveat: 'Desktop CPU throttling and concurrent machine load; context preparation time changes are not a causal Android speed guarantee.' }, null, 2));
  } else if (report.results.some(r => r.error)) process.exitCode = 1;
} catch (error) { report.errors.push(error.message); process.exitCode = 1; }
finally { await browser.close(); writeFileSync(join(evidence, selected ? 'selected-comparison.json' : batch ? 'batch-comparison.json' : regression ? 'context-regression.json' : rich ? 'rich-comparison.json' : labels.length === 1 ? 'baseline.json' : 'comparison.json'), JSON.stringify(report, null, 2)); }
