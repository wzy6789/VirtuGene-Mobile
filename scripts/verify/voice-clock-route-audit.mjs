import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-clock-route-20261015';
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const text = path => { const data = readFileSync(path); return data.toString(data[0] === 0xff && data[1] === 0xfe ? 'utf16le' : 'utf8'); };
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const bridge = load(`${dir}/bridge.json`), native = load(`${dir}/native.json`);
assert.ok(bridge.checks >= 1923 && native.checks >= 2432);
assert.match(text(`${dir}/java-compile.txt`), /BUILD SUCCESSFUL/);
assert.equal(text(`${dir}/tsc.txt`).trim(), '');
const files = ['src/lib/voice-call/clock.ts', 'src/lib/voice-call/native-audio.ts', 'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java'];
const report = {
  phase: 'P0 native/JS clock intervals and route observations implemented; parent integration and overall plan acceptance separate',
  workingDirectory: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认', providerCalls: 0, microphoneAccess: false,
  versionChanged: false, apkBuiltOrPublished: false, screenshotsOrRecording: 'No same-condition before/after screenshot or recording; audio/data path only',
  files: files.map(path => ({ path, sha256: hash(path) })),
  snapshots: ['native-audio.ts', 'VoiceCallAudioPlugin.java'].map(path => ({ path: `${dir}/before/${path}`, sha256: hash(`${dir}/before/${path}`) })),
  bridge, native,
  checks: { typescript: { exitCode: 0, evidence: `${dir}/tsc.txt` }, javaCompile: { task: ':app:compileDebugJavaWithJavac --offline', evidence: `${dir}/java-compile.txt`, warnings: 'Existing flatDir / deprecated API and Gradle warnings remain' } },
  interfaces: {
    clockSnapshot: 'NativeCallAudio.clockSnapshot() detached snapshot; JS=native+offset interval, not midpoint',
    timeMapping: 'mapNativeTime(snapshot, nativeAtMs, nowJsMs); undefined when stale/unknown/failed/future/invalid; age is visible, drift is not guaranteed bounded',
    clockEvents: 'type:clock; clock snapshot; at is JS performance.now, unlike native audio event.at',
    capture: 'captureFrameEnd is the current 100ms batch end in raw AudioRecord frame units, excluding unread-in-batch tail of the latest raw read; captureFrameSampleRate=8000/16000. captureSampleEndAtMs is optional audio-record-timestamp-estimate; absent after revision discontinuity, unaligned half-frame or invalid timestamp',
    playback: 'Read-only bufferFrames/startThresholdFrames/underrunCount getters are optional and guarded by API/exception. append exports nativeWriteCompletedAtMs and routeGeneration; append/drain JS receipts cannot advance generation ownership',
    routes: 'routeObservation contains only current observed booleans, device type numbers, native observed time and generation. Selected communication is independent from actual input/output. No device names/IDs',
  },
  limits: ['No Android runtime, Bluetooth hardware, physical speaker/microphone latency or actual service timing verified',
    'AudioRecord sample end is an estimate using read counts and timestamp anchor; driver overrun cannot be proven absent',
    'Bridge interval is calibrated uncertainty with visible age, not proof of zero clock drift; expires after 30 seconds',
    'Underlying third-party bridge promise cannot be canceled by JS, but each group is bounded and stale completion cannot publish; failed bridge groups are not periodically retried',
    'This subtask does not certify overall approved real-time call plan completion'],
};
writeFileSync(`${dir}/summary.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ bridgeChecks: bridge.checks, nativeChecks: native.checks, providerCalls: 0, report: `${dir}/summary.json` }));
