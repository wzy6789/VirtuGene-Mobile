import assert from 'node:assert/strict';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { MimoCallClient } from '../../src/lib/voice-call/mimo';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';

const before = process.argv.includes('--before');
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
const caps = { sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true, routes: [{ id: 1, type: 2, label: 'isolated sink', selected: true }] };
function fixture(id: string) {
  let now = 0, sequence = 0, callback!: (event: NativeAudioEvent) => void, view: CallView | undefined, written = 0;
  const contextTexts: string[] = [];
  type Request = { startedAt: number; options: Parameters<MimoCallClient['recognize']>[1]; amplitudes: number[]; resolve(): void };
  const requests: Request[] = [];
  const controller = new VoiceCallController(id, { voice: '茉莉', style: '', now: () => now, onView: value => { view = value; },
    audio: { start: async cb => { callback = cb; return caps; }, beginPlayback: async () => {},
      append: async (_turn, bytes) => ({ writtenFrames: written += bytes.length / 2, playedFrames: written }),
      drain: async () => ({ writtenFrames: written, playedFrames: written, complete: true }),
      interrupt: async () => ({ writtenFrames: 0, playedFrames: 0 }), close: async () => {}, pause: async () => {}, mute: async () => {}, resume: async () => ({ routes: caps.routes }) },
    context: async text => { contextTexts.push(text); return [{ role: 'user', content: text }]; },
    api: {
      recognize: (wav, options) => new Promise((resolve, reject) => {
        const samples = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.byteLength));
        const amplitudes = [...new Set(samples)].filter(value => value !== 0);
        const request: Request = { startedAt: now, options, amplitudes, resolve: () => {
          options.signal.removeEventListener('abort', abort);
          resolve(amplitudes.map(value => ({ 8000: 'clause-one', 10000: 'clause-two', 12000: 'clause-three' })[value] ?? 'unknown').join(' '));
        } };
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        options.signal.addEventListener('abort', abort, { once: true }); requests.push(request);
      }),
      dialogue: async (_messages, options) => { await options.onText('Accepted.'); },
      synthesize: async (_text, _voice, _style, options) => { await options.onPcm(new Uint8Array(480)); },
    } });
  return { controller, requests, contextTexts, get view() { return view; }, setTime(value: number) { now = value; },
    async send(count: number, amplitude = 0, fixedReceiptTime?: number) {
      for (let i = 0; i < count; i++) {
        now = fixedReceiptTime ?? now + 100;
        const bytes = new Uint8Array(3200), data = new DataView(bytes.buffer);
        for (let offset = 0; offset < bytes.length; offset += 2) data.setInt16(offset, amplitude, true);
        callback({ callId: id, type: 'capture', sampleRate: 16000, sequence, at: ++sequence * 100, pcm: Buffer.from(bytes).toString('base64') });
        await flush();
      }
    },
    async completeAt(value: number) {
      now = value;
      // Draining may make one queued request active. Never creates a real request.
      for (let i = 0; i < 6; i++) { requests.filter(request => !request.options.signal.aborted).forEach(request => request.resolve()); await flush(); }
    },
  };
}
async function saturatedNaturalPauses() {
  const f = fixture('saturated-three-short-clauses'); await f.controller.start();
  await f.send(3, 8000); await f.send(3);
  await f.send(3, 10000); await f.send(3);
  await f.send(3, 12000); await f.send(7);
  const endpoint = { phase: f.view?.phase, error: f.view?.error, requestCount: f.requests.length, firstAsrPendingMs: 2200 - f.requests[0].startedAt };
  await f.completeAt(2600);
  const rows = f.controller.getRecords();
  const normalizedText = f.contextTexts.join(' ').replace(/\s+/g, ' ').trim();
  const lostSpeech = normalizedText !== 'clause-one clause-two clause-three';
  if (before) {
    assert.equal(endpoint.error, 'voice:utterance_queue_full'); assert.equal(lostSpeech, true);
  } else {
    assert.notEqual(endpoint.phase, 'error'); assert.equal(lostSpeech, false);
    assert.equal(f.contextTexts.length, 1); assert.equal(f.requests.length, 2);
    assert.equal(rows.length, 1); assert.equal(rows[0].interrupted, false);
    assert.deepEqual(f.requests.map(request => request.amplitudes), [[8000], [10000, 12000]]);
  }
  const result = { endpoint, lostSpeech, normalizedText, requests: f.requests.map(request => ({ startedAt: request.startedAt, amplitudes: request.amplitudes, abortedBeforeHangup: request.options.signal.aborted })), records: rows.map(row => ({ userText: row.userText, heardText: row.heardText, interrupted: row.interrupted })) };
  await f.controller.end(); return result;
}
async function lateContinuationDiagnostic() {
  const f = fixture('new-speech-after-800ms-while-asr-incomplete'); await f.controller.start();
  await f.send(5, 8000); await f.send(8); // First speech ends, ASR still in flight.
  await f.send(5, 12000); await f.send(7); await f.completeAt(2700);
  const rows = f.controller.getRecords();
  const result = { scenario: 'New speech after 800ms pause while the first ASR has not completed.', firstRequestAborted: f.requests[0].options.signal.aborted,
    firstClauseMissing: !rows.some(row => row.userText.includes('clause-one')), contextTexts: f.contextTexts, records: rows.map(row => ({ userText: row.userText, interrupted: row.interrupted })) };
  if (before) assert.equal(result.firstClauseMissing, true);
  else {
    assert.equal(result.firstRequestAborted, false); assert.equal(result.firstClauseMissing, false);
    assert.equal(rows.length, 1); assert.equal(rows[0].interrupted, false);
    assert.equal(f.contextTexts.join(' ').replace(/\s+/g, ' ').trim(), 'clause-one clause-three');
  }
  await f.controller.end(); return result;
}
async function delayedCaptureDiagnostic() {
  const f = fixture('delayed-capture-burst'); await f.controller.start();
  // Native sample timestamps cover 100..1200ms. Delivery bursts after a 1.9s JS stall.
  await f.send(5, 8000, 1900); await f.send(7, 0, 1900); await f.completeAt(2200);
  const metrics = f.controller.getRecords()[0]?.metrics;
  await f.controller.end();
  return { scope: 'Diagnostic of the documented JS-receipt timing basis, not a physical playback assertion.', nativeLastVoicedFrameAt: 500, nativeEndpointAt: 1200, captureReceiptBurstAt: 1900, metrics };
}
async function resumedNoiseAndRepeatedClauses() {
  const results = [];
  for (const scenario of ['noise', 'repeated'] as const) {
    const f = fixture(`resumed-${scenario}`); await f.controller.start();
    await f.send(5, 8000); await f.send(8);
    if (scenario === 'noise') {
      await f.send(1, 12000);
      // Recognition completes while the 100ms fragment is still tentative.
      await f.completeAt(1450);
      assert.equal(f.contextTexts.length, 0, 'tentative continuation is not an endpoint');
      await f.send(7); await f.completeAt(2300);
      assert.equal(f.contextTexts.join(' '), 'clause-one', 'discarded noise releases the original endpoint instead of waiting forever');
      assert.equal(f.requests.length, 1, 'discarded noise has no additional ASR request');
    } else {
      await f.send(3, 10000); await f.send(8);
      await f.send(3, 12000); await f.send(7);
      await f.completeAt(4000);
      assert.equal(f.contextTexts.join(' ').replace(/\s+/g, ' ').trim(), 'clause-one clause-two clause-three');
      assert.equal(f.requests.length, 2, 'not-yet-uploaded tails merge within the existing two-slot bound');
    }
    assert.equal(f.controller.getRecords().length, 1);
    assert.equal(f.controller.getRecords()[0].interrupted, false);
    results.push({ scenario, contextTexts: f.contextTexts, requests: f.requests.length, error: f.view?.error });
    await f.controller.end();
  }
  return results;
}
async function main() {
  console.log(JSON.stringify({ mode: before ? 'before' : 'after', scope: 'Actual controller with artificial PCM, isolated sink and manual ASR completion; zero network or real microphone.', realApiCalls: 0,
    saturation: await saturatedNaturalPauses(), lateContinuation: await lateContinuationDiagnostic(),
    resumedBoundaries: before ? undefined : await resumedNoiseAndRepeatedClauses(), delayedCapture: await delayedCaptureDiagnostic() }, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
