import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-route-recovery-20261016', before = process.argv.includes('--before'), name = before ? 'before' : 'after';
await build({ entryPoints: ['scripts/verify/voice-route-recovery.ts'], outfile: `${dir}/${name}.cjs`, bundle: true, platform: 'node', format: 'cjs',
  plugins: before ? [{ name: 'frozen-route-recovery', setup(b) { b.onLoad({ filter: /voice-call[\\/](?:native-audio|controller)\.ts$/ }, args => ({
    contents: readFileSync(`${dir}/before/${args.path.endsWith('controller.ts') ? 'controller' : 'native-audio'}.ts`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) })); } }] : [] });
const result = spawnSync(process.execPath, [`${dir}/${name}.cjs`, ...(before ? ['--before'] : [])], { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
writeFileSync(`${dir}/${name}.txt`, result.stdout + result.stderr + (result.error ? String(result.error) : ''));
assert.equal(result.status, 0, result.stderr || String(result.error));
const report = JSON.parse(result.stdout); writeFileSync(`${dir}/${name}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: name, checks: report.checks, bridgeRounds: report.bridge.length, controllerRounds: report.controller.length, apiCalls: 0 }));
