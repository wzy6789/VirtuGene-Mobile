import assert from 'node:assert/strict';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent, RouteObservation } from '../../src/lib/voice-call/native-audio';
import type { NativeClockSnapshot } from '../../src/lib/voice-call/clock';
let checks = 0;
const check = (v: unknown, label: string) => { assert.ok(v, label); checks++; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
async function run(mode: 'mapped' | 'missing' | 'stale' | 'wrong-generation') {
  let now = 0, callback!: (e: NativeAudioEvent) => void, view!: CallView, written = 0, routeGeneration = 1;
  const clock: NativeClockSnapshot = { status: 'calibrated', serial: 1, routeGeneration: mode === 'wrong-generation' ? 99 : 1,
    attempts: 1, samples: 1, offsetMinMs: -1000005, offsetMaxMs: -999995, roundTripMs: 10, calibratedAtJsMs: mode === 'stale' ? -31000 : 0 };
  const routes = [{ id: 1, type: 2, label: 'PRIVATE DEVICE NAME', selected: true }, { id: 2, type: 3, label: 'OTHER PRIVATE NAME', selected: false }];
  const observation = (input = false, output = false): RouteObservation => ({ inputObserved: input, outputObserved: output,
    communicationObserved: true, ...(input ? { inputType: 3 } : {}), ...(output ? { outputType: 3 } : {}), communicationType: 3,
    observedAtMs: 1000000 + now, routeGeneration });
  const controller = new VoiceCallController(`evidence-${mode}`, { voice: 'synthetic', style: '', now: () => now,
    onView: v => { view = v; }, context: async () => [], api: {
      recognize: async () => '合成问题', dialogue: async (_m, stream) => { await stream.onText('合成回答。'); },
      synthesize: async (_t, _v, _s, stream) => { stream.onRequest?.(); await stream.onPcm(new Uint8Array(9600)); },
    }, audio: { start: async cb => { callback = cb; return { sampleRate: 16000, routes, routeGeneration, echoCancellation: true, noiseSuppression: true, routeObservation: observation() }; },
      clockSnapshot: () => ({ ...clock }), beginPlayback: async () => {}, append: async (turnId, pcm) => {
        written += pcm.length / 2;
        const getters = mode === 'mapped' ? { bufferFrames: 2400, startThresholdFrames: 960, underrunCount: 2 } : {};
        callback({ callId: `evidence-${mode}`, type: 'playback', at: 1000000 + now, turnId, playedFrames: written - 1200, writtenFrames: written, routeGeneration,
          sampleRate: 24000, ...getters, routeObservation: observation(true, true) });
        return { turnId, playedFrames: written - 1200, writtenFrames: written, sampleRate: 24000, routeGeneration,
          nativeWriteCompletedAtMs: 1000000 + now - 2, ...getters };
      }, drain: async () => ({ playedFrames: written, writtenFrames: written, sampleRate: 24000, complete: true }),
      interrupt: async () => ({ playedFrames: written, writtenFrames: written }), mute: async () => {}, close: async () => {},
      resume: async () => ({ routes, routeGeneration, routeObservation: observation() }),
      route: async () => { routeGeneration++; return { routes, routeGeneration, routeObservation: observation() }; },
    } });
  await controller.start();
  const initial = controller.getDiagnostics().events.find(e => e.stage === 'route-observed')!;
  check(initial.routeObservation?.communicationObserved && !initial.routeObservation.inputObserved && !initial.routeObservation.outputObserved,
    'selected communication route alone cannot certify actual input or output');
  callback({ callId: `evidence-${mode}`, type: 'clock', at: now, clock: { ...clock, ...({ secret: 'PRIVATE CLOCK DATA' } as object) } });
  for (let i = 0; i < 12; i++) {
    now += 100;
    const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
    for (let j = 0; j < pcm.length; j += 2) data.setInt16(j, i < 5 ? 8000 : 0, true);
    callback({ callId: `evidence-${mode}`, type: 'capture', at: 1000000 + now, pcm: btoa(String.fromCharCode(...pcm)),
      sequence: i, sampleRate: 16000, routeGeneration, captureGeneration: 1, captureFrameEnd: (i + 1) * 1600,
      captureFrameSampleRate: 16000, ...(mode === 'missing' ? {} : { captureSampleEndAtMs: 1000000 + now - 30,
        captureSampleTimeBasis: 'audio-record-timestamp-estimate' as const }), routeObservation: observation(true, false) });
    await flush();
  }
  await flush(); check(view.phase === 'listening', `${mode}: call behavior is independent of diagnostics`);
  const record = controller.getRecords()[0]; check(record?.heardText === '合成回答。', 'diagnostics never change full speech');
  check(record.metrics.speechEndedAt === 500 && record.metrics.latencyBasis === 'js-capture-receipt-with-frame-offset', 'old latency basis remains explicit and unchanged');
  check(record.metrics.playback?.peakQueuedMs === 50 && record.metrics.playback.queuedFrames === 0,
    'queue measures actual frame backlog, not the native maximum capacity or physical audio delay');
  check(record.metrics.synthesizedPcmBytes === 9600 && record.metrics.enqueuedPcmBytes === 9600 && record.metrics.ttsInputCharacters === 5,
    'received PCM, acknowledged enqueue bytes and dispatched TTS characters stay distinct');
  if (mode === 'mapped') {
    const sample = record.metrics.speechSampleClock!;
    check(sample?.jsEarliestMs === 465 && sample.jsLatestMs === 475 && sample.nativeAtMs === 1000470,
      'native sample is mapped into a JS interval, not directly subtracted across clock origins');
    sample.jsEarliestMs = -1;
    check(controller.getRecords()[0].metrics.speechSampleClock?.jsEarliestMs === 465, 'returned sample interval is an independent copy');
    check(record.metrics.playback?.bufferFrames === 2400 && record.metrics.playback.startThresholdFrames === 960 && record.metrics.playback.underrunCount === 2,
      'native observed buffer, start threshold and underruns are retained');
    const write = record.metrics.timeline?.events.find(e => e.stage === 'append-end');
    check(write?.nativeTiming?.uncertaintyMs === 10 && write.nativeTiming.nativeAtMs > 1000000 && write.nativeTiming.jsLatestMs < 10000,
      'native successful write is mapped separately from JS receipt and physical sound');
  } else {
    check(!record.metrics.speechSampleClock, `${mode}: unavailable, stale or foreign-generation sample stays unknown`);
    check(record.metrics.playback?.underrunCount === undefined && record.metrics.playback.bufferFrames === undefined,
      'missing native getters remain unknown rather than a fabricated zero underrun count');
  }
  await controller.selectRoute(2);
  let diagnostics = controller.getDiagnostics();
  for (const stage of ['route-request', 'route-confirmed', 'route-observed', 'clock-correlation', 'capture-progress', 'native-playback-progress']) {
    check(diagnostics.events.some(e => e.stage === stage), `${mode}: ${stage} recorded outside and inside turns`);
  }
  check(diagnostics.events.filter(e => e.stage === 'capture-progress').length === 1, 'capture progress is not appended on every PCM callback');
  check(!JSON.stringify(diagnostics).includes('PRIVATE') && !JSON.stringify(diagnostics).includes('合成'), 'diagnostics contain no device names, private extras, PCM or conversation text');
  const route = diagnostics.events.find(e => e.routeObservation)?.routeObservation!; route.inputObserved = true;
  check(controller.getDiagnostics().events.find(e => e.routeObservation)?.routeObservation?.inputObserved === false, 'route evidence is deeply copied');
  for (let i = 0; i < 200; i++) callback({ callId: `evidence-${mode}`, type: 'clock', at: now, clock });
  diagnostics = controller.getDiagnostics(); check(diagnostics.events.length === 128 && diagnostics.dropped > 0, 'whole-call evidence stays bounded');
  await controller.end(); return { mode, speechSampleClock: controller.getRecords()[0].metrics.speechSampleClock, diagnosticEvents: diagnostics.events.length };
}
async function main() {
  const rows = []; for (const mode of ['mapped', 'missing', 'stale', 'wrong-generation'] as const) rows.push(await run(mode));
  console.log(JSON.stringify({ checks, rows, apiCalls: 0, microphone: false, physicalAudio: false, nativeHardware: false }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
