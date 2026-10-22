import assert from 'node:assert/strict';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent, PlaybackReceipt } from '../../src/lib/voice-call/native-audio';

let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
async function run(kind: 'speaker' | 'aec' | 'headset' | 'before-pcm') {
  let now = 0, written = 0, tail = 0, firstEnd = Infinity, turnId = '', fired = false, injectedAt = 0;
  let callback!: (event: NativeAudioEvent) => void, view!: CallView;
  const timers: { at: number; resolve(): void }[] = [], packets: { start: number; end: number; frames: number }[] = [];
  const delay = (ms: number) => new Promise<void>(resolve => timers.push({ at: now + ms, resolve }));
  const head = () => packets.reduce((n, p) => n + Math.min(p.frames, Math.max(0, Math.floor((now - p.start) * 24))), 0);
  const receipt = (throughFrame?: number): PlaybackReceipt => ({ turnId, writtenFrames: written, playedFrames: Math.min(written, head()), sampleRate: 24000, ...(throughFrame === undefined ? {} : { throughFrame }) });
  const capture = (amplitude: number) => {
    const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
    for (let i = 0; i < pcm.length; i += 2) data.setInt16(i, amplitude, true);
    callback({ callId: kind, type: 'capture', at: now, sequence: now / 100, sampleRate: 16000, pcm: btoa(String.fromCharCode(...pcm)) });
  };
  const requests: string[] = [];
  let stops = 0;
  const controller = new VoiceCallController(kind, { voice: 'synthetic', style: '', now: () => now, onView: v => { view = v; },
    context: async text => ({ messages: [{ role: 'user', content: text }], assertCurrent: async () => {
      // A real source query may still be pending while the queued next prefix plays.
      await delay(now >= firstEnd && written > 9600 ? 240 : 20);
    } }),
    api: { recognize: async () => { requests.push('asr'); return '请继续说'; }, dialogue: async (_messages, stream) => {
      requests.push('llm'); await stream.onText('第一句话。第二句话。');
    }, synthesize: async (text, _voice, _style, stream) => {
      requests.push('tts'); await delay(kind === 'before-pcm' ? 300 : 20);
      await stream.onPcm(new Uint8Array(9600).fill(text.startsWith('第一') ? 1 : 2));
      await delay(20); await stream.onPcm(new Uint8Array(9600).fill(3));
    } }, audio: {
      start: async cb => { callback = cb; return { sampleRate: 16000, echoCancellation: kind === 'aec', noiseSuppression: true, segmentDrain: true,
        routes: [{ id: 1, type: kind === 'headset' ? 3 : 2, label: 'synthetic', selected: true }] }; },
      beginPlayback: async id => { turnId = id; }, append: async (_id, pcm, signal) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const start = Math.max(now, tail), frames = pcm.length / 2;
        packets.push({ start, end: start + frames / 24, frames }); written += frames; tail = start + frames / 24;
        if (written === 9600) firstEnd = tail;
        return receipt();
      }, drain: async (_id, _signal, target) => {
        const at = target === 9600 ? firstEnd : tail; if (at > now) await delay(at - now);
        return { ...receipt(target), complete: true };
      }, interrupt: async () => { stops++; return receipt(); }, mute: async () => {}, resume: async () => ({ routes: [] }), close: async () => {},
    } });
  await controller.start();
  // One real voice turn, using the production capture decoder and endpoint gate.
  for (let i = 0; i < 12; i++) { now += 100; capture(i < 5 ? 8000 : 0); await flush(); }
  for (; now < 9000; now += 10) {
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const timer of timers.filter(t => t.at <= now)) { timers.splice(timers.indexOf(timer), 1); timer.resolve(); }
      await flush();
    }
    const boundary = now > firstEnd && head() > 9600 && view.phase === 'generating';
    const beforePcm = kind === 'before-pcm' && !!turnId && !packets.length && view.phase === 'generating';
    if (!fired && (kind === 'before-pcm' ? beforePcm : boundary)) { fired = true; injectedAt = now; capture(8000); await flush(); }
    if (turnId) callback({ callId: kind, type: 'playback', at: now, ...receipt() });
    if (fired && controller.getRecords().length && view.phase === 'listening') break;
  }
  check(fired, `${kind}: exercised capture in the intended boundary`);
  const record = controller.getRecords()[0]; check(!!record, `${kind}: saved original exchange`);
  if (kind === 'speaker') {
    check(record.heardText === '第一句话。第二句话。', 'speaker without AEC must ignore its own audible queued prefix while UI is generating');
    check(!record.interrupted, 'speaker echo cannot interrupt the original voice turn');
  } else check(record.interrupted, `${kind}: genuine barge-in remains available when safe, including before any PCM`);
  check(requests.filter(r => r === 'asr').length === 1, `${kind}: echo/noise cannot dispatch another ASR request`);
  const result = { kind, injectedAt, heard: record.heardText, interrupted: record.interrupted, requests, stops };
  await controller.end(); return result;
}
async function main() {
  const rows = []; for (const kind of ['speaker', 'aec', 'headset', 'before-pcm'] as const) rows.push(await run(kind));
  console.log(JSON.stringify({ checks, rows, apiCalls: 0, microphone: false, physicalAudio: false }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
