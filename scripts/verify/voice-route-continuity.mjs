import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const dir = '.tmp-preview/voice-route-continuity-20261015';
const current = readFileSync('android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java', 'utf8');
const reports = [];
for (const mode of ['before', 'after']) {
  const source = mode === 'before' ? readFileSync(`${dir}/before/VoiceCallAudioPlugin.java`, 'utf8') : current;
  const callback = source.match(/communicationDevices = device -> sessions\.guard\(session, \(\) -> \{([\s\S]*?)\}\)\.run\(\);/)[1];
  const helpers = mode === 'before' ? '' : source.slice(source.indexOf('private static boolean privateOutputExpected'), source.indexOf('private void rememberRoute'));
  const loopStart = source.indexOf('while (offset < pcm.length) {');
  const writeLoop = source.slice(loopStart, source.indexOf('synchronized (lock) { if (generation != epoch)', loopStart));
  const java = `import com.virtugene.app.plugins.AudioRouteLoss;
public final class VoiceRouteContinuityCheck {
  static int checks, rejected, stopped;
  static void check(boolean ok) { checks++; if (!ok) throw new AssertionError("check " + checks); }
  static class Build { static class VERSION { static int SDK_INT = 36; } }
  static class AudioDeviceInfo {
    static final int TYPE_BUILTIN_EARPIECE=1, TYPE_BUILTIN_SPEAKER=2, TYPE_WIRED_HEADSET=3,
      TYPE_WIRED_HEADPHONES=4, TYPE_BLUETOOTH_SCO=7, TYPE_USB_HEADSET=22, TYPE_BUILTIN_MIC=15,
      TYPE_BLE_HEADSET=26, TYPE_BLE_SPEAKER=27, TYPE_HEARING_AID=23;
    int id, type; AudioDeviceInfo(int id, int type) { this.id=id; this.type=type; }
    int getId() { return id; } int getType() { return type; }
  }
  static class Manager {
    AudioDeviceInfo current; boolean denied; int calls;
    AudioDeviceInfo getCommunicationDevice() { calls++; if (denied) throw new SecurityException(); return current; }
  }
  static class SystemClock { static long now=1000; static long elapsedRealtime() { return now; } static long elapsedRealtimeNanos() { return now*1000000; } }
  static class Thread { static void sleep(long ms) { SystemClock.now+=ms; } }
  static class AudioTrack { static final int WRITE_NON_BLOCKING=1; }
  static class Io { AudioDeviceInfo route; int writes; AudioDeviceInfo getRoutedDevice() { return route; }
    int write(byte[] pcm,int offset,int size,int mode) { return ++writes<=200 ? 0 : size; } }
  boolean running=true, paused, selectingRoute; Object pendingRouteCall;
  int confirmedCommunication=7, expectedLegacyOutputType, pauses, routeEvents; long routeGeneration=1;
  Manager manager=new Manager(); Io recorder=new Io(), track=new Io();
  Object lock=new Object(); long epoch=1, writtenFrames;
  void suspend(String reason) { if (!running || paused) return; paused=true; pauses++; }
  void event(String type,Object data) { routeEvents++; } Object routes() { return null; }
  void onCommunicationChanged() { ${callback} }
  ${helpers}
  void productionWriteLoop() {
    int offset=0; long started=SystemClock.elapsedRealtime(), lastRouteCheck=started;
    boolean routeChecked=false; long generation=epoch; Io active=track; byte[] pcm=new byte[480];
    ${writeLoop}
  }
  static VoiceRouteContinuityCheck route(int type) {
    VoiceRouteContinuityCheck p=new VoiceRouteContinuityCheck();
    p.manager.current=new AudioDeviceInfo(7,type);
    p.recorder.route=new AudioDeviceInfo(8,type); p.track.route=new AudioDeviceInfo(9,type); return p;
  }
  static void protection(VoiceRouteContinuityCheck p) {
    p.onCommunicationChanged();
    if (p.paused) rejected++;
    check(p.pauses<=1);
    p.onCommunicationChanged(); check(p.pauses<=1); // repeated notifications do not rebuild or resume
  }
  public static void main(String[] args) {
    for (int round=0;round<30;round++) {
      for (int type:new int[]{7,26}) {
        VoiceRouteContinuityCheck p=route(type); p.onCommunicationChanged(); check(!p.paused);
        p.manager.current=new AudioDeviceInfo(2,2); protection(p);
        p=route(type); p.manager.current=null; protection(p);
        p=route(type); p.recorder.route=new AudioDeviceInfo(1,15); protection(p);
        p=route(type); p.track.route=new AudioDeviceInfo(2,2); protection(p);
        p=route(type); p.track.route=new AudioDeviceInfo(1,1); protection(p);
        p=route(type); p.manager.denied=true; protection(p);
        p=route(type); p.pendingRouteCall=new Object(); p.manager.current=new AudioDeviceInfo(2,2); p.onCommunicationChanged(); check(!p.paused);
        p=route(type); p.selectingRoute=true; p.manager.current=new AudioDeviceInfo(2,2); p.onCommunicationChanged(); check(!p.paused);
        p=route(type); p.recorder.route=null; p.track.route=null; p.onCommunicationChanged(); check(!p.paused);
      }
      VoiceRouteContinuityCheck p=route(2); p.recorder.route=new AudioDeviceInfo(1,15); p.track.route=new AudioDeviceInfo(2,2); p.onCommunicationChanged(); check(!p.paused);
      p=route(4); p.recorder.route=new AudioDeviceInfo(1,15); p.onCommunicationChanged(); check(!p.paused); // output-only headphones
      p=route(27); p.recorder.route=new AudioDeviceInfo(1,15); p.onCommunicationChanged(); check(!p.paused); // Bluetooth speaker may use phone mic
      p=route(23); p.recorder.route=new AudioDeviceInfo(1,15); p.onCommunicationChanged(); check(!p.paused); // hearing aid may be output only
      p=route(22); p.track.route=new AudioDeviceInfo(2,2); protection(p);
      p=route(7); p.running=false; p.manager.current=null; p.onCommunicationChanged(); check(p.pauses==0);
      p=route(7); p.paused=true; p.manager.current=null; p.onCommunicationChanged(); check(p.pauses==0);
      // Same-type devices use different input/output IDs: equality with the communication ID is not required.
      p=route(26); p.onCommunicationChanged(); check(!p.paused);
    }
    VoiceRouteContinuityCheck stalled=route(7); stalled.productionWriteLoop();
    check(${mode === 'before' ? 'stalled.manager.calls==0' : 'stalled.manager.calls>=10 && stalled.manager.calls<=12'});
    System.out.println(checks+":"+rejected+":"+stalled.manager.calls);
  }
}`;
  const out = `${dir}/${mode}`; mkdirSync(out, { recursive: true });
  const file = `${out}/VoiceRouteContinuityCheck.java`; writeFileSync(file, java);
  const home = process.env.JAVA_HOME || (existsSync('D:/Java/jdk-21') ? 'D:/Java/jdk-21' : '');
  const bin = name => home ? join(home, 'bin', `${name}.exe`) : name;
  const compile = spawnSync(bin('javac'), ['-d', out, 'android/app/src/main/java/com/virtugene/app/plugins/AudioRouteLoss.java', file], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr || String(compile.error));
  const run = spawnSync(bin('java'), ['-cp', out, 'VoiceRouteContinuityCheck'], { encoding: 'utf8' });
  writeFileSync(`${out}/result.txt`, (run.stdout ?? '') + (run.stderr ?? ''));
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const [checks, rejected, routePollsDuringOneSecondStall] = run.stdout.trim().split(':').map(Number);
  const report = { mode, checks, rejected, routePollsDuringOneSecondStall, roundsPerScenario: 30, realApiCalls: 0, androidRuntime: false,
    scope: 'Actual communication callback and after-version route verification methods extracted from production Java, JVM doubles; no Android/Bluetooth hardware' };
  reports.push(report); writeFileSync(`${dir}/${mode}.json`, JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
}
assert.equal(reports[0].rejected,0); assert.equal(reports[1].rejected,390);
const contracts = [
  [current.indexOf('if (!verifyActiveRoute()) { batchOffset = 0; break; }') < current.indexOf('data.put("captureReadCompletedAtMs"'), 'capture verified before bridge emission'],
  [current.includes('if (!verifyActiveRoute()) { call.reject("voice:stale_audio"); return; }'), 'append verified before queueing'],
  [current.includes('if (!verifyActiveRoute()) throw new IllegalStateException();'), 'output retries recheck routes'],
  [current.includes('if (!verifyActiveRoute()) return;'), 'playback ticker checks while JS has no new PCM'],
  [current.includes('finally { selectingRoute = false; }'), 'synchronous selection guard released on failure'],
  [current.indexOf('confirmedCommunication = id; routeGeneration++') < current.indexOf('pendingRouteCall = null; routeConfirmation = null; call.resolve(routes())'), 'explicit confirmation adopts expected route before acknowledging'],
];
for (const [ok,label] of contracts) assert.ok(ok,label);
writeFileSync(`${dir}/comparison.json`, JSON.stringify({ reports, sourceContracts: contracts.map(row=>row[1]),
  unexpectedRerouteOrRebuilds: 0, physicalAudioVerified: false,
  limitations: ['100ms periodic observation is not a physical stop latency guarantee', 'Unknown/null IO routes are unverified, not proven correct', 'Legacy <=30 SCO behavior unchanged'] },null,2));
