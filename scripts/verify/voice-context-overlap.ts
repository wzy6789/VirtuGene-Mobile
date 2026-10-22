import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';

const before = process.argv.includes('--before');
let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; }
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
type Action = 'continue' | 'revoke' | 'pause' | 'mute' | 'end' | 'text' | 'interrupt' | 'early-failure' | 'draft';
type Options = { asr: number; context: number; jitter: number; action?: Action; ignoreAbort?: boolean };
async function scenario(options: Options) {
  let now = 0, sequence = 0, frames = 0, view: CallView | undefined;
  let callback!: (event: NativeAudioEvent) => void;
  const tasks: { at: number; run(): void }[] = [];
  const contexts: { text: string; signal: AbortSignal; at: number }[] = [];
  const requests: { stage: string; at: number }[] = [], inputs: unknown[] = [], wavHashes: string[] = [];
  let revoked = false, assertCount = 0, heardAt: number | undefined;
  const capabilities = { sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true, routes: [] };
  const delay = (ms: number, signal?: AbortSignal, ignoreAbort = false) => new Promise<void>((resolve, reject) => {
    const abort = () => { if (!ignoreAbort) reject(new DOMException('Aborted', 'AbortError')); };
    tasks.push({ at: now + ms, run: () => { signal?.removeEventListener('abort', abort); resolve(); } });
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
  const controller = new VoiceCallController('synthetic-overlap', { prepareContextDuringEndpoint: true,
    voice: '茉莉', style: '虚构人物', now: () => now, onView: value => { view = value; },
    audio: {
      start: async cb => { callback = cb; return capabilities; },
      beginPlayback: async () => { await delay(80); },
      append: async (_id, pcm) => { heardAt ??= now; frames += pcm.length / 2; return { playedFrames: frames, writtenFrames: frames }; },
      drain: async () => ({ playedFrames: frames, writtenFrames: frames, complete: true }),
      interrupt: async () => ({ playedFrames: frames, writtenFrames: frames }),
      mute: async () => {}, pause: async () => {}, close: async () => {}, setInputMode: async () => {}, resume: async () => ({ routes: [] }),
    },
    context: async (text, _exchanges, signal, _mode, _trigger, preparation) => {
      contexts.push({ text, signal, at: now }); const index = contexts.length;
      await delay(options.context, signal, options.ignoreAbort);
      if (options.action === 'early-failure' && index === 1 && now < 1200) throw new Error('synthetic-local-prepare-failure');
      await preparation?.waitForEndpoint();
      return { messages: [{ role: 'system', content: '完整虚构角色与记忆，不因提前准备删减。' }, { role: 'user', content: text }],
        assertCurrent: async () => { assertCount++; if (revoked) throw new Error('voice:context_changed'); },
        reviewSpeech: async text => text };
    },
    api: {
      recognize: async (wav, stream) => {
        const index = wavHashes.length; wavHashes.push(createHash('sha256').update(wav).digest('hex'));
        requests.push({ stage: 'asr', at: now }); stream.onRequest?.();
        if (options.action === 'draft') { stream.onText?.('不能当事实的草稿'); await delay(200, stream.signal); check(contexts.length === 0, 'draft never starts context'); }
        await delay(options.asr + options.jitter, stream.signal);
        return index === 0 ? '今天想聊一下。' : '还有明天的安排。';
      },
      dialogue: async (messages, stream) => {
        requests.push({ stage: 'dialogue', at: now }); inputs.push(messages); stream.onRequest?.();
        await delay(200, stream.signal); await stream.onText('我听着，你接着说。');
      },
      synthesize: async (text, _voice, _style, stream) => {
        requests.push({ stage: 'tts', at: now }); inputs.push(text); stream.onRequest?.();
        await delay(150, stream.signal); await stream.onPcm(new Uint8Array(480));
      },
    },
  });
  await controller.start();
  for (now = 20; now <= 6000; now += 20) {
    if (now % 100 === 0 && view?.phase !== 'ended') {
      const voiced = now <= 500 || options.action === 'continue' && now >= 1000 && now <= 1200;
      const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
      for (let i = 0; i < pcm.length; i += 2) data.setInt16(i, voiced ? 8000 : 0, true);
      callback({ type: 'capture', callId: 'synthetic-overlap', at: now + 100_000, sequence: sequence++, sampleRate: 16000,
        pcm: btoa(String.fromCharCode(...pcm)) });
    }
    if (now === 1000 && options.action && !['continue', 'early-failure', 'draft'].includes(options.action)) {
      if (options.action === 'revoke') revoked = true;
      else if (options.action === 'pause') callback({ callId: 'synthetic-overlap', type: 'paused', at: now, reason: 'synthetic-background' });
      else if (options.action === 'mute') await controller.mute(true);
      else if (options.action === 'text') await controller.setInputMode('text');
      else if (options.action === 'interrupt') await controller.interrupt();
      else if (options.action === 'end') await controller.end();
    }
    for (let cycle = 0; cycle < 5; cycle++) {
      const ready = tasks.filter(task => task.at <= now);
      for (const task of ready) { tasks.splice(tasks.indexOf(task), 1); task.run(); }
      await flush();
    }
  }
  const rows = controller.getRecords(), row = rows.at(-1);
  const successful = !options.action || ['continue', 'early-failure', 'draft'].includes(options.action);
  if (successful) {
    check(row?.heardText === '我听着，你接着说。', 'meaningful complete speech kept');
    check(requests.filter(row => row.stage === 'dialogue').length === 1 && requests.filter(row => row.stage === 'tts').length === 1, 'exactly one dialogue and synthesis');
    check(requests.find(row => row.stage === 'dialogue')!.at >= (options.action === 'continue' ? 1900 : 1200), 'no model request before final endpoint');
    if (options.action === 'continue') {
      check(row?.userText === '今天想聊一下。\n还有明天的安排。', 'continued phrase uses complete transcript');
      if (!before) {
        check(contexts[0].signal.aborted && contexts.length === 2, 'continuation aborts one early preparation and uses one final fresh preparation');
        check(row?.metrics.contextPreparationDiscarded === 1, 'discard counted once');
      }
    }
    if (!before && !options.action && options.asr < 400) {
      check(contexts.length === 1 && contexts[0].at < 1200, 'same final transcript prepared once during silence');
      check((row?.metrics.contextPreparationOverlapMs ?? 0) > 0, 'overlap recorded separately from residual wait');
    }
  } else {
    check(requests.every(row => row.stage === 'asr') && heardAt === undefined, 'cancel/revoke prevents model and playback');
    if (!before && options.action !== 'revoke') check(contexts.every(context => context.signal.aborted), 'cancelled prepared contexts lose authority');
  }
  const result = { options, before, firstPlaybackFromSpeechMs: row?.metrics.firstPlaybackFromSpeechMs,
    metrics: row?.metrics, inputHash: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'), wavHashes,
    contexts: contexts.map(row => ({ text: row.text, at: row.at, aborted: row.signal.aborted })),
    requests, assertCount, heardAt, error: view?.error };
  await controller.end(); return result;
}
async function main() {
  const strata = [];
  for (const base of [{ asr: 100, context: 300 }, { asr: 100, context: 800 }, { asr: 900, context: 300 }, { asr: 100, context: 100 }]) {
    const rows = [];
    for (let round = 0; round < 30; round++) rows.push(await scenario({ ...base, jitter: (round % 5) * 20 }));
    const sorted = rows.map(row => row.firstPlaybackFromSpeechMs!).sort((a, b) => a - b);
    strata.push({ base, count: rows.length, p50: sorted[14], p95: sorted[28], rows });
  }
  const adversarial = [];
  for (const action of ['continue', 'revoke', 'pause', 'mute', 'end', 'text', 'interrupt', 'draft'] as const) {
    adversarial.push(await scenario({ asr: 100, context: 500, jitter: 0, action, ignoreAbort: true }));
  }
  if (!before) adversarial.push(await scenario({ asr: 100, context: 50, jitter: 0, action: 'early-failure' }));
  console.log(JSON.stringify({ mode: before ? 'before' : 'after', checks, strata, adversarial,
    realApiCalls: 0, microphone: false, physicalAudio: false, scope: 'actual controller; synthetic PCM, context and transport; virtual software times only' }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
