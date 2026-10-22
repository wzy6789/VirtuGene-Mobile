import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = '.tmp-preview/voice-route-continuity-20261015';
for (const mode of ['before', 'after']) {
  const outfile = `${dir}/bridge-${mode}.cjs`;
  await build({ entryPoints: ['scripts/verify/voice-route-bridge.ts'], outfile, bundle: true, platform: 'node', format: 'cjs',
    plugins: mode === 'before' ? [{ name: 'original-current-bridge-and-controller', setup(b) {
      b.onLoad({ filter: /voice-call[\\/](native-audio|controller)\.ts$/ }, args => ({ contents: readFileSync(`${dir}/before/${args.path.split(/[\\/]/).pop()}`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] : [] });
  const run = spawnSync(process.execPath, [outfile, ...(mode === 'before' ? ['--before'] : [])], { encoding: 'utf8', timeout: 20_000 });
  writeFileSync(`${dir}/bridge-${mode}.txt`, (run.stdout ?? '') + (run.stderr ?? ''));
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const report = JSON.parse(run.stdout.trim()); writeFileSync(`${dir}/bridge-${mode}.json`, JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
}
