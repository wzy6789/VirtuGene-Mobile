import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const dir = '.tmp-preview/voice-short-tail-20261016/final';
mkdirSync(dir, { recursive: true });
const files = [
  'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java',
  'scripts/verify/voice-short-tail.mjs', 'scripts/verify/voice-segment-native.mjs',
  'package.json', 'android/app/build.gradle',
];
const hashes = () => files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const start = hashes(), results = [];
const suites = [
  ['baseline', ['scripts/verify/voice-short-tail.mjs', '--before'], 0],
  ['regression-red', ['scripts/verify/voice-short-tail.mjs', '--before', '--require-fix'], 1],
  ['short-tail', ['scripts/verify/voice-short-tail.mjs'], 0],
  ['segment-native', ['scripts/verify/voice-segment-native.mjs'], 0],
  ['segment-controller', ['scripts/verify/voice-segment-playback.mjs'], 0],
  ['default-headset', ['scripts/verify/voice-default-headset.mjs'], 0],
  ['route-continuity', ['scripts/verify/voice-route-continuity.mjs'], 0],
  ['clock-observation', ['scripts/verify/voice-clock-route-native.mjs'], 0],
];
for (const [name, args, expected] of suites) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const output = (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : '');
  writeFileSync(`${dir}/${name}.txt`, output);
  const passed = result.status === expected && (name !== 'regression-red' || output.includes('complete short audio must not wait forever below startup threshold'));
  results.push({ name, exitCode: result.status, expectedExitCode: expected, passed, evidence: `${dir}/${name}.txt` });
  console.log(JSON.stringify(results.at(-1)));
  if (!passed) break;
}
if (results.length === suites.length && results.every(r => r.passed)) {
  const result = spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat :app:compileDebugJavaWithJavac --offline'], {
    cwd: 'android', encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  writeFileSync(`${dir}/java-compile.txt`, (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : ''));
  results.push({ name: 'java-compile-only', exitCode: result.status, passed: result.status === 0, evidence: `${dir}/java-compile.txt` });
  console.log(JSON.stringify(results.at(-1)));
}
const end = hashes();
const report = {
  date: new Date().toISOString(), workdir: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认',
  passed: results.length === suites.length + 1 && results.every(r => r.passed) && JSON.stringify(start) === JSON.stringify(end),
  sourceUnchangedDuringRun: JSON.stringify(start) === JSON.stringify(end), sourceHashes: end, results,
  actualProviderCalls: 0, providerTokens: 0, microphone: false, androidRuntime: false,
  versionChanged: false, apkBuilt: false, published: false, overallPlanComplete: false,
  limitations: [
    'Threshold-constrained JVM AudioTrack doubles are not Android/acoustic playback evidence.',
    'Legacy devices may clamp the effective minimum buffer above a tiny completed segment. This still times out honestly, not as a heard receipt.',
    'Only startup before any playback progress is tuned; running-track jitter buffering is retained.',
    'Adaptive buffer policy remains an experiment, not connected to production playback.',
  ],
};
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
assert.equal(report.passed, true, 'Inspect report for failed regression or compile');
