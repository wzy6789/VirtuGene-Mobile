import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-buffer-integration-20261016/final'; mkdirSync(dir, { recursive: true });
const files = ['src/lib/voice-call/native-audio.ts', 'src/lib/voice-call/controller.ts', 'src/lib/voice-call/playback-buffer-policy.ts',
  'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java', 'package.json', 'android/app/build.gradle',
  'scripts/verify/voice-buffer-integration.ts', 'scripts/verify/voice-buffer-native.mjs', 'scripts/verify/voice-call-controller.ts',
  'docs/VOICE-PLAYBACK-BUFFER-INTEGRATION-2026-10-16.md'];
const hashes = () => files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const start = hashes(), results = [];
const suites = [
  ['bridge-red', ['scripts/verify/voice-buffer-integration.mjs', '--before'], 1],
  ['native-red', ['scripts/verify/voice-buffer-native.mjs', '--before'], 1],
  ['bridge', ['scripts/verify/voice-buffer-integration.mjs'], 0],
  ['native', ['scripts/verify/voice-buffer-native.mjs'], 0],
  ['policy-simulation', ['scripts/verify/voice-playback-buffer-policy.mjs'], 0],
  ['start-threshold', ['scripts/verify/voice-call-playback-start.mjs'], 0],
  ['short-tail', ['scripts/verify/voice-short-tail.mjs'], 0],
  ['segment-native', ['scripts/verify/voice-segment-native.mjs'], 0],
  ['input-contract', ['scripts/verify/voice-call-native-input-contract.mjs'], 0],
  ['existing-call-regressions', ['scripts/verify/voice-headset-final.mjs'], 0],
];
for (const [name, args, expected] of suites) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const output = (r.stdout ?? '') + (r.stderr ?? '') + (r.error ? String(r.error) : ''); writeFileSync(`${dir}/${name}.txt`, output);
  let passed = r.status === expected;
  if (name === 'bridge-red') passed &&= output.includes('"failures":60');
  if (name === 'native-red') passed &&= output.includes('native tuning obeys requested bounded threshold and effective capacity');
  results.push({ name, exitCode: r.status, expectedExitCode: expected, passed, evidence: `${dir}/${name}.txt` });
  console.log(JSON.stringify(results.at(-1))); if (!passed) break;
}
if (results.length === suites.length && results.every(r => r.passed)) {
  const r = spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat :app:compileDebugJavaWithJavac --offline'], { cwd: 'android', encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  writeFileSync(`${dir}/java-compile.txt`, (r.stdout ?? '') + (r.stderr ?? '') + (r.error ? String(r.error) : ''));
  results.push({ name: 'java-compile-only', exitCode: r.status, passed: r.status === 0, evidence: `${dir}/java-compile.txt` }); console.log(JSON.stringify(results.at(-1)));
}
const end = hashes();
const report = { date: new Date().toISOString(), workdir: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认',
  passed: results.length === suites.length + 1 && results.every(r => r.passed) && JSON.stringify(start) === JSON.stringify(end),
  sourceUnchangedDuringRun: JSON.stringify(start) === JSON.stringify(end), sourceHashes: end, results,
  productionIntegration: true, overallPlanComplete: false, actualProviderCalls: 0, providerTokens: 0, microphone: false,
  androidRuntime: false, physicalAudio: false, apkBuilt: false, installed: false, published: false, versionChanged: false,
  evidenceScope: 'Actual production bridge, policy, controller and extracted Java methods run with constrained doubles; Java compile and Web build. No Android/acoustic/provider timing claim.',
  limitations: ['Recovery tuning adds a bridge and startup buffering only after confirmed active-supply starvation; physical latency gain unmeasured.',
    'Persistent producer undersupply and legacy minimum-clamped short EOF are unresolved.',
    'General unpunctuated deadline, energy-only VAD limits and real Android/OEM/provider validation remain.',
    'Conditional P3 background calling is not enabled.'],
};
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2)); assert.equal(report.passed, true, 'Inspect failed regression or source mutation in final report');
