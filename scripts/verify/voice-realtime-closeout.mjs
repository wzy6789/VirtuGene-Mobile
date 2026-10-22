import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = '.tmp-preview/voice-realtime-closeout-20261015'; mkdirSync(dir, { recursive: true });
if (existsSync(`${dir}/regression.json`)) {
  const previous = JSON.parse(readFileSync(`${dir}/regression.json`, 'utf8'));
  if (!previous.passed) {
    const archive = `${dir}/rejected-${Date.now()}`; mkdirSync(archive);
    copyFileSync(`${dir}/regression.json`, `${archive}/regression.json`);
    for (const row of previous.results) copyFileSync(`${dir}/${row.name}.txt`, `${archive}/${row.name}.txt`);
  }
}
const files = ['src/lib/voice-call/controller.ts', 'src/lib/voice-call/utterance.ts', 'src/lib/voice-call/native-audio.ts',
  'src/lib/voice-call/clock.ts', 'src/lib/voice-call/trace.ts', 'src/lib/voice-call/lifecycle.ts', 'src/lib/voice-call/context.ts',
  'src/lib/voice-call/mimo.ts', 'src/lib/voice-call/transport.ts', 'src/lib/character-memory.ts', 'src/store/voice-call-store.ts',
  'src/components/chat/VoiceCallDialog.tsx', 'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java',
  'android/app/src/main/java/com/virtugene/app/plugins/AudioRouteLoss.java', 'package.json', 'android/app/build.gradle'];
const hashes = () => files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const before = hashes();
const suites = [
  ['controller', 'scripts/verify/voice-call-controller.mjs'], ['core', 'scripts/verify/voice-call-core.mjs'],
  ['latency', 'scripts/verify/voice-call-latency.mjs'], ['transport', 'scripts/verify/voice-call-transport.mjs'],
  ['usage', 'scripts/verify/voice-call-usage.mjs'], ['host', 'scripts/verify/voice-call-profile.mjs', '--host'],
  ['context', 'scripts/verify/voice-call-profile.mjs', '--context'], ['native-input', 'scripts/verify/voice-call-native-input.mjs'],
  ['native-input-contract', 'scripts/verify/voice-call-native-input-contract.mjs'],
  ['route-bridge', 'scripts/verify/voice-route-bridge.mjs'], ['route-native', 'scripts/verify/voice-route-continuity.mjs'],
  ['segment-controller', 'scripts/verify/voice-segment-playback.mjs'], ['segment-bridge', 'scripts/verify/voice-segment-bridge.mjs'],
  ['segment-native', 'scripts/verify/voice-segment-native.mjs'], ['speaker-echo', 'scripts/verify/voice-segment-echo.mjs'],
  ['speaker-recovery', 'scripts/verify/voice-output-recovery.mjs'], ['diagnostic-integration', 'scripts/verify/voice-call-evidence.mjs'],
  ['ui', 'scripts/verify/voice-call-ui.mjs'], ['typescript', 'node_modules/typescript/bin/tsc', '--noEmit'],
  ['web-build', 'node_modules/vite/bin/vite.js', 'build'],
];
const results = [];
for (const [name, script, ...args] of suites) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 150000, windowsHide: true });
  const log = (run.stdout ?? '') + (run.stderr ?? '') + (run.error ? String(run.error) : '');
  writeFileSync(`${dir}/${name}.txt`, log);
  const result = { name, command: `node ${[script, ...args].join(' ')}`, exitCode: run.status, signal: run.signal,
    elapsedMs: Date.now() - started, evidence: `${dir}/${name}.txt` };
  results.push(result); console.log(JSON.stringify(result));
  if (run.status !== 0) break;
}
const after = hashes(), unchanged = JSON.stringify(before) === JSON.stringify(after);
const report = { date: new Date().toISOString(), workdir: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认',
  phase: 'closeout requested by user; no new optimization scope', overallGoalComplete: false,
  passed: results.length === suites.length && results.every(r => r.exitCode === 0) && unchanged,
  sourceUnchangedDuringRegression: unchanged, sourceHashesBefore: before, sourceHashesAfter: after, results,
  actualProviderCalls: 0, microphone: false, androidRuntime: false, apkBuilt: false, versionChanged: false, published: false,
  limitation: 'Local browser/Node/JVM regressions and web build are not real service, Android, Bluetooth or acoustic acceptance.' };
writeFileSync(`${dir}/regression.json`, JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
