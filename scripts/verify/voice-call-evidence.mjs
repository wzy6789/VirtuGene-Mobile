import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-call-evidence-20261015'; mkdirSync(dir, { recursive: true });
await build({ entryPoints: ['scripts/verify/voice-call-evidence.ts'], outfile: `${dir}/test.cjs`, bundle: true, platform: 'node', format: 'cjs' });
const result = spawnSync(process.execPath, [`${dir}/test.cjs`], { encoding: 'utf8', timeout: 30000 });
writeFileSync(`${dir}/run.txt`, result.stdout + result.stderr); assert.equal(result.status, 0, result.stderr || String(result.error));
const report = JSON.parse(result.stdout); writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
