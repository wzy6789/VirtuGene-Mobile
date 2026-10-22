import assert from 'node:assert/strict';
import { NativeCallAudio, type NativeAudioEvent, type NativeCallPlugin } from '../../src/lib/voice-call/native-audio';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
const before = process.argv.includes('--before');
let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; }
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture(legacy = false, pauseFails = false) {
  let callback!: (event: NativeAudioEvent) => void;
  let generation = 10, captures = 0, pauses = 0, closes = 0, removed = 0, nativeRunning = true;
  let resolveResume!: (value: { routes: [] ; routeGeneration?: number }) => void;
  let deferStop = false, rejectStop!: (error: Error) => void;
  const caps = { sampleRate: 16000 as const, routes: [], echoCancellation: true, noiseSuppression: true,
    ...(legacy ? {} : { routeGeneration: generation }) };
  const plugin: NativeCallPlugin = {
    addListener: async (_name, listener) => { callback = listener; return { remove: async () => { removed++; } }; },
    start: async () => caps, heartbeat: async () => {}, mute: async () => {},
    resume: async () => new Promise(resolve => { resolveResume = resolve; }),
    pause: async () => { pauses++; if (pauseFails) throw Error('voice:pause_failed'); nativeRunning = false; },
    stop: async () => { closes++; nativeRunning = false; },
    beginPlayback: async () => {}, appendPcm: async () => ({ playedFrames: 1, writtenFrames: 1 }),
    drain: async () => ({ playedFrames: 1, writtenFrames: 1, complete: true }),
    stopPlayback: async () => deferStop ? new Promise((_resolve, reject) => { rejectStop = reject; }) : ({ playedFrames: 0, writtenFrames: 0 }), getRoutes: async () => ({ routes: [] }),
    setRoute: async () => ({ routes: [], routeGeneration: ++generation }), requestBluetooth: async () => {},
  };
  const audio = new NativeCallAudio('route-fixture', plugin);
  const event = (type: NativeAudioEvent['type'], gen = generation) => callback({ type, callId: 'route-fixture', at: 0,
    ...(legacy ? {} : { routeGeneration: gen }), sequence: captures, sampleRate: 16000 });
  return { audio, start: () => audio.start(event => { if (event.type === 'capture') captures++; }), event,
    holdStop: () => { deferStop = true; }, failOldStop: () => { deferStop = false; rejectStop(Error('voice:old_stop_failed')); },
    acknowledge: (gen: number) => { generation = gen; nativeRunning = true; resolveResume({ routes: [], ...(legacy ? {} : { routeGeneration: gen }) }); },
    get captures() { return captures; }, get pauses() { return pauses; }, get closes() { return closes; }, get removed() { return removed; }, get nativeRunning() { return nativeRunning; } };
}
async function bridgeCases() {
  for (let round = 0; round < 30; round++) {
    const loss = fixture(); await loss.start();
    loss.event('routeLost', 11); loss.event('capture', 11);
    check(loss.captures === (before ? 1 : 0), 'standalone routeLost excludes microphone capture');
    await loss.audio.close(); check(loss.removed === 1 && !loss.nativeRunning, 'close releases subscription and native session');
    const stale = fixture(); await stale.start(); stale.event('paused', 10);
    const recovery = stale.audio.resume(); stale.acknowledge(12); await recovery;
    stale.event('paused', 10); stale.event('capture', 12);
    check(stale.captures === (before ? 0 : 1), 'older native route generation cannot pause a recovered session');
    await stale.audio.close();
    const explicit = fixture(); await explicit.start(); explicit.event('paused', 10);
    const explicitPending = explicit.audio.resume().then(() => 'resolved', error => error.name);
    await explicit.audio.pause(); explicit.acknowledge(12);
    const explicitOutcome = await explicitPending; explicit.event('capture', 12);
    check(explicitOutcome === (before ? 'resolved' : 'AbortError'), 'explicit local pause supersedes pending resume even without a native event');
    check(explicit.nativeRunning === before && explicit.captures === (before ? 1 : 0), 'explicit pause cannot be undone by late native success');
    await explicit.audio.close();
    const oldStop = fixture(); await oldStop.start(); oldStop.holdStop();
    const failedOldStop = oldStop.audio.interrupt().catch(() => {});
    await oldStop.audio.close(); await oldStop.start(); oldStop.failOldStop(); await failedOldStop;
    oldStop.event('capture', 10);
    check(oldStop.captures === (before ? 0 : 1), 'old stop failure cannot suspend a restarted native session');
    await oldStop.audio.close();
    for (const legacy of [false, true]) {
      const race = fixture(legacy); await race.start(); race.event('paused', 10);
      const pending = race.audio.resume().then(() => 'resolved', error => error.name);
      race.event('routeLost', 11); race.acknowledge(12); const outcome = await pending;
      race.event('capture', 12);
      check(outcome === (before ? 'resolved' : 'AbortError'), 'new suspension invalidates old resume acknowledgement');
      check(race.captures === (before ? 1 : 0), 'late resume cannot reopen JS capture after a newer loss');
      check(race.nativeRunning === before && race.pauses === (before ? 0 : 1), 'stale resume is suspended natively, not only hidden in JS');
      await race.audio.close();
    }
    const failure = fixture(false, true); await failure.start(); failure.event('paused', 10);
    const obsolete = failure.audio.resume().catch(error => error.name);
    failure.event('paused', 11); failure.acknowledge(12); await obsolete;
    check(before || failure.closes === 1 && failure.removed === 1 && !failure.nativeRunning, 'failed native re-pause closes and releases the session');
    await failure.audio.close();
  }
}
async function controllerCases() {
  for (const reject of [false, true]) {
    let callback!: (event: NativeAudioEvent) => void, view: CallView | undefined, mutes = 0;
    let resume!: () => void;
    const caps = { sampleRate: 16000 as const, routes: [], echoCancellation: true, noiseSuppression: true };
    const controller = new VoiceCallController('resume-race', { voice: '茉莉', style: '', onView: value => { view = value; }, context: async () => [],
      api: { recognize: async () => { throw Error('No ASR allowed'); }, dialogue: async () => { throw Error('No dialogue allowed'); }, synthesize: async () => { throw Error('No synthesis allowed'); } },
      audio: {
        start: async cb => { callback = cb; return caps; }, close: async () => {},
        beginPlayback: async () => {}, append: async () => ({ playedFrames: 0, writtenFrames: 0 }), drain: async () => ({ playedFrames: 0, writtenFrames: 0 }),
        interrupt: async () => ({ playedFrames: 0, writtenFrames: 0 }), mute: async () => { mutes++; },
        resume: async () => new Promise((resolve, fail) => { resume = () => reject ? fail(Error('voice:route_failed')) : resolve({ routes: [] }); }),
      },
    });
    await controller.start(); callback({ type: 'paused', callId: 'resume-race', at: 0, reason: 'old-pause' });
    const pending = controller.resume(); await flush();
    callback({ type: 'routeLost', callId: 'resume-race', at: 1, reason: 'route-lost' });
    resume(); await pending;
    if (!before) check(view?.phase === 'paused' && view.error === 'route-lost' && mutes === 0, 'latest native pause reason survives resume success and rejection');
    else check(reject ? view?.phase === 'error' && view.error === 'voice:route_failed' : mutes === 1, 'before baseline shows overwritten failure or unnecessary post-pause mute');
    await controller.end();
  }
}
async function main() {
  await bridgeCases(); await controllerCases();
  console.log(JSON.stringify({ mode: before ? 'before' : 'after', checks, roundsPerBridgeCase: 30, providerCalls: 0,
    scope: 'actual NativeCallAudio and controller with native bridge doubles; no microphone/model/Android runtime' }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
