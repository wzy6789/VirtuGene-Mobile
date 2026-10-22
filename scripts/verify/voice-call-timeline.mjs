import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-realtime-plan-20261015';
mkdirSync(dir, { recursive: true });
const reports = [];
for (const mode of ['before', 'after']) {
  const outfile = `${dir}/timeline-${mode}.cjs`;
  await build({ entryPoints: ['scripts/verify/voice-call-timeline.ts'], outfile, bundle: true, platform: 'node', format: 'cjs',
    plugins: mode === 'before' ? [{ name: 'actual-current-snapshot', setup(b) {
      b.onLoad({ filter: /voice-call[\\/]controller\.ts$/ }, args => ({
        contents: readFileSync(`${dir}/before/controller.ts`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path),
      }));
    } }] : [] });
  const run = spawnSync(process.execPath, [outfile, ...(mode === 'before' ? ['--before'] : [])], { encoding: 'utf8', timeout: 20_000 });
  writeFileSync(`${dir}/timeline-${mode}.txt`, (run.stdout ?? '') + (run.stderr ?? ''));
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const report = JSON.parse(run.stdout.trim());
  writeFileSync(`${dir}/timeline-${mode}.json`, JSON.stringify(report, null, 2)); reports.push(report);
  console.log(JSON.stringify({ mode, checks: report.checks, rounds: report.rounds }));
}
for (let i = 0; i < 30; i++) {
  const a = reports[0].rows[i], b = reports[1].rows[i];
  assert.equal(a.inputHash, b.inputHash, 'full model and speech inputs unchanged');
  assert.deepEqual(a.calls, b.calls); assert.equal(a.validations, b.validations);
  assert.equal(a.softwareFirstPlaybackMs, b.softwareFirstPlaybackMs, 'instrumentation does not add waits');
}
writeFileSync(`${dir}/timeline-comparison.json`, JSON.stringify({ sameConditionRounds: 30,
  inputAndRequestParity: true, unchangedAuthorizationChecks: true, noAddedSyntheticWaits: true,
  physicalAudioVerified: false, providerCalls: 0 }, null, 2));
