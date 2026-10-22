import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const plugin = readFileSync('android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java', 'utf8');
const service = readFileSync('android/app/src/main/java/com/virtugene/app/plugins/VoiceCallService.java', 'utf8');
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
function method(source, name) {
  const syntax = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, token => token.replace(/[^\r\n]/g, ' '));
  const match = new RegExp('(?:public|private)\\s+(?:void|int|JSObject)\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(syntax);
  assert.ok(match, name);
  const start = syntax.indexOf('{', match.index); let depth = 1;
  for (let end = start + 1; end < syntax.length; end++) {
    if (syntax[end] === '{') depth++;
    if (syntax[end] === '}' && --depth === 0) return source.slice(start + 1, end);
  }
  throw new Error('unclosed method ' + name);
}
const checks = [];
function check(condition, scope) { assert.ok(condition, scope); checks.push(scope); }
const start = method(plugin, 'start'), begin = method(plugin, 'begin');
check(start.includes('call.getBoolean("captureEnabled", true) && getPermissionState("microphone")'), 'text-start-no-permission-request');
check(begin.includes('wantsCapture && !AudioCaptureLease.acquire(this)'), 'text-start-no-microphone-lease');
const audioStart = method(plugin, 'finishDefaultAudioStart');
check(!begin.includes('replaceCapture(') && begin.includes('awaitDefaultAudioStart(call, session)') && audioStart.includes('if (captureEnabled) { replaceCapture('), 'text-start-no-recorder-or-thread-before-confirmed-route');
check(begin.includes('if (wantsCapture && manager.isMicrophoneMute())'), 'text-start-does-not-depend-on-system-microphone');
const resume = method(plugin, 'resume');
check(resume.includes('captureEnabled && (capture == null || !capture.isAlive())'), 'text-resume-does-not-require-capture-thread');
check(resume.includes('captureEnabled && getPermissionState("microphone")') && resume.includes('captureEnabled && !muted && recorder.getRecordingState()'), 'text-resume-no-microphone-permission-or-recording');
const setter = method(plugin, 'setInputMode'), permission = method(plugin, 'switchInput'), commit = method(plugin, 'completeInputSwitch');
check(setter.includes('synchronized (lock)') && setter.includes('!owns(call) || paused'), 'mode-setter-is-current-owner-only-and-paused-rejects');
check(permission.includes('pendingModeCall.getCallbackId().equals(call.getCallbackId())') && permission.includes('!owns(call) || paused'), 'late-permission-result-rechecks-owner-and-pause');
check(permission.includes('main.postDelayed(modeServiceTimeout, 3000)'), 'foreground-service-acknowledgement-has-bounded-timeout');
check(commit.includes('if (serviceError != null)') && commit.indexOf('if (serviceError != null)') < commit.indexOf('AudioCaptureLease.acquire(this)'), 'microphone-allocation-follows-successful-service-ack');
check(commit.includes('if (!owns(call) || paused || activityPaused)') && commit.includes('pendingModeCall.getCallbackId().equals(call.getCallbackId())'), 'mode-commit-rechecks-current-session-and-activity');
const release = method(plugin, 'releaseCapture');
check(release.includes('captureGeneration++') && release.includes('oldRecorder::release') && release.includes('AudioCaptureLease.release(this)'), 'text-switch-revokes-old-capture-and-releases-microphone');
check(release.includes('if (captureCleanupFailures == 0)') && commit.includes('suspend("voice:audio_release_failed")'), 'unconfirmed-microphone-release-cannot-claim-success');
check(method(plugin, 'captureLoop').includes('while (running && captureEnabled && generation == captureGeneration)'), 'text-mode-has-no-capture-or-barge-in-thread-authority');
check(plugin.includes('if (pendingModeCall != null) cancelInputSwitch("voice:cancelled", true)') && method(plugin, 'close').includes('cancelInputSwitch("voice:cancelled", false)'), 'pause-and-hangup-revoke-pending-mode-change');
check(method(plugin, 'startLegacySco').includes('if (captureEnabled && pendingAudioStart == null) replaceCapture(8000)') && method(plugin, 'setRoute').includes('if (captureEnabled) replaceCapture(16000)'), 'legacy-bluetooth-routing-does-not-create-text-microphone');
const foreground = method(service, 'activate');
check(foreground.includes('ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK') && foreground.includes('accepted.captureEnabled ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0'), 'foreground-service-runtime-types-reflect-input-mode');
check(service.includes('completion[0].run()') && service.includes('catch (RuntimeException error) { failure = error; }'), 'foreground-start-failure-is-caught-and-reported-outside-registry');
check(manifest.includes('android:foregroundServiceType="microphone|mediaPlayback"') && manifest.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'), 'manifest-supports-both-output-only-and-voice-service');
mkdirSync('.tmp-preview/voice-call', { recursive: true });
const result = { checks: checks.length, mode: 'production-java-input-mode-source-contract', scenarios: checks, realApiCalls: 0, modelTokens: 0, deviceTested: false, androidRuntimeExecuted: false };
writeFileSync('.tmp-preview/voice-call/native-input-contract-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
