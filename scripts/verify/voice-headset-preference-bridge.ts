import { NativeCallAudio, type AudioCapabilities, type CallRoute, type NativeAudioEvent, type NativeCallPlugin, type RouteSnapshot } from '../../src/lib/voice-call/native-audio';

type Preference = { id: number; type: number } | undefined;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  return { promise: new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }), resolve, reject };
};
const row = (id: number, type: number, selected = true): CallRoute => ({ id, type, selected, label: `synthetic-${id}-${type}` });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const failures: { round: number; label: string; actual?: unknown; expected?: unknown; error?: string }[] = [];
const counts = new Map<string, { checks: number; failures: number }>();
let round = 0, checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks++;
  const counter = counts.get(label) ?? { checks: 0, failures: 0 };
  counter.checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { counter.failures++; failures.push({ round, label, actual, expected }); }
  counts.set(label, counter);
}
function fixture(suffix: string) {
  let generation = 10, session = 100, dead = false, stops = 0, sets = 0;
  let nextRoute: (() => Promise<RouteSnapshot>) | undefined;
  let nextResume: Promise<RouteSnapshot> | undefined;
  const listeners: ((event: NativeAudioEvent) => void)[] = [];
  const starts: Parameters<NativeCallPlugin['start']>[0][] = [];
  const callId = `preference-${round}-${suffix}`;
  let currentRows = [row(7, 7)];
  const snapshot = (routes = currentRows): RouteSnapshot => ({ routes: clone(routes), routeGeneration: generation, routeControlSession: session });
  const plugin: NativeCallPlugin = {
    addListener: async (_name, listener) => { listeners.push(listener); return { remove: async () => {} }; },
    start: async options => { starts.push(clone(options)); generation++; session++; dead = false;
      return { ...snapshot(), sampleRate: 16000, echoCancellation: true, noiseSuppression: true, routeCancellation: true } as AudioCapabilities; },
    resume: async () => { if (nextResume) { const pending = nextResume; nextResume = undefined; return pending; } if (dead) throw Error('voice:capture_ended'); generation++; return snapshot(); },
    heartbeat: async () => {}, pause: async () => {}, mute: async () => {},
    beginPlayback: async () => {}, appendPcm: async () => ({ playedFrames: 0, writtenFrames: 0 }),
    drain: async () => ({ playedFrames: 0, writtenFrames: 0 }), stopPlayback: async () => ({ playedFrames: 0, writtenFrames: 0 }),
    stop: async () => { stops++; }, getRoutes: async () => snapshot(),
    setRoute: async () => { sets++; if (nextRoute) { const action = nextRoute; nextRoute = undefined; return action(); } return snapshot(); },
    cancelRouteRequest: async options => { generation++; return { ...snapshot(), cancelledRequestId: options.requestId }; },
    requestBluetooth: async () => {},
  };
  const audio = new NativeCallAudio(callId, plugin, 100, 100, 1000);
  const opened: NativeCallAudio[] = [audio];
  const emit = (routes: CallRoute[], options: { listener?: number; routeGeneration?: number; callId?: string; type?: NativeAudioEvent['type']; reason?: string } = {}) => {
    listeners[options.listener ?? listeners.length - 1]({ callId: options.callId ?? callId, type: options.type ?? 'routes', at: 0,
      routeGeneration: options.routeGeneration ?? generation, routes, reason: options.reason });
  };
  return {
    audio, starts, listeners, plugin, callId, snapshot, emit,
    start: () => audio.start(() => {}),
    choose: async (id: number, type: number, selected = true) => { currentRows = [row(id, type, selected)]; generation++; await audio.route(id); },
    deferResume: () => { const pending = deferred<RouteSnapshot>(); nextResume = pending.promise; return pending; },
    deferRoute: () => { const pending = deferred<RouteSnapshot>(); nextRoute = () => pending.promise; return pending; },
    failRoute: () => { nextRoute = async () => { throw Error('voice:route_failed'); }; },
    routeAction: (action: () => Promise<RouteSnapshot>) => { nextRoute = action; },
    forceNativeRoutes: (routes: CallRoute[]) => { currentRows = routes; },
    recover: async () => { await audio.pause(); dead = true; await audio.resume(); },
    preference: (): Preference => {
      const request = starts[starts.length - 1];
      if (!Object.hasOwn(request, 'preferredRouteId') && !Object.hasOwn(request, 'preferredRouteType')) return undefined;
      return { id: request.preferredRouteId!, type: request.preferredRouteType! };
    },
    freshCall: async () => { const fresh = new NativeCallAudio(callId + '-new', plugin, 100, 100, 1000); opened.push(fresh); await fresh.start(() => {}); return fresh; },
    close: async () => { await Promise.allSettled(opened.map(instance => instance.close())); },
    get generation() { return generation; }, get stops() { return stops; }, get sets() { return sets; },
  };
}
async function scenario(label: string, action: (f: ReturnType<typeof fixture>) => Promise<void>) {
  const f = fixture(label);
  try { await f.start(); await action(f); }
  catch (error) { failures.push({ round, label, error: String(error) }); const count = counts.get(label) ?? { checks: 0, failures: 0 }; count.failures++; counts.set(label, count); }
  finally { await f.close(); }
}
async function main() {
  for (round = 0; round < 30; round++) {
    await scenario('resume-route-confirmation-deadline', async f => {
      await f.audio.pause();
      const pending = f.deferResume(), deadlines: number[] = [];
      const originalTimer = globalThis.setTimeout;
      globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
        deadlines.push(delay ?? 0); return originalTimer(handler, delay, ...args);
      }) as typeof setTimeout;
      let resumed: Promise<RouteSnapshot>;
      try { resumed = f.audio.resume(); } finally { globalThis.setTimeout = originalTimer; }
      check('resume bridge allows native eight-second confirmation plus delivery margin', deadlines.some(ms => ms >= 9000), true);
      await flush(); pending.resolve(f.snapshot());
      check('delayed successful resume returns selected headset', (await resumed).routes[0]?.type, 7);
    });
    await scenario('default', async f => {
      check('fresh start sends no forced phone preference', f.preference(), undefined);
      f.emit([row(7, 7)]);
      await f.recover();
      check('passive default headset observation does not become explicit preference', f.preference(), undefined);
      check('default headset privacy survives dead-native recovery', f.starts.at(-1)?.requirePrivateRoute, true);
    });
    await scenario('default-headset-phone-fallback', async f => {
      f.forceNativeRoutes([row(1, 1)]);
      let rejected = false;try { await f.recover(); } catch { rejected = true; }
      check('phone result on private-call recreation must remain blocked', rejected, true);
    });
    for (const type of [1, 2]) await scenario(`phone-${type}`, async f => {
      await f.choose(100 + type, type);
      await f.recover();
      check(`confirmed phone type ${type} survives capture_ended restart`, f.preference(), { id: 100 + type, type });
      await f.audio.close(); await f.freshCall();
      check(`new logical call resets type ${type} preference`, f.preference(), undefined);
    });
    await scenario('unconfirmed', async f => {
      await f.choose(102, 2, false); await f.recover();
      check('unselected route result never becomes preference', f.preference(), undefined);
    });
    await scenario('failed', async f => {
      f.failRoute(); await f.audio.route(102).catch(() => {}); await f.recover();
      check('failed route without confirmation never becomes preference', f.preference(), undefined);
    });
    await scenario('failed-late-route', async f => {
      await f.choose(101, 1);
      f.failRoute(); await f.audio.route(102).catch(() => {});
      f.emit([row(102, 2)]); await f.recover();
      check('routes arriving after failed selection cannot replace prior confirmed phone choice', f.preference(), { id: 101, type: 1 });
    });
    await scenario('modern-callback-before-failure', async f => {
      await f.choose(101, 1);
      f.routeAction(async () => { f.emit([row(102, 2)]); throw Error('voice:route_failed'); });
      await f.audio.route(102).catch(() => {}); await f.recover();
      check('modern passive routes before a rejected route result cannot certify preference', f.preference(), { id: 101, type: 1 });
    });
    await scenario('unconfirmed-modern-late-route', async f => {
      await f.choose(101, 1); await f.choose(102, 2, false);
      f.emit([row(102, 2)]); await f.recover();
      check('only legacy SCO may confirm a still-unselected result through routes events', f.preference(), { id: 101, type: 1 });
    });
    await scenario('cancelled', async f => {
      await f.choose(101, 1);
      const pending = f.deferRoute();
      const request = f.audio.route(102).then(() => 'resolved', error => error.name);
      await flush(); await f.audio.cancelRouteWait();
      check('cancelled route loses bridge ownership', await request, 'AbortError');
      pending.resolve(f.snapshot([row(102, 2)])); f.emit([row(102, 2)]); await flush();
      await f.recover();
      check('cancelled late native success preserves prior confirmed preference', f.preference(), { id: 101, type: 1 });
    });
    await scenario('legacy-sco', async f => {
      f.routeAction(async () => { f.emit([], { type: 'paused', reason: 'bluetooth-connecting' }); return f.snapshot([row(-3, 7, false)]); });
      await f.audio.route(-3).catch(() => {});
      f.emit([row(-3, 7)]); await f.recover();
      check('legacy SCO routes confirmation survives dead-session restart', f.preference(), { id: -3, type: 7 });
    });
    await scenario('old-generation', async f => {
      await f.choose(101, 1);
      f.emit([row(101, 2)], { routeGeneration: f.generation - 1 }); await f.recover();
      check('older routes generation cannot rewrite confirmed intent', f.preference(), { id: 101, type: 1 });
    });
    await scenario('cross-session', async f => {
      await f.choose(101, 1); await f.recover();
      await f.choose(102, 2, false);
      f.emit([row(102, 2)], { listener: 0, routeGeneration: f.generation + 100 }); await f.recover();
      check('old listener session cannot write preference even with a higher generation', f.preference(), { id: 101, type: 1 });
    });
    await scenario('wrong-call', async f => {
      await f.choose(101, 1); await f.choose(102, 2, false);
      f.emit([row(102, 2)], { callId: f.callId + '-different' }); await f.recover();
      check('other call routes cannot write preference', f.preference(), { id: 101, type: 1 });
    });
    await scenario('aborted-late-route', async f => {
      await f.choose(101, 1); const pending = f.deferRoute(), abort = new AbortController();
      const request = f.audio.route(102, abort.signal).then(() => 'resolved', error => error.name);
      await flush(); abort.abort(); await request;
      pending.resolve(f.snapshot([row(102, 2)])); f.emit([row(102, 2)]); await f.recover();
      check('aborted request late routes cannot replace confirmed preference', f.preference(), { id: 101, type: 1 });
    });
    for (const type of [undefined, NaN, 2.5]) await scenario(`invalid-type-${String(type)}`, async f => {
      f.routeAction(async () => f.snapshot([{ id: 102, type, label: 'synthetic-invalid', selected: true }]));
      await f.audio.route(102); await f.recover();
      check('invalid or missing selected route type never becomes preference', f.preference(), undefined);
    });
  }
  console.log(JSON.stringify({ roundsPerScenario: 30, checks, failures, cases: [...counts].map(([label, count]) => ({ label, ...count })),
    providerRequests: 0, modelTokens: 0, microphone: false, audioPlayback: false, androidRuntime: false,
    scope: 'Actual NativeCallAudio start/route/cancel/pause/resume/close with deferred native bridge doubles; no Android or device claims' }));
  if (failures.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
