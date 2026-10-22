import { NativeCallAudio, type NativeCallPlugin, type NativeAudioEvent, type PlaybackReceipt } from '../../src/lib/voice-call/native-audio';

let checks = 0;
const failures: string[] = [];
const check = (value: unknown, label: string) => { checks++; if (!value) failures.push(label); };
const pending = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture() {
  let listener!: (event: NativeAudioEvent) => void;
  let written = 0, turn = '', generation = 7, count = 0, threshold = 960, unknown = false, partial = false;
  let supported = true, initialThreshold = 960, missingThreshold = false, missingBuffer = false, oldNative = false;
  let holdStop: ReturnType<typeof pending<PlaybackReceipt>> | undefined;
  let holdTune: ReturnType<typeof pending<PlaybackReceipt>> | undefined;
  const targets: number[] = [];
  const receipt = (): PlaybackReceipt => ({ playedFrames: partial ? 0 : written, writtenFrames: written, sampleRate: 24000,
    turnId: turn, routeGeneration: generation, ...(missingBuffer ? {} : { bufferFrames: 2400 }), ...(missingThreshold ? {} : { startThresholdFrames: threshold }),
    ...(unknown ? {} : { underrunCount: count }) });
  const plugin: NativeCallPlugin = {
    addListener: async (_name, callback) => { listener = callback; return { remove: async () => {} }; },
    start: async () => ({ routes: [], sampleRate: 16000, echoCancellation: true, noiseSuppression: true, routeGeneration: generation, playbackBufferTuning: supported }),
    beginPlayback: async options => { turn = options.turnId; written = 0; threshold = initialThreshold; return oldNative ? undefined : receipt(); },
    appendPcm: async options => { written += atob(options.pcm).length / 2; return receipt(); },
    tunePlaybackBuffer: async options => { targets.push(options.targetMs); threshold = options.targetMs * 24; return holdTune ? holdTune.promise : receipt(); },
    drain: async options => ({ ...receipt(), complete: true, throughFrame: options.throughFrame }),
    stopPlayback: async () => holdStop ? holdStop.promise : receipt(), stop: async () => {},
    heartbeat: async () => {}, mute: async () => {}, pause: async () => {}, resume: async () => ({ routes: [], routeGeneration: generation }),
    getRoutes: async () => ({ routes: [], routeGeneration: generation }), setRoute: async () => ({ routes: [], routeGeneration: generation }), requestBluetooth: async () => {},
  };
  const audio = new NativeCallAudio('buffer-synthetic', plugin, 100, 100, 100);
  const signal = new AbortController();
  return {
    audio, targets, receipt, signal,
    start: () => audio.start(() => {}),
    begin: (id: string) => audio.beginPlayback(id, signal.signal),
    append: (id: string) => audio.append(id, new Uint8Array(2400), signal.signal),
    drain: (id: string) => audio.drain(id, signal.signal, written),
    count: (n: number) => { count = n; }, unknown: (value = true) => { unknown = value; }, partial: () => { partial = true; },
    unsupported: () => { supported = false; }, oldNative: () => { oldNative = true; },
    missingThreshold: () => { missingThreshold = true; }, missingBuffer: () => { missingBuffer = true; },
    largeDefault: () => { initialThreshold = 4800; },
    changeRoute: () => { generation++; listener({ callId: 'buffer-synthetic', type: 'routes', at: 0, routeGeneration: generation, routes: [] }); },
    holdStop: () => holdStop = pending<PlaybackReceipt>(), clearStop: () => { holdStop = undefined; },
    holdTune: () => holdTune = pending<PlaybackReceipt>(),
  };
}

async function main() {
  for (let round = 0; round < 30; round++) {
    for (const mode of ['stable', 'underrun', 'cancel', 'partial', 'unknown', 'counter-reset', 'eof', 'segments', 'route',
      'unsupported', 'old-native', 'missing-threshold', 'missing-buffer', 'large-default'] as const) {
      const f = fixture();
      try {
        if (mode === 'unsupported') f.unsupported(); if (mode === 'old-native') f.oldNative();
        if (mode === 'missing-threshold') f.missingThreshold(); if (mode === 'missing-buffer') f.missingBuffer();
        if (mode === 'large-default') f.largeDefault();
        await f.start(); if (mode === 'unknown') f.unknown();
        await f.begin('one'); check(f.targets.length === 0, `${mode}: cold start adds no tuning bridge or startup wait`);
        if (mode === 'counter-reset') f.count(5);
        await f.append('one');
        if (['underrun', 'cancel', 'partial', 'route', 'unsupported', 'old-native', 'missing-threshold', 'missing-buffer', 'large-default'].includes(mode)) f.count(1);
        if (mode === 'unknown') { f.unknown(false); f.count(2); }
        if (mode === 'counter-reset') f.count(1);
        if (mode !== 'eof') await f.append('one');
        await f.drain('one');
        f.count(100); // Native underruns after EOF are expected idle, never active-supply evidence.
        if (mode === 'segments') { await f.append('one'); await f.append('one'); await f.drain('one'); }
        if (mode === 'partial') f.partial();
        await f.audio.interrupt(mode === 'cancel' ? undefined : 'one');
        if (mode === 'route') f.changeRoute();
        await f.begin('two');
        check(mode === 'underrun' ? f.targets.length === 1 && f.targets[0] === 60 : f.targets.length === 0,
          `${mode}: only completed active-supply starvation adjusts the next track`);
      } finally { await f.audio.close(); }
    }
    {
      const f = fixture(); await f.start(); await f.begin('one'); await f.append('one'); f.count(2); await f.append('one'); await f.drain('one');
      const wait = f.holdStop(); const completing = f.audio.interrupt('one'); await flush();
      f.clearStop(); await f.audio.interrupt(); wait.resolve(f.receipt()); await completing;
      await f.begin('two'); check(f.targets.length === 0, 'a cancellation racing with completion cannot train buffer history'); await f.audio.close();
    }
    {
      const f = fixture(); await f.start(); await f.begin('one'); await f.append('one'); f.count(2); await f.append('one'); await f.drain('one'); await f.audio.interrupt('one');
      const wait = f.holdTune(); const begin = f.begin('two').then(() => 'resolved', () => 'rejected'); await flush();
      f.changeRoute(); wait.resolve(f.receipt());
      check(await begin === 'rejected', 'route change invalidates an in-flight tuning result'); await f.audio.close();
    }
  }
  console.log(JSON.stringify({ checks, failures, roundsPerScenario: 30, providerRequests: 0, microphone: false, androidRuntime: false,
    scope: 'Actual NativeCallAudio + production policy with native receipts/route/cancellation doubles; no physical audio.' }));
  if (failures.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
