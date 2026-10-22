import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = '.tmp-preview/voice-segment-playback-20261015';
const mode = process.argv.includes('--baseline') ? 'before' : 'after';
const outfile = `${dir}/${mode}.cjs`;
await build({ entryPoints: ['scripts/verify/voice-segment-playback.ts'], outfile, bundle: true, platform: 'node', format: 'cjs',
  plugins: mode === 'before' ? [{ name: 'frozen-current-controller', setup(b) { b.onLoad({ filter: /voice-call[\\/]controller\.ts$/ }, args => ({ contents: readFileSync(`${dir}/before/controller.ts`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) })); } }] : [] });
const run = spawnSync(process.execPath, [outfile, ...(mode === 'before' ? ['--baseline'] : [])], { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
writeFileSync(`${dir}/${mode}.txt`, (run.stdout ?? '') + (run.stderr ?? ''));
assert.equal(run.status, 0, run.stderr || String(run.error));
const report = JSON.parse(run.stdout.trim()); writeFileSync(`${dir}/${mode}.json`, JSON.stringify(report,null,2));
console.log(JSON.stringify({ mode, checks: report.checks, scenarios: report.rows.length,
  gapMs: [...new Set(report.rows.map(row=>row.gapMs))], maximumLeadingMs: Math.max(...report.rows.map(row=>row.maximumLeadingMs)) }));
