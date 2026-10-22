import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
const evidence = '.tmp-preview/voice-default-headset-20261016/bridge';
mkdirSync(evidence, { recursive: true });
const sourcePath = resolve('src/lib/voice-call/native-audio.ts'), source = readFileSync(sourcePath, 'utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const labelIndex = process.argv.indexOf('--label');
const label = labelIndex < 0 ? 'current' : process.argv[labelIndex + 1];
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid evidence label');
writeFileSync(`${evidence}/${label}-native-audio.ts`, source);
await build({ entryPoints: ['scripts/verify/voice-headset-preference-bridge.ts'], outfile: `${evidence}/${label}.cjs`, bundle: true, platform: 'node', format: 'cjs',
  plugins: [{ name: 'frozen-current-native-audio', setup(b) {
    b.onLoad({ filter: /voice-call[\\/]native-audio\.ts$/ }, args => args.path === sourcePath ? { contents: source, loader: 'ts', resolveDir: dirname(args.path) } : undefined);
  } }] });
const run = spawnSync(process.execPath, [`${evidence}/${label}.cjs`], { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
writeFileSync(`${evidence}/${label}.txt`, (run.stdout ?? '') + (run.stderr ?? '') + (run.error ? String(run.error) : ''));
let report;
try { report = JSON.parse(run.stdout); } catch { console.error(run.stderr || run.error || run.stdout); process.exitCode = 1; }
if (report) {
  report.sourcePath = sourcePath; report.sourceSha256 = sourceSha256; report.exitCode = run.status;
  writeFileSync(`${evidence}/${label}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ roundsPerScenario: report.roundsPerScenario, checks: report.checks, failures: report.failures.length,
    cases: report.cases, sourceSha256, providerRequests: 0, microphone: false, evidence: `${evidence}/${label}.json` }));
  process.exitCode = run.status ?? 1;
}
