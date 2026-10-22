import assert from 'node:assert/strict';
import { VoiceCallController, type CallAudioPort, type CallView } from '../../src/lib/voice-call/controller';
import { NativeCallAudio, type NativeAudioEvent, type NativeCallPlugin } from '../../src/lib/voice-call/native-audio';
import { projectCallMessages, callSummarySource, type VoiceCallRecord } from '../../src/lib/voice-call/record';
import { MimoCallClient, CallApiError } from '../../src/lib/voice-call/mimo';
import { MAX_CALL_TEXT_LENGTH, type CallInputMode } from '../../src/lib/voice-call/input';
let checks = 0;
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; };
const sleep = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(predicate: () => boolean) { for (let i = 0; i < 100; i++) { if (predicate()) return; await sleep(); } throw new Error('verification timed out'); }
const capabilities = { sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true, routes: [{ id: 1, type: 2, label: 'speaker', selected: true }, { id: 2, type: 3, label: 'headset', selected: false }] };
function capture(callId: string, sequence: number, amplitude: number): NativeAudioEvent {
  const pcm = new Uint8Array(3200), view = new DataView(pcm.buffer);
  for (let i = 0; i < pcm.length; i += 2) view.setInt16(i, amplitude, true);
  return { type: 'capture', callId, pcm: btoa(String.fromCharCode(...pcm)), sampleRate: 16000, sequence, at: sequence * 100 };
}
function segmentedSpeechFixture(id: string, ignoreAbort = false) {
  type Request = { wav: Uint8Array; options: Parameters<MimoCallClient['recognize']>[1]; completed: boolean;
    complete(text: string): void; fail(error: Error): void };
  const requests: Request[] = [], inputs: Uint8Array[] = [], usages: number[] = [];
  let callback: (event: NativeAudioEvent) => void = () => {}, view: CallView | undefined;
  let sequence = 0, frames = 0, dialogues = 0, syntheses = 0, contextText = '';
  const controller = new VoiceCallController(id, { audio: {
    start: async cb => { callback = cb; return capabilities; }, beginPlayback: async () => { frames = 0; },
    append: async (_turn, pcm) => { frames += pcm.length / 2; return { playedFrames: frames, writtenFrames: frames }; },
    drain: async () => ({ playedFrames: frames, writtenFrames: frames, complete: true }),
    interrupt: async () => ({ playedFrames: 0, writtenFrames: 0 }), close: async () => {}, pause: async () => {},
    mute: async () => {}, resume: async () => ({ routes: capabilities.routes }), route: async () => ({ routes: capabilities.routes }),
  }, voice: '茉莉', style: '既有说话风格', context: async text => { contextText = text; return [{ role: 'user', content: text }]; },
  onView: value => { view = value; }, onUsage: (stage, usage) => { if (stage === 'asr') usages.push(usage.inputTokens); }, api: {
    recognize: (wav, options) => new Promise<string>((resolve, reject) => {
      options.onRequest?.();
      let settled = false;
      const finish = (text?: string, error?: Error) => {
        if (settled) return; settled = true; options.signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else { request.completed = true; if (!options.signal.aborted) options.onUsage?.({ inputTokens: wav.length, outputTokens: text!.length }); resolve(text!); }
      };
      const abort = () => { if (!ignoreAbort) finish(undefined, new DOMException('Aborted', 'AbortError')); };
      const request: Request = { wav, options, completed: false, complete: text => finish(text), fail: error => finish(undefined, error) };
      requests.push(request); options.signal.addEventListener('abort', abort, { once: true }); if (options.signal.aborted) abort();
    }),
    dialogue: async (messages, options) => { dialogues++; check(messages.at(-1)?.content === contextText, 'merged speech uses the original host context'); await options.onText('合并回应。'); },
    synthesize: async (_text, voice, style, options) => { syntheses++; check(voice === '茉莉' && style === '既有说话风格', 'merged speech retains the original voice and delivery'); await options.onPcm(new Uint8Array([0, 0, 0, 0])); },
  } });
  return { controller, requests, inputs, usages, get view() { return view; }, get dialogues() { return dialogues; }, get syntheses() { return syntheses; }, get contextText() { return contextText; },
    send(count: number, speech = true) {
      for (let i = 0; i < count; i++) {
        const event = capture(id, sequence, speech ? 1000 + sequence : 0); sequence++;
        inputs.push(Uint8Array.from(atob(event.pcm!), char => char.charCodeAt(0))); callback(event);
      }
    },
    pause() { callback({ callId: id, type: 'paused', at: 0, reason: 'background' }); },
  };
}
function typedCallFixture(id: string, inputMode: CallInputMode = 'text', ignoreAbort = false) {
  type Dialogue = { options: Parameters<MimoCallClient['dialogue']>[1]; text: string; complete(text?: string): Promise<void>; fail(error: Error): void };
  let callback: (event: NativeAudioEvent) => void = () => {}, view: CallView | undefined, frames = 0, turnId = '';
  let asr = 0, syntheses = 0, resumes = 0, closes = 0, starts = 0;
  let stopWait: Promise<void> | undefined, modeWait: Promise<void> | undefined;
  const state: { failure?: 'start' | 'context' | 'tts' | 'append' | 'drain' | 'mode'; modeError?: string; holdDrain?: boolean; withdrawn?: boolean; padding?: boolean } = {};
  const startModes: CallInputMode[] = [], modeChanges: CallInputMode[] = [], stages: string[] = [], contexts: { text: string; mode?: CallInputMode; previous: readonly string[] }[] = [];
  const requests: Dialogue[] = [], drains: (() => void)[] = [];
  const completionMarkers: (string | undefined)[] = [];
  const controller = new VoiceCallController(id, { inputMode, voice: '茉莉', style: '原角色语气', audio: {
    start: async (cb, options) => { starts++; startModes.push(options?.inputMode ?? 'voice'); callback = cb; if (state.failure === 'start') throw new Error('voice:permission'); return capabilities; },
    setInputMode: async mode => { modeChanges.push(mode); const wait = modeWait; modeWait = undefined; await wait; if (state.failure === 'mode') throw new Error(state.modeError ?? 'voice:permission'); },
    beginPlayback: async turn => { frames = 0; turnId = turn; },
    append: async (_turn, pcm) => { if (state.failure === 'append') throw new Error('voice:audio_bridge_timeout'); frames += pcm.length / 2; return { turnId, playedFrames: Math.min(1, frames), writtenFrames: frames,
      ...(state.padding ? { sampleRate: 24000, startupPaddingFrames: 100, nativeQueuedFrames: 100 + frames - Math.min(1, frames) } : {}) }; },
    drain: async () => { if (state.holdDrain) { state.holdDrain = false; await new Promise<void>(resolve => { drains.push(resolve); }); } if (state.failure === 'drain') throw new Error('voice:audio_playback_receipt'); return { turnId, playedFrames: frames, writtenFrames: frames, complete: true,
      ...(state.padding ? { sampleRate: 24000, startupPaddingFrames: 100, nativeQueuedFrames: 100 } : {}) }; },
    interrupt: async completedTurnId => { completionMarkers.push(completedTurnId); const wait = stopWait; stopWait = undefined; await wait; return { turnId, playedFrames: Math.min(1, frames), writtenFrames: frames }; },
    mute: async () => {}, pause: async () => {}, close: async () => { closes++; },
    resume: async () => { resumes++; return { routes: capabilities.routes }; }, route: async () => ({ routes: capabilities.routes }),
  }, context: async (text, exchanges, _signal, mode) => {
    contexts.push({ text, mode, previous: exchanges.map(exchange => exchange.userText) });
    if (state.failure === 'context') throw new Error('voice:context_changed');
    return { messages: [{ role: 'system', content: '原角色设定、真实记忆与关系' }, { role: 'user', content: text }],
      assertCurrent: async () => { if (state.withdrawn) throw new Error('voice:source_withdrawn'); } };
  }, onView: value => { view = value; }, onRequest: stage => { stages.push(stage); }, api: {
    recognize: async (_wav, options) => { asr++; options.onRequest?.(); return '语音模式真实转写'; },
    dialogue: (messages, options) => new Promise<void>((resolve, reject) => {
      options.onRequest?.();
      const abort = () => { if (!ignoreAbort) reject(new DOMException('Aborted', 'AbortError')); };
      options.signal.addEventListener('abort', abort, { once: true });
      const cleanup = () => options.signal.removeEventListener('abort', abort);
      requests.push({ options, text: messages.at(-1)!.content, complete: async (text = '原角色语音回答。') => {
        try { await options.onText(text); options.onUsage?.({ inputTokens: 2, outputTokens: 1 }); cleanup(); resolve(); } catch (error) { cleanup(); reject(error); }
      }, fail: error => { cleanup(); reject(error); } });
    }),
    synthesize: async (_text, voice, style, options) => {
      syntheses++; options.onRequest?.();
      check(voice === '茉莉' && style === '原角色语气', 'typed input retains the character voice and delivery settings');
      if (state.failure === 'tts') throw new CallApiError('service', 'tts', 503);
      await options.onPcm(new Uint8Array([0, 0, 0, 0])); options.onUsage?.({ inputTokens: 1, outputTokens: 1 });
    },
  } });
  return { controller, state, requests, drains, startModes, modeChanges, stages, contexts, completionMarkers,
    get view() { return view; }, get asr() { return asr; }, get syntheses() { return syntheses; }, get resumes() { return resumes; }, get closes() { return closes; }, get starts() { return starts; },
    capture() { for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0)); },
    event(type: 'paused' | 'routeLost' | 'interrupted') { callback({ callId: id, type, turnId, at: 0, reason: 'background', playedFrames: 1, writtenFrames: frames }); },
    delayStop() { let release!: () => void; stopWait = new Promise<void>(resolve => { release = resolve; }); return release; },
    delayMode() { let release!: () => void; modeWait = new Promise<void>(resolve => { release = resolve; }); return release; },
  };
}
async function main() {
  let callback: (event: NativeAudioEvent) => void = () => {}, played = 0, stopped = 0, closed = 0, asr = 0, synthesis = 0;
  let view: CallView | undefined;
  const audio: CallAudioPort = {
    start: async cb => { callback = cb; return capabilities; },
    beginPlayback: async () => { played = 0; },
    append: async (_id, pcm) => { played += pcm.length / 2; return { playedFrames: played, writtenFrames: played, sampleRate: 8000 }; },
    drain: async () => ({ playedFrames: played, writtenFrames: played, complete: true, sampleRate: 8000 }),
    interrupt: async () => { stopped++; return { playedFrames: played, writtenFrames: played }; },
    mute: async () => {}, resume: async () => ({ routes: capabilities.routes }), close: async () => { closed++; },
  };
  const controller = new VoiceCallController('test-call', { audio, voice: '茉莉', style: '自然说话', onView: v => { view = v; },
    context: async (text, exchanges) => [{ role: 'system', content: '既有角色设定与记忆' }, ...exchanges.flatMap(e => [{ role: 'user' as const, content: e.userText }, { role: 'assistant' as const, content: e.heardText }]), { role: 'user', content: text }],
    api: {
      recognize: async (_wav, options) => { asr++; options.onText?.('今天天气不错'); return '今天天气不错'; },
      // The healthy flow uses dialogue; raw staging rejection has its own
      // regression in voice-call-recovery.ts.
      dialogue: async (messages, options) => { check(messages[0].content === '既有角色设定与记忆', 'controller uses host context'); await options.onText('那出去走走。'); await options.onText('别忘了带水。'); },
      synthesize: async (_text, _voice, _style, options) => { synthesis++; await options.onPcm(new Uint8Array([1, 2, 3, 4])); },
    },
  });
  await controller.start(); check(view?.phase === 'listening', 'start reaches listening after native initialization');
  for (let i = 0; i < 5; i++) callback(capture('test-call', i, 8000));
  for (let i = 5; i < 12; i++) callback(capture('test-call', i, 0));
  await until(() => view?.phase === 'listening' && view.heardText === '那出去走走。别忘了带水。');
  check(asr === 1 && synthesis === 2, 'one stop-phrase creates one ASR and streamed sentences');
  check(stopped === 1, 'a drained reply releases native playback and its progress ticker');
  await controller.mute(true); for (let i = 12; i < 30; i++) callback(capture('test-call', i, 8000));
  check(asr === 1 && view?.muted, 'muted capture makes no additional API requests');
  callback({ type: 'paused', callId: 'test-call', at: 0, reason: 'audio-focus' }); check(view?.phase === 'paused', 'audio focus loss pauses call');
  await controller.resume(); check(view?.phase === 'listening', 'explicit recovery resumes native audio');
  const exchanges = await controller.end();
  check(closed === 1 && exchanges.length === 1 && exchanges[0].heardText === '那出去走走。别忘了带水。', 'hangup releases native audio and returns completed listening facts');
  check(exchanges[0].generatedText === '那出去走走。别忘了带水。' && !exchanges[0].heardText.includes('微笑'), 'healthy dialogue retains complete generated text and confirmed heard speech');
  check(exchanges[0].segments.every(segment => segment.playbackSampleRate === 8000), 'SCO playback acknowledgements retain their actual frame rate');
  const record: VoiceCallRecord = { id: 'test-call', sessionId: 'session', userId: 'user', characterId: 'role', startedAt: 1, endedAt: 2, voice: '茉莉', exchanges, summaryState: 'pending', messageIds: [] };
  const projected = projectCallMessages(record);
  check(projected.length === 2 && projected[1].content === exchanges[0].heardText, 'record projects acknowledged speech and user input');
  check(JSON.stringify(projected) === JSON.stringify(projectCallMessages(record)), 'projection is deterministic for idempotent persistence');
  const generatedOnly = { ...exchanges[0], heardText: '伪造已听', segments: exchanges[0].segments.map(segment => ({ ...segment, playedAt: undefined, playedFrames: 10, interrupted: true })) };
  const incomplete = { ...record, exchanges: [generatedOnly] };
  check(projectCallMessages(incomplete).length === 1 && !callSummarySource(incomplete).includes('伪造已听'), 'partial playback and UI claims cannot become assistant facts or summary input');
  check(!callSummarySource(record).includes('微笑'), 'stage instructions are absent from summary evidence');

  let pendingSynthesis: (() => void) | undefined;
  const interrupted = new VoiceCallController('interrupted-call', { audio, voice: '苏打', style: '', onView: v => { view = v; }, context: async text => [{ role: 'user', content: text }], api: {
    recognize: async () => '等一下',
    dialogue: async (_messages, options) => { await options.onText('还没有播放的回答。'); },
    synthesize: async (_text, _voice, _style, options) => { await new Promise<void>(resolve => { pendingSynthesis = resolve; }); if (!options.signal.aborted) await options.onPcm(new Uint8Array([0, 0])); },
  } });
  await interrupted.start();
  for (let i = 0; i < 5; i++) callback(capture('interrupted-call', i, 8000));
  for (let i = 5; i < 12; i++) callback(capture('interrupted-call', i, 0));
  await until(() => !!pendingSynthesis);
  check(view?.phase === 'generating' && !view.speakingText && !view.heardText, 'an empty playback track and delayed synthesis remain preparing without claiming a spoken sentence');
  let releaseStop: (() => void) | undefined;
  const originalInterrupt = audio.interrupt;
  let simultaneousStops = 0;
  audio.interrupt = async () => { simultaneousStops++; await new Promise<void>(resolve => { releaseStop = resolve; }); return { turnId: interrupted.lifecycle.receipt()[0].turnId, playedFrames: 25, writtenFrames: 100, sampleRate: 24000 }; };
  const firstStop = interrupted.interrupt(), secondStop = interrupted.interrupt();
  check(firstStop === secondStop && simultaneousStops === 1, 'simultaneous native and frontend interruptions share one stop operation');
  releaseStop!(); await Promise.all([firstStop, secondStop]); audio.interrupt = originalInterrupt; pendingSynthesis!();
  await sleep(); const partial = await interrupted.end();
  check(partial[0].metrics.firstPlaybackMs === undefined, 'cancellation before an audible receipt never invents first-playback latency');
  check(stopped > 0 && partial.length === 1 && partial[0].heardText === '' && partial[0].interrupted, 'interrupt discards unplayed generated sentence');
  check(partial[0].segments[0].interrupted, 'interrupted segment is explicitly recorded');
  check(partial[0].segments[0].playedFrames === 25 && partial[0].segments[0].playedAt === undefined, 'controller saves the final stop receipt without promoting partial speech to listening fact');

  let releaseClose: (() => void) | undefined, closeCalls = 0;
  const closing = new VoiceCallController('closing-call', { audio: { ...audio, close: async () => { closeCalls++; await new Promise<void>(resolve => { releaseClose = resolve; }); } }, voice: '茉莉', style: '', context: async () => [], onView: () => {} });
  await closing.start();
  let secondResolved = false;
  const closeOne = closing.end(), closeTwo = closing.end().then(value => { secondResolved = true; return value; });
  await sleep(); check(closeCalls === 1 && !secondResolved, 'duplicate hangup waits for the same resource release');
  releaseClose!(); await Promise.all([closeOne, closeTwo]);

  const pausedStart = new VoiceCallController('paused-start', { audio: { ...audio, start: async cb => { cb({ type: 'paused', callId: 'paused-start', at: 0, reason: 'focus-loss' }); return capabilities; } }, voice: '茉莉', style: '', context: async () => [], onView: v => { view = v; } });
  await pausedStart.start(); check(view?.phase === 'paused' && !!view.capabilities, 'focus loss during native startup remains paused instead of becoming an illegal transition');
  await pausedStart.end();
  let deniedStarts = 0;
  const permission = new VoiceCallController('permission-call', { audio: { ...audio, start: async cb => { deniedStarts++; if (deniedStarts === 1) throw new Error('voice:permission'); callback = cb; return capabilities; } }, voice: '茉莉', style: '', context: async () => [], onView: v => { view = v; } });
  await permission.start(); check(view?.phase === 'error' && deniedStarts === 1, 'permission denial becomes a recoverable error without retry');
  await permission.resume(); check(view?.phase === 'listening' && deniedStarts === 2, 'explicit permission recovery initializes a new native session');
  await permission.end();
  for (const code of ['microphone_denied', 'microphone_disabled', 'bluetooth_denied']) {
    let attempts = 0;
    const bridgePermission = new VoiceCallController(`bridge-${code}`, { audio: { ...audio,
      start: async cb => { attempts++; if (attempts === 1) throw { message: `voice:${code}` }; callback = cb; return capabilities; },
    }, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; } });
    await bridgePermission.start();
    check(view?.phase === 'error' && view.error === `voice:${code}` && attempts === 1, 'plain-object Capacitor permission error preserves its fixed code without automatic retry');
    await bridgePermission.resume();
    check(view?.phase === 'listening' && attempts === 2, 'explicit permission recovery starts a fresh native session after a bridge rejection');
    await bridgePermission.end();
  }
  let clock = 0;
  const duration = new VoiceCallController('duration-call', { audio, voice: '茉莉', style: '', context: async () => [], now: () => clock, onView: v => { view = v; } });
  await duration.start(); clock = 60 * 60_000 + 1;
  callback(capture('duration-call', 0, 8000)); await until(() => view?.phase === 'ended');
  check((await duration.end()).length === 0, 'duration limit closes a long call without submitting another ASR');
  {
    const id = 'continuous-30-second-capture'; let submitted: Uint8Array | undefined, recognitionRequests = 0;
    const longCapture = new VoiceCallController(id, { audio, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; }, api: {
      recognize: async wav => { recognitionRequests++; submitted = wav; return ''; }, dialogue: async () => {}, synthesize: async () => {},
    } });
    await longCapture.start();
    try {
      // Distinct final 500ms must not be mistaken for a silence-triggered ending.
      for (let i = 0; i < 300; i++) callback(capture(id, i, i < 295 ? 8000 : 13000));
      await until(() => !!submitted);
      check(submitted!.length === 960044 && new DataView(submitted!.buffer).getInt16(submitted!.length - 2, true) === 13000,
        '30-second continuous speech retains all PCM including the voiced final 500ms');
      check(recognitionRequests === 1, 'the bounded long utterance submits one ASR without retry');
    } finally { await longCapture.end(); }
  }
  {
    const id = 'silence-trim-capture'; let submitted: Uint8Array | undefined;
    const shortCapture = new VoiceCallController(id, { audio, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; }, api: {
      recognize: async wav => { submitted = wav; return ''; }, dialogue: async () => {}, synthesize: async () => {},
    } });
    await shortCapture.start();
    try {
      for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 13000 : 0));
      await until(() => !!submitted);
      const wav = submitted!, samples = new DataView(wav.buffer);
      check(wav.length === 22444 && samples.getInt16(44 + 15998, true) === 13000 && samples.getInt16(wav.length - 2, true) === 0,
        'silence-triggered ending preserves voiced PCM and only keeps 200ms of the silent tail');
    } finally { await shortCapture.end(); }
  }
  let metricClock = 0;
  const measured = new VoiceCallController('metrics-call', { audio: { ...audio, append: async (turnId, pcm) => {
    metricClock += 110;
    callback({ callId: 'metrics-call', type: 'playback', turnId, at: 0, first: true, playedFrames: pcm.length / 2, writtenFrames: pcm.length / 2, sampleRate: 24000 });
    return { playedFrames: pcm.length / 2, writtenFrames: pcm.length / 2, sampleRate: 24000 };
  }, drain: async () => ({ playedFrames: 2, writtenFrames: 2, complete: true, sampleRate: 24000 }) }, now: () => metricClock, voice: '茉莉', style: '', onView: v => { view = v; }, context: async () => [{ role: 'user', content: '测试' }], api: {
    recognize: async () => { metricClock += 10; return '测试'; },
    dialogue: async (_messages, options) => { metricClock += 20; await options.onText('回应。'); },
    synthesize: async (_text, _voice, _style, options) => { metricClock += 20; await options.onPcm(new Uint8Array([0, 0, 0, 0])); },
  } });
  await measured.start();
  for (let i = 0; i < 12; i++) { metricClock = (i + 1) * 100; callback(capture('metrics-call', i, i < 5 ? 8000 : 0)); await sleep(); }
  await until(() => view?.phase === 'listening' && view.heardText === '回应。');
  const timed = (await measured.end())[0].metrics;
  check(timed.vadWaitMs === 700 && timed.asrMs === 0 && timed.asrRequestMs === 10 && timed.firstTextMs === 20 && timed.firstPcmMs === 40, 'ASR request work overlaps endpoint detection; remaining ASR wait and actual request duration are distinct');
  check(timed.firstPlaybackMs === 150 && timed.firstPlaybackFromSpeechMs === 850, 'speech-to-playback includes the full 700ms grace period even when ASR finishes early');
  check(timed.llmFirstTokenMs === 20 && timed.ttsFirstChunkMs === 20, 'LLM and TTS timings are measured from their own stage starts');

  for (const source of ['event', 'append', 'drain'] as const) {
    const id = `audible-receipt-${source}`, sentence = '现在才真正说出来。';
    let releaseSynthesis!: () => void, releaseDrain!: () => void, clock = 0;
    const seen: CallView[] = [];
    const audible = new VoiceCallController(id, { audio: { ...audio,
      append: async () => ({ playedFrames: source === 'append' ? 1 : 0, writtenFrames: 2, sampleRate: 24000 }),
      drain: async () => { await new Promise<void>(resolve => { releaseDrain = resolve; }); return { playedFrames: 2, writtenFrames: 2, complete: true, sampleRate: 24000 }; },
    }, now: () => clock, voice: '茉莉', style: '', onView: value => { view = value; seen.push(value); }, context: async () => [], api: {
      recognize: async () => '说一句吧', dialogue: async (_messages, options) => { await options.onText(sentence); },
      synthesize: async (_text, _voice, _style, options) => { await new Promise<void>(resolve => { releaseSynthesis = resolve; }); await options.onPcm(new Uint8Array([0, 0, 0, 0])); },
    } });
    await audible.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    await until(() => !!releaseSynthesis);
    const turnId = audible.lifecycle.receipt()[0].turnId;
    check(view?.phase === 'generating' && !view.speakingText && seen.every(value => value.phase !== 'playing'), `${source}: pending TTS never announces currently speaking`);
    for (const invalid of [
      { playedFrames: 0, writtenFrames: 0 }, { playedFrames: 1 }, { playedFrames: 2, writtenFrames: 1 },
      { playedFrames: NaN, writtenFrames: 2 }, { playedFrames: 1, writtenFrames: 2.5 }, { playedFrames: 1, writtenFrames: 2, turnId: 'stale-turn' },
    ]) callback({ callId: id, type: 'playback', turnId, at: 0, first: true, sampleRate: 24000, ...invalid });
    check(view?.phase === 'generating' && !view.speakingText && audible.lifecycle.receipt()[0].playedFrames === 0, `${source}: first flags, missing/invalid bounds and stale events cannot claim output`);
    clock = 300; releaseSynthesis(); await until(() => !!releaseDrain);
    if (source === 'event') {
      check(view?.phase === 'generating' && !view.speakingText, 'written PCM alone does not advance to playing');
      callback({ callId: id, type: 'playback', turnId, at: 0, first: false, playedFrames: 1, writtenFrames: 2, sampleRate: 24000 });
    }
    check(source === 'drain' ? view?.phase === 'generating' && !view.speakingText : view?.phase === 'playing' && view.speakingText === sentence,
      `${source}: playing and current caption require the first positive bounded playback receipt`);
    check(!view?.heardText && audible.lifecycle.receipt()[0].playedAt === undefined, `${source}: a live caption never promotes incomplete playback into transcript`);
    clock = 500;
    if (source !== 'drain') callback({ callId: id, type: 'playback', turnId, at: 0, first: true, playedFrames: 2, writtenFrames: 2, sampleRate: 24000 });
    releaseDrain(); await until(() => view?.phase === 'listening' && view.heardText === sentence);
    const rows = await audible.end();
    check(rows[0].metrics.firstPlaybackMs === (source === 'drain' ? 500 : 300), `${source}: earliest valid receipt owns latency; duplicate first flags cannot reset it`);
    check(rows[0].heardText === sentence && rows[0].segments[0].playedAt !== undefined && seen.some(value => value.phase === 'playing' && value.speakingText === sentence), `${source}: only complete drain certifies transcript, while actual output is represented`);
  }
  for (const receipt of [
    { playedFrames: 2, writtenFrames: 2 }, { playedFrames: 1, writtenFrames: 2, complete: true },
    { playedFrames: 0, writtenFrames: 0, complete: true }, { playedFrames: 3, writtenFrames: 2, complete: true },
  ]) {
    const id = `invalid-drain-${checks}`;
    const rejected = new VoiceCallController(id, { audio: { ...audio,
      append: async () => ({ playedFrames: 0, writtenFrames: 2 }), drain: async () => receipt,
    }, voice: '茉莉', style: '', onView: value => { view = value; }, context: async () => [], api: {
      recognize: async () => '说一句吧', dialogue: async (_messages, options) => { await options.onText('等待确认。'); },
      synthesize: async (_text, _voice, _style, options) => { await options.onPcm(new Uint8Array([0, 0, 0, 0])); },
    } });
    await rejected.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    await until(() => view?.phase === 'error');
    const rows = await rejected.end();
    check(view?.error === 'voice:audio_playback_receipt' && rows[0].heardText === '' && rows[0].segments[0].playedAt === undefined,
      'missing completion, incomplete/empty drain or impossible frame bounds pause without certifying speech');
  }

  let networkAsr = 0, pauseRequests = 0, resumeRequests = 0;
  let releasePause!: () => void;
  const recovering = new VoiceCallController('network-recovery', { audio: { ...audio,
    pause: async () => { pauseRequests++; await new Promise<void>(resolve => { releasePause = resolve; }); },
    resume: async () => { resumeRequests++; return { routes: [] }; },
  }, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; }, api: {
    recognize: async () => { networkAsr++; throw new Error('voice:network'); }, dialogue: async () => {}, synthesize: async () => {},
  } });
  await recovering.start();
  for (let i = 0; i < 12; i++) callback(capture('network-recovery', i, i < 5 ? 8000 : 0));
  await until(() => pauseRequests === 1);
  check(view?.phase === 'error' && networkAsr === 1, 'request failure pauses native audio without automatically retrying');
  const recovery = recovering.resume(); await sleep();
  check(resumeRequests === 0, 'explicit recovery waits for the pending native pause');
  releasePause(); await recovery;
  check(view?.phase === 'listening' && networkAsr === 1, 'recovery clears old utterance instead of replaying it');
  await recovering.end();
  let listener: (e: NativeAudioEvent) => void = () => {}, removals = 0, bridgeStops = 0, appended = 0;
  const plugin: NativeCallPlugin = {
    addListener: async (_name, cb) => { listener = cb; return { remove: async () => { removals++; } }; },
    start: async () => capabilities, heartbeat: async () => {}, mute: async () => {}, resume: async () => ({ routes: [] }),
    beginPlayback: async () => {}, appendPcm: async () => { appended++; return { playedFrames: 1, writtenFrames: 1 }; }, drain: async () => ({ playedFrames: 1, writtenFrames: 1, complete: true }),
    stopPlayback: async () => ({ playedFrames: 0, writtenFrames: 0 }), stop: async () => { bridgeStops++; },
    getRoutes: async () => ({ routes: [] }), setRoute: async () => ({ routes: [] }), requestBluetooth: async () => {},
  };
  const bridge = new NativeCallAudio('bridge-call', plugin); let delivered = 0;
  await bridge.start(event => { if (event.type !== 'clock') delivered++; });
  listener(capture('wrong-call', 0, 8000)); listener(capture('bridge-call', 1, 8000)); listener(capture('bridge-call', 1, 8000));
  check(delivered === 1 && bridge.clockSnapshot().status === 'unsupported', 'bridge filters other calls and replayed capture; old native clock support remains explicitly unknown');
  const signal = new AbortController().signal;
  await bridge.beginPlayback('turn-1', signal);
  listener({ callId: 'bridge-call', type: 'interrupted', turnId: 'turn-1', at: 0 });
  await assert.rejects(bridge.append('turn-1', new Uint8Array([0, 0]), signal), (e: any) => e.name === 'AbortError');
  check(appended === 0, 'native interruption revokes bridge playback before late append');
  const abortController = new AbortController();
  await bridge.beginPlayback('turn-2', abortController.signal);
  plugin.appendPcm = async () => new Promise(() => {});
  const pending = bridge.append('turn-2', new Uint8Array([0, 0]), abortController.signal);
  abortController.abort();
  await assert.rejects(pending, (e: any) => e.name === 'AbortError'); checks++;
  const oldListener = listener;
  await bridge.close(); check(removals === 1 && bridgeStops === 1, 'bridge cleanup removes listener and native session');
  await bridge.start(event => { if (event.type !== 'clock') delivered++; });
  oldListener(capture('bridge-call', 0, 8000));
  listener(capture('bridge-call', 0, 8000));
  check(delivered === 3, 'fresh native capture sequence is accepted after bridge restart');
  await bridge.close(); check(removals === 2 && bridgeStops === 2, 'restarted bridge releases its replacement listener and session');
  await bridge.start(event => { if (event.type !== 'clock') delivered++; });
  let nativeMuteRequests = 0;
  plugin.mute = async options => { if (options.muted) nativeMuteRequests++; };
  await bridge.mute(true); listener(capture('bridge-call', 22, 8000));
  check(delivered === 3, 'bridge discards muted PCM even if an old native callback arrives');
  plugin.resume = async () => { throw new Error('voice:capture_ended'); };
  await bridge.resume();
  check(nativeMuteRequests === 2 && removals === 3, 'explicit dead-session recovery rebuilds audio and restores mute');
  await bridge.mute(false); listener(capture('bridge-call', 0, 8000));
  check(delivered === 4, 'recovered recorder accepts fresh sequence with the existing callback');
  plugin.resume = async () => { throw { message: 'voice:capture_ended' }; };
  await bridge.resume();
  listener(capture('bridge-call', 0, 8000));
  check(delivered === 5 && removals === 4, 'Capacitor plain-object dead-session error rebuilds recorder and accepts fresh capture');
  await bridge.close(); check(removals === 5 && bridgeStops === 5, 'recovered audio releases the new native session');
  let releaseListener: (() => void) | undefined, cancelledStarts = 0, cancelledRemovals = 0;
  const cancelledPlugin: NativeCallPlugin = { ...plugin,
    addListener: async () => { await new Promise<void>(resolve => { releaseListener = resolve; }); return { remove: async () => { cancelledRemovals++; } }; },
    start: async () => { cancelledStarts++; return capabilities; },
  };
  const cancelledBridge = new NativeCallAudio('cancelled-start', cancelledPlugin);
  const starting = cancelledBridge.start(() => {});
  await cancelledBridge.close(); releaseListener!();
  await assert.rejects(starting, (error: any) => error.name === 'AbortError'); checks++;
  check(cancelledStarts === 0 && cancelledRemovals === 1, 'closing during listener registration prevents microphone startup and removes the late listener');
  for (const onlyUnsafe of [false, true]) {
    const id = `speech-quality-${onlyUnsafe}`, spoken: string[] = [];
    const draft = '我看到了你的照片。你的声音里有点疲惫。' + (onlyUnsafe ? '' : '听你这么说，我明白了。');
    let reviews = 0;
    const checked = new VoiceCallController(id, { audio, voice: '茉莉', style: '', context: async () => ({ messages: [], reviewSpeech: async text => { reviews++; return text; } }), onView: value => { view = value; }, api: {
      recognize: async () => '今天累了', dialogue: async (_messages, options) => { await options.onText(draft); },
      synthesize: async (text, _voice, _style, options) => { spoken.push(text); await options.onPcm(new Uint8Array([0, 0])); },
    } });
    await checked.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    await until(() => onlyUnsafe ? view?.phase === 'error' : view?.heardText === '听你这么说，我明白了。');
    const rows = await checked.end();
    check(reviews > 0, 'prepared context review executes before streaming speech is queued');
    check(rows[0].generatedText === draft && !rows[0].heardText.includes('照片') && !rows[0].heardText.includes('声音里'), 'raw generation is auditable while unsupported perception is excluded from listening facts');
    check(onlyUnsafe ? spoken.length === 0 && view?.error === 'voice:reply_filtered' : spoken.join('') === '听你这么说，我明白了。', 'unsafe speech is removed before billable synthesis without replacing safe dialogue or retrying');
  }
  let crossStop!: () => void, crossSynthesis!: () => void, nativeClosed = false;
  const crossed = new VoiceCallController('crossed-end', { audio: { ...audio,
    interrupt: async () => { await new Promise<void>(resolve => { crossStop = resolve; }); return { turnId: crossed.lifecycle.receipt()[0].turnId, playedFrames: 15, writtenFrames: 50, sampleRate: 24000 }; },
    close: async () => { nativeClosed = true; },
  }, voice: '茉莉', style: '', context: async () => [], onView: () => {}, api: {
    recognize: async () => '等一下', dialogue: async (_messages, options) => { await options.onText('正在回应。'); },
    synthesize: async () => { await new Promise<void>(resolve => { crossSynthesis = resolve; }); },
  } });
  await crossed.start();
  for (let i = 0; i < 12; i++) callback(capture('crossed-end', i, i < 5 ? 8000 : 0));
  await until(() => !!crossSynthesis);
  const pendingCrossStop = crossed.interrupt(); let hangupDone = false;
  const crossEnd = crossed.end().then(rows => { hangupDone = true; return rows; }); await sleep();
  check(nativeClosed && !hangupDone, 'hangup releases audio immediately but waits for an existing stop receipt');
  crossStop(); crossSynthesis(); await pendingCrossStop; const crossRows = await crossEnd;
  check(crossRows.length === 1 && crossRows[0].segments[0].playedFrames === 15 && crossRows[0].heardText === '', 'crossed interrupt and hangup retain partial audit once without certifying listening');
  let timeoutRemovals = 0;
  const stalledBridge = new NativeCallAudio('stalled-bridge', { ...plugin,
    addListener: async () => ({ remove: async () => { timeoutRemovals++; } }),
    stopPlayback: async () => new Promise(() => {}), stop: async () => new Promise(() => {}),
  }, 10);
  await stalledBridge.start(() => {});
  await assert.rejects(stalledBridge.interrupt(), /voice:audio_bridge_timeout/); checks++;
  await assert.rejects(stalledBridge.close(), /voice:audio_bridge_timeout/); checks++;
  check(timeoutRemovals === 1, 'stalled native stop still removes its listener');
  await assert.rejects(stalledBridge.start(() => {}), /voice:audio_release_failed/); checks++;
  let cleanupResumes = 0, cleanupBegins = 0;
  const failedCleanup = new NativeCallAudio('failed-output-cleanup', { ...plugin,
    stopPlayback: async () => ({ playedFrames: 0, writtenFrames: 0, cleanupFailures: 1 }),
    resume: async () => { cleanupResumes++; return { routes: [] }; },
    beginPlayback: async () => { cleanupBegins++; }, stop: async () => {},
  });
  await failedCleanup.start(() => {});
  await assert.rejects(failedCleanup.interrupt(), /voice:audio_release_failed/); checks++;
  await assert.rejects(failedCleanup.resume(), /voice:audio_release_failed/); checks++;
  await assert.rejects(failedCleanup.beginPlayback('unsafe-replacement', new AbortController().signal), /voice:audio_release_failed/); checks++;
  check(cleanupResumes === 0 && cleanupBegins === 0, 'unconfirmed output cleanup cannot reopen capture or create another track');
  await failedCleanup.close();
  let cleanupListener!: (event: NativeAudioEvent) => void;
  const cleanupEvents: NativeAudioEvent[] = [];
  const failedNativeStop = new NativeCallAudio('native-cleanup-event', { ...plugin,
    addListener: async (_name, cb) => { cleanupListener = cb; return { remove: async () => {} }; },
    stop: async () => { throw { message: 'voice:audio_release_failed' }; },
  });
  await failedNativeStop.start(event => { if (event.type !== 'clock') cleanupEvents.push(event); });
  cleanupListener({ callId: 'native-cleanup-event', type: 'interrupted', at: 0, cleanupFailures: 1 });
  cleanupListener(capture('native-cleanup-event', 0, 8000));
  check(cleanupEvents.length === 1 && cleanupEvents[0].type === 'paused' && cleanupEvents[0].reason === 'voice:audio_release_failed',
    'native-initiated teardown failure pauses the bridge before subsequent microphone frames can start inference');
  await assert.rejects(failedNativeStop.resume(), /voice:audio_release_failed/); checks++;
  await assert.rejects(failedNativeStop.close(), (error: any) => error.message === 'voice:audio_release_failed'); checks++;
  await assert.rejects(failedNativeStop.start(() => {}), /voice:audio_release_failed/); checks++;
  const playbackPlugin: NativeCallPlugin = { ...plugin, appendPcm: async () => new Promise(() => {}), drain: async () => new Promise(() => {}), stop: async () => {} };
  const timedPlayback = new NativeCallAudio('timed-playback', playbackPlugin, 10, 10);
  await timedPlayback.start(() => {});
  await timedPlayback.beginPlayback('timed-turn', new AbortController().signal);
  await assert.rejects(timedPlayback.append('timed-turn', new Uint8Array([0, 0]), new AbortController().signal), /voice:audio_bridge_timeout/); checks++;
  await assert.rejects(timedPlayback.drain('timed-turn', new AbortController().signal), /voice:audio_bridge_timeout/); checks++;
  playbackPlugin.beginPlayback = async () => new Promise(() => {});
  await assert.rejects(timedPlayback.beginPlayback('timed-new-turn', new AbortController().signal), /voice:audio_bridge_timeout/); checks++;
  await timedPlayback.close();
  let heartbeatRequests = 0, heartbeatPauses = 0, healthyHeartbeat = false;
  const heartbeatPlugin: NativeCallPlugin = { ...plugin,
    heartbeat: async () => { heartbeatRequests++; if (!healthyHeartbeat) await new Promise<void>(() => {}); },
    resume: async () => ({ routes: [] }), stop: async () => {},
  };
  const heartbeatBridge = new NativeCallAudio('heartbeat-bounds', heartbeatPlugin, 800);
  await heartbeatBridge.start(event => { if (event.type === 'paused') heartbeatPauses++; });
  await new Promise(resolve => setTimeout(resolve, 1150));
  check(heartbeatRequests === 1 && heartbeatPauses === 0, 'slow heartbeat never overlaps the next interval request');
  await new Promise(resolve => setTimeout(resolve, 250));
  check(heartbeatPauses === 1, 'stalled heartbeat becomes a paused event at its bridge deadline');
  await new Promise(resolve => setTimeout(resolve, 550));
  check(heartbeatRequests === 1, 'heartbeat timeout pauses once and stops automatic retries');
  healthyHeartbeat = true; await heartbeatBridge.resume();
  await new Promise(resolve => setTimeout(resolve, 550));
  check(heartbeatRequests > 1 && heartbeatPauses === 1, 'explicit successful recovery restarts healthy heartbeat monitoring');
  await heartbeatBridge.close();
  let resolveResume!: (value: { routes: [] }) => void;
  const resumePlugin: NativeCallPlugin = { ...plugin, stop: async () => {},
    resume: async () => new Promise(resolve => { resolveResume = resolve; }),
  };
  const resumeBridge = new NativeCallAudio('resume-bounds', resumePlugin, 10);
  await resumeBridge.start(() => {});
  const lateResume = resumeBridge.resume();
  const rejectedLateResume = assert.rejects(lateResume, (error: any) => error.name === 'AbortError');
  await resumeBridge.close(); resolveResume({ routes: [] }); await rejectedLateResume; checks++;
  await resumeBridge.start(() => {});
  await assert.rejects(resumeBridge.resume(), /voice:audio_bridge_timeout/); checks++;
  await assert.rejects(resumeBridge.beginPlayback('after-resume-timeout', new AbortController().signal), (error: any) => error.name === 'AbortError'); checks++;
  await resumeBridge.close();
  let resolveMute!: () => void, resolveRoutes!: (value: { routes: [] }) => void, controlCapture = 0;
  const controlPlugin: NativeCallPlugin = { ...plugin,
    mute: async () => new Promise<void>(resolve => { resolveMute = resolve; }),
    getRoutes: async () => new Promise(resolve => { resolveRoutes = resolve; }),
    setRoute: async () => new Promise(() => {}), stop: async () => {},
  };
  const controlBridge = new NativeCallAudio('control-bounds', controlPlugin, 10, 18_000, 10);
  await controlBridge.start(event => { if (event.type === 'capture') controlCapture++; });
  const pendingMute = controlBridge.mute(true);
  listener(capture('control-bounds', 0, 8000));
  check(controlCapture === 0, 'requested mute immediately excludes queued native capture before acknowledgement');
  resolveMute(); await pendingMute;
  const pendingUnmute = controlBridge.mute(false);
  listener(capture('control-bounds', 1, 8000));
  check(controlCapture === 0, 'unmute keeps capture blocked until native acknowledgement');
  resolveMute(); await pendingUnmute;
  listener(capture('control-bounds', 2, 8000));
  check(controlCapture === 1, 'acknowledged unmute restores capture');
  const lateRoutes = controlBridge.routes();
  const routesRejected = assert.rejects(lateRoutes, (error: any) => error.name === 'AbortError');
  await controlBridge.close(); resolveRoutes({ routes: [] }); await routesRejected; checks++;
  await controlBridge.start(() => {});
  await assert.rejects(controlBridge.routes(), /voice:audio_bridge_timeout/); checks++;
  await assert.rejects(controlBridge.route(1), /voice:audio_bridge_timeout/); checks++;
  await assert.rejects(controlBridge.beginPlayback('route-timeout', new AbortController().signal), (error: any) => error.name === 'AbortError'); checks++;
  await controlBridge.close();
  await controlBridge.start(() => {});
  const lateMute = controlBridge.mute(true);
  const lateMuteRejected = assert.rejects(lateMute, (error: any) => error.name === 'AbortError');
  await controlBridge.close(); resolveMute(); await lateMuteRejected; checks++;
  await controlBridge.start(() => {});
  await assert.rejects(controlBridge.mute(false), /voice:audio_bridge_timeout/); checks++;
  await assert.rejects(controlBridge.beginPlayback('mute-timeout', new AbortController().signal), (error: any) => error.name === 'AbortError'); checks++;
  await controlBridge.close();
  let muteAttempt = 0, mutePause = 0, releaseMute!: () => void;
  const muteController = new VoiceCallController('mute-failure', { audio: { ...audio,
    mute: async () => { muteAttempt++; await new Promise<void>(resolve => { releaseMute = resolve; }); throw new Error('voice:audio_bridge_timeout'); },
    pause: async () => { mutePause++; },
  }, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; } });
  await muteController.start();
  const mutedRequest = muteController.mute(true);
  const mutedRejected = assert.rejects(mutedRequest, /voice:audio_bridge_timeout/);
  await muteController.mute(true);
  check(muteAttempt === 1, 'repeated mute taps cannot overlap native control requests');
  releaseMute(); await mutedRejected;
  check(view?.phase === 'error' && mutePause === 1 && !view.muted, 'failed mute pauses the real audio port without falsely acknowledging mute');
  await muteController.end();
  let releaseRoute!: (value: { routes: typeof capabilities.routes }) => void, routeRequests = 0, routeAsr = 0;
  const routeController = new VoiceCallController('routing-capture', { audio: { ...audio,
    route: async () => { routeRequests++; return new Promise(resolve => { releaseRoute = resolve; }); },
  }, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; }, api: {
    recognize: async () => { routeAsr++; return ''; }, dialogue: async () => {}, synthesize: async () => {},
  } });
  await routeController.start();
  const routeChange = routeController.selectRoute(2); await until(() => routeRequests === 1);
  for (let i = 0; i < 12; i++) callback(capture('routing-capture', i, i < 5 ? 8000 : 0));
  await routeController.selectRoute(2);
  check(routeAsr === 0 && routeRequests === 1 && view?.routing, 'route change holds capture and rejects overlapping selection');
  const newerRoutes = [{ id: 2, type: 3, label: 'headset', selected: true }];
  callback({ callId: 'routing-capture', type: 'routes', at: 0, routes: newerRoutes });
  releaseRoute({ routes: capabilities.routes }); await routeChange;
  check(view?.capabilities?.routes[0].id === 2 && !view.routing, 'old route acknowledgement cannot overwrite a newer native device event');
  for (let i = 12; i < 24; i++) callback(capture('routing-capture', i, i < 17 ? 8000 : 0));
  await until(() => routeAsr === 1);
  check(routeAsr === 1, 'fresh speech after route acknowledgement resumes normal recognition');
  await routeController.end();
  let releaseLostRoute!: (value: { routes: typeof capabilities.routes }) => void;
  const lostRouteController = new VoiceCallController('routing-loss', { audio: { ...audio,
    route: async () => new Promise(resolve => { releaseLostRoute = resolve; }),
  }, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; } });
  await lostRouteController.start();
  const lostRouteChange = lostRouteController.selectRoute(2); await until(() => !!releaseLostRoute);
  callback({ callId: 'routing-loss', type: 'routeLost', reason: 'headset-disconnected', at: 0 });
  releaseLostRoute({ routes: capabilities.routes }); await lostRouteChange;
  check(view?.phase === 'paused' && view.error === 'headset-disconnected', 'route acknowledgement cannot resume a call paused by device loss');
  await lostRouteController.end();
  let routeQueryResolvers: ((value: { routes: typeof capabilities.routes }) => void)[] = [];
  const queriedRoutes = new VoiceCallController('route-query-order', { audio: { ...audio,
    routes: async () => new Promise(resolve => { routeQueryResolvers.push(resolve); }),
  }, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; } });
  await queriedRoutes.start();
  const firstRoutes = queriedRoutes.refreshRoutes(), secondRoutes = queriedRoutes.refreshRoutes();
  routeQueryResolvers[1]({ routes: newerRoutes }); await secondRoutes;
  routeQueryResolvers[0]({ routes: capabilities.routes }); await firstRoutes;
  check(view?.capabilities?.routes[0].id === 2, 'out-of-order route queries retain the newest requested result');
  await queriedRoutes.end();
  let finishOldListener!: (handle: { remove: () => Promise<void> }) => void, registrationCount = 0, lateRemoved = 0, startStops = 0;
  const lateListenerPlugin: NativeCallPlugin = { ...plugin,
    addListener: async (_event, cb) => { registrationCount++; if (registrationCount === 1) return new Promise(resolve => { finishOldListener = resolve; }); listener = cb; return { remove: async () => {} }; },
    start: async () => capabilities, stop: async () => { startStops++; },
  };
  const lateListenerBridge = new NativeCallAudio('late-listener', lateListenerPlugin, 10);
  const oldListenerStart = lateListenerBridge.start(() => {});
  const oldListenerRejected = assert.rejects(oldListenerStart, (error: any) => error.name === 'AbortError');
  await lateListenerBridge.close(); await oldListenerRejected; checks++;
  await lateListenerBridge.start(() => {});
  finishOldListener({ remove: async () => { lateRemoved++; } }); await sleep();
  await lateListenerBridge.beginPlayback('fresh-after-listener', new AbortController().signal);
  check(lateRemoved === 1 && startStops === 1, 'late listener removes itself without stopping a replacement native session');
  await lateListenerBridge.close();
  let finishPermission!: (value: typeof capabilities) => void, permissionStartRequests = 0, permissionStops = 0;
  const waitingPermissionPlugin: NativeCallPlugin = { ...plugin,
    start: async () => { permissionStartRequests++; if (permissionStartRequests === 1) return new Promise(resolve => { finishPermission = resolve; }); return capabilities; },
    stop: async () => { permissionStops++; },
  };
  const waitingPermission = new NativeCallAudio('pending-permission', waitingPermissionPlugin, 10);
  const pendingPermissionStart = waitingPermission.start(() => {});
  const permissionCancelled = assert.rejects(pendingPermissionStart, (error: any) => error.name === 'AbortError');
  await until(() => permissionStartRequests === 1);
  await waitingPermission.close(); await permissionCancelled; checks++;
  await waitingPermission.start(() => {});
  finishPermission(capabilities); await sleep();
  await waitingPermission.beginPlayback('fresh-after-permission', new AbortController().signal);
  check(permissionStops === 1, 'late permission result cannot stop or overwrite the replacement startup');
  await waitingPermission.close();
  let finishTimedListener!: (handle: { remove: () => Promise<void> }) => void, timedListenerRemoved = 0;
  const timedListenerBridge = new NativeCallAudio('listener-timeout', { ...plugin,
    addListener: async () => new Promise(resolve => { finishTimedListener = resolve; }), stop: async () => {},
  }, 10);
  await assert.rejects(timedListenerBridge.start(() => {}), /voice:audio_bridge_timeout/); checks++;
  finishTimedListener({ remove: async () => { timedListenerRemoved++; } }); await sleep();
  check(timedListenerRemoved === 1, 'timed-out registration removes its late listener rather than retaining native callbacks');
  for (const stage of ['before-tts', 'before-pcm', 'queued-next', 'withdrawn'] as const) {
    const id = `source-withdraw-${stage}`;
    let evidenceValid = stage !== 'before-tts' && stage !== 'withdrawn', syntheses = 0, pcmAppends = 0, modelAborted = false, modelCalls = 0;
    let resumeCalls = 0, startCalls = 0;
    const sourceError = stage === 'withdrawn' ? 'voice:source_withdrawn' : 'voice:context_changed';
    let releasePcm!: () => void;
    const withdrawn = new VoiceCallController(id, { audio: { ...audio,
      start: async listener => { startCalls++; return audio.start(listener); },
      resume: async () => { resumeCalls++; return audio.resume(); },
      append: async () => { pcmAppends++; return { playedFrames: 2, writtenFrames: 2, sampleRate: 24000 }; },
      drain: async () => { if (stage === 'queued-next') evidenceValid = false; return { playedFrames: 2, writtenFrames: 2, complete: true, sampleRate: 24000 }; },
    }, voice: '茉莉', style: '', onView: value => { view = value; }, context: async () => ({ messages: [],
      reviewSpeech: async text => text,
      assertCurrent: async () => { if (!evidenceValid) throw new Error(sourceError); },
    }), api: {
      recognize: async () => '聊聊吧',
      dialogue: async (_messages, options) => {
        modelCalls++;
        await options.onText('第一句话。第二句话。');
        await new Promise<void>((_resolve, reject) => {
          const abort = () => { modelAborted = true; reject(new DOMException('Aborted', 'AbortError')); };
          if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
        });
      },
      synthesize: async (_text, _voice, _style, options) => {
        syntheses++;
        if (stage === 'before-pcm') await new Promise<void>(resolve => { releasePcm = resolve; });
        await options.onPcm(new Uint8Array([0, 0, 0, 0]));
      },
    } });
    await withdrawn.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    if (stage === 'before-pcm') { await until(() => !!releasePcm); evidenceValid = false; releasePcm(); }
    await until(() => view?.phase === 'error');
    if (stage === 'withdrawn') {
      await withdrawn.resume(); await withdrawn.start();
      check(resumeCalls === 0 && startCalls === 1 && view?.phase === 'error', 'withdrawn call cannot reopen native capture through controller entry points');
      callback({ callId: id, type: 'routeLost', reason: 'voice:route_lost' });
      await withdrawn.resume();
      check(view?.error === sourceError && resumeCalls === 0, 'late route loss preserves source withdrawal and cannot make the old call recoverable');
    }
    const withdrawalRows = await withdrawn.end();
    check(view?.error === sourceError && (stage === 'before-tts' || stage === 'withdrawn' ? modelCalls === 0 : modelCalls === 1 && modelAborted), `${stage} withdrawal blocks model transmission or cancels an already pending dialogue`);
    check(syntheses === (stage === 'before-tts' || stage === 'withdrawn' ? 0 : stage === 'queued-next' ? 2 : 1) && pcmAppends === (stage === 'queued-next' ? 1 : 0), `${stage} withdrawal prevents stale PCM append; a previously authorized one-sentence prefetch may already be billable`);
    check(withdrawalRows.length === 1 && withdrawalRows[0].heardText === (stage === 'queued-next' ? '第一句话。' : ''), `${stage} withdrawal preserves full listening receipts and never certifies revoked queued speech`);
  }
  for (const answer of ['', '   \n', '（微笑，望向窗外）']) {
    const id = `empty-answer-${checks}`; let ttsCalls = 0;
    const empty = new VoiceCallController(id, { audio, voice: '茉莉', style: '', onView: value => { view = value; },
      context: async () => [], api: {
        recognize: async () => '你觉得呢？',
        dialogue: async (_messages, options) => { await options.onText(answer); },
        synthesize: async () => { ttsCalls++; },
      },
    });
    await empty.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    await until(() => view?.phase === 'error');
    check(view?.error === (answer.trim()?'voice:reply_filtered':'voice:reply_empty') && ttsCalls === 0, 'empty or action-only answer pauses explicitly without a billable synthesis or automatic retry');
    await empty.resume();
    check(view?.phase === 'listening', 'empty answer permits explicit recovery for fresh user speech');
    const rows = await empty.end();
    check(rows.length === 1 && rows[0].userText === '你觉得呢？' && rows[0].generatedText === answer && rows[0].heardText === '' && rows[0].segments.length === 0,
      'empty answer preserves original user transcript and raw generation without inventing heard dialogue');
  }
  for (const cancel of [false, true]) {
    const id = `prefetch-${cancel}`; let requests = 0, appends = 0, drains = 0, written = 0;
    let releaseDrain!: () => void;
    const pipelined = new VoiceCallController(id, { voice: '茉莉', style: '', onView: value => { view = value; }, context: async () => [],
      audio: { ...audio,
        append: async (_turn, pcm) => { appends++; written += pcm.length / 2; return { playedFrames: 0, writtenFrames: written, sampleRate: 24000 }; },
        drain: async () => { if (++drains === 1) await new Promise<void>(resolve => { releaseDrain = resolve; }); return { playedFrames: written, writtenFrames: written, sampleRate: 24000, complete: true }; },
        interrupt: async () => ({ playedFrames: 0, writtenFrames: written, sampleRate: 24000 }),
      }, api: {
        recognize: async () => '继续说吧',
        dialogue: async (_messages, options) => { await options.onText('第一句。第二句。第三句。第四句。'); },
        synthesize: async (_text, _voice, _style, options) => { requests++; await options.onPcm(new Uint8Array([0, 0, 0, 0])); },
      },
    });
    await pipelined.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    await until(() => requests === 2 && !!releaseDrain);
    check(appends === 1 && requests === 2, 'one next-sentence request overlaps previous playback but future PCM and further requests remain blocked');
    callback({ callId: id, type: 'playback', turnId: pipelined.lifecycle.receipt()[0].turnId, at: 0, playedFrames: 1, writtenFrames: 2, sampleRate: 24000 });
    check(view?.phase === 'playing' && view.speakingText === '第一句。', 'prefetch does not replace the current audible sentence or mark it as preparing');
    check(pipelined.lifecycle.receipt().every(segment => segment.playedAt === undefined), 'prefetch and synthesis do not certify listening before a full playback receipt');
    if (cancel) {
      await pipelined.interrupt(); const rows = await pipelined.end(); releaseDrain(); await sleep();
      check(requests === 2 && appends === 1 && rows[0].heardText === '', 'interruption cancels the prefetched PCM gate and never plays or certifies future speech');
    } else {
      releaseDrain(); await until(() => view?.phase === 'listening' && view.heardText === '第一句。第二句。第三句。第四句。');
      const rows = await pipelined.end();
      check(requests === 4 && appends === 4 && rows[0].segments.every(segment => segment.playedAt !== undefined && segment.playedFrames === 2), 'normal pipeline preserves ordered per-sentence frame boundaries and full listening receipts');
    }
  }
  for (const transportTimeout of [false, true]) {
    const id = `prefetch-failure-${transportTimeout}`; let requests = 0, appends = 0, modelAborted = false, drainAborted = false, drainsStarted = 0;
    const savedTimer = globalThis.setTimeout;
    if (transportTimeout) globalThis.setTimeout = ((callback: any, delay?: number, ...args: any[]) => savedTimer(callback, delay === 45000 ? 0 : delay, ...args)) as typeof setTimeout;
    const transport = new MimoCallClient(async () => 'mock-key', (async () => {
      requests++;
      return new Response('data: {"choices":[{"delta":{"audio":{"data":"AAAAAA=="}}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch);
    const failedPrefetch = new VoiceCallController(id, { voice: '茉莉', style: '', onView: value => { view = value; }, context: async () => [],
      audio: { ...audio,
        append: async () => { appends++; return { playedFrames: 0, writtenFrames: 2 }; },
        drain: async (_turn, signal) => new Promise((_, reject) => {
          drainsStarted++;
          const abort = () => { drainAborted = true; reject(new DOMException('Aborted', 'AbortError')); };
          if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
        }),
      }, api: {
        recognize: async () => '说下去',
        dialogue: async (_messages, options) => {
          await options.onText('第一句。第二句。第三句。');
          await new Promise<void>((_, reject) => {
            const abort = () => { modelAborted = true; reject(new DOMException('Aborted', 'AbortError')); };
            if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
          });
        },
        synthesize: async (text, voice, style, options) => {
          if (transportTimeout) return transport.synthesize(text, voice, style, options);
          if (++requests === 2) throw new Error('voice:quota'); await options.onPcm(new Uint8Array([0, 0, 0, 0]));
        },
      },
    });
    try {
    await failedPrefetch.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    await until(() => view?.phase === 'error');
    check(view?.error === (transportTimeout ? 'timeout' : 'voice:quota') && modelAborted && (!drainsStarted || drainAborted) && requests === 2 && appends === 1,
      'prefetch failure preserves its real cause, cancels dialogue and any started drain, and prevents further requests');
    const rows = await failedPrefetch.end();
    check(rows.length === 1 && rows[0].heardText === '' && rows[0].segments.every(segment => segment.playedAt === undefined),
      'failed prefetch does not promote an incomplete preceding receipt or pending future sentence to listening facts');
    } finally { globalThis.setTimeout = savedTimer; await failedPrefetch.end(); }
  }
  {
    const id = 'local-audio-failure'; let requests = 0, paused = 0;
    const client = new MimoCallClient(async () => 'mock-key', (async () => {
      requests++;
      return new Response('data: {"choices":[{"delta":{"audio":{"data":"AAAAAA=="}}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch);
    const failedAudio = new VoiceCallController(id, { audio: { ...audio,
      append: async () => { throw { message: 'voice:audio_backpressure' }; },
      pause: async () => { paused++; },
    }, voice: '茉莉', style: '', onView: value => { view = value; }, context: async () => [], api: {
      recognize: async () => '你好', dialogue: async (_messages, options) => { await options.onText('我在。'); },
      synthesize: (text, voice, style, options) => client.synthesize(text, voice, style, options),
    } });
    await failedAudio.start();
    for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
    await until(() => view?.phase === 'error');
    check(view?.error === 'voice:audio_backpressure' && paused === 1, 'actual TTS transport preserves a native write failure and pauses audio instead of misreporting network');
    check(requests === 1, 'local audio failure does not trigger another billable synthesis');
    const rows = await failedAudio.end();
    check(rows.length === 1 && rows[0].heardText === '', 'failed native audio write never becomes heard conversation');
  }
  for (const failed of [false, true]) {
    const id = `device-stop-recovery-${failed}`; let stops = 0, resumes = 0, finishStop!: () => void, rejectStop!: (error: Error) => void;
    const recoveringDevice = new VoiceCallController(id, { audio: { ...audio,
      interrupt: async () => { stops++; return new Promise((resolve, reject) => { finishStop = () => resolve({ playedFrames: 0, writtenFrames: 0 }); rejectStop = reject; }); },
      resume: async () => { resumes++; return { routes: [] }; },
      pause: async () => {},
    }, voice: '茉莉', style: '', context: async () => [], onView: value => { view = value; } });
    await recoveringDevice.start();
    callback({ callId: id, type: 'paused', at: 0, reason: 'background' });
    callback({ callId: id, type: 'routeLost', at: 1, reason: 'route-lost' });
    const recovery = recoveringDevice.resume(); await sleep();
    check(stops === 1 && resumes === 0 && view?.phase === 'paused', 'repeated device pauses share one native stop and resume waits for its acknowledgement');
    if (failed) rejectStop(new Error('voice:audio_bridge_timeout')); else finishStop();
    await recovery;
    check(failed ? resumes === 0 && view?.error === 'voice:audio_bridge_timeout' : resumes === 1 && view?.phase === 'listening',
      'device stop failure is reported without automatic reopening; successful stop permits explicit recovery');
    await recoveringDevice.end();
  }
  for (const cleanupFails of [false, true]) {
    const id = `late-failed-turn-cleanup-${cleanupFails}`;
    let asrRequests = 0, dialogueRequests = 0, stopRequests = 0;
    let finishOldStop!: () => void, finishNewRecognition!: () => void;
    let newSignal: AbortSignal | undefined;
    const isolated = new VoiceCallController(id, { audio: { ...audio,
      interrupt: async () => {
        if (++stopRequests === 1) await new Promise<void>((resolve, reject) => {
          finishOldStop = () => cleanupFails ? reject(new Error('voice:audio_bridge_timeout')) : resolve();
        });
        return { playedFrames: 0, writtenFrames: 0 };
      },
    }, voice: '茉莉', style: '', context: async text => [{ role: 'user', content: text }], onView: value => { view = value; }, api: {
      recognize: async (_wav, options) => {
        if (++asrRequests === 1) return '第一轮原话';
        newSignal = options.signal;
        return new Promise<string>((resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          options.signal.addEventListener('abort', abort, { once: true });
          finishNewRecognition = () => { options.signal.removeEventListener('abort', abort); resolve('新轮原话'); };
        });
      },
      dialogue: async (_messages, options) => {
        if (++dialogueRequests === 1) throw new CallApiError('network', 'dialogue');
        await options.onText('新轮回应。');
      },
      synthesize: async (_text, _voice, _style, options) => { await options.onPcm(new Uint8Array([0, 0, 0, 0])); },
    } });
    try {
      await isolated.start();
      for (let i = 0; i < 12; i++) callback(capture(id, i, i < 5 ? 8000 : 0));
      await until(() => stopRequests === 1);
      check(view?.phase === 'generating' && asrRequests === 1, 'failed turn can be awaiting native cleanup before its error is published');
      await isolated.interrupt();
      const previous = isolated.getRecords();
      check(previous.length === 1 && previous[0].userText === '第一轮原话' && previous[0].interrupted && !previous[0].heardText,
        'manual stop preserves the failed turn original speech once without creating assistant listening facts');
      for (let i = 0; i < 12; i++) callback(capture(id, i + 12, i < 5 ? 8000 : 0));
      await until(() => asrRequests === 2);
      check(view?.phase === 'recognizing' && !newSignal!.aborted, 'fresh speech starts a separate live turn after the manual stop');
      finishOldStop(); await sleep(); await sleep();
      check(view?.phase === 'recognizing' && !view.error && !newSignal!.aborted && isolated.getRecords().length === 1,
        'late success or failure of old error cleanup cannot save, abort or report an error on the new exchange');
      finishNewRecognition();
      await until(() => view?.phase === 'listening' && view.heardText === '新轮回应。');
      const completed = isolated.getRecords();
      check(completed.length === 2 && completed[0].turnId !== completed[1].turnId && completed[0].userText === '第一轮原话'
        && !completed[0].heardText && completed[1].userText === '新轮原话' && completed[1].heardText === '新轮回应。'
        && completed[1].segments.every(segment => segment.playedAt !== undefined),
        'new turn completes normally and only its fully acknowledged response becomes listening evidence');
    } finally { finishOldStop?.(); await isolated.end(); }
  }
  {
    const fixture = segmentedSpeechFixture('continuous-40-second-merge');
    await fixture.controller.start();
    try {
      fixture.send(400); fixture.send(7, false);
      check(fixture.requests.length === 1 && !fixture.requests[0].options.signal.aborted && fixture.dialogues === 0,
        'forty-second continuous speech keeps the first ASR alive and queues its tail without an early reply');
      fixture.requests[0].complete('前段实际转写'); await until(() => fixture.requests.length === 2);
      check(fixture.dialogues === 0 && fixture.view?.userText === '前段实际转写', 'completed prefix waits for its queued tail before the single dialogue');
      fixture.requests[1].complete('尾段实际转写'); await until(() => fixture.view?.phase === 'listening');
      check(fixture.requests.every(request => request.wav.length <= 960044) && fixture.requests.length === 2,
        'each unique speech segment uses one WAV of at most thirty seconds and one ASR request');
      check(Buffer.concat(fixture.requests.map(request => Buffer.from(request.wav.subarray(44))))
        .equals(Buffer.concat(fixture.inputs.slice(0, 402).map(pcm => Buffer.from(pcm)))),
        'marked PCM covers all forty seconds once in order, plus exactly two hundred milliseconds of silent tail');
      check(fixture.contextText === '前段实际转写\n尾段实际转写' && fixture.dialogues === 1 && fixture.syntheses === 1,
        'real completed segment text merges in order for one original-role reply after the true pause');
      check(fixture.usages.length === 2 && fixture.usages[0] === fixture.requests[0].wav.length && fixture.usages[1] === fixture.requests[1].wav.length,
        'one usage receipt is attributed to each actual segment request without invented duplicates');
      const records = fixture.controller.getRecords();
      check(records.length === 1 && records[0].userText === fixture.contextText && records[0].heardText === '合并回应。',
        'the segmented utterance becomes one exchange with only fully acknowledged assistant speech');
    } finally { await fixture.controller.end(); }
  }
  for (const tailFrames of [0, 1]) {
    const fixture = segmentedSpeechFixture(`completed-prefix-short-tail-${tailFrames}`);
    await fixture.controller.start();
    try {
      fixture.send(300); fixture.requests[0].complete('已完成前段'); await sleep();
      check(fixture.dialogues === 0, 'early ASR completion never answers before the actual utterance ends');
      fixture.send(tailFrames); fixture.send(7, false);
      if (tailFrames) { await until(() => fixture.requests.length === 2); fixture.requests[1].complete('短尾'); }
      await until(() => fixture.view?.phase === 'listening');
      check(fixture.requests.length === (tailFrames ? 2 : 1) && fixture.dialogues === 1 && fixture.syntheses === 1
        && fixture.contextText === (tailFrames ? '已完成前段\n短尾' : '已完成前段'),
        'sub-two-hundred-millisecond continuation and silence-only tail both finish the same utterance without an extra silent ASR');
    } finally { await fixture.controller.end(); }
  }
  for (const action of ['interrupt', 'pause', 'mute', 'route', 'end'] as const) {
    const fixture = segmentedSpeechFixture(`queued-speech-cancel-${action}`);
    await fixture.controller.start();
    try {
      fixture.send(300); fixture.requests[0].complete('真实完成前缀'); await sleep();
      fixture.send(600); await until(() => fixture.requests.length === 2); fixture.requests[1].options.onText?.('当前段未完成草稿');
      check(fixture.requests.length === 2 && fixture.view?.userText === '真实完成前缀\n当前段未完成草稿', 'normal recognition subtitles include the active draft while a later segment is bounded in the queue');
      if (action === 'pause') fixture.pause();
      else if (action === 'mute') await fixture.controller.mute(true);
      else if (action === 'route') await fixture.controller.selectRoute(2);
      else await fixture.controller[action]();
      await sleep();
      const saved = fixture.controller.getRecords();
      check(saved.length === 1 && saved[0].userText === '真实完成前缀' && !saved[0].heardText && fixture.view?.userText === '真实完成前缀',
        'stop, background, mute, route and hangup preserve only completed recognition in facts and restored subtitles');
      check(fixture.requests[1].options.signal.aborted && fixture.requests.length === 2 && fixture.dialogues === 0 && fixture.syntheses === 0,
        'cancellation aborts the active ASR and clears its queued continuation without future model requests');
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = segmentedSpeechFixture('speech-queue-overflow');
    await fixture.controller.start();
    try {
      fixture.send(300); fixture.requests[0].complete('已确认前缀'); await sleep();
      fixture.send(600); await until(() => fixture.requests.length === 2); fixture.requests[1].options.onText?.('尚未完成草稿'); fixture.send(300);
      check(fixture.view?.phase === 'error' && fixture.view.error === 'voice:utterance_queue_full' && fixture.view.userText === '已确认前缀',
        'more than two pending segments pauses explicitly and restores confirmed text instead of displaying an unfinished draft');
      check(fixture.requests.length === 2 && fixture.requests[1].options.signal.aborted && fixture.dialogues === 0,
        'queue overflow does not request its queued or overflowing PCM or retry recognition');
      check(fixture.controller.getRecords().length === 1 && fixture.controller.getRecords()[0].userText === '已确认前缀',
        'overflow preserves the completed prefix and does not claim the unrecognized remainder');
    } finally { await fixture.controller.end(); }
  }
  for (const errorKind of ['asr', 'text-limit'] as const) {
    const fixture = segmentedSpeechFixture(`speech-prefix-failure-${errorKind}`);
    await fixture.controller.start();
    try {
      const prefix = errorKind === 'text-limit' ? '真'.repeat(4090) : '已确认前缀';
      fixture.send(300); fixture.requests[0].complete(prefix); await sleep();
      fixture.send(1); fixture.send(7, false); await until(() => fixture.requests.length === 2);
      fixture.requests[1].options.onText?.('当前段草稿');
      if (errorKind === 'asr') fixture.requests[1].fail(new CallApiError('service', 'asr', 503));
      else fixture.requests[1].complete('超过总转写长度的真实尾段');
      await until(() => fixture.view?.phase === 'error');
      check(fixture.view?.error === (errorKind === 'asr' ? 'service' : 'voice:utterance_transcript_limit') && fixture.view.userText === prefix,
        'ASR failure or combined transcript overflow reports its own cause and restores completed-prefix subtitles');
      check(fixture.controller.getRecords().length === 1 && fixture.controller.getRecords()[0].userText === prefix
        && fixture.controller.getRecords()[0].userText.length <= 4096 && fixture.dialogues === 0,
        'failed or over-budget tail cannot become facts, reach dialogue or enlarge stored user text beyond its bound');
    } finally { await fixture.controller.end(); }
  }
  for (const lateFailure of [false, true]) {
    const fixture = segmentedSpeechFixture(`late-cancelled-asr-${lateFailure}`, true);
    await fixture.controller.start();
    try {
      fixture.send(300); fixture.requests[0].complete('原完成前缀'); await sleep(); fixture.send(600); await until(() => fixture.requests.length === 2);
      const cancelled = fixture.requests[1]; await fixture.controller.interrupt();
      fixture.send(5); fixture.send(7, false); await until(() => fixture.requests.length === 3);
      assert.throws(() => cancelled.options.onText?.('迟到草稿'), error => (error as Error).name === 'AbortError'); checks++;
      if (lateFailure) cancelled.fail(new CallApiError('network', 'asr')); else cancelled.complete('迟到结果');
      await sleep();
      check(fixture.view?.phase === 'recognizing' && !fixture.view.error && !fixture.requests[2].options.signal.aborted
        && fixture.controller.getRecords().length === 1, 'late cancelled ASR text, completion or error cannot start its old queue or mutate the new turn');
      fixture.requests[2].complete('新轮真实原话'); await until(() => fixture.view?.phase === 'listening');
      check(fixture.contextText === '新轮真实原话' && fixture.controller.getRecords().length === 2
        && fixture.controller.getRecords()[0].userText === '原完成前缀', 'a fresh turn completes while the cancelled speech retains only its completed prefix');
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = typedCallFixture('typed-real-input');
    fixture.state.padding = true;
    await fixture.controller.start();
    try {
      check(fixture.startModes[0] === 'text' && fixture.view?.inputMode === 'text' && fixture.view.phase === 'listening', 'text call starts the playback-only input mode explicitly');
      fixture.capture(); fixture.event('interrupted');
      check(fixture.asr === 0 && fixture.contexts.length === 0 && fixture.view?.phase === 'listening', 'text mode ignores capture and stale microphone interruption events');
      for (const [text, code] of [['', 'voice:text_empty'], ['  \n\t ', 'voice:text_empty'], ['字'.repeat(MAX_CALL_TEXT_LENGTH + 1), 'voice:text_limit']] as const) {
        await assert.rejects(fixture.controller.sendText(text), error => (error as Error).message === code); checks++;
      }
      check(fixture.requests.length === 0 && fixture.controller.getRecords().length === 0, 'rejected blank or oversized text creates no model request or saved user fact');
      const text = '  用户自己输入的原话\n保留换行和首尾空白。  ';
      check(await fixture.controller.sendText(text), 'valid typed input returns accepted without waiting for a model reply');
      await until(() => fixture.requests.length === 1);
      check(fixture.view?.phase === 'generating' && fixture.view.userText === text && fixture.contexts[0].mode === 'text'
        && fixture.requests[0].text === text && fixture.asr === 0, 'typed input enters generation with the exact user text and explicit text context, skipping ASR');
      await fixture.requests[0].complete(); await until(() => fixture.view?.phase === 'listening');
      const saved = fixture.controller.getRecords()[0];
      check(saved.userText === text && saved.heardText === '原角色语音回答。' && saved.metrics.asrMs === undefined && saved.metrics.latencyBasis === undefined,
        'typed turn saves original text and fully played reply without invented ASR or microphone latency');
      check(saved.metrics.playback?.startupPaddingFrames === 100 && saved.metrics.playback.voiceQueuedFrames === 0
        && saved.metrics.playback.queuedFrames === 100 && saved.metrics.playback.peakQueuedFrames === 101,
        'diagnostics include real pending silence while heard speech remains based only on supplied voice frames');
      check(fixture.completionMarkers.filter(Boolean).length === 1 && fixture.completionMarkers.at(-1) === saved.turnId,
        'only the fully drained turn supplies a completion identity; setup cancellation has no completion marker');
      check(!fixture.stages.includes('asr') && fixture.stages.join(',') === 'dialogue,tts', 'typed usage contains only the actual dialogue and TTS requests');
      check(await fixture.controller.sendText('字'.repeat(MAX_CALL_TEXT_LENGTH)), 'the exact shared text length boundary is accepted');
      await until(() => fixture.requests.length === 2); await fixture.controller.interrupt();
      check(fixture.controller.getRecords()[1].userText.length === MAX_CALL_TEXT_LENGTH && !fixture.controller.getRecords()[1].heardText,
        'accepted length-boundary text survives interruption without promoting an unplayed reply');
      check(fixture.completionMarkers.at(-1) === undefined && fixture.completionMarkers.filter(Boolean).length === 1,
        'manual interruption does not mark its turn as completed for buffer feedback');
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = typedCallFixture('typed-explicit-send-and-late-reply', 'text', true);
    await fixture.controller.start();
    try {
      await fixture.controller.sendText('原轮真实输入'); await until(() => fixture.requests.length === 1);
      const release = fixture.delayStop();
      const replacing = fixture.controller.sendText('新轮明确发送');
      check(!(await fixture.controller.sendText('同时点击不应重复接受')), 'parallel text sends cannot enter the same stop-and-accept boundary twice');
      await sleep(); check(fixture.requests[0].options.signal.aborted && fixture.requests.length === 1, 'explicit sending cancels generation and waits for the old native stop');
      release(); check(await replacing, 'replacement text is accepted only after the old stop acknowledgement');
      await until(() => fixture.requests.length === 2);
      await fixture.requests[0].complete('旧轮迟到台词。'); await sleep();
      check(fixture.view?.userText === '新轮明确发送' && fixture.view.phase === 'generating' && !fixture.requests[1].options.signal.aborted,
        'late cancelled dialogue cannot overwrite, abort or speak over the accepted new text turn');
      await fixture.requests[1].complete(); await until(() => fixture.view?.phase === 'listening');
      const saved = fixture.controller.getRecords();
      check(saved.length === 2 && saved[0].userText === '原轮真实输入' && !saved[0].heardText && saved[1].userText === '新轮明确发送'
        && saved[1].heardText === '原角色语音回答。', 'replacement preserves both genuine user inputs and only the fully heard new response');
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = typedCallFixture('typed-send-during-playback');
    await fixture.controller.start();
    try {
      fixture.state.holdDrain = true;
      await fixture.controller.sendText('播放中的原轮输入'); await until(() => fixture.requests.length === 1); await fixture.requests[0].complete();
      await until(() => fixture.view?.phase === 'playing' && fixture.drains.length === 1);
      check(await fixture.controller.sendText('明确打断播放再回答'), 'explicit typed sending also interrupts current playback');
      await until(() => fixture.requests.length === 2);
      const partial = fixture.controller.getRecords()[0];
      check(partial.userText === '播放中的原轮输入' && !partial.heardText && partial.segments[0].playedFrames === 1 && partial.segments[0].interrupted,
        'playback interruption keeps its partial receipt while withholding unplayed sentence facts');
      fixture.drains[0](); await fixture.requests[1].complete(); await until(() => fixture.view?.phase === 'listening');
      check(fixture.controller.getRecords().length === 2 && fixture.controller.getRecords()[1].heardText === '原角色语音回答。',
        'old playback drain completion cannot certify the interrupted old sentence or disturb new playback');
    } finally { fixture.drains.forEach(resolve => resolve()); await fixture.controller.end(); }
  }
  for (const action of ['paused', 'routeLost', 'interrupt', 'mode', 'end'] as const) {
    const fixture = typedCallFixture(`typed-cancel-${action}`, 'text', true);
    await fixture.controller.start();
    try {
      await fixture.controller.sendText('已经接受的真实文字'); await until(() => fixture.requests.length === 1);
      if (action === 'paused' || action === 'routeLost') fixture.event(action);
      else if (action === 'mode') await fixture.controller.setInputMode('voice');
      else await fixture.controller[action]();
      check(fixture.requests[0].options.signal.aborted && fixture.controller.getRecords()[0].userText === '已经接受的真实文字'
        && !fixture.controller.getRecords()[0].heardText, 'pause, route loss, manual interrupt, input-mode switch and hangup cancel typed responses while preserving accepted words');
      if (action !== 'interrupt') check(!(await fixture.controller.sendText('不应偷偷发送')) && fixture.requests.length === 1, 'paused, voice-mode or ended call rejects text without automatic recovery or resend');
      await fixture.requests[0].complete('取消后的迟到台词。'); await sleep();
      check(fixture.syntheses === 0 && fixture.controller.getRecords().length === 1, 'late cancelled typed replies make no future synthesis and no duplicate facts');
      if (action === 'paused' || action === 'routeLost') {
        check(fixture.resumes === 0, 'rejected paused typed input does not secretly resume native audio');
        await fixture.controller.resume(); check(fixture.resumes === 1 && fixture.requests.length === 1 && fixture.view?.phase === 'listening', 'manual resume restores text mode without replaying rejected or cancelled input');
      }
    } finally { await fixture.controller.end(); }
  }
  for (const failure of ['context', 'dialogue', 'tts', 'append', 'drain'] as const) {
    const fixture = typedCallFixture(`typed-response-failure-${failure}`);
    if (failure !== 'dialogue') fixture.state.failure = failure;
    await fixture.controller.start();
    try {
      check(await fixture.controller.sendText('出错仍应保留这段原话'), 'accepted typed text does not wait for downstream success');
      if (failure !== 'context') {
        await until(() => fixture.requests.length === 1);
        if (failure === 'dialogue') fixture.requests[0].fail(new CallApiError('service', 'dialogue', 503));
        else await fixture.requests[0].complete();
      }
      await until(() => fixture.view?.phase === 'error');
      const saved = fixture.controller.getRecords();
      check(saved.length === 1 && saved[0].userText === '出错仍应保留这段原话' && !saved[0].heardText && fixture.asr === 0,
        'context, dialogue, TTS, append and drain failures retain user text while excluding incomplete assistant playback');
      const requestsBefore = fixture.requests.length;
      check(!(await fixture.controller.sendText('保留草稿直到恢复')) && fixture.requests.length === requestsBefore && fixture.resumes === 0,
        'typed failure does not accept, resume or automatically retry the next draft');
      if (failure === 'dialogue' || failure === 'tts') check(fixture.view?.errorStage === failure && fixture.view.errorHttpStatus === 503,
        'typed model failures retain the real stage and HTTP status');
      fixture.state.failure = undefined; await fixture.controller.resume();
      check(fixture.view?.phase === 'listening' && fixture.requests.length === requestsBefore, 'manual error recovery does not resend the failed typed turn');
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = typedCallFixture('typed-hangup-during-accept');
    await fixture.controller.start();
    await fixture.controller.sendText('已接受旧输入'); await until(() => fixture.requests.length === 1);
    const release = fixture.delayStop(), pending = fixture.controller.sendText('挂断前尚未接受的新草稿');
    await sleep(); const ending = fixture.controller.end(); release();
    check(!(await pending), 'hangup while waiting for stop cannot return accepted for unsent text');
    await ending;
    check(fixture.requests.length === 1 && fixture.controller.getRecords().length === 1 && fixture.controller.getRecords()[0].userText === '已接受旧输入',
      'hangup during typed acceptance saves only the already accepted input and starts no future request');
  }
  {
    const fixture = typedCallFixture('typed-mode-native-confirmation');
    await fixture.controller.start();
    try {
      const release = fixture.delayMode(), switching = fixture.controller.setInputMode('voice');
      await until(() => fixture.modeChanges.length === 1);
      fixture.capture();
      check(fixture.view?.inputMode === 'text' && fixture.view.inputModePending && fixture.asr === 0 && !(await fixture.controller.sendText('切换中不接受')),
        'mode remains unchanged and capture/text are excluded until native confirmation');
      await assert.rejects(fixture.controller.setInputMode('text'), error => (error as Error).message === 'voice:input_mode_pending'); checks++;
      release(); await switching; fixture.capture(); await until(() => fixture.requests.length === 1);
      check(fixture.view?.inputMode === 'voice' && !fixture.view.inputModePending && fixture.asr === 1 && fixture.contexts[0].mode === 'voice',
        'confirmed voice mode resumes the existing ASR path with voice context');
      await fixture.controller.setInputMode('text');
      check(fixture.controller.getRecords()[0].userText === '语音模式真实转写' && fixture.requests[0].options.signal.aborted,
        'voice-to-text switch cancels the original response and retains its completed real ASR input');
      check(await fixture.controller.sendText('切回文字后发送'), 'confirmed text mode accepts a new typed turn');
      await until(() => fixture.requests.length === 2); await fixture.requests[1].complete(); await until(() => fixture.view?.phase === 'listening');
      check(fixture.asr === 1 && fixture.controller.getRecords()[1].userText === '切回文字后发送', 'mode round trip adds no ASR for the typed follow-up');
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = typedCallFixture('typed-mode-permission-failure');
    await fixture.controller.start();
    try {
      fixture.state.failure = 'mode';
      await assert.rejects(fixture.controller.setInputMode('voice'), error => (error as Error).message === 'voice:permission'); checks++;
      check(fixture.view?.inputMode === 'text' && !fixture.view.inputModePending && fixture.view.phase === 'error', 'failed native mode switch retains the last acknowledged input mode');
      check(!(await fixture.controller.sendText('失败后保留草稿')) && fixture.asr === 0, 'failed mode switch cannot secretly accept a draft or start microphone recognition');
      await assert.rejects(fixture.controller.setInputMode('voice'), error => (error as Error).message === 'voice:input_unavailable'); checks++;
      fixture.state.failure = undefined; await fixture.controller.resume();
      check(fixture.view?.inputMode === 'text' && fixture.view.phase === 'listening' && fixture.requests.length === 0, 'manual recovery preserves acknowledged text mode without replay');
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = typedCallFixture('typed-mode-late-hangup');
    await fixture.controller.start();
    const release = fixture.delayMode(), switching = fixture.controller.setInputMode('voice');
    await until(() => fixture.modeChanges.length === 1); await fixture.controller.end(); release(); await switching;
    check(fixture.view?.phase === 'ended' && fixture.view.inputMode === 'text' && !fixture.view.inputModePending && fixture.asr === 0,
      'native mode confirmation after hangup cannot reactivate the call or publish a different mode');
  }
  for (const committed of [true, false]) {
    const fixture = typedCallFixture(`typed-mode-paused-before-ack-${committed}`, 'voice');
    await fixture.controller.start();
    try {
      const release = fixture.delayMode(), switching = fixture.controller.setInputMode('text');
      await until(() => fixture.modeChanges.length === 1);
      fixture.event('paused');
      check(fixture.view?.phase === 'paused' && fixture.view.inputMode === 'voice' && fixture.view.inputModePending,
        'device pause can reach the controller before the pending native mode acknowledgement');
      if (!committed) { fixture.state.failure = 'mode'; fixture.state.modeError = 'voice:inactive'; }
      release();
      if (committed) await switching;
      else { await assert.rejects(switching, error => (error as Error).message === 'voice:inactive'); checks++; }
      check(fixture.view?.inputMode === (committed ? 'text' : 'voice') && !fixture.view.inputModePending
        && fixture.view.phase === (committed ? 'paused' : 'error'),
        'a committed mode acknowledgement updates mode while keeping the call paused, and rejected uncommitted mode keeps the previous mode');
      fixture.capture();
      check(!(await fixture.controller.sendText('后台不应偷偷接收')) && fixture.asr === 0 && fixture.requests.length === 0 && fixture.resumes === 0,
        'neither late mode acknowledgement nor rejection can resume audio or accept input during device suspension');
      if (committed) {
        await fixture.controller.resume();
        check(await fixture.controller.sendText('确认继续后才接收文字'), 'explicit resume uses the acknowledged text mode after a device pause');
        await until(() => fixture.requests.length === 1); await fixture.requests[0].complete(); await until(() => fixture.view?.phase === 'listening');
        check(fixture.controller.getRecords()[0].userText === '确认继续后才接收文字' && fixture.asr === 0,
          'text accepted after explicit recovery remains a real typed turn without an ASR request');
      }
    } finally { await fixture.controller.end(); }
  }
  {
    const fixture = typedCallFixture('typed-permission-denied-start', 'voice');
    fixture.state.failure = 'start'; await fixture.controller.start();
    check(fixture.view?.phase === 'error' && !(await fixture.controller.sendText('不应假装接收')), 'failed call initialization does not accept typed input');
    await fixture.controller.setInputMode('text'); fixture.state.failure = undefined;
    check(fixture.starts === 1 && fixture.modeChanges.length === 0 && fixture.view?.phase === 'error', 'changing a failed start target only updates configuration and does not automatically reopen audio');
    await fixture.controller.resume();
    check(fixture.startModes.join(',') === 'voice,text' && fixture.view?.phase === 'listening' && fixture.view.inputMode === 'text', 'explicit resume after failed initialization starts the newly selected mode');
    await fixture.controller.end();
  }
  {
    const fixture = typedCallFixture('typed-revoked-source'); await fixture.controller.start();
    await fixture.controller.sendText('已接受但背景来源撤回'); await until(() => fixture.requests.length === 1); fixture.state.withdrawn = true;
    await fixture.requests[0].complete(); await until(() => fixture.view?.phase === 'error');
    check(fixture.view?.error === 'voice:source_withdrawn' && !fixture.controller.getRecords()[0].heardText && fixture.syntheses === 0,
      'typed input shares source authorization and cannot synthesize from withdrawn context');
    await fixture.controller.resume();
    check(!(await fixture.controller.sendText('撤回后未接收的草稿')) && fixture.resumes === 0 && fixture.requests.length === 1, 'source revocation is terminal for the current typed call and never auto-repairs memory');
    await fixture.controller.end();
  }
  console.log(JSON.stringify({ checks, realApiCalls: 0, modelTokens: 0, deviceTested: false, mode: 'mock-controller-and-bridge' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
