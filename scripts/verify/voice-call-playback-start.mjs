import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Executes the production start configuration against a small AudioTrack test
// double, not an Android runtime. The double models the documented startup
// threshold only; it does not model a speaker, Bluetooth or system scheduling.
const evidence = '.tmp-preview/voice-latency-native-20261015';
mkdirSync(evidence, { recursive: true });
const source = readFileSync('android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java', 'utf8');
const start = source.indexOf('private void configurePlaybackStart(');
assert.ok(start >= 0);
let end = source.indexOf('{', start) + 1, depth = 1;
while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
assert.equal(depth, 0);
const configure = source.slice(start, end);
const capacity = source.match(/\.setBufferSizeInBytes\((.*?)\)\.setTransferMode/)[1];
assert.ok(source.indexOf('track.play();') > source.indexOf('configurePlaybackStart(track, playbackRate)'));
const java = `public final class VoiceCallPlaybackStartCheck {
    static int checks;
    static class Build { static class VERSION { static int SDK_INT; } }
    static class AudioTrack {
        int threshold, calls; boolean fails;
        AudioTrack(int capacityFrames) { threshold = capacityFrames; }
        void setStartThresholdInFrames(int value) {
            calls++;
            if (fails) throw new IllegalStateException("ROM rejects optional tuning");
            if (value <= 0) throw new AssertionError("invalid threshold");
            threshold = Math.min(value, threshold);
        }
        boolean starts(int frames) { return frames >= threshold; }
    }
    ${configure}
    static int capacity(int minimum, int playbackRate) { return ${capacity}; }
    static void check(boolean value) { checks++; if (!value) throw new AssertionError("check " + checks); }
    public static void main(String[] args) {
        VoiceCallPlaybackStartCheck check = new VoiceCallPlaybackStartCheck();
        // Neither rate can allocate below the platform's advertised minimum.
        check(capacity(9000, 8000) == 9000);
        check(capacity(9000, 24000) == 9000);
        check(capacity(800, 8000) == 1600);
        check(capacity(800, 24000) == 4800);
        for (int sdk : new int[]{24, 30, 31, 36}) {
            Build.VERSION.SDK_INT = sdk;
            for (int rate : new int[]{8000, 24000}) {
                AudioTrack track = new AudioTrack(capacity(800, rate) / 2);
                int initialThreshold = track.threshold;
                check.configurePlaybackStart(track, rate);
                if (sdk >= 31) {
                    check(track.calls == 1);
                    check(track.starts(rate * 40 / 1000));
                    check(!track.starts(rate * 39 / 1000));
                } else {
                    check(track.calls == 0);
                    check(track.threshold == initialThreshold);
                }
            }
        }
        Build.VERSION.SDK_INT = 31;
        AudioTrack expanded = new AudioTrack(12000);
        check.configurePlaybackStart(expanded, 24000);
        check(expanded.starts(960));
        AudioTrack unsupported = new AudioTrack(4800); unsupported.fails = true;
        check.configurePlaybackStart(unsupported, 24000);
        check(unsupported.calls == 1 && unsupported.threshold == 4800);
        System.out.println(checks);
    }
}`;
const sourcePath = join(evidence, 'VoiceCallPlaybackStartCheck.java');
writeFileSync(sourcePath, java);
const javaHome = process.env.JAVA_HOME || (existsSync('D:/Java/jdk-21') ? 'D:/Java/jdk-21' : '');
const bin = name => javaHome ? join(javaHome, 'bin', process.platform === 'win32' ? `${name}.exe` : name) : name;
for (const [command, args] of [[bin('javac'), ['-d', evidence, sourcePath]], [bin('java'), ['-cp', evidence, 'VoiceCallPlaybackStartCheck']]]) {
  const run = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout ?? ''}\n${run.stderr ?? ''}\n${run.error ?? ''}`);
  if (command === bin('java')) {
    const result = {
      checks: Number(run.stdout.trim()) + 1,
      scope: 'Production Java startup configuration executed with AudioTrack/Build doubles; call ordering source check. Android runtime and Bluetooth not tested.',
      before: { fixedCapacityFloorBytes: 4800, minimumCapacityFloorMs24k: 100, minimumCapacityFloorMs8k: 300, threshold: 'device buffer capacity' },
      after: { minimumCapacityFloorMs: 100, requestedThresholdMsAndroid12Plus: 40, fallback: 'device default', platformMinimumPreserved: true },
      sources: ['https://developer.android.com/reference/android/media/AudioTrack#setStartThresholdInFrames(int)', 'https://android.googlesource.com/platform/frameworks/base/+/master/media/java/android/media/AudioTrack.java'],
      deviceTested: false, androidRuntimeExecuted: false, realApiCalls: 0, modelTokens: 0,
    };
    writeFileSync(join(evidence, 'playback-start-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}
