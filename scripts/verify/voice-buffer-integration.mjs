import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
const dir = '.tmp-preview/voice-buffer-integration-20261016';
const before = process.argv.includes('--before'), label = before ? 'before' : 'after';
mkdirSync(`${dir}/${label}`, { recursive: true });
const source = readFileSync(before ? `${dir}/before/native-audio.ts` : 'src/lib/voice-call/native-audio.ts', 'utf8');
const outfile = `${dir}/${label}/check.cjs`;
await build({ entryPoints: ['scripts/verify/voice-buffer-integration.ts'], outfile, bundle: true, platform: 'node', format: 'cjs',
  plugins: [{ name: 'exact-bridge-source', setup(b) { b.onLoad({ filter: /voice-call[\\/]native-audio\.ts$/ }, args => ({ contents: source, loader: 'ts', resolveDir: dirname(args.path) })); } }] });
const run = spawnSync(process.execPath, [outfile], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
writeFileSync(`${dir}/${label}/run.txt`, (run.stdout ?? '') + (run.stderr ?? ''));
if (run.stdout) {
  const report = { ...JSON.parse(run.stdout), variant: label, sourceHash: createHash('sha256').update(source).digest('hex'), exitCode: run.status };
  writeFileSync(`${dir}/${label}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, failures: report.failures.length }));
} else console.error(run.stderr || run.error);
process.exitCode = run.status ?? 1;
