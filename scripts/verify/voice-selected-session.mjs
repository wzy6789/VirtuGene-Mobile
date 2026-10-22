import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const evidence = '.tmp-preview/voice-chain-speed-20261016';
const smoke = process.argv.includes('--smoke'), rounds = smoke ? 2 : 30;
const largeSelectedSession = process.argv.includes('--large-selected-session');
const keyOnly = process.argv.includes('--key-only');
const output = join(evidence, `selected-session${keyOnly ? '-key-only' : ''}${largeSelectedSession ? '-large-row' : ''}-${smoke ? 'smoke' : 'comparison'}.json`);
mkdirSync(evidence, { recursive: true });
const report = { date: '2026-10-16', workdir: 'F:/VirtuGene-Mobile', model: '未确认', reasoning: '未确认',
  roundsPerVariant: rounds, warmupsPerVariant: smoke ? 1 : 3, samples: [], results: [], errors: [], realApiCalls: 0,
  stratum: largeSelectedSession ? 'small-history-large-selected-session' : 'large-unrelated-history',
  keyOnly,
  scope: 'isolated real IndexedDB; desktop Chrome CPU 4x; exact selected-reference validation; no model/ASR/TTS/microphone/Android',
  sourceSha256: {}, requestURLs: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const variants = [];
try {
  const helper = keyOnly ? readFileSync('src/db/selected-private-session.ts', 'utf8') : undefined;
  if (helper) report.sourceSha256.selectedPrivateSessionHelper = createHash('sha256').update(helper).digest('hex');
  for (const [label, path] of [['before', join(evidence, 'before/character-memory.ts')],
    ['after', keyOnly ? 'src/lib/character-memory.ts' : join(evidence, 'after-session/character-memory.ts')]]) {
    const frozen = readFileSync(path, 'utf8');
    report.sourceSha256[label] = createHash('sha256').update(frozen).digest('hex');
    const bundle = await build({ entryPoints: ['scripts/verify/voice-selected-session.ts'], bundle: true, write: false,
      platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' },
      define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' }, plugins: [{ name: 'frozen-character-memory', setup(b) {
        b.onLoad({ filter: /[\\/]lib[\\/]character-memory\.ts$/ }, args => ({ contents: frozen, loader: 'ts', resolveDir: dirname(args.path) }));
        if (helper) b.onLoad({ filter: /[\\/]db[\\/]selected-private-session\.ts$/ }, args => ({ contents: helper, loader: 'ts', resolveDir: dirname(args.path) }));
      } }] });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
      res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><script src="/test.js"></script>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const context = await browser.newContext(), page = await context.newPage();
    variants.push({ label, context, page, server });
    await page.route('**/*', route => { const url = route.request().url();
      report.requestURLs.push(url); return new URL(url).hostname === '127.0.0.1' ? route.continue() : route.abort(); });
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !!window.voiceSelectedSession);
    const fixture = await page.evaluate(large => window.voiceSelectedSession.setup(large), largeSelectedSession);
    for (let i = 0; i < report.warmupsPerVariant; i++) await page.evaluate(() => window.voiceSelectedSession.sample());
    report.results.push({ label, fixture });
  }
  // Alternate both the variants and their ordering to avoid measuring one
  // variant only during a consistently earlier/later period of machine load.
  for (let round = 0; round < rounds; round++) {
    for (const variant of round % 2 ? [...variants].reverse() : variants) {
      const sample = await variant.page.evaluate(() => window.voiceSelectedSession.sample());
      report.samples.push({ round, label: variant.label, ...sample });
    }
  }
  for (const variant of variants) Object.assign(report.results.find(result => result.label === variant.label),
    await variant.page.evaluate(() => window.voiceSelectedSession.checks()));
  report.contextUnchanged = new Set(report.samples.map(sample => sample.contextHash)).size === 1;
  report.actualModelInputUnchanged = new Set(report.results.map(result => result.actualModelInputHash)).size === 1;
  if (!report.contextUnchanged || !report.actualModelInputUnchanged) throw Error('validated context or actual model input changed');
  report.sessionValidationScoped = report.samples.filter(sample => sample.label === 'after')
    .every(sample => keyOnly
      ? sample.tables.sessions.keys <= 12 && sample.tables.sessions.rows <= report.samples
        .find(before => before.label === 'before' && before.round === sample.round).tables.sessions.rows
      : sample.tables.sessions.keys === 0 && sample.tables.sessions.rows <= 10);
  if (!report.sessionValidationScoped) throw Error('selected session validation read unrelated session keys or rows');
  const quantile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1]; };
  report.summary = variants.map(({ label }) => { const rows = report.samples.filter(sample => sample.label === label);
    return { label, samples: rows.length, medianMs: quantile(rows.map(row => row.elapsedMs), .5), p95Ms: quantile(rows.map(row => row.elapsedMs), .95),
      requests: [...new Set(rows.map(row => row.requests))], rowReads: [...new Set(rows.map(row => row.rows))],
      keyReads: [...new Set(rows.map(row => row.keys))], sessionReads: rows[0].tables.sessions, transactions: [...new Set(rows.map(row => row.transactions))] }; });
  console.log(JSON.stringify({ summary: report.summary, contextUnchanged: report.contextUnchanged,
    actualModelInputUnchanged: report.actualModelInputUnchanged, checks: report.results.map(result => ({ label: result.label, count: result.checks.length })), output }));
} catch (error) { report.errors.push(error.stack ?? error.message); process.exitCode = 1; console.error(error.stack ?? error.message); }
finally {
  for (const variant of variants) { await variant.context.close(); await new Promise(resolve => variant.server.close(resolve)); }
  await browser.close(); writeFileSync(output, JSON.stringify(report, null, 2));
}
