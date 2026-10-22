import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const baseline = process.argv.includes('--baseline');
const aosp = process.argv.includes('--aosp-startup-only');
const root = '.tmp-preview/voice-playback-buffer-policy-20261016';
const dir = aosp ? `${root}/aosp-startup-only${baseline?'-baseline':''}` : baseline ? `${root}/recovery-gated/before-run` : root;
mkdirSync(dir, { recursive: true });
const outfile = `${dir}/verify.cjs`;
await build({ entryPoints: ['scripts/verify/voice-playback-buffer-policy.ts'], outfile, bundle: true, platform: 'node', format: 'cjs',
  plugins: baseline ? [{ name:'frozen-buffer-policy', setup(b) { b.onLoad({filter:/voice-call[\\/]playback-buffer-policy\.ts$/},args=>({
    contents:readFileSync(`${root}/recovery-gated/before/playback-buffer-policy.ts`,'utf8'),loader:'ts',resolveDir:dirname(args.path)})); } }] : [] });
const run = spawnSync(process.execPath, [outfile,...(baseline ? ['--baseline'] : []), ...(aosp ? ['--aosp-startup-only'] : [])], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
writeFileSync(`${dir}/run.txt`, (run.stdout ?? '') + (run.stderr ?? ''));
assert.equal(run.status, 0, run.stderr || String(run.error));
const report = JSON.parse(run.stdout.trim());
report.variant = baseline ? 'frozen-before-underrun-gate' : 'underrun-gated-candidate';
report.policySource = baseline ? `${root}/recovery-gated/before/playback-buffer-policy.ts` : 'src/lib/voice-call/playback-buffer-policy.ts';
report.sources = [
  'https://developer.android.com/reference/android/media/AudioTrack#setStartThresholdInFrames(int)',
  'https://developer.android.com/reference/android/media/AudioTrack#getBufferSizeInFrames()',
  'https://developer.android.com/reference/android/media/AudioTrack#getUnderrunCount()',
];
report.sourceHashes = Object.fromEntries(['src/lib/voice-call/playback-buffer-policy.ts', 'scripts/verify/voice-playback-buffer-policy.ts', 'scripts/verify/voice-playback-buffer-policy.mjs']
  .map(file => [file, createHash('sha256').update(readFileSync(file === 'src/lib/voice-call/playback-buffer-policy.ts' ? report.policySource : file)).digest('hex')]));
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${dir}/summary.json`, JSON.stringify({ ...report, rows: undefined, cancellations: undefined }, null, 2));
const representative = report.summary.filter(row => row.rate === 24000 && row.capacityMs === 100);
const table = representative.map(row => `| ${row.scenario} | ${row.mode} | ${row.firstProgressP50Ms}/${row.firstProgressP95Ms} | ${row.underrunTotal} | ${row.underrunMsTotal} | ${row.targetsMs.join('/')} |`).join('\n');
writeFileSync(`${dir}/README.md`, `# Playback buffer policy experiment\n\nRun from F:/VirtuGene-Mobile: \`node scripts/verify/voice-playback-buffer-policy.mjs${aosp ? ' --aosp-startup-only' : ''}${baseline ? ' --baseline' : ''}\`.\n\n${report.scope}\n\nSink model: ${report.refillModel}. This is a reference/stress assumption, not device discovery.\n\n${report.rowDefinition}\n\n${report.supplyDefinition}\n\n${report.eofDefinition}\n\n${report.cancellationDefinition}\n\n${report.preservedBoundary}\n\nThe frozen pre-gate candidate raised stable startup without an underrun benefit. The current candidate only uses the supply-history estimate after a confirmed active-supply underrun; stable and unknown-counter cases keep 40ms. Jitter recovery still costs first-progress time, and persistent undersupply still stalls. All cold starts and slower cases remain in the results. Check the report variant and policySource. The current policy is used by NativeCallAudio; this software-sink verifier does not execute that bridge or physical playback. Separate integration evidence is under voice-buffer-integration-20261016. Numeric route history is not authorization caching.\n\n${report.checks} checks; ${report.rows.length} main rows; ${report.cancellations.length} cancellation rows. Full frame, PCM hash, final-sample, queue and history-age evidence is in report.json. First progress is a software frame clock, not physical sound.\n\nRepresentative 24kHz / 100ms effective capacity, all 30 rounds included:\n\n| Supply | Mode | First progress P50/P95 ms | Underruns | Underrun ms total | Target ms |\n|---|---|---:|---:|---:|---|\n${table}\n\nOfficial definitions:\n${report.sources.map(url => `- ${url}`).join('\n')}\n\nRejected first run: rejected-unknown-fixture.txt. A test helper's default parameter converted explicit undefined to zero; the fixture now omits the getter field. The rejected result is not counted as a pass.\n`, 'utf8');
console.log(JSON.stringify({ checks: report.checks, partialWriteOperations: report.partialWriteOperations, rows: report.rows.length, cancellations: report.cancellations.length,
  scope: report.scope, summary: `${dir}/summary.json`, report: `${dir}/report.json` }));
