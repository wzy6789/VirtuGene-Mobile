import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const evidence = '.tmp-preview/voice-chain-speed-20261016', smoke = process.argv.includes('--smoke'), rounds = smoke ? 2 : 30;
const output = join(evidence, smoke ? 'empty-history-smoke.json' : 'empty-history-comparison.json');
mkdirSync(evidence, { recursive: true });
const report = { date: '2026-10-16', workdir: 'F:/VirtuGene-Mobile', model: '未确认', reasoning: '未确认',
  roundsPerCaseAndVariant: rounds, samples: [], results: [], errors: [], apiCalls: 0, sourceSha256: {},
  counterScope: 'countCalls and postingQueries are exact; bodyRows/keyRows count direct get/getMany/query results and exclude collection cursor rows, so fullRecall bodyRows is not total row reads',
  scope: 'real isolated IndexedDB; desktop Chrome CPU 4x; empty and nonempty per-session indexed lookup plus actual full owned-history recall; no model/microphone/Android' };
const browser = await chromium.launch({ channel: 'chrome', headless: true }), variants = [];
try {
  for (const [label, path] of [['before', join(evidence, 'before/chat-history-index.ts')], ['after', 'src/lib/chat-history-index.ts']]) {
    const frozen = readFileSync(path, 'utf8'); report.sourceSha256[label] = createHash('sha256').update(frozen).digest('hex');
    const bundle = await build({ entryPoints: ['scripts/verify/voice-empty-history.ts'], bundle: true, write: false,
      platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' },
      plugins: [{ name: 'frozen-history', setup(b) { b.onLoad({ filter: /[\\/]lib[\\/]chat-history-index\.ts$/ },
        args => ({ contents: frozen, loader: 'ts', resolveDir: dirname(args.path) })); } }] });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
      res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><script src="/test.js"></script>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const context = await browser.newContext(), page = await context.newPage(); variants.push({ label, server, context, page });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !!window.voiceEmptyHistory);
    report.results.push({ label, fixture: await page.evaluate(() => window.voiceEmptyHistory.setup()) });
    for (const kind of ['empty', 'nonempty']) for (let i = 0; i < 3; i++) await page.evaluate(kind => window.voiceEmptyHistory.sample(kind), kind);
  }
  for (let round = 0; round < rounds; round++) for (const kind of ['empty', 'nonempty']) {
    for (const variant of round % 2 ? [...variants].reverse() : variants) report.samples.push({ label: variant.label, round, kind,
      ...await variant.page.evaluate(kind => window.voiceEmptyHistory.sample(kind), kind) });
  }
  for (const variant of variants) {
    const target = report.results.find(result => result.label === variant.label);
    target.fullRecall = await variant.page.evaluate(() => window.voiceEmptyHistory.fullRecall());
    Object.assign(target, await variant.page.evaluate(() => window.voiceEmptyHistory.checks()));
  }
  report.resultsUnchanged = ['empty', 'nonempty'].every(kind => new Set(report.samples.filter(sample => sample.kind === kind).map(sample => sample.resultHash)).size === 1);
  report.fullRecallUnchanged = new Set(report.results.map(result => result.fullRecall.resultHash)).size === 1;
  report.emptyReadBound = report.samples.filter(sample => sample.label === 'after' && sample.kind === 'empty')
    .every(sample => sample.countCalls === 2 && sample.requests === 2 && sample.postingQueries === 0 && sample.bodyRows === 0 && sample.mutations === 0);
  if (!report.resultsUnchanged || !report.fullRecallUnchanged || !report.emptyReadBound) throw Error('empty history parity or fresh count read bound failed');
  const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
  report.summary = ['empty', 'nonempty'].flatMap(kind => variants.map(({ label }) => {
    const rows = report.samples.filter(sample => sample.label === label && sample.kind === kind);
    return { kind, label, samples: rows.length, medianMs: quantile(rows.map(row => row.elapsedMs), .5), p95Ms: quantile(rows.map(row => row.elapsedMs), .95),
      requests: [...new Set(rows.map(row => row.requests))], countCalls: [...new Set(rows.map(row => row.countCalls))],
      postingQueries: [...new Set(rows.map(row => row.postingQueries))], bodyRows: [...new Set(rows.map(row => row.bodyRows))] };
  }));
  console.log(JSON.stringify({ summary: report.summary, resultsUnchanged: report.resultsUnchanged, fullRecallUnchanged: report.fullRecallUnchanged,
    emptyReadBound: report.emptyReadBound, fullRecall: report.results.map(result => ({ label: result.label, ...result.fullRecall })),
    checks: report.results.map(result => ({ label: result.label, count: result.checks.length })), output }));
} catch (error) { report.errors.push(error.stack ?? error.message); process.exitCode = 1; console.error(error.stack ?? error.message); }
finally {
  for (const variant of variants) { await variant.context.close(); await new Promise(resolve => variant.server.close(resolve)); }
  await browser.close(); writeFileSync(output, JSON.stringify(report, null, 2));
}
