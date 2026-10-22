import assert from 'node:assert/strict';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
import type { MimoCallClient } from '../../src/lib/voice-call/mimo';
import { UtteranceGate } from '../../src/lib/voice-call/utterance';

const before = process.argv.includes('--before');
let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; }
async function flush() { for (let n = 0; n < 50; n++) await Promise.resolve(); }
const caps = { sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true,
  routes: [{ id: 1, type: 2, label: '外放', selected: true }, { id: 3, type: 7, label: '蓝牙', selected: false }] };
function audioEvent(id: string, sequence: number, at: number, amplitude = 0): NativeAudioEvent {
  const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
  for (let n = 0; n < pcm.length; n += 2) data.setInt16(n, amplitude, true);
  return { callId: id, type: 'capture', sampleRate: 16000, pcm: btoa(String.fromCharCode(...pcm)), sequence, at };
}

// Same source PCM and stage durations before/after. Virtual time models latency,
// not provider throughput, real network, Android scheduling or physical sound.
async function latencyScenario(asrMs: number, setupMs: number, ttsMs: number) {
  let now = 0, sequence = 0, callback!: (event: NativeAudioEvent) => void, frames = 0, view: CallView | undefined;
  const deadlines: { at: number; resolve(): void }[] = [];
  const delay = (ms: number) => new Promise<void>(resolve => deadlines.push({ at: now + ms, resolve }));
  const requests: { stage: string; at: number }[] = [], wavs: number[][] = [];
  const controller = new VoiceCallController('latency', { voice: '茉莉', style: '', now: () => now, onView: v => { view = v; },
    audio: { start: async cb => { callback = cb; return caps; },
      beginPlayback: async () => { requests.push({ stage: 'track', at: now }); await delay(setupMs); },
      append: async (_id, pcm) => ({ writtenFrames: frames += pcm.length / 2, playedFrames: frames, sampleRate: 24000 }),
      drain: async () => ({ writtenFrames: frames, playedFrames: frames, sampleRate: 24000, complete: true }),
      interrupt: async () => ({ writtenFrames: frames, playedFrames: frames }), close: async () => {}, mute: async () => {}, resume: async () => ({ routes: [] }) },
    context: async text => { requests.push({ stage: 'context', at: now }); await delay(200); return [{ role: 'user', content: text }]; },
    api: { recognize: async wav => { wavs.push([...wav.subarray(44)]); requests.push({ stage: 'asr', at: now }); await delay(asrMs); return '我今天想和你聊聊天。'; },
      dialogue: async (_messages, options) => { requests.push({ stage: 'dialogue', at: now }); await delay(300); await options.onText('我听着，你说吧。'); },
      synthesize: async (_text, _voice, _style, options) => { requests.push({ stage: 'tts', at: now }); await delay(ttsMs); await options.onPcm(new Uint8Array(480)); } } });
  await controller.start();
  for (now = 100; now <= 8000 && !controller.getRecords().length; now += 100) {
    callback(audioEvent('latency', sequence++, now, now <= 500 ? 8000 : 0));
    for (let cycle = 0; cycle < 8; cycle++) {
      const ready = deadlines.filter(item => item.at <= now);
      ready.forEach(item => { deadlines.splice(deadlines.indexOf(item), 1); item.resolve(); });
      await flush();
    }
  }
  const row = controller.getRecords()[0];
  check(!!row && view?.phase === 'listening', 'same-condition simulated call completes');
  check(row.userText === '我今天想和你聊聊天。' && row.heardText === '我听着，你说吧。', 'real turn and heard content stay identical');
  check(requests.filter(x => x.stage === 'asr').length === 1 && wavs[0].length === 22400, 'ordinary pause uploads each voiced frame once, with only 200ms silent tail');
  check(requests.find(x => x.stage === 'dialogue')!.at >= 1200, 'never answers during the 700ms continuation grace period');
  if (!before) {
    check(requests.find(x => x.stage === 'asr')!.at === 800, 'ASR starts within the callback covering 240ms silence');
    check(requests.find(x => x.stage === 'track')!.at === requests.find(x => x.stage === 'tts')!.at, 'track creation overlaps the TTS request');
    check(row.metrics.firstPlaybackFromSpeechMs! <= 700 + Math.max(0, asrMs - 400) + 200 + 300 + Math.max(setupMs, ttsMs), 'first output follows overlapped critical path, not serial stages');
  }
  await controller.end();
  return { delays: { asrMs, contextMs: 200, firstTextMs: 300, setupMs, ttsMs }, requests, metrics: row.metrics };
}

async function continuationAndCancellation() {
  type Recognition = { wav: Uint8Array; options: Parameters<MimoCallClient['recognize']>[1]; finish(text: string): void };
  for (const action of ['continue', 'short-tail', 'interrupt', 'mute', 'pause', 'route', 'text', 'end', 'failure'] as const) {
    let callback!: (event: NativeAudioEvent) => void, sequence = 0, now = 0, frames = 0, dialogue = 0, contextText = '', view: CallView | undefined;
    const requests: Recognition[] = [];
    const controller = new VoiceCallController(action, { voice: '茉莉', style: '', now: () => now, onView: v => { view = v; },
      audio: { start: async cb => { callback = cb; return caps; }, beginPlayback: async () => {}, setInputMode: async () => {}, route: async () => ({ routes: [] }),
        append: async (_id, pcm) => ({ writtenFrames: frames += pcm.length / 2, playedFrames: frames }),
        drain: async () => ({ writtenFrames: frames, playedFrames: frames, complete: true }),
        interrupt: async () => ({ writtenFrames: frames, playedFrames: frames }), close: async () => {}, mute: async () => {}, pause: async () => {}, resume: async () => ({ routes: [] }) },
      context: async text => { contextText = text; return [{ role: 'user', content: text }]; },
      api: { recognize: (wav, options) => new Promise((resolve, reject) => {
        requests.push({ wav, options, finish: text => resolve(text) });
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        if (action === 'failure') reject(new Error('voice:network'));
      }), dialogue: async (_m, options) => { dialogue++; await options.onText('听完整了。'); },
      synthesize: async (_t, _v, _s, options) => { await options.onPcm(new Uint8Array(480)); } } });
    const send = async (count: number, amplitude = 0) => {
      for (let n = 0; n < count; n++) { now += 100; callback(audioEvent(action, sequence++, now, amplitude)); await flush(); }
    };
    await controller.start(); await send(5, 8000); await send(3);
    check(requests.length === 1 && dialogue === 0, `${action}: early ASR does not start a dialogue`);
    if (action === 'failure') {
      check(view?.phase === 'error' && dialogue === 0 && controller.getRecords().every(x => !x.userText && !x.heardText), 'early recognition failure retains the error without inventing speech');
    } else if (action === 'continue' || action === 'short-tail') {
      requests[0].finish('实际前半句'); await flush();
      if (action === 'short-tail') {
        // One real 20ms frame inside the native 100ms callback, not a new
        // 80ms start gate. A continuing word must survive this boundary.
        const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
        for (let n = 0; n < 640; n += 2) data.setInt16(n, 12000, true);
        now += 100; callback({ ...audioEvent(action, sequence++, now), pcm: btoa(String.fromCharCode(...pcm)) }); await flush();
      } else await send(3, 12000);
      await send(7);
      check(requests.length === 2 && dialogue === 0, 'continuation remains in the same turn until the tail recognition completes');
      const samples = requests.flatMap(row => Array.from(new Int16Array(row.wav.buffer.slice(row.wav.byteOffset + 44, row.wav.byteOffset + row.wav.byteLength))));
      check(samples.filter(x => x === 8000).length === 8000 && samples.filter(x => x === 12000).length === (action === 'short-tail' ? 320 : 4800), 'all first and continuing voiced samples are uploaded exactly once');
      check(samples.indexOf(12000) > samples.lastIndexOf(8000), 'voiced continuation follows the prefix in original order');
      requests[1].finish('实际后半句'); await flush();
      check(dialogue === 1 && contextText === '实际前半句\n实际后半句' && controller.getRecords().length === 1, 'one contextual reply includes both completed transcripts');
      check(controller.getRecords()[0].metrics.vadWaitMs === (action === 'short-tail' ? 780 : 700), 'continuation uses last voiced frame plus actual native callback batching for latency');
    } else {
      requests[0].options.onText?.('尚未确认的草稿');
      if (action === 'pause') callback({ callId: action, type: 'paused', reason: 'background', at: now });
      else if (action === 'mute') await controller.mute(true);
      else if (action === 'route') await controller.selectRoute(3);
      else if (action === 'text') await controller.setInputMode('text');
      else await controller[action]();
      await flush(); requests[0].finish('迟到的转写'); await flush();
      check(requests[0].options.signal.aborted && dialogue === 0 && controller.getRecords().every(x => !x.userText && !x.heardText), `${action}: cancellation discards late ASR and unconfirmed drafts`);
    }
    await controller.end();
  }
  const gate = new UtteranceGate(); const events: string[] = [];
  for (let n = 0; n < 4; n++) events.push(gate.push(.08));
  for (let n = 0; n < 35; n++) events.push(gate.push(0));
  check(!events.includes('recognize') && events.includes('discard'), 'short noise has no early paid ASR');
  for (let repeat = 0; repeat < 4; repeat++) {
    for (let n = 0; n < 15; n++) events.push(gate.push(.08));
    for (let n = 0; n < 20; n++) events.push(gate.push(0));
  }
  check(events.filter(x => x === 'recognize').length === 2, 'repeated hesitation permits at most two early prefixes, including a resumed final clause');
  const saturated = new UtteranceGate();
  for (let n = 0; n < 15; n++) saturated.push(.08);
  const waiting = Array.from({ length: 25 }, () => saturated.push(0, 20, false));
  check(!waiting.includes('recognize') && !waiting.includes('end'), 'early recognition defers when the ASR queue has no room');
  check(saturated.push(0) === 'recognize', 'a freed ASR slot can use the remaining continuation grace period');
  const segmented = new UtteranceGate(700, 1000);
  for (let n = 0; n < 50; n++) segmented.push(.08);
  const following = Array.from({ length: 35 }, () => segmented.push(0));
  check(!following.includes('recognize') && following.includes('end'), 'a forced PCM boundary already starts recognition; silence cannot add another early request');
}

async function setupBoundary() {
  for (const fail of [false, true]) {
    let release!: () => void, rejectSetup!: (error: Error) => void, started = 0, appended = 0, signal: AbortSignal | undefined, view: CallView | undefined;
    const controller = new VoiceCallController(`setup-${fail}`, { inputMode: 'text', voice: '茉莉', style: '', onView: v => { view = v; }, context: async () => [],
      audio: { start: async () => caps, beginPlayback: async () => new Promise<void>((resolve, reject) => { release = resolve; rejectSetup = reject; }),
        append: async () => { appended++; return { writtenFrames: 240, playedFrames: 240 }; }, drain: async () => ({ writtenFrames: 240, playedFrames: 240, complete: true }),
        interrupt: async () => ({ writtenFrames: 0, playedFrames: 0 }), close: async () => {}, mute: async () => {}, resume: async () => ({ routes: [] }) },
      api: { recognize: async () => '', dialogue: async (_m, options) => { await options.onText('我在听。'); },
        synthesize: async (_t, _v, _s, options) => { started++; signal = options.signal; await options.onPcm(new Uint8Array(480)); } } });
    await controller.start(); const sending = controller.sendText('听得到吗？'); await flush();
    check(started === 1 && appended === 0 && view?.phase === 'generating', 'TTS starts during pending setup, but never appends or claims sound before setup');
    if (fail) rejectSetup(new Error('voice:audio_start_failed')); else release();
    await sending; await flush();
    check(fail ? signal!.aborted && appended === 0 && view?.phase === 'error' : appended === 1 && view?.phase === 'listening', 'setup failure cancels TTS; successful setup authorizes ordered playback');
    await controller.end();
  }
}

async function overlapSentences() {
  for (const cancel of [false, true]) {
    let finishFirst!: () => void, finishDrain!: () => void, requests = 0, appends = 0, written = 0, drains = 0;
    const signals: AbortSignal[] = [];
    const controller = new VoiceCallController(`overlap-${cancel}`, { inputMode: 'text', voice: '茉莉', style: '', onView: () => {}, context: async () => [],
      audio: { start: async () => caps, beginPlayback: async () => {},
        append: async (_id, pcm) => { appends++; written += pcm.length / 2; return { writtenFrames: written, playedFrames: 0 }; },
        drain: async () => { if (++drains === 1) await new Promise<void>(resolve => { finishDrain = resolve; }); return { writtenFrames: written, playedFrames: written, complete: true }; },
        interrupt: async () => ({ writtenFrames: written, playedFrames: 0 }), close: async () => {}, mute: async () => {}, resume: async () => ({ routes: [] }) },
      api: { recognize: async () => '', dialogue: async (_m, options) => { await options.onText('第一句。第二句。第三句。'); },
        synthesize: async (_t, _v, _s, options) => {
          const index = ++requests; signals.push(options.signal);
          await options.onPcm(new Uint8Array(480));
          if (index === 1) await new Promise<void>((resolve, reject) => {
            finishFirst = resolve; options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          });
        } } });
    await controller.start(); const sent = controller.sendText('继续说吧。'); await flush();
    check(requests === 2 && appends === 1 && drains === 0, 'one next TTS request starts while first synthesis is still streaming; future PCM remains blocked');
    if (cancel) {
      await controller.interrupt(); await sent;
      check(signals.every(x => x.aborted) && appends === 1 && requests === 2 && !controller.getRecords()[0].heardText, 'interrupt cancels both streams and cannot certify unheard future speech');
    } else {
      finishFirst(); await flush();
      check(!!finishDrain && requests === 2 && appends === 1, 'next PCM waits for the full previous playback receipt');
      finishDrain(); await sent; await flush();
      check(requests === 3 && appends === 3 && controller.getRecords()[0].heardText === '第一句。第二句。第三句。', 'prefetch preserves sentence order and full per-sentence playback evidence');
    }
    await controller.end();
  }
}

async function synthesisFailsDuringSetup() {
  let finishSetup!: () => void, appends = 0, stops = 0, view: CallView | undefined;
  const controller = new VoiceCallController('setup-network-failure', { inputMode: 'text', voice: '茉莉', style: '', onView: v => { view = v; }, context: async () => [],
    audio: { start: async () => caps, beginPlayback: async () => new Promise<void>(resolve => { finishSetup = resolve; }),
      append: async () => { appends++; return { writtenFrames: 1, playedFrames: 1 }; }, drain: async () => ({ writtenFrames: 1, playedFrames: 1, complete: true }),
      interrupt: async () => { stops++; return { writtenFrames: 0, playedFrames: 0 }; }, close: async () => {}, mute: async () => {}, resume: async () => ({ routes: [] }) },
    api: { recognize: async () => '', dialogue: async (_m, options) => { await options.onText('不能播出的回答。'); }, synthesize: async () => { throw new Error('voice:service'); } } });
  await controller.start(); const sent = controller.sendText('你好。'); await flush(); finishSetup(); await sent; await flush();
  check(appends === 0 && stops > 0 && view?.error === 'voice:service' && !controller.getRecords()[0].heardText, `TTS failure before late track setup prevents audio and cleans output while preserving the original error: ${JSON.stringify({appends, stops, view, rows: controller.getRecords()})}`);
  await controller.end();
}

async function main() {
  const scenarios = [];
  for (const delays of [[500, 300, 400], [100, 300, 400], [900, 100, 200]]) scenarios.push(await latencyScenario(...delays as [number, number, number]));
  if (!before) { await continuationAndCancellation(); await setupBoundary(); await overlapSentences(); await synthesisFailsDuringSetup(); }
  console.log(JSON.stringify({ mode: before ? 'before' : 'after', checks, scenarios, realApiCalls: 0, modelTokens: 0,
    scope: 'actual controller and PCM gate; virtual clock and simulated network/audio; not Android or real provider latency' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
