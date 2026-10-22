import assert from 'node:assert/strict';
import { NativeCallAudio, type NativeAudioEvent, type NativeCallPlugin } from '../../src/lib/voice-call/native-audio';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
const before = process.argv.includes('--before');
let checks = 0;
const opened: NativeCallAudio[] = [];
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks++; };
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  return { promise: new Promise<T>((a, b) => { resolve = a; reject = b; }), resolve, reject }; };
const routes = [{ id: 1, type: 1, label: 'synthetic earpiece', selected: true }, { id: 2, type: 2, label: 'synthetic speaker', selected: false }, { id: 7, type: 7, label: 'synthetic headset', selected: false }];
function fixture(supported = true) {
  let callback!: (e: NativeAudioEvent) => void, generation = 1, session = 101, captures = 0, sets = 0, cancels = 0, closes = 0;
  let pending = deferred<any>(); let nextStop: ReturnType<typeof deferred<any>> | undefined;
  const caps = () => ({ sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true, routes, routeGeneration: generation,
    ...(supported ? { routeCancellation: true, routeControlSession: session } : {}) });
  const plugin: NativeCallPlugin = {
    addListener: async (_n, cb) => { callback = cb; return { remove: async () => {} }; },
    start: async () => caps(), heartbeat: async () => {}, mute: async () => {}, pause: async () => {},
    resume: async () => ({ routes, routeGeneration: ++generation, routeControlSession: session }),
    beginPlayback: async () => {}, appendPcm: async () => ({ playedFrames: 0, writtenFrames: 0 }), drain: async () => ({ playedFrames: 0, writtenFrames: 0 }),
    stopPlayback: async () => nextStop ? nextStop.promise : ({ playedFrames: 0, writtenFrames: 0 }), stop: async () => { closes++; session++; },
    getRoutes: async () => ({ routes, routeGeneration: generation }), setRoute: async () => { sets++; return pending.promise; }, requestBluetooth: async () => {},
    ...({ cancelRouteRequest: async (o: any) => { cancels++; generation++; return { routes, routeGeneration: generation,
      routeControlSession: session, cancelledRequestId: o.requestId }; } } as object),
  };
  const audio = new NativeCallAudio('route-recovery', plugin, 100, 100, 1000);
  opened.push(audio);
  const emit = (type: NativeAudioEvent['type'], patch: Partial<NativeAudioEvent> = {}) => callback({ callId: 'route-recovery', type, at: 0, routeGeneration: generation, ...patch });
  return { audio, plugin, start: () => audio.start(e => { if (e.type === 'capture') captures++; }),
    emit, next: () => { pending = deferred<any>(); }, resolve: () => pending.resolve({ routes, routeGeneration: ++generation, routeControlSession: session }),
    reject: () => pending.reject(Error('voice:route_failed')), holdStop: () => { nextStop = deferred<any>(); return () => { nextStop!.resolve({ playedFrames: 0, writtenFrames: 0 }); nextStop = undefined; }; },
    get captures() { return captures; }, get sets() { return sets; }, get cancels() { return cancels; }, get closes() { return closes; } };
}
async function bridgeCases() {
  const rows = [];
  for (let round = 0; round < 30; round++) {
    const late = fixture(); await late.start();
    const oldSuccess = late.audio.route(7).then(() => 'resolved', e => e.name); await flush();
    await late.audio.pause(); late.resolve(); const success = await oldSuccess;
    check(success === (before ? 'resolved' : 'AbortError'), 'pause revokes old route success'); await late.audio.close();
    const failure = fixture(); await failure.start();
    const oldFailure = failure.audio.route(7).catch(() => {}); await flush();
    await failure.audio.pause(); await failure.audio.resume(); failure.reject(); await oldFailure;
    failure.emit('capture', { sequence: 1 });
    check(failure.captures === (before ? 0 : 1), 'old route rejection cannot suspend recovered capture'); await failure.audio.close();
    if (!before) {
      const cancel = fixture(); await cancel.start();
      const stale = cancel.audio.route(7).then(() => 'resolved', e => e.name); await flush();
      await cancel.audio.cancelRouteWait();
      check(await stale === 'AbortError' && cancel.cancels === 1, 'explicit cancellation revokes pending bridge before late native success');
      cancel.resolve(); await flush(); cancel.emit('capture', { sequence: 1 });
      check(cancel.captures === 0, 'cancelled wait stays paused');
      cancel.next(); const fresh = cancel.audio.route(1); await flush(); cancel.resolve(); await fresh;
      await cancel.audio.resume(); cancel.emit('capture', { sequence: 2 }); check(cancel.captures === 1, 'explicit route then resume restores capture without old reply');
      await cancel.audio.close();
      const stopped = fixture(); await stopped.start(); const release = stopped.holdStop();
      const aborted = stopped.audio.route(7).then(() => 'resolved', e => e.name); await flush();
      await stopped.audio.cancelRouteWait(); release();
      check(await aborted === 'AbortError' && stopped.sets === 0, 'cancel during stop acknowledgement cannot submit a later setRoute'); await stopped.audio.close();
      const legacy = fixture(false); await legacy.start();
      const unsupported = legacy.audio.route(7).then(() => 'resolved', e => e.name); await flush();
      await legacy.audio.cancelRouteWait(); legacy.resolve();
      check(await unsupported === 'AbortError' && legacy.closes === 1 && legacy.cancels === 0, 'older native cancels by confirmed session close, not unreliable repeated pause');
      await legacy.audio.close();
    }
    rows.push({ round, lateSuccess: success, recoveredCapture: failure.captures });
  }
  return rows;
}
async function controllerCases() {
  if (before) return [];
  const rows = [];
  for (let round = 0; round < 30; round++) {
    let callback!: (e: NativeAudioEvent) => void, view!: CallView, sets = 0, cancels = 0, res = 0;
    const pending = deferred<any>(), stop = deferred<any>(); let hold = true;
    const controller = new VoiceCallController('control-recovery', { voice: '茉莉', style: '', context: async () => [], onView: v => { view = v; },
      api: { recognize: async () => { throw Error('ASR forbidden'); }, dialogue: async () => { throw Error('LLM forbidden'); }, synthesize: async () => { throw Error('TTS forbidden'); } },
      audio: { start: async cb => { callback = cb; return { sampleRate: 16000, echoCancellation: true, noiseSuppression: true, routes }; },
        beginPlayback: async () => {}, append: async () => ({ playedFrames: 0, writtenFrames: 0 }), drain: async () => ({ playedFrames: 0, writtenFrames: 0 }),
        interrupt: async () => hold ? stop.promise : ({ playedFrames: 0, writtenFrames: 0 }), close: async () => {}, mute: async () => {},
        resume: async () => { res++; return { routes }; }, route: async () => { sets++; return pending.promise; },
        cancelRouteWait: async () => { cancels++; return { routes }; },
      } });
    await controller.start(); const first = controller.selectRoute(7); await flush();
    check(view.routing && view.routeWait?.requestedType === 7, 'route wait includes explicit target without claiming I/O');
    await controller.cancelRouteWait(); check(view.phase === 'paused' && !view.routing && !view.routeWait, 'cancel clears only its own wait and preserves pause');
    hold = false; stop.resolve({ playedFrames: 0, writtenFrames: 0 }); await first;
    check(sets === 0 && cancels === 1, 'controller cancellation before stop ack never submits native route');
    const second = controller.selectRoute(1); await flush();
    callback({ callId: 'control-recovery', type: 'routes', at: 0, routes });
    pending.resolve({ routes }); await second;
    check(view.phase === 'paused' && !view.routing && res === 0, 'explicit phone choice never automatically resumes a paused call');
    await controller.resume(); check(view.phase === 'listening' && res === 1, 'user resume is the separate capture authorization');
    await controller.end(); rows.push({ round, sets, cancels, resumes: res });
  }
  return rows;
}
async function main() { const bridge = await bridgeCases(), controller = await controllerCases(); console.log(JSON.stringify({ before, checks, bridge, controller,
  apiCalls: 0, microphone: false, androidRuntime: false, scope: 'Actual NativeCallAudio/controller with deferred bridge and synthetic events; not hardware.' })); }
void main().catch(async e => { await Promise.allSettled(opened.map(audio => audio.close())); console.error(e); process.exitCode = 1; });
