import { db, type Character } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { persistSecret, clearSecret } from '../../src/lib/api-key-storage';
import { withChatSessionLock } from '../../src/lib/chat/request-coordinator';
import type { CallAudioPort } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
import { canUseAi } from '../../src/lib/ai/availability';
import { messageRepo } from '../../src/db/message-repo';
import { extractVoiceCallMemory } from '../../src/lib/voice-call/memory';
import { voiceCallRepo } from '../../src/db/voice-call-repo';
async function main() {
  let checks = 0;
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks++; };
  const wait = async (fn: () => boolean) => { for (let index = 0; index < 300; index++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('host timeout'); };
  await db.open(); useAuthStore.setState({ userId: 'host-user' });
  const role: Character = { id: 'host-role', name: '阿遥', avatar: '🌙', createdBy: 'host-user', createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '阿遥喜欢诗，惜字如金。' };
  await db.characters.put(role); await db.sessions.put({ id: 'host-session', characterId: role.id, userId: role.createdBy, title: '通话', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  check(!canUseAi(), 'host test has no configured global text AI route');
  await db.sessions.put({ id: 'unrelated-session', characterId: role.id, userId: role.createdBy, title: '无关原文', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  await messageRepo.create({ id: 'unrelated-msg', sessionId: 'unrelated-session', role: 'user', content: '另一会话的私人原文', createdAt: 1, isProactive: false });
  useChatStore.setState({ currentSessionId: 'host-session', selectedCharacterId: role.id, messages: [] });
  // Dummy local secret never leaves the isolated browser; all audio/model ports are injected mocks.
  await persistSecret('mimo-key', 'test-only-placeholder');
  let callback: (event: NativeAudioEvent) => void = () => {}, frames = 0, closed = 0, dialogues = 0, memoryCalls = 0, audioStarts = 0;
  const caps = { sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true, routes: [] };
  const audio: CallAudioPort = { start: async cb => { audioStarts++; callback = cb; return caps; }, beginPlayback: async () => { frames = 0; },
    append: async (_id, pcm) => { frames += pcm.length / 2; return { playedFrames: frames, writtenFrames: frames }; },
    drain: async () => ({ playedFrames: frames, writtenFrames: frames, complete: true }), interrupt: async () => ({ playedFrames: frames, writtenFrames: frames }), mute: async () => {}, resume: async () => ({ routes: [] }), close: async () => { closed++; } };
  const api = { recognize: async (_wav: Uint8Array, options: any) => { options.onRequest?.(); options.onUsage?.({ inputTokens: 10, outputTokens: 1 }); return '我喜欢读诗'; }, synthesize: async (_text: string, _voice: unknown, _style: string, options: any) => { options.onRequest?.(); await options.onPcm(new Uint8Array([0, 0, 0, 0])); }, dialogue: async (messages: any[], options: any) => {
    options.onRequest?.(); options.onUsage?.({ inputTokens: 20, outputTokens: 8 });
    if (messages[0].content.includes('你是一个记忆提取系统')) {
      check(options.maxTokens === 1000, 'memory transport uses its bounded extraction output budget');
      memoryCalls++;
      const sourceId = /\[sourceId=([^\]]+)\]/.exec(messages[1].content)?.[1];
      check(!messages[1].content.includes('我记得这份喜欢'), 'memory transport receives only user evidence');
      await options.onText('```json\n' + JSON.stringify([{ content: '用户喜欢读诗', sourceIds: [sourceId] }]) + '\n```'); return;
    }
    dialogues++; if (dialogues === 1) check(messages[0].content.includes('阿遥喜欢诗'), 'host invokes original persona context');
    await options.onText(dialogues === 1 ? '我记得这份喜欢。' : '用户表达喜欢读诗，角色回应了。');
  } };
  await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
  check(useVoiceCallStore.getState().view?.phase === 'listening', 'host starts controller after native initialization');
  let ordinarySend = false; const queued = withChatSessionLock('host-session', async () => { ordinarySend = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); check(!ordinarySend, 'ordinary send waits until call releases the shared session lock');
  const callId = useVoiceCallStore.getState().record!.id;
  for (let sequence = 0; sequence < 12; sequence++) {
    const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
    for (let offset = 0; offset < pcm.length; offset += 2) data.setInt16(offset, sequence < 5 ? 8000 : 0, true);
    callback({ callId, type: 'capture', sampleRate: 16000, sequence, pcm: btoa(String.fromCharCode(...pcm)), at: sequence * 100 });
  }
  await wait(() => useVoiceCallStore.getState().view?.heardText === '我记得这份喜欢。');
  await wait(() => useVoiceCallStore.getState().record?.exchanges.length === 1);
  check((await db.voiceCalls.get(callId))?.status === 'active' && (await db.messages.where('sessionId').equals('host-session').count()) === 2, 'completed turn is durable before hangup');
  const finishingStages: string[] = [];
  const stopWatching = useVoiceCallStore.subscribe(state => { if (state.finishing && finishingStages.at(-1) !== state.finishing) finishingStages.push(state.finishing); });
  await useVoiceCallStore.getState().end(); await queued; stopWatching();
  check(finishingStages.join(',') === 'saving,summary,memory', 'real host reports durable save, summary and memory stages in execution order');
  check(!useVoiceCallStore.getState().finishing && !useVoiceCallStore.getState().saving, 'completion clears transient progress without retaining a false busy state');
  check(closed === 1 && ordinarySend, 'hangup releases both native session and chat queue');
  const saved = await db.voiceCalls.get(callId);
  check(saved?.summaryState === 'ready' && saved.messageIds.length === 2, 'host commits heard speech and generates one summary');
  check(useChatStore.getState().messages.length === 2, 'hangup refreshes actual chat history');
  check((await db.memoryJobs.where('userId').equals(role.createdBy).count()) > 0, 'host queues original evidence-based memory worker');
  check(dialogues === 2, 'one answer plus one summary without automatic paid retries');
  check(saved?.usage?.length === 5, 'call audit records ASR, dialogue, TTS, summary and memory request attempts');
  check(memoryCalls === 1 && (await db.memories.where('userId').equals(role.createdBy).toArray()).some(row => row.content.includes('喜欢读诗')), 'MiMo-only call memory commits through the original evidence worker');
  check((await db.memoryJobs.where('userId').equals(role.createdBy).toArray()).filter(job => job.sessionId === 'unrelated-session').every(job => job.status === 'queued' && job.attempts === 0), 'voice memory does not lease or pay to process unrelated sessions');
  check(saved?.usage?.find(row => row.stage === 'asr')?.audioSeconds! > 0, 'ASR uploaded duration is recorded');
  check(saved?.usage?.find(row => row.stage === 'tts')?.inputTokens === undefined, 'missing token usage remains unknown instead of zero');
  audio.close = async () => { throw new Error('mock-native-release-failure'); };
  await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
  const failedReleaseId = useVoiceCallStore.getState().record!.id;
  for (let sequence = 0; sequence < 12; sequence++) {
    const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
    for (let offset = 0; offset < pcm.length; offset += 2) data.setInt16(offset, sequence < 5 ? 8000 : 0, true);
    callback({ callId: failedReleaseId, type: 'capture', sampleRate: 16000, sequence, pcm: btoa(String.fromCharCode(...pcm)), at: sequence * 100 });
  }
  await wait(() => !!useVoiceCallStore.getState().view?.heardText);
  await useVoiceCallStore.getState().end();
  check((await db.voiceCalls.get(failedReleaseId))?.exchanges.length === 1 && useVoiceCallStore.getState().error === 'voice:audio_release_failed', 'native release errors preserve acknowledged conversation and remain visible');
  // Real IndexedDB jobs, synthetic call/model fixtures: no microphone or API.
  const fixture = async (id: string, content: string, count = 1) => {
    await db.voiceCalls.put({ ...saved!, id, status: 'ended', messageIds: [], exchanges: [], usage: [] });
    for (let index = 0; index < count; index++) await messageRepo.create({ id: `voice:${id}:${index}:user`, sessionId: 'host-session', role: 'user', content, createdAt: Date.now() + index, isProactive: false });
  };
  await fixture('memory-long', '我喜欢读诗。'.repeat(1000), 5);
  let batches = 0;
  const boundedApi = { dialogue: async (messages: any[], options: any) => {
    batches++; options.onRequest?.();
    check(messages.reduce((sum, row) => sum + row.content.length, 0) < 40000, 'long memory batch stays within the real transport envelope');
    await options.onText('[]');
  } };
  await extractVoiceCallMemory('memory-long', role.createdBy, new AbortController().signal, boundedApi);
  check((await db.voiceCalls.get('memory-long'))?.memoryProgress?.pending === 1, 'one bounded action leaves the fifth memory source pending');
  await extractVoiceCallMemory('memory-long', role.createdBy, new AbortController().signal, boundedApi);
  check((await db.voiceCalls.get('memory-long'))?.memoryProgress?.completed === 5, 'explicit continuation finishes remaining sources without dropping them');
  check(batches === 2, 'five long sources require two bounded actions rather than unbounded automatic calls');
  for (const mode of ['cancel', 'edit'] as const) {
    const id = `memory-${mode}`, sourceId = `voice:${id}:0:user`, abort = new AbortController();
    await fixture(id, '我喜欢喝茶。');
    const countBefore = await db.memories.count();
    await extractVoiceCallMemory(id, role.createdBy, abort.signal, { dialogue: async (_messages, options) => {
      options.onRequest?.();
      await options.onText(JSON.stringify([{ content: '用户喜欢喝茶', sourceIds: [sourceId] }]));
      if (mode === 'cancel') abort.abort();
      else await db.messages.update(sourceId, { revision: 2, content: '刚才说错了。' });
    } });
    check(await db.memories.count() === countBefore, `${mode} during extraction does not commit a stale fact`);
    const job = (await db.memoryJobs.where('userId').equals(role.createdBy).toArray()).find(row => row.sourceIds.includes(sourceId));
    check(mode === 'cancel' ? job?.status === 'retry' : job?.status === 'cancelled', `${mode} preserves an honest durable job outcome`);
  }
  const startsBefore = audioStarts;
  await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'missing-session' }, { audio, api });
  check(useVoiceCallStore.getState().error === 'voice:context_changed' && !useVoiceCallStore.getState().busy, 'missing session is rejected before recording');
  await db.sessions.put({ id: 'group-session', userId: role.createdBy, characterId: role.id, type: 'group', title: '群聊', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'group-session' }, { audio, api });
  check(useVoiceCallStore.getState().error === 'voice:context_changed', 'group session cannot start a single-role call');
  await db.characters.update(role.id, { agentProfile: 'secretary' });
  await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
  check(useVoiceCallStore.getState().error === 'voice:context_changed', 'assistant cannot start a role call via stale UI');
  check(audioStarts === startsBefore, 'invalid owners never initialize native audio');
  await db.characters.update(role.id, { agentProfile: undefined });
  audio.close = async () => { closed++; };
  await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
  const originalSave = voiceCallRepo.save;
  voiceCallRepo.save = async () => { throw new Error('simulated-storage-full'); };
  try {
    const beforeHangup = Date.now();
    const ending = useVoiceCallStore.getState().end();
    const hangupAt = useVoiceCallStore.getState().record?.endedAt;
    check(hangupAt !== undefined && hangupAt >= beforeHangup && hangupAt <= Date.now(), 'hangup timestamp is captured immediately before asynchronous persistence');
    await ending;
    check(useVoiceCallStore.getState().record?.endedAt === hangupAt, 'failed save retains the actual hangup time for duration display');
    check(useVoiceCallStore.getState().error === 'voice:save_failed', 'durable save failure is distinguished from summary or memory failure');
    check(useVoiceCallStore.getState().record?.status === 'active', 'failed final save never advertises an ended durable record');
    check(!useVoiceCallStore.getState().saving && !useVoiceCallStore.getState().finishing, 'save failure clears transient progress so UI cannot spin forever');
    let released = false; await withChatSessionLock('host-session', async () => { released = true; });
    check(released, 'failed save still releases the ordinary chat session queue');
  } finally { voiceCallRepo.save = originalSave; }
  clearSecret('mimo-key');
  return { checks, mode: 'browser-host-with-mock-audio-and-models', realApiCalls: 0, modelTokens: 0, usageReceipts: 'synthetic fixtures, not actual consumption', deviceTested: false };
}
main().then(result => { (window as any).voiceProfileResult = result; }).catch(error => { (window as any).voiceProfileResult = { error: String(error) }; });
