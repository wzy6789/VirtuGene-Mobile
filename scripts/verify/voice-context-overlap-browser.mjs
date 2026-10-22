import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const dir = '.tmp-preview/voice-context-overlap-20261015', reports = [];
const guardsOnly = process.argv.includes('--guards-only');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
try {
  for (const mode of ['before', 'after']) {
    const bundle = await build({ entryPoints: ['scripts/verify/voice-context-overlap-browser.ts'], bundle: true, write: false,
      platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' },
      define: { 'import.meta.env': '{}', __APP_VERSION__: '"isolated-test"' },
      plugins: mode === 'before' ? [{ name: 'frozen-controller-only', setup(b) { b.onLoad({ filter: /voice-call[\\/]controller\.ts$/ }, args => ({
        contents: readFileSync(`${dir}/before/controller.ts`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path),
      })); } }] : [] });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/fixture.js' ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><script src="/fixture.js"></script>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const context = await browser.newContext();
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const page = await context.newPage();
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw Error('Microphone forbidden'); }; });
      const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto(origin); await page.waitForFunction(() => !!window.voiceOverlapDbRun);
      assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
      const report = await page.evaluate(flag => window.voiceOverlapDbRun(flag), guardsOnly); reports.push(report);
      writeFileSync(`${dir}/browser-${guardsOnly ? 'guards-' : ''}${mode}.json`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ mode, rounds: report.rows.length,
        p50: quantile(report.rows.map(row => row.metrics.firstPlaybackFromSpeechMs), .5),
        p95: quantile(report.rows.map(row => row.metrics.firstPlaybackFromSpeechMs), .95),
        rows: [...new Set(report.rows.map(row => row.reads.rows))] }));
    } finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
  }
  for (let round = 0; round < (guardsOnly ? 0 : 30); round++) {
    const a = reports[0].rows[round], b = reports[1].rows[round];
    assert.equal(a.inputHash, b.inputHash, 'full real composed model input must be identical');
    assert.deepEqual(a.wavHashes, b.wavHashes); assert.deepEqual(a.requests, b.requests);
    assert.deepEqual(a.reads, b.reads, 'same actual table reads, DB requests and transactions');
  }
  const summary = reports.map((report, i) => ({ mode: i ? 'after' : 'before', rounds: 30,
    softwarePlaybackFromSpeech: { p50: quantile(report.rows.map(row => row.metrics.firstPlaybackFromSpeechMs), .5), p95: quantile(report.rows.map(row => row.metrics.firstPlaybackFromSpeechMs), .95) },
    contextPreparationMs: { p50: quantile(report.rows.map(row => row.metrics.contextPreparationMs), .5), p95: quantile(report.rows.map(row => row.metrics.contextPreparationMs), .95) },
    residualPreparationWaitMs: { p50: quantile(report.rows.map(row => row.metrics.contextResidualWaitMs ?? row.metrics.contextPreparationMs), .5) },
  }));
  writeFileSync(`${dir}/browser-${guardsOnly ? 'guards-' : ''}comparison.json`, JSON.stringify({ summary, guards: reports.map(row => row.guards), fullInputHashesUnchanged: true,
    actualReadsUnchanged: true, modelRequestCountsUnchanged: true, realApiCalls: 0,
    scope: '4x CPU desktop Chrome, isolated synthetic stocked DB and mock transport/sink, not Android or physical audio' }, null, 2));
} finally { await browser.close(); }
