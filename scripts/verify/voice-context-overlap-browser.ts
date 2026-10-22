import './voice-context-latency';
import { VoiceCallController, type CallExchange, type CallView } from '../../src/lib/voice-call/controller';
import { prepareCallContext } from '../../src/lib/voice-call/context';
import { db } from '../../src/db';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
const testWindow = window as any;
let writes = 0;
let writeTypes: Record<string, number> = {};
db.use({ stack: 'dbcore', name: 'early-context-write-evidence', create: down => ({ ...down,
  table: name => { const table = down.table(name); return { ...table,
    mutate: request => { writes++; const key = `${name}:${request.type}`; writeTypes[key] = (writeTypes[key] ?? 0) + 1; return table.mutate(request); },
  }; },
}) });
const topic = '还记得一起观星 CHAT_MEMORY SHARED_MEMORY TODO_SOURCE CONTINUITY_SOURCE MOMENT_SOURCE REACTION_SOURCE 吗';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), b => b.toString(16).padStart(2, '0')).join('');
Object.assign(window, { voiceOverlapDbRun: async (guardsOnly = false) => {
  const fixture = await testWindow.voiceContextLatency(true, true, true);
  // Ordinary established-call performance: initialization has already happened in both variants.
  await db.characterStates.put({ characterId: 'a', userId: 'u', affinity: 0, mood: 70, milestones: [], updatedAt: Date.now() });
  const rows = [];
  for (let round = 0; round < 30; round++) {
    if (guardsOnly) break;
    let callback!: (event: NativeAudioEvent) => void, sequence = 0, frames = 0, view: CallView | undefined;
    let completed: CallExchange | undefined, input: unknown, preparations = 0;
    const requests = { asr: 0, dialogue: 0, tts: 0 }, wavHashes: string[] = [];
    const controller = new VoiceCallController(`isolated-db-${round}`, { prepareContextDuringEndpoint: true,
      voice: '茉莉', style: '', onView: v => { view = v; }, onExchange: row => { completed = row; },
      context: async (text, exchanges, signal, mode, trigger, preparation) => {
        preparations++;
        return prepareCallContext({ userId: 'u', characterId: 'a', sessionId: 's', worldId: 'w' }, text, exchanges, signal, mode, trigger, preparation);
      },
      audio: {
        start: async cb => { callback = cb; return { routes: [], echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }; },
        beginPlayback: async () => { await sleep(50); },
        append: async (_id, pcm) => ({ playedFrames: frames += pcm.length / 2, writtenFrames: frames }),
        drain: async () => ({ playedFrames: frames, writtenFrames: frames, complete: true }),
        interrupt: async () => ({ playedFrames: frames, writtenFrames: frames }),
        mute: async () => {}, resume: async () => ({ routes: [] }), close: async () => {},
      },
      api: {
        recognize: async (wav, options) => { requests.asr++; options.onRequest?.(); wavHashes.push(await hash(Array.from(wav))); await sleep(60); return topic; },
        dialogue: async (messages, options) => {
          requests.dialogue++; options.onRequest?.(); input = messages;
          for (const marker of ['CHAT_MEMORY', 'SHARED_MEMORY', 'TODO_SOURCE', 'CONTINUITY_SOURCE', 'MOMENT_SOURCE', 'REACTION_SOURCE']) {
            if (!messages[0].content.includes(marker)) throw Error(`Required memory missing: ${marker}`);
          }
          await sleep(100); await options.onText('还记得那次一起观星。');
        },
        synthesize: async (_t, _v, _s, options) => { requests.tts++; options.onRequest?.(); await sleep(80); for (let packet = 0; packet < 3; packet++) await options.onPcm(new Uint8Array(960)); },
      },
    });
    await controller.start(); testWindow.resetVoiceContextReadCounts(); const started = performance.now();
    const timer = setInterval(() => {
      const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer), voiced = sequence < 5;
      for (let n = 0; n < pcm.length; n += 2) data.setInt16(n, voiced ? 8000 : 0, true);
      callback({ type: 'capture', callId: `isolated-db-${round}`, at: performance.now(), sequence: sequence++, sampleRate: 16000,
        pcm: btoa(String.fromCharCode(...pcm)) });
    }, 100);
    try {
      while (!completed) {
        if (performance.now() - started > 12_000 || view?.phase === 'error') throw Error(`Isolated call failed: ${view?.error ?? 'timeout'}`);
        await sleep(10);
      }
    } finally { clearInterval(timer); await controller.end(); }
    if (preparations !== 1 || requests.asr !== 1 || requests.dialogue !== 1 || requests.tts !== 1) throw Error('Unexpected extra preparation/request');
    rows.push({ round, inputHash: await hash(input), wavHashes, preparations, requests,
      metrics: completed.metrics, reads: testWindow.voiceContextReadCounts() });
  }
  const guards: string[] = [];
  const owner = { userId: 'u', characterId: 'a', sessionId: 's', worldId: 'w' };
  const reject = async (action: Promise<unknown>, expected: string) => {
    try { await action; throw Error('Unexpected early authority'); }
    catch (error) { if ((error as Error).message !== expected && (error as Error).name !== expected) throw error; }
  };
  writes = 0; writeTypes = {};
  const normal = await prepareCallContext(owner, topic, [], new AbortController().signal);
  const normalWrites = writes;
  writes = 0; writeTypes = {};
  let release!: () => void, reached!: () => void;
  const commitReady = new Promise<void>(resolve => { release = resolve; });
  const reachedLedger = new Promise<void>(resolve => { reached = resolve; });
  const earlyWork = prepareCallContext(owner, topic, [], new AbortController().signal, 'voice', undefined, {
    mode: 'early-local', waitForEndpoint: () => { reached(); return commitReady; },
  });
  await reachedLedger;
  if (writes !== 0) throw Error('Early read-only prefix wrote persistent data');
  release();
  const early = await earlyWork, committedWrites = writes;
  const normalHash = await hash(normal.messages), earlyHash = await hash(early.messages);
  if (normalWrites <= 0 || committedWrites !== normalWrites || normalHash !== earlyHash) throw Error(`Early context parity failure: writes=${writes}, normalWrites=${normalWrites}, tables=${JSON.stringify(writeTypes)}, normalHash=${normalHash}, earlyHash=${earlyHash}`);
  guards.push(`early prefix has zero writes; endpoint preserves ${normalWrites} normal ledger writes and identical full input`);
  const immediate = { mode: 'early-local' as const, waitForEndpoint: () => Promise.resolve() };
  const memory = await db.memories.get('chat-memory');
  await db.memories.update('chat-memory', { content: '撤权竞态：原始内容已修订' });
  await reject(early.assertCurrent!(), 'voice:context_changed');
  await db.memories.put(memory!); guards.push('prepared real memory edit rejected by fresh source validation');
  const abort = new AbortController();
  const cancelled = await prepareCallContext(owner, topic, [], abort.signal, 'voice', undefined, immediate);
  abort.abort(); await reject(cancelled.assertCurrent!(), 'AbortError'); guards.push('completed context remains bound to cancellation signal');
  const cancelledPrefix = new AbortController();
  let prefixReached!: () => void;
  const prefixAtGate = new Promise<void>(resolve => { prefixReached = resolve; });
  const deniedCommit = new Promise<void>((_resolve, reject) => {
    cancelledPrefix.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  void deniedCommit.catch(() => {});
  writes = 0;
  const abandoned = prepareCallContext(owner, topic, [], cancelledPrefix.signal, 'voice', undefined, {
    mode: 'early-local', waitForEndpoint: () => { prefixReached(); return deniedCommit; },
  });
  await prefixAtGate; cancelledPrefix.abort(); await reject(abandoned, 'AbortError');
  if (writes !== 0) throw Error('Cancelled early prefix wrote retrieval history');
  guards.push('cancellation before endpoint writes no retrieval/claim/evidence/knowledge records');
  await db.characterStates.delete(['a', 'u']); writes = 0;
  await reject(prepareCallContext(owner, topic, [], new AbortController().signal, 'voice', undefined, immediate), 'voice:early_context_unavailable');
  if (writes !== 0 || await db.characterStates.get(['a', 'u'])) throw Error('Early preparation initialized relationship state');
  guards.push('missing relationship stays absent during early preparation');
  const worlds = await db.worlds.count(); writes = 0;
  await reject(prepareCallContext({ ...owner, worldId: undefined }, topic, [], new AbortController().signal, 'voice', undefined, immediate), 'voice:early_context_unavailable');
  if (writes !== 0 || await db.worlds.count() !== worlds) throw Error('Early preparation created default world');
  guards.push('missing default world stays absent during early preparation');
  await prepareCallContext(owner, topic, [], new AbortController().signal);
  if (!await db.characterStates.get(['a', 'u'])) throw Error('Final context failed to initialize normal state');
  guards.push('final non-speculative path retains normal initialization');
  return { fixture, rows, guards, apiCalls: 0, scope: 'real isolated IndexedDB and controller; synthetic ASR/LLM/TTS and playback, no microphone or physical sound' };
} });
