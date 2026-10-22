import { db, type Character } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { persistSecret, clearSecret } from '../../src/lib/api-key-storage';
import { voiceCallRepo } from '../../src/db/voice-call-repo';
import type { CallAudioPort } from '../../src/lib/voice-call/controller';
import type { MimoCallClient } from '../../src/lib/voice-call/mimo';

async function main() {
  const failures: string[] = [], cases: unknown[] = [];
  let checks = 0;
  const check = (condition: unknown, label: string) => { checks++; if (!condition) failures.push(label); };
  const wait = async (condition: () => boolean) => {
    const until = Date.now() + 10000;
    while (!condition()) { if (Date.now() > until) throw Error('usage fixture timeout'); await new Promise(resolve => setTimeout(resolve, 5)); }
  };
  await db.open();
  const owner = { userId: 'usage-owner', characterId: 'usage-role', sessionId: 'usage-session' };
  useAuthStore.setState({ userId: owner.userId });
  const role: Character = { id: owner.characterId, name: '澄', avatar: '🌙', createdBy: owner.userId, createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '说话简洁。' };
  await db.characters.put(role);
  await db.sessions.put({ id: owner.sessionId, characterId: owner.characterId, userId: owner.userId, title: '用量归属夹具', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  await persistSecret('mimo-key', 'test-only-placeholder');
  let frames = 0;
  const audio: CallAudioPort = {
    start: async () => ({ sampleRate: 16000, echoCancellation: true, noiseSuppression: true, routes: [] }),
    beginPlayback: async () => { frames = 0; },
    append: async (_turn, pcm) => { frames += pcm.length / 2; return { playedFrames: frames, writtenFrames: frames }; },
    drain: async () => ({ playedFrames: frames, writtenFrames: frames, complete: true }),
    interrupt: async () => ({ playedFrames: frames, writtenFrames: frames }), mute: async () => {}, resume: async () => ({ routes: [] }), close: async () => {},
  };
  let legacySource;
  try {
    for (const reverse of [false, true]) {
      let synthesis = 0, secondStarted = false;
      const events: string[] = [];
      const api: Pick<MimoCallClient, 'recognize' | 'dialogue' | 'synthesize'> = {
        recognize: async () => { throw Error('Text fixture must not invoke ASR'); },
        dialogue: async (messages, options) => {
          options.onRequest?.();
          if (messages[0].content.includes('你是一个记忆提取系统') || messages[0].content.startsWith('将真实通话原文整理成简短记录')) { await options.onText('[]'); return; }
          options.onUsage?.({ inputTokens: 9, outputTokens: 8 });
          await options.onText('这是第一句完整的回答内容。');
          await options.onText('这是第二句完整的回答内容。');
        },
        synthesize: async (_text, _voice, _style, options) => {
          const ordinal = ++synthesis;
          options.onRequest?.(); events.push(`request:${ordinal}`);
          if (ordinal === 1) {
            await options.onPcm(new Uint8Array([0, 0, 0, 0]));
            await wait(() => secondStarted);
            events.push('usage:1'); options.onUsage?.({ inputTokens: 101, outputTokens: 11 });
          } else if (ordinal === 2) {
            secondStarted = true;
            if (reverse) { events.push('usage:2'); options.onUsage?.({ inputTokens: 202, outputTokens: 22 }); }
            await options.onPcm(new Uint8Array([0, 0, 0, 0]));
            if (!reverse) { events.push('usage:2'); options.onUsage?.({ inputTokens: 202, outputTokens: 22 }); }
          } else throw Error('Expected exactly two spoken segments');
        },
      };
      await useVoiceCallStore.getState().start(owner, { audio, api }, 'text');
      check(await useVoiceCallStore.getState().sendText('继续说吧。'), 'host accepts typed fixture');
      await wait(() => useVoiceCallStore.getState().record?.exchanges.length === 1 || useVoiceCallStore.getState().view?.phase === 'error');
      const saved = await db.voiceCalls.get(useVoiceCallStore.getState().record!.id);
      if (!saved || saved.exchanges.length !== 1) throw Error(`fixture did not complete: ${useVoiceCallStore.getState().view?.error}`);
      const tts = saved.usage?.filter(row => row.stage === 'tts') ?? [];
      cases.push({ reverse, events, usage: saved.usage });
      check(events.indexOf('request:2') < events.indexOf('usage:1'), 'second TTS starts before first usage receipt');
      check(tts.length === 2, 'both overlapping TTS attempts remain recorded');
      check(tts[0]?.inputTokens === 101 && tts[0]?.outputTokens === 11, 'first TTS retains its own usage');
      check(tts[1]?.inputTokens === 202 && tts[1]?.outputTokens === 22, 'second TTS retains its own usage');
      check(!!tts[0]?.requestId && !!tts[1]?.requestId && tts[0].requestId !== tts[1].requestId, 'overlapping TTS have stable distinct request IDs');
      check(saved.usage?.find(row => row.stage === 'dialogue')?.inputTokens === 9, 'dialogue receipt remains separate');
      legacySource = saved;
      await useVoiceCallStore.getState().end();
      const ended = await db.voiceCalls.get(saved.id);
      check(ended?.usage?.filter(row => row.stage === 'tts').every((row, index) => row.requestId === tts[index]?.requestId && row.inputTokens === tts[index]?.inputTokens), 'hangup preserves request-to-usage association');
    }
    if (!legacySource) throw Error('missing legacy source fixture');
    const legacy = { ...legacySource, id: 'legacy-usage-record', exchanges: [], messageIds: [], status: 'active' as const,
      usage: [{ stage: 'tts' as const, requestedAt: 1, inputTokens: 7, outputTokens: 3 }] };
    await voiceCallRepo.save(legacy);
    const restored = await voiceCallRepo.get(legacy.id, owner.userId);
    check(restored?.usage?.[0].requestId === undefined && restored.usage[0].inputTokens === 7, 'legacy usage rows remain readable without invented IDs');
    return { checks, failures, cases, realApiCalls: 0, modelTokens: 0, deviceTested: false,
      scope: 'Actual voice-call-store/controller/checkpoint/hangup with isolated IndexedDB, synthetic usage callbacks and simulated audio. No provider calls.' };
  } finally { await useVoiceCallStore.getState().end(); clearSecret('mimo-key'); }
}
main().then(result => { (window as any).voiceUsageResult = result; }).catch(error => { (window as any).voiceUsageResult = { error: String(error) }; });
