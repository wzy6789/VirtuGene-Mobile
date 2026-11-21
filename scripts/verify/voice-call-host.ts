import { db, type Character } from '../../src/db';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { persistSecret, clearSecret, loadSecret } from '../../src/lib/api-key-storage';
import { withChatSessionLock } from '../../src/lib/chat/request-coordinator';
import type { CallAudioPort } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
import { canUseAi } from '../../src/lib/ai/availability';
import { messageRepo } from '../../src/db/message-repo';
import { extractVoiceCallMemory } from '../../src/lib/voice-call/memory';
import { voiceCallRepo } from '../../src/db/voice-call-repo';
import { MimoCallClient, CALL_MODELS } from '../../src/lib/voice-call/mimo';
import { nativeCallFetch, type MimoStreamPort } from '../../src/lib/voice-call/transport';
import { voiceProfileRepo } from '../../src/db/voice-profile-repo';
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
  let longSpeechWavs: Uint8Array[] | undefined;
  const audioStartModes: string[] = [], audioModeChanges: string[] = [];
  let typedFixture = false;
  const typedDialogueMessages: any[][] = [];
  const typedReply = '好，我会认真听你说。';
  let heldTypedRequest: { entered: () => void; wait: Promise<void> } | undefined;
  const audio: CallAudioPort = { start: async (cb, options) => { audioStarts++; audioStartModes.push(options?.inputMode ?? 'voice'); callback = cb; return caps; },
    setInputMode: async mode => { audioModeChanges.push(mode); }, beginPlayback: async () => { frames = 0; },
    append: async (_id, pcm) => { frames += pcm.length / 2; return { playedFrames: frames, writtenFrames: frames }; },
    drain: async () => ({ playedFrames: frames, writtenFrames: frames, complete: true }), interrupt: async () => ({ playedFrames: frames, writtenFrames: frames }), mute: async () => {}, resume: async () => ({ routes: [] }), close: async () => { closed++; } };
  const fixtureApi = { recognize: async (wav: Uint8Array, options: any) => {
    options.onRequest?.(); options.onUsage?.({ inputTokens: 10, outputTokens: 1 });
    if (longSpeechWavs) {
      longSpeechWavs.push(wav);
      return longSpeechWavs.length === 1 ? '前半段内容。' : '后半段内容。';
    }
    return '我喜欢读诗';
  }, synthesize: async (_text: string, _voice: unknown, _style: string, options: any) => { options.onRequest?.(); await options.onPcm(new Uint8Array([0, 0, 0, 0])); }, dialogue: async (messages: any[], options: any) => {
    options.onRequest?.(); options.onUsage?.({ inputTokens: 20, outputTokens: 8 });
    if (typedFixture) {
      if (messages[0].content.includes('你是一个记忆提取系统')) { await options.onText('[]'); return; }
      if (messages[0].content.startsWith('将真实通话原文整理成简短记录')) { await options.onText('用户以文字交流，角色以声音回应。'); return; }
      typedDialogueMessages.push(messages.map(row => ({ ...row })));
      await options.onText(typedReply); return;
    }
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
  const responseChunks = new Map<string, Uint8Array[]>(), requestedModels: string[] = [], cancelledResponseIds = new Set<string>();
  let failureModel: string | undefined, failureStatus = 503;
  const nativePort: MimoStreamPort = {
    open: async ({ id, key, body }) => {
      if (key !== 'test-only-placeholder') throw new Error('unexpected fixture credential');
      const request = JSON.parse(body), events: unknown[] = [];
      requestedModels.push(request.model);
      if (typedFixture && heldTypedRequest && request.model === CALL_MODELS.dialogue
        && !request.messages[0].content.startsWith('将真实通话原文整理成简短记录')
        && !request.messages[0].content.includes('你是一个记忆提取系统')) {
        const held = heldTypedRequest; heldTypedRequest = undefined; held.entered(); await held.wait;
        if (cancelledResponseIds.has(id)) throw new DOMException('Aborted', 'AbortError');
      }
      if (request.model === failureModel) return { status: failureStatus };
      const options = { signal: new AbortController().signal, maxTokens: request.max_completion_tokens,
        onRequest: () => {}, onUsage: (usage: any) => events.push({ usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens } }),
        onText: async (text: string) => { events.push({ choices: [{ delta: { content: text } }] }); },
        onPcm: async (pcm: Uint8Array) => { events.push({ choices: [{ delta: { audio: { data: btoa(String.fromCharCode(...pcm)) } } }] }); },
      };
      if (request.model === CALL_MODELS.asr) {
        const data = request.messages[0].content[0].input_audio.data;
        const wav = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), char => char.charCodeAt(0));
        if (String.fromCharCode(...wav.subarray(0, 4)) !== 'RIFF') throw new Error('invalid captured WAV');
        await options.onText(await fixtureApi.recognize(wav, options));
      } else if (request.model === CALL_MODELS.tts) {
        await fixtureApi.synthesize(request.messages[1].content, request.audio.voice, request.messages[0].content, options);
      } else {
        if (request.model !== CALL_MODELS.dialogue) throw new Error('unexpected fixture model');
        await fixtureApi.dialogue(request.messages, options);
      }
      const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
      const chunks: Uint8Array[] = []; for (let offset = 0; offset < bytes.length; offset += 13) chunks.push(bytes.slice(offset, offset + 13));
      responseChunks.set(id, chunks); return { status: 200, contentType: 'text/event-stream' };
    },
    read: async ({ id }) => { const bytes = responseChunks.get(id)?.shift(); return bytes ? { done: false, data: btoa(String.fromCharCode(...bytes)) } : { done: true }; },
    cancel: async ({ id }) => { cancelledResponseIds.add(id); responseChunks.delete(id); },
  };
  const api = new MimoCallClient(async () => loadSecret('mimo-key'), (url, init) => nativeCallFetch(nativePort, url, init));
  const platform = Capacitor.getPlatform, available = Capacitor.isPluginAvailable;
  try {
    Capacitor.getPlatform = () => 'android';
    Capacitor.isPluginAvailable = name => name === 'VoiceCallAudio';
    let startupError = '';
    try { await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }); }
    catch (error) { startupError = (error as Error).message; }
    check(startupError === 'voice:transport_missing', 'missing native network component is rejected before microphone startup rather than after the first ASR request');
    check(!useVoiceCallStore.getState().busy && !useVoiceCallStore.getState().record && audioStarts === 0,
      'missing native network component leaves no call record or busy state');
  } finally { Capacitor.getPlatform = platform; Capacitor.isPluginAvailable = available; }
  for (const value of ['', 'mock\nkey', 'mock\u200bkey']) {
    if (value) await persistSecret('mimo-key', value); else clearSecret('mimo-key');
    check(await loadSecret('mimo-key') === (value || null), 'encrypted secret round-trip preserves fixture bytes rather than silently rewriting a malformed key');
    await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
    check(useVoiceCallStore.getState().error === (value ? 'voice:key_format' : 'voice:key') && !useVoiceCallStore.getState().busy,
      'missing and malformed secrets are distinguished and clear the call startup state');
    check(audioStarts === 0 && dialogues === 0 && !useVoiceCallStore.getState().record,
      'invalid local key never starts microphone capture, dialogue or a false call record');
    let available = false;
    await withChatSessionLock('host-session', async () => { available = true; });
    check(available, 'invalid key does not retain the ordinary chat session lock');
  }
  for (const corrupt of ['{invalid json', JSON.stringify({ iv: 'invalid', data: 'invalid' })]) {
    localStorage.setItem('virtugene-secret-mimo-key', corrupt);
    await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
    check(useVoiceCallStore.getState().error === 'voice:key_storage' && !useVoiceCallStore.getState().busy,
      'unreadable saved secret is reported as local storage failure rather than missing or rejected service key');
    check(audioStarts === 0 && dialogues === 0 && !useVoiceCallStore.getState().record,
      'corrupted saved secret starts neither hardware nor model requests');
    check(localStorage.getItem('virtugene-secret-mimo-key') === corrupt, 'failure does not silently delete or overwrite a saved secret');
  }
  await persistSecret('mimo-key', 'test-only-placeholder');
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
  check(requestedModels.join(',') === [CALL_MODELS.asr, CALL_MODELS.dialogue, CALL_MODELS.tts, CALL_MODELS.dialogue, CALL_MODELS.dialogue].join(','),
    'capture, reply, speech, summary and original memory all pass through actual MiMo protocol and native transport adapter');
  check(responseChunks.size === 0, 'full call and postprocessing release every simulated native response stream');
  check(memoryCalls === 1 && (await db.memories.where('userId').equals(role.createdBy).toArray()).some(row => row.content.includes('喜欢读诗')), 'MiMo-only call memory commits through the original evidence worker');
  check((await db.memoryJobs.where('userId').equals(role.createdBy).toArray()).filter(job => job.sessionId === 'unrelated-session').every(job => job.status === 'queued' && job.attempts === 0), 'voice memory does not lease or pay to process unrelated sessions');
  check(saved?.usage?.find(row => row.stage === 'asr')?.audioSeconds! > 0, 'ASR uploaded duration is recorded');
  check(saved?.usage?.find(row => row.stage === 'tts')?.inputTokens === undefined, 'missing token usage remains unknown instead of zero');
  for (const stage of ['asr', 'dialogue', 'tts'] as const) {
    failureModel = CALL_MODELS[stage]; failureStatus = stage === 'asr' ? 401 : 503;
    const requestStart = requestedModels.length;
    await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
    const failedCallId = useVoiceCallStore.getState().record!.id;
    for (let sequence = 0; sequence < 12; sequence++) {
      const pcm = new Uint8Array(3200), data = new DataView(pcm.buffer);
      for (let offset = 0; offset < pcm.length; offset += 2) data.setInt16(offset, sequence < 5 ? 8000 : 0, true);
      callback({ callId: failedCallId, type: 'capture', sampleRate: 16000, sequence, pcm: btoa(String.fromCharCode(...pcm)), at: sequence * 100 });
    }
    await wait(() => useVoiceCallStore.getState().view?.phase === 'error');
    const failedView = useVoiceCallStore.getState().view!;
    check(failedView.error === (stage === 'asr' ? 'key' : 'service') && failedView.errorStage === stage && failedView.errorHttpStatus === failureStatus,
      `${stage} HTTP failure crosses full host chain with correct cause, model stage and actual status`);
    check(requestedModels.slice(requestStart).filter(model => model === failureModel).length === 1,
      `${stage} HTTP failure never automatically retries its model request`);
    failureModel = undefined;
    await useVoiceCallStore.getState().end();
    const failedRecord = await db.voiceCalls.get(failedCallId);
    const failedMessages = await db.messages.bulkGet(failedRecord!.messageIds);
    check(failedRecord?.status === 'ended' && failedRecord.exchanges.every(exchange => !exchange.heardText)
      && failedMessages.length === (stage === 'asr' ? 0 : 1) && failedMessages.every(message => message?.role === 'user'),
      `${stage} hangup saves recognized user evidence only, never failed or unplayed assistant speech`);
    check(responseChunks.size === 0 && !useVoiceCallStore.getState().busy && !useVoiceCallStore.getState().saving,
      `${stage} failure/hangup releases response streams and transient host state`);
  }
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
  // A cancelled startup can remain in a text send's session queue while a
  // new call starts elsewhere. Its late continuation must own no new lock.
  await db.sessions.put({ id: 'startup-session-b', characterId: role.id, userId: role.createdBy, title: '另一通话', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  let releaseText!: () => void, textEntered!: () => void;
  const textReady = new Promise<void>(resolve => { textEntered = resolve; });
  const textGate = new Promise<void>(resolve => { releaseText = resolve; });
  const blockedText = withChatSessionLock('host-session', async () => { textEntered(); await textGate; });
  await textReady;
  const originalProfile = voiceProfileRepo.getOrCreate;
  let releaseProfile!: () => void, profileEntered!: () => void;
  const profileReady = new Promise<void>(resolve => { profileEntered = resolve; });
  const profileGate = new Promise<void>(resolve => { releaseProfile = resolve; });
  voiceProfileRepo.getOrCreate = async (characterId, userId) => {
    const value = await originalProfile(characterId, userId);
    profileEntered(); await profileGate; return value;
  };
  let oldStart: Promise<void> | undefined, queuedB: Promise<void> | undefined, sendB = false;
  try {
    const beforeStarts = audioStarts;
    oldStart = useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'host-session' }, { audio, api });
    await profileReady; releaseProfile();
    // After this tick the fulfilled profile continuation has enqueued the
    // startup behind blockedText; there are no subsequent database awaits.
    await new Promise(resolve => setTimeout(resolve, 0));
    check(useVoiceCallStore.getState().busy && audioStarts === beforeStarts, 'startup queued behind a text send does not open the microphone early');
    const cancellation = useVoiceCallStore.getState().end();
    let prematureError = '';
    try { await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'startup-session-b' }, { audio, api }); }
    catch (error) { prematureError = (error as Error).message; }
    check(prematureError === 'voice:busy', 'new startup cannot enter while the cancelled startup is still finishing');
    await cancellation;
    check(!useVoiceCallStore.getState().busy && !useVoiceCallStore.getState().saving, 'queued startup can be cancelled without waiting for an unrelated text request');
    voiceProfileRepo.getOrCreate = originalProfile;
    await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'startup-session-b' }, { audio, api });
    const newerId = useVoiceCallStore.getState().record!.id;
    check(useVoiceCallStore.getState().view?.phase === 'listening' && audioStarts === beforeStarts + 1, 'a different session can start after queued startup cancellation');
    queuedB = withChatSessionLock('startup-session-b', async () => { sendB = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    check(!sendB, 'new call retains its own session lock before the cancelled startup resumes');
    releaseText(); await blockedText; await oldStart;
    await new Promise(resolve => setTimeout(resolve, 0));
    check(!sendB, 'late cancelled startup cannot release a newer call session lock');
    check(useVoiceCallStore.getState().busy && useVoiceCallStore.getState().record?.id === newerId && audioStarts === beforeStarts + 1,
      'late startup cancellation leaves the newer controller, record and microphone intact');
    await useVoiceCallStore.getState().end(); await queuedB;
    check(sendB, 'new session text send resumes only after its own call ends');
  } finally {
    voiceProfileRepo.getOrCreate = originalProfile;
    releaseProfile(); releaseText(); await blockedText; await oldStart;
    await useVoiceCallStore.getState().end(); await queuedB;
  }
  // Same real protocol/store path as short calls, with two distinct PCM
  // markers. Simulated capture time avoids a 40-second blocking test.
  await db.sessions.put({ id: 'long-speech-session', characterId: role.id, userId: role.createdBy, title: '长句协议回归', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  longSpeechWavs = [];
  const modelsBeforeLong = requestedModels.length;
  await useVoiceCallStore.getState().start({ userId: role.createdBy, characterId: role.id, sessionId: 'long-speech-session' }, { audio, api });
  const longCallId = useVoiceCallStore.getState().record!.id;
  let longSequence = 0;
  const emitLong = (amplitude: number, count: number) => {
    const pcm = new Uint8Array(3200), values = new DataView(pcm.buffer);
    for (let offset = 0; offset < pcm.length; offset += 2) values.setInt16(offset, amplitude, true);
    const data = btoa(String.fromCharCode(...pcm));
    for (let index = 0; index < count; index++) callback({ type: 'capture', callId: longCallId, pcm: data, sampleRate: 16000, sequence: longSequence, at: longSequence++ * 100 });
  };
  try {
    emitLong(8000, 300);
    await wait(() => useVoiceCallStore.getState().view?.userText === '前半段内容。');
    check(useVoiceCallStore.getState().view?.phase === 'recognizing' && requestedModels.slice(modelsBeforeLong).every(model => model === CALL_MODELS.asr),
      'a completed first long-speech segment remains in ASR until a true pause, without early dialogue or TTS');
    emitLong(9000, 100); emitLong(0, 7);
    await wait(() => useVoiceCallStore.getState().view?.phase === 'listening' && useVoiceCallStore.getState().record?.exchanges.length === 1);
    check(longSpeechWavs.length === 2 && longSpeechWavs[0].length === 960044 && longSpeechWavs[1].length === 326444,
      'real ASR serialization emits one 30-second WAV and one 10-second tail plus 200ms silence');
    const firstWav = new DataView(longSpeechWavs[0].buffer), tailWav = new DataView(longSpeechWavs[1].buffer);
    check(firstWav.getInt16(44, true) === 8000 && firstWav.getInt16(960042, true) === 8000
      && tailWav.getInt16(44, true) === 9000 && tailWav.getInt16(320042, true) === 9000 && tailWav.getInt16(320044, true) === 0,
      'PCM markers preserve the voiced first-segment tail and place the second segment after it without repeated pre-roll');
    const longModels = requestedModels.slice(modelsBeforeLong);
    check(longModels.filter(model => model === CALL_MODELS.asr).length === 2
      && longModels.filter(model => model === CALL_MODELS.dialogue).length === 1
      && longModels.filter(model => model === CALL_MODELS.tts).length === 1,
      '40-second speech has two distinct ASR requests and one original dialogue/TTS response, without retry');
    check(useVoiceCallStore.getState().record?.exchanges[0].userText === '前半段内容。\n后半段内容。',
      'the real call store receives both completed ASR texts in their original order as one exchange');
    await useVoiceCallStore.getState().end();
    const savedLong = await db.voiceCalls.get(longCallId), longUsage = savedLong?.usage?.filter(row => row.stage === 'asr');
    check(longUsage?.length === 2 && longUsage.every(row => row.inputTokens === 10 && row.outputTokens === 1)
      && longUsage[0].audioSeconds === 30 && longUsage[1].audioSeconds === 10.2,
      'durable usage records both unique ASR segments and their fixture usage/audio duration rather than pretending one request');
    check(savedLong?.exchanges.length === 1 && savedLong.exchanges[0].userText === '前半段内容。\n后半段内容。'
      && savedLong.exchanges[0].heardText.length > 0,
      'hangup persists the merged user speech and only playback-acknowledged assistant facts');
  } finally { await useVoiceCallStore.getState().end(); longSpeechWavs = undefined; }
  // Typed turns keep the same real persona, protocol, playback receipts and
  // repositories. Only the native audio/HTTP endpoints remain local fixtures.
  typedFixture = true;
  const typedOwner = { userId: role.createdBy, characterId: role.id, sessionId: 'typed-session' };
  await db.sessions.put({ id: typedOwner.sessionId, characterId: role.id, userId: role.createdBy, title: '文字输入语音回复', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  await useVoiceCallStore.getState().start(typedOwner, { audio, api }, 'text');
  const typedCallId = useVoiceCallStore.getState().record!.id;
  check(useVoiceCallStore.getState().view?.phase === 'listening' && useVoiceCallStore.getState().view?.inputMode === 'text'
    && audioStartModes.at(-1) === 'text', 'typed start carries text mode through the real store/controller to audio initialization');
  const typedRequestStart = requestedModels.length;
  for (const [value, expected] of [[' \n\t ', 'voice:text_empty'], ['字'.repeat(4097), 'voice:text_limit']]) {
    let rejected = '';
    try { await useVoiceCallStore.getState().sendText(value); } catch (error) { rejected = (error as Error).message; }
    check(rejected === expected && requestedModels.length === typedRequestStart && !useVoiceCallStore.getState().record?.exchanges.length,
      `${expected} cannot create a model request or a false durable exchange`);
  }
  const typedPcm = new Uint8Array(3200), typedSamples = new DataView(typedPcm.buffer);
  for (let offset = 0; offset < typedPcm.length; offset += 2) typedSamples.setInt16(offset, 8000, true);
  for (let sequence = 0; sequence < 12; sequence++) callback({ callId: typedCallId, type: 'capture', sampleRate: 16000, sequence,
    pcm: btoa(String.fromCharCode(...(sequence < 5 ? typedPcm : new Uint8Array(3200)))), at: sequence * 100 });
  await new Promise(resolve => setTimeout(resolve, 0));
  check(requestedModels.length === typedRequestStart && useVoiceCallStore.getState().view?.phase === 'listening',
    'late microphone capture events during text mode do not invoke ASR or replace a typed turn');
  const typedUserText = '  今天我改用打字。\n请用声音回答。  ';
  check(await useVoiceCallStore.getState().sendText(typedUserText), 'typed input is accepted through the public store action');
  await wait(() => useVoiceCallStore.getState().view?.phase === 'listening' && useVoiceCallStore.getState().record?.exchanges.length === 1);
  check(requestedModels.slice(typedRequestStart).join(',') === [CALL_MODELS.dialogue, CALL_MODELS.tts].join(','),
    'typed turn makes exactly one real-client dialogue and one TTS fixture request, without ASR');
  check(typedDialogueMessages[0]?.[0].content.includes(role.systemPrompt)
    && typedDialogueMessages[0]?.some(row => row.role === 'user' && row.content.includes(typedUserText)),
    'typed turn invokes the original role context with the accepted user wording');
  check(typedDialogueMessages[0]?.[0].content.includes('[当前交流方式：用户打字，你用声音回答]')
    && !typedDialogueMessages[0]?.[0].content.includes('语音识别可能有误'),
    'typed prompt declares actual text input instead of representing it as a microphone transcript');
  const typedExchange = useVoiceCallStore.getState().record!.exchanges[0];
  check(typedExchange.userText === typedUserText && typedExchange.heardText === typedReply && typedExchange.metrics.asrMs === undefined,
    'typed exchange preserves original whitespace/newlines and records heard audio without invented ASR latency');
  const activeTyped = await db.voiceCalls.get(typedCallId), activeTypedMessages = await db.messages.bulkGet(activeTyped!.messageIds);
  check(activeTyped?.status === 'active' && activeTypedMessages.length === 2
    && activeTypedMessages[0]?.content === typedUserText.trim() && activeTypedMessages[1]?.content === typedReply,
    'typed user text and fully acknowledged reply are durable in the original chat repository before hangup');
  check(activeTyped?.usage?.map(row => row.stage).join(',') === 'dialogue,tts', 'typed usage audit contains only the actual dialogue/TTS attempts');
  const secondTypedText = '接着聊刚才的话题。';
  check(await useVoiceCallStore.getState().sendText(secondTypedText), 'a second typed turn is accepted after the first playback completes');
  await wait(() => useVoiceCallStore.getState().view?.phase === 'listening' && useVoiceCallStore.getState().record?.exchanges.length === 2);
  check(typedDialogueMessages[1]?.some(row => row.role === 'user' && row.content.includes(typedUserText))
    && typedDialogueMessages[1]?.some(row => row.role === 'assistant' && row.content === typedReply),
    'next typed turn receives prior user text and only the previous playback-acknowledged character reply');
  callback({ type: 'paused', callId: typedCallId, at: 0, reason: 'voice:background' });
  await wait(() => useVoiceCallStore.getState().view?.phase === 'paused');
  const pausedRequests = requestedModels.length;
  check(await useVoiceCallStore.getState().sendText('暂停期间不应发送') === false && requestedModels.length === pausedRequests
    && useVoiceCallStore.getState().view?.phase === 'paused', 'paused typed call rejects submission without resuming or issuing a request');
  await useVoiceCallStore.getState().resume();
  check(useVoiceCallStore.getState().view?.phase === 'listening' && useVoiceCallStore.getState().view?.inputMode === 'text',
    'explicit resume restores typed input mode');
  await useVoiceCallStore.getState().setInputMode('voice');
  check(useVoiceCallStore.getState().view?.inputMode === 'voice' && audioModeChanges.at(-1) === 'voice', 'typed call can explicitly restore voice capture mode');
  const voiceModeRequests = requestedModels.length;
  check(await useVoiceCallStore.getState().sendText('语音模式不能暗中提交文字') === false && requestedModels.length === voiceModeRequests,
    'voice mode rejects hidden typed sends instead of silently changing its input mode');
  await useVoiceCallStore.getState().setInputMode('text');
  check(useVoiceCallStore.getState().view?.inputMode === 'text' && audioModeChanges.at(-1) === 'text', 'voice mode can explicitly return to typed input');
  await useVoiceCallStore.getState().end();
  const typedSaved = await db.voiceCalls.get(typedCallId);
  check(typedSaved?.status === 'ended' && typedSaved.summaryState === 'ready' && typedSaved.messageIds.length === 4
    && typedSaved.usage?.every(row => row.stage !== 'asr'), 'typed call completes ordinary durable summary/memory processing without adding ASR usage');
  const endedRequests = requestedModels.length;
  check(await useVoiceCallStore.getState().sendText('挂断后不应发送') === false && requestedModels.length === endedRequests,
    'ended call refuses typed submission');
  await useVoiceCallStore.getState().start(typedOwner, { audio, api }, 'text');
  const typedFailureId = useVoiceCallStore.getState().record!.id;
  failureModel = CALL_MODELS.tts; failureStatus = 503;
  const typedFailureStart = requestedModels.length;
  check(await useVoiceCallStore.getState().sendText('这条文字已发送，但回复声音会失败。'), 'accepted typed input remains an actual user fact if TTS later fails');
  await wait(() => useVoiceCallStore.getState().view?.phase === 'error');
  check(useVoiceCallStore.getState().view?.errorStage === 'tts' && useVoiceCallStore.getState().view?.errorHttpStatus === 503
    && requestedModels.slice(typedFailureStart).join(',') === [CALL_MODELS.dialogue, CALL_MODELS.tts].join(','),
    'typed TTS failure retains actual stage/status with no ASR or automatic retry');
  const errorRequests = requestedModels.length;
  check(await useVoiceCallStore.getState().sendText('错误状态不应重试') === false && requestedModels.length === errorRequests,
    'error state rejects further typed submission without automatically paying to retry');
  failureModel = undefined;
  await useVoiceCallStore.getState().resume();
  check(useVoiceCallStore.getState().view?.phase === 'listening' && useVoiceCallStore.getState().view?.inputMode === 'text'
    && requestedModels.length === errorRequests, 'explicit recovery restores text input without resending the failed request');
  await useVoiceCallStore.getState().end();
  const typedFailed = await db.voiceCalls.get(typedFailureId), typedFailedMessages = await db.messages.bulkGet(typedFailed!.messageIds);
  check(typedFailed?.exchanges[0].generatedText === typedReply && !typedFailed.exchanges[0].heardText
    && typedFailedMessages.length === 1 && typedFailedMessages[0]?.role === 'user',
    'generated-only typed reply stays audit data and never becomes a spoken chat message or summary source');
  for (const cancellation of ['hangup', 'account'] as const) {
    await useVoiceCallStore.getState().start(typedOwner, { audio, api }, 'text');
    const cancelledCallId = useVoiceCallStore.getState().record!.id;
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    heldTypedRequest = { entered, wait: gate };
    const requestStart = requestedModels.length;
    try {
      check(await useVoiceCallStore.getState().sendText(`等待${cancellation}取消的文字`), `${cancellation} fixture accepts its text before the dialogue response is delayed`);
      await entry;
      if (cancellation === 'account') {
        useAuthStore.setState({ userId: 'another-host-user' });
        check(await useVoiceCallStore.getState().sendText('新账号不能继续旧通话') === false && requestedModels.length === requestStart + 1,
          'account change refuses another typed send into the old account call');
      }
      await useVoiceCallStore.getState().end();
      release(); await new Promise(resolve => setTimeout(resolve, 0));
      const cancelled = await db.voiceCalls.get(cancelledCallId);
      const replies = cancelled ? (await db.messages.bulkGet(cancelled.messageIds)).filter(row => row?.role === 'assistant') : [];
      check(!replies.length && !requestedModels.slice(requestStart).includes(CALL_MODELS.tts)
        && useVoiceCallStore.getState().view?.phase === 'ended', `${cancellation} invalidates delayed typed response before any speech or assistant fact is produced`);
      check(cancellation === 'account' ? !cancelled : cancelled?.exchanges[0].userText === `等待${cancellation}取消的文字`,
        `${cancellation} preserves owner-scoped persistence and does not invent a completed reply`);
    } finally { release(); heldTypedRequest = undefined; useAuthStore.setState({ userId: role.createdBy }); await useVoiceCallStore.getState().end(); }
  }
  check(responseChunks.size === 0, 'all typed success/failure/cancellation fixtures release native response leases');
  clearSecret('mimo-key');
  return { checks, mode: 'browser-host-with-native-transport-fixture-and-mock-audio', protocolPath: 'MimoCallClient -> nativeCallFetch -> simulated native SSE', typedCoverage: ['text-start', 'no-ASR', 'original-role-context', 'bounded-input', 'typed-wording', 'playback-facts', 'mode-roundtrip', 'pause-and-error-refusal', 'hangup-cancellation', 'account-isolation'], realApiCalls: 0, modelTokens: 0, usageReceipts: 'synthetic fixtures, not actual consumption', deviceTested: false };
}
main().then(result => { (window as any).voiceProfileResult = result; }).catch(error => { (window as any).voiceProfileResult = { error: String(error) }; });
