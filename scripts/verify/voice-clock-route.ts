import assert from 'node:assert/strict';
import { NativeCallAudio, type NativeAudioEvent, type NativeCallPlugin } from '../../src/lib/voice-call/native-audio';
import { clockSample, mapNativeTime } from '../../src/lib/voice-call/clock';
let checks = 0, now = 10_000_000_000;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function rig(config: { offset?: number; outbound?: number; inbound?: number; supported?: boolean } = {}) {
  let listener!: (event: NativeAudioEvent) => void, generation = 1, probes = 0;
  const events: NativeAudioEvent[] = [];
  const plugin: NativeCallPlugin = {
    addListener: async (_name, callback) => { listener = callback; return { remove: async () => {} }; },
    start: async () => ({ routes: [], sampleRate: 16000, echoCancellation: false, noiseSuppression: false, routeGeneration: generation, clockProbe: config.supported !== false }),
    clockProbe: async options => { probes++; now += config.outbound ?? 2; const nativeAtMs = now - (config.offset ?? 500_000); now += config.inbound ?? 20;
      return { ...options, nativeAtMs }; },
    heartbeat: async () => {}, mute: async () => {}, pause: async () => {},
    resume: async () => ({ routes: [], routeGeneration: ++generation }),
    beginPlayback: async () => {}, appendPcm: async () => ({ playedFrames: 0, writtenFrames: 0 }),
    drain: async () => ({ playedFrames: 0, writtenFrames: 0 }), stopPlayback: async () => ({ playedFrames: 0, writtenFrames: 0 }),
    stop: async () => {}, getRoutes: async () => ({ routes: [], routeGeneration: generation }),
    setRoute: async () => ({ routes: [], routeGeneration: ++generation }), requestBluetooth: async () => {},
  };
  const audio = new NativeCallAudio('clock-test', plugin);
  return { audio, plugin, events, start: () => audio.start(event => events.push(event)), emit: (event: Partial<NativeAudioEvent>) => listener({ callId: 'clock-test', type: 'capture', at: now - (config.offset ?? 500_000), sequence: 0, routeGeneration: generation, ...event }), probes: () => probes };
}
async function main() {
  for (const offset of [-1_000_000, 500_000, 8_000_000_000]) for (const [outbound, inbound] of [[2, 20], [90, 1], [0, 0]]) for (let round = 0; round < 30; round++) {
    const r = rig({ offset, outbound, inbound }); await r.start(); await flush();
    const c = r.audio.clockSnapshot();
    check(c.status === 'calibrated' && c.samples === 3 && r.probes() === 3, 'three sequential bounded samples');
    check(c.offsetMinMs! <= offset && c.offsetMaxMs! >= offset, 'asymmetric round trip encloses actual offset');
    const mapped = mapNativeTime(c, now - offset, now)!;
    check(mapped.jsEarliestMs <= now && mapped.jsLatestMs >= now && mapped.uncertaintyMs === outbound + inbound, 'large native/JS origin offset mapped by interval');
    r.emit({}); check(r.events.at(-1)?.timing?.basis === 'bridge-roundtrip', 'accepted event has bounded mapping');
    for (let i = 1; i <= 10; i++) r.emit({ sequence: i });
    check(r.probes() === 3, 'PCM callbacks never probe');
    c.offsetMinMs = -99; check(r.audio.clockSnapshot().offsetMinMs !== -99, 'snapshot is detached');
    now += 30_001; check(r.audio.clockSnapshot().status === 'stale' && !mapNativeTime(r.audio.clockSnapshot(), now - offset, now), 'stale calibration cannot map');
    await r.audio.close();
  }
  for (const bad of [NaN, Infinity, -1]) check(!clockSample(bad, now, now + 1), 'invalid native clock');
  check(!clockSample(1, now, now + 251) && !clockSample(1, now + 1, now), 'over-budget and reversed RTT rejected');
  {
    const r = rig(); await r.start(); await flush();
    check(!mapNativeTime(r.audio.clockSnapshot(), now + 10_000, now), 'future native clock jump is not mapped as an observation');
    await r.audio.close();
  }
  {
    const r = rig({ supported: false }); await r.start(); await flush();
    check(r.probes() === 0 && r.audio.clockSnapshot().status === 'unsupported', 'old capability does not attempt unsupported bridge');
    check(r.events.some(e => e.type === 'clock' && e.clock?.status === 'unsupported'), 'unsupported is observable'); await r.audio.close();
  }
  for (const fault of ['wrong-call', 'wrong-sequence', 'old-generation', 'missing-native', 'jump']) {
    const r = rig(); let count = 0;
    r.plugin.clockProbe = async options => { count++; now += 2; return { ...options, callId: fault === 'wrong-call' ? 'other' : options.callId,
      probeSequence: options.probeSequence + (fault === 'wrong-sequence' ? -1 : 0), routeGeneration: options.routeGeneration + (fault === 'old-generation' ? -1 : 0),
      nativeAtMs: fault === 'missing-native' ? undefined as unknown as number : now - 500_000 + (fault === 'jump' && count > 1 ? 1000 : 0) }; };
    await r.start(); await flush(); check(r.audio.clockSnapshot().status === 'failed', `invalid ${fault} is diagnostic failure only`);
    check(!r.events.some(e => e.type === 'paused'), 'calibration failure cannot pause a call'); await r.audio.close();
  }
  for (const action of ['pause', 'close', 'route']) {
    const r = rig(); let resolve!: (value: any) => void, options: any;
    r.plugin.clockProbe = async value => { options = value; return new Promise(done => { resolve = done; }); };
    await r.start(); const oldResolve = resolve, oldOptions = options;
    check(r.probes() === 0 && r.audio.clockSnapshot().status === 'calibrating', 'start does not wait for outstanding diagnostic');
    if (action === 'pause') await r.audio.pause(); else if (action === 'close') await r.audio.close(); else await r.audio.route(2);
    const events = r.events.length;
    oldResolve({ ...oldOptions, nativeAtMs: now - 500_000 }); await flush();
    check(!r.events.slice(events).some(e => e.type === 'clock' && e.clock?.routeGeneration === oldOptions.routeGeneration), 'stale calibration callback has no owner');
    if (action === 'pause') { r.plugin.clockProbe = async value => ({ ...value, nativeAtMs: now - 500_000 }); await r.audio.resume(); await flush(); check(r.audio.clockSnapshot().status === 'calibrated' && r.audio.clockSnapshot().routeGeneration === 2, 'explicit resume recalibrates new generation'); }
    if (action !== 'close') await r.audio.close();
  }
  {
    const r = rig(); let resolve!: (value: any) => void, oldOptions: any;
    r.plugin.clockProbe = async options => { oldOptions = options; return new Promise(done => { resolve = done; }); };
    await r.start(); const oldResolve = resolve, options = oldOptions; await r.audio.close();
    r.plugin.clockProbe = async value => ({ ...value, nativeAtMs: now - 500_000 });
    await r.start(); await flush(); const current = r.audio.clockSnapshot(), eventCount = r.events.length;
    oldResolve({ ...options, nativeAtMs: now - 500_000 }); await flush();
    check(current.serial !== 1 && r.audio.clockSnapshot().serial === current.serial && r.events.length === eventCount, 'same call ID restart rejects old serial result');
    await r.audio.close();
  }
  for (const failure of ['mute', 'interrupt', 'route']) {
    const r = rig(); await r.start(); await flush();
    if (failure === 'mute') r.plugin.mute = async () => { throw new Error('voice:test'); };
    else if (failure === 'interrupt') r.plugin.stopPlayback = async () => { throw new Error('voice:test'); };
    else r.plugin.setRoute = async () => { throw new Error('voice:test'); };
    try { if (failure === 'mute') await r.audio.mute(true); else if (failure === 'interrupt') await r.audio.interrupt(); else await r.audio.route(2); } catch {}
    check(r.audio.clockSnapshot().status === 'unknown', 'failed audio operation invalidates suspended timing'); await r.audio.close();
  }
  for (const method of ['append', 'drain']) {
    const r = rig(); await r.start(); await flush(); const signal = new AbortController(); await r.audio.beginPlayback('turn', signal.signal);
    r.plugin.appendPcm = async () => ({ playedFrames: 0, writtenFrames: 1, routeGeneration: 0 });
    r.plugin.drain = async () => ({ playedFrames: 1, writtenFrames: 1, complete: true, routeGeneration: 0 });
    let rejected = false; try { if (method === 'append') await r.audio.append('turn', new Uint8Array(2), signal.signal); else await r.audio.drain('turn', signal.signal); }
    catch (error) { rejected = (error as Error).name === 'AbortError'; }
    check(rejected && r.audio.clockSnapshot().routeGeneration === 1, 'late playback receipt cannot advance route ownership'); await r.audio.close();
  }
  {
    const r = rig(); await r.start(); await flush(); now += 30_001; await new Promise(done => setTimeout(done, 520)); await flush();
    check(r.probes() === 6 && r.audio.clockSnapshot().status === 'calibrated', 'existing heartbeat performs one bounded refresh after expiry');
    await r.audio.close();
  }
  {
    const r = rig(); let resolve!: (value: any) => void; let options: any;
    r.plugin.clockProbe = async value => { options = value; return new Promise(done => { resolve = done; }); };
    await r.start(); await new Promise(done => setTimeout(done, 280)); await flush();
    check(r.audio.clockSnapshot().status === 'failed' && r.audio.clockSnapshot().attempts === 1, 'one timed out probe ends bounded group');
    const events = r.events.length; resolve({ ...options, nativeAtMs: now - 500_000 }); await flush(); check(r.events.length === events, 'late timed-out result cannot publish'); await r.audio.close();
  }
  console.log(JSON.stringify({ checks, apiCalls: 0, microphone: false, scenarios: 270, scope: 'Actual NativeCallAudio and clock mapping with controlled clocks/bridge; no Android runtime or acoustic timing' }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
