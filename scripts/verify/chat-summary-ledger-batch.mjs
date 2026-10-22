import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const baseline = process.argv.includes('--baseline'), scale = process.argv.includes('--scale'), existing = process.argv.includes('--existing'), perfOnly = process.argv.includes('--perf-only') || scale || existing;
if (baseline && scale) throw Error('New scale fixtures are after-only; do not manufacture an unmatched before comparison.');
const directory = 'release/chat-summary-ledger-batch-20261019';
const sourcePath = baseline ? `${directory}/before/memory-ledger-repo.ts` : 'src/db/memory-ledger-repo.ts';
const source = readFileSync(sourcePath, 'utf8'), sourceSha256 = createHash('sha256').update(source).digest('hex');
const testPath = 'scripts/verify/chat-summary-ledger-batch.ts';
const testSha256 = createHash('sha256').update(readFileSync(testPath)).digest('hex');
const bundle = await build({ entryPoints: ['scripts/verify/chat-summary-ledger-batch.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"summary-ledger-batch"' }, plugins: [{ name: 'exact-ledger-source-under-review', setup(builder) { builder.onLoad({ filter: /[\\/]memory-ledger-repo\.ts$/ }, () => ({ loader: 'ts', contents: source })); } }] });
const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/test.js' ? 'text/javascript' : 'text/html;charset=utf-8'); response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><script src="/test.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let report;
try {
  const context = await browser.newContext({ permissions: [] }), origin = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => !!window.runSummaryLedgerBatch);
  report = { phase: (existing ? 'existing-' : '') + (baseline ? 'before' : scale ? 'scale-after' : 'after'), sourcePath, sourceSha256, testSha256, ...await page.evaluate(options => window.runSummaryLedgerBatch(options), { perfOnly, scale, existing }) };
  if (!report.complete) process.exitCode = 1;
} catch (error) { report = { complete: false, sourcePath, sourceSha256, error: error.stack, paidCalls: 0 }; process.exitCode = 1; }
finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  report.sourceSha256AtEnd = createHash('sha256').update(readFileSync(sourcePath, 'utf8')).digest('hex');
  report.testSha256AtEnd = createHash('sha256').update(readFileSync(testPath)).digest('hex');
  report.sourcesStable = report.sourceSha256AtEnd === sourceSha256 && report.testSha256AtEnd === testSha256;
  if (!report.sourcesStable) { report.complete = false; process.exitCode = 1; }
  mkdirSync(directory, { recursive: true });
  const path = `${directory}/${existing ? 'existing-' : ''}${baseline ? 'red' : scale ? 'scale-after' : 'after'}-${Date.now()}.json`; writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ path, ...report, ...(report.correctness ? { correctness: { complete: report.correctness.complete, checks: report.correctness.checks.length, passed: report.correctness.checks.filter(check => check.passed).length, failures: report.correctness.checks.filter(check => !check.passed) } } : {}) }));
}
