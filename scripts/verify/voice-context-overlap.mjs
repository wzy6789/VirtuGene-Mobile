import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-context-overlap-20261015', reports = [];
for (const mode of ['before', 'after']) {
  const outfile = `${dir}/${mode}.cjs`;
  await build({ entryPoints: ['scripts/verify/voice-context-overlap.ts'], outfile, platform: 'node', format: 'cjs', bundle: true,
    plugins: mode === 'before' ? [{ name: 'unchanged-current-controller-baseline', setup(b) {
      b.onLoad({ filter: /voice-call[\\/]controller\.ts$/ }, args => ({ contents: readFileSync(`${dir}/before/controller.ts`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] : [] });
  const result = spawnSync(process.execPath, [outfile, ...(mode === 'before' ? ['--before'] : [])], { encoding: 'utf8', timeout: 60_000 });
  writeFileSync(`${dir}/${mode}.txt`, (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const report = JSON.parse(result.stdout.trim()); reports.push(report);
  writeFileSync(`${dir}/${mode}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, checks: report.checks, strata: report.strata.map(row => ({ base: row.base, count: row.count, p50: row.p50, p95: row.p95 })) }));
}
for (let s = 0; s < reports[0].strata.length; s++) for (let r = 0; r < 30; r++) {
  const a = reports[0].strata[s].rows[r], b = reports[1].strata[s].rows[r];
  assert.equal(a.inputHash, b.inputHash); assert.deepEqual(a.wavHashes, b.wavHashes);
  assert.deepEqual(a.requests.map(row => row.stage), b.requests.map(row => row.stage));
  assert.equal(a.assertCount, b.assertCount);
  assert.ok(b.firstPlaybackFromSpeechMs <= a.firstPlaybackFromSpeechMs);
}
writeFileSync(`${dir}/comparison.json`, JSON.stringify({ sameCondition: true, strata: reports[0].strata.map((row, i) => ({
  base: row.base, roundsPerVariant: 30, before: { p50: row.p50, p95: row.p95 },
  after: { p50: reports[1].strata[i].p50, p95: reports[1].strata[i].p95 },
})), modelAndTtsInputHashesUnchanged: true, audioHashesUnchanged: true, requestCountsUnchanged: true,
  sourceChecksUnchanged: true, realApiCalls: 0, physicalAudio: false,
  limitation: 'Synthetic context and network time; no MiMo service or Android speed claim.' }, null, 2));
