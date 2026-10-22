import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = 'release/chat-core-implementation-20261021/voice';
const before = process.argv.includes('--before');
const source = 'src/lib/voice-call/controller.ts';
const effective = before ? `${root}/before/${source}` : source;
mkdirSync(root, { recursive: true });
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
await build({ entryPoints: ['scripts/verify/voice-call-recovery.ts'], outfile: `${root}/recovery-${before ? 'before' : 'current'}.cjs`, bundle: true, platform: 'node', format: 'cjs',
  plugins: before ? [{ name: 'frozen-controller', setup(b) { b.onLoad({ filter: /[\\/]src[\\/]lib[\\/]voice-call[\\/]controller\.ts$/ }, () => ({ contents: readFileSync(effective, 'utf8'), loader: 'ts' })); } }] : [] });
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, [`${root}/recovery-${before ? 'before' : 'current'}.cjs`], { encoding: 'utf8', timeout: 20000 });
let report; try { report = JSON.parse(result.stdout.trim()); } catch { report = { complete: false, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }; }
const path = `${root}/recovery-${before ? 'before' : 'current'}-${Date.now()}.json`;
writeFileSync(path, JSON.stringify({ ...report, startedAt, finishedAt: new Date().toISOString(), before, exitCode: result.status, source, effectiveSource: effective, sha256: hash(effective), actualRuntimeModel: '未确认', actualReasoning: '未确认' }, null, 2));
console.log(JSON.stringify({ path, complete: report.complete, checks: report.checks?.length, failures: report.checks?.filter(check => !check.ok) }, null, 2));
process.exitCode = result.status ?? 1;
