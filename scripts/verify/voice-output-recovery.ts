import assert from 'node:assert/strict';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
let checks = 0;
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks++; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
async function run(mode: 'paused' | 'tts-error') {
  let now = 0, sequence = 0, callback!: (event: NativeAudioEvent) => void, view!: CallView, asr = 0, turns = 0;
  let turnId = '', written = 0;
  const controller = new VoiceCallController(mode, { voice: 'synthetic', style: '', now: () => now, onView: v => { view = v; }, context: async () => [],
    api: { recognize: async () => { asr++; return '合成测试'; }, dialogue: async (_m, stream) => { await stream.onText('合成回答。'); },
      synthesize: async (_t, _v, _s, stream) => { await stream.onPcm(new Uint8Array(9600));
        if (mode === 'tts-error' && turns === 1) throw Error('voice:tts_empty'); }, },
    audio: { start: async cb => { callback = cb; return { sampleRate: 16000, echoCancellation: false, noiseSuppression: true,
      routes: [{ id: 1, type: 2, label: 'synthetic', selected: true }] }; },
      beginPlayback: async id => { turnId = id; written = 0; turns++; }, append: async (_id, pcm) => { written += pcm.length / 2; return { turnId, writtenFrames: written, playedFrames: 1 }; },
      drain: async (_id, signal) => new Promise((resolve, reject) => {
        if (turns > 1) resolve({ turnId, writtenFrames: written, playedFrames: written, complete: true });
        else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
      interrupt: async () => ({ turnId, writtenFrames: written, playedFrames: Math.min(1, written) }),
      pause: async () => {}, mute: async () => {}, resume: async () => ({ routes: [{ id: 1, type: 2, label: 'synthetic', selected: true }] }), close: async () => {},
    } });
  const speech = async () => {
    for (let i = 0; i < 12; i++) {
      now += 100; const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
      for (let j = 0; j < pcm.length; j += 2) data.setInt16(j, i < 5 ? 8000 : 0, true);
      callback({ callId: mode, type: 'capture', at: now, sequence: sequence++, sampleRate: 16000, pcm: btoa(String.fromCharCode(...pcm)) }); await flush();
    }
  };
  await controller.start(); await speech(); await flush();
  if (mode === 'paused') { check(view.phase === 'playing', 'paused case has already queued speaker audio'); callback({ callId: mode, type: 'paused', at: now, reason: 'audio-focus' }); await flush(); }
  else check(view.phase === 'error', 'TTS failed after its first speaker PCM');
  await controller.resume(); check(view.phase === 'listening', `${mode}: explicit resume confirmed`);
  await speech(); await flush();
  check(asr === 2, `${mode}: restored no-AEC speaker accepts a new real voice turn`);
  check(controller.getRecords().at(-1)?.heardText === '合成回答。', `${mode}: new voice reply completes after recovery`);
  await controller.end(); return { mode, asr, turns };
}
async function main() { const rows = [await run('paused'), await run('tts-error')]; console.log(JSON.stringify({ checks, rows, apiCalls: 0, microphone: false, physicalAudio: false })); }
void main().catch(error => { console.error(error); process.exitCode = 1; });
