import { db, type Character, type Message } from '../../src/db';
import { buildCharacterMemoryContext, revalidateCharacterMemoryContext, type MemoryMode } from '../../src/lib/character-memory';
import { recallHistoricalPrivateChat } from '../../src/lib/character-history-recall';
import { findSceneSegmentHistory } from '../../src/lib/world/scene-recall';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { memorySourceTombstoneRepo } from '../../src/db/memory-source-tombstone-repo';
import { messageRepo } from '../../src/db/message-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { webApi } from '../../src/lib/web-api';
import { sendRoleChatReply } from '../../src/lib/chat/send-service';
import { ChatReplyStream } from '../../src/lib/chat-stream';
import Dexie from 'dexie';
import { prepareCallContext } from '../../src/lib/voice-call/context';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { useGroupStore } from '../../src/store/group-store';
import { momentsRepo } from '../../src/db/moments-repo';

const U = 'portability-owner', A = 'portability-a', B = 'portability-b';
const now = Date.UTC(2026, 9, 15, 8);
const modes: MemoryMode[] = ['private-chat', 'group-chat', 'world-scene', 'moments-comment', 'proactive-chat'];
const checks: { label: string; pass: boolean }[] = [];
const check = (pass: unknown, label: string) => checks.push({ label, pass: !!pass });
const padding = '这是与约定无关的旧日常记录。'.repeat(90);
const character = (id: string): Character => ({ id, createdBy: U, name: id, avatar: '🌿', systemPrompt: '自然直接的成年朋友，只依据真实原话回答。', isPreset: false, isCustom: true, tags: [], createdAt: now, proactivity: 0 } as Character);
type Metric = { operations: number; bodyRows: number; keyRows: number };
let counting = false, reads: Record<string, Metric> = {};
db.use({ stack: 'dbcore', name: 'portability-read-count', create: down => ({ ...down, table: name => {
  const table = down.table(name);
  const metric = () => reads[name] ??= { operations: 0, bodyRows: 0, keyRows: 0 };
  return { ...table,
    get: async req => { const result = await table.get(req); if (counting) { metric().operations++; metric().bodyRows += Number(!!result); } return result; },
    getMany: async req => { const result = await table.getMany(req); if (counting) { metric().operations++; metric().bodyRows += result.filter(Boolean).length; } return result; },
    query: async req => { const result = await table.query(req); if (counting) { metric().operations++; metric()[req.values ? 'bodyRows' : 'keyRows'] += result.result.length; } return result; },
    openCursor: async req => {
      const cursor = await table.openCursor(req);
      if (counting) metric().operations++;
      if (cursor) {
        const start = cursor.start;
        cursor.start = callback => start.call(cursor, () => { if (counting && !cursor.done) metric()[req.values ? 'bodyRows' : 'keyRows']++; callback(); });
      }
      return cursor;
    },
  };
} }) });

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function collectContext(context: Awaited<ReturnType<typeof buildCharacterMemoryContext>>) {
  return { text: context.text, sections: context.sections, references: context.references.map(r => ({ source: r.source, id: r.id, text: r.text })) };
}

Object.assign(window, { characterPortability: async () => {
  window.fetch = async () => { throw Error('External model/network disabled'); };
  await db.delete();
  const legacyDb = new Dexie(db.name);
  legacyDb.version(39).stores(Object.fromEntries(db.tables.map(table => [table.name, table.name === 'sessions'
    ? 'id,characterId,userId,[characterId+userId],updatedAt,groupId,[characterId+userId+type]'
    : [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(',')])));
  await legacyDb.open();
  const legacySessions = Array.from({ length: 3002 }, (_, i) => ({ id: 'legacy-session-' + i, userId: i < 2 ? 'index-owner' : 'unrelated-session-owner', characterId: i < 2 ? 'index-role' : 'unrelated-session-role', type: 'single', title: '旧会话' + i, createdAt: now + i, updatedAt: now, summary: '保留旧摘要和来源，不重写历史' }));
  await legacyDb.table('sessions').bulkPut(legacySessions);
  const beforeUpgrade = await legacyDb.table('sessions').toArray(); legacyDb.close();
  await db.open();
  check(db.verno === 41 && JSON.stringify(beforeUpgrade) === JSON.stringify(await db.sessions.toArray()), 'v39 to v41 preserves all 3002 original session records exactly');
  check(db.sessions.schema.indexes.some(i => i.name === '[characterId+userId+type]') && db.memorySourceTombstones.schema.indexes.some(i => i.name === '[userId+characterId]'), 'index repair retains ownership and scoped tombstone indexes');
  reads = {}; counting = true;
  const indexedSessions = await db.sessions.where('[characterId+userId+createdAt+id]').between(['index-role', 'index-owner', 0, ''], ['index-role', 'index-owner', Dexie.maxKey, Dexie.maxKey]).toArray();
  counting = false;
  check(indexedSessions.length === 2 && reads.sessions?.bodyRows === 2, 'repaired index reads only two matching bodies among 3002 sessions');
  check(await db.sessions.where('[characterId+userId+createdAt+id]').between(['index-role', 'another-owner', 0, ''], ['index-role', 'another-owner', Dexie.maxKey, Dexie.maxKey]).count() === 0, 'session ordering index retains account isolation');
  await db.sessions.update('legacy-session-0', { characterId: 'transferred-role' });
  check(await db.sessions.where('[characterId+userId]').equals(['index-role', 'index-owner']).count() === 1, 'role transfer updates both session ownership and ordering indexes');
  try { await db.transaction('rw', db.sessions, async () => { await db.sessions.update('legacy-session-1', { characterId: 'transferred-role' }); throw Error('test rollback'); }); } catch { /* expected */ }
  check((await db.sessions.get('legacy-session-1'))?.characterId === 'index-role', 'session index transaction rollback preserves original ownership');
  await db.sessions.delete('legacy-session-1');
  check(await db.sessions.where('[characterId+userId+createdAt+id]').between(['index-role', 'index-owner', 0, ''], ['index-role', 'index-owner', Dexie.maxKey, Dexie.maxKey]).count() === 0, 'session deletion removes its ordered entry');
  useAuthStore.setState({ userId: U, isLoggedIn: true, apiKey: 'isolated-no-real-key' });
  useSettingsStore.setState({ aiVoiceMode: false, ttsEnabled: false, diaryPin: null });
  await db.characters.bulkPut([character(A), character(B)]);
  await db.sessions.bulkPut([
    { id: 'old-chat', userId: U, characterId: A, type: 'single', title: '旧会话', createdAt: now - 10000, updatedAt: now - 5000, unreadCount: 0 },
    { id: 'current-chat', userId: U, characterId: A, type: 'single', title: '新会话', createdAt: now, updatedAt: now, unreadCount: 0, modelAsked: true, model: { provider: 'deepseek', model: 'deepseek-chat' } },
    { id: 'other-chat', userId: U, characterId: B, type: 'single', title: '另一角色', createdAt: now, updatedAt: now, unreadCount: 0 },
  ] as any);
  const long: Message = { id: 'long-original', sessionId: 'old-chat', role: 'user', content: padding + '；青岚项目不要周五交稿，改为周四下午四点交给林舟。', createdAt: now - 8000, revision: 1, isProactive: false };
  const short: Message = { id: 'short-original', sessionId: 'old-chat', role: 'user', content: '枫桥预约在周二上午十点。', createdAt: now - 7000, revision: 1, isProactive: false };
  await db.messages.bulkPut([long, short, ...Array.from({ length: 510 }, (_, i) => ({ id: 'filler-' + i, sessionId: i % 3 ? 'old-chat' : 'other-chat', role: 'user' as const, content: '无关的既有聊天资料' + i, createdAt: now - 6000 + i, revision: 1, isProactive: false }))]);
  await db.messages.bulkPut([
    { id: 'same-ms-a', sessionId: 'old-chat', role: 'user', content: '朝露安排最初定在周五。', createdAt: now - 7500, revision: 1, isProactive: false },
    { id: 'same-ms-b', sessionId: 'old-chat', role: 'user', content: '不是周五，是周四。', createdAt: now - 7500, revision: 1, isProactive: false },
  ]);
  const sameMillisecond = await recallHistoricalPrivateChat({ userId: U, characterId: A, query: '朝露安排定在哪天' });
  check(sameMillisecond.some(hit => hit.messageId === 'same-ms-b' && hit.followsMessageId === 'same-ms-a'), 'adjacent correction at the same timestamp remains linked to the original user statement');
  const correctedAtSameTime = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '朝露安排定在哪天', mode: 'private-chat', excludeSessionId: 'current-chat', sources: ['chat'] });
  check(correctedAtSameTime.text.includes('不是周五，是周四') && correctedAtSameTime.text.includes('以后续用户更正为准'), 'new-session recall carries the same-timestamp correction with its chronology instruction');
  await db.memorySourceTombstones.bulkPut(Array.from({ length: 8105 }, (_, i) => ({ id: 'unrelated-tombstone-' + i, userId: i % 5 ? U : 'other-owner', characterId: 'unrelated-role-' + i % 20, sourceType: 'message' as const, sourceId: 'removed-' + i, sourceRevision: 1, status: 'deleted' as const, updatedAt: now, suppressedMessageIds: ['removed-' + i] })));
  await db.diaries.bulkPut(Array.from({ length: 120 }, (_, i) => ({ id: 'private-diary-' + i, userId: U, date: '2026-10-15', title: '未分享资料', content: 'PRIVATE_DIARY_' + i, visibility: 'private', visibleTo: [], tags: [], createdAt: now, updatedAt: now })) as any);
  await db.characterKnowledge.bulkPut(Array.from({ length: 900 }, (_, i) => ({ id: 'unrelated-knowledge-' + i, userId: U, characterId: B, worldId: 'unrelated-world', eventId: 'missing-event-' + i, knowledgeLevel: 'full', canMention: true, learnedAt: now })));
  const originalContentHash = await digest((await db.messages.get(long.id))!.content);
  const indexed = await recallHistoricalPrivateChat({ userId: U, characterId: A, query: '青岚项目什么时候交稿', limit: 3 });
  check(indexed.some(h => h.messageId === long.id && h.content.includes('周四下午四点交给林舟')), 'indexed private history retains the requested late detail');
  check(indexed.some(h => h.messageId === long.id && h.content.includes('不要周五')), 'contiguous excerpt preserves the negative instruction beside its correction');
  const projection = await db.messageHistorySearch.where('sessionId').equals('old-chat').toArray();
  await db.messageHistorySearch.where('sessionId').equals('old-chat').delete();
  const legacy = await recallHistoricalPrivateChat({ userId: U, characterId: A, query: '青岚项目什么时候交稿', limit: 3 });
  check(legacy.some(h => h.content.includes('周四下午四点交给林舟')), 'legacy incomplete index also retains the original late detail');
  await db.messageHistorySearch.bulkPut(projection);
  const longQuery = '关于一些没有关系的背景说明以及我们刚聊过的日常生活情况暂时先放一边再想想，青岚项目什么时候交稿';
  check((await recallHistoricalPrivateChat({ userId: U, characterId: A, query: longQuery })).some(h => h.content.includes('周四下午四点')), 'long query searches its ending subject');
  await db.characters.update(A, { name: '改名后的同一个人' });
  for (const mode of modes) {
    const context = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '青岚项目什么时候交稿', mode, excludeSessionId: 'current-chat', budget: 5000 });
    check(context.references.some(r => r.id === long.id && r.text.includes('周四下午四点')), mode + ': renamed character carries long original into a new entrance');
    check(!context.text.includes('PRIVATE_DIARY_'), mode + ': unrelated private diaries remain unavailable');
  }
  const other = await buildCharacterMemoryContext({ userId: U, characterId: B, topic: '青岚项目什么时候交稿', budget: 5000 });
  check(!other.text.includes('交给林舟'), 'different role never inherits the old private chat');
  const wrongAccount = await buildCharacterMemoryContext({ userId: 'other-owner', characterId: A, topic: '青岚项目' });
  check(!wrongAccount.references.length, 'different account is denied');
  const shared = await buildCharacterMemoryContext({ userId: U, characterId: A, audience: [A, B], topic: '青岚项目', mode: 'group-chat' });
  check(!shared.text.includes('交给林舟'), 'private fact does not leak into a shared audience');
  const sourceContext = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '青岚项目什么时候交稿', sources: ['chat'], budget: 5000 });
  await messageRepo.update(long.id, { content: padding + '；青岚项目已改为下周一上午九点交给林舟。' });
  const rechecked = await revalidateCharacterMemoryContext({ userId: U, characterId: A }, sourceContext);
  check(!rechecked.references.some(r => r.id === long.id), 'editing source invalidates an already selected excerpt');
  const corrected = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '青岚项目什么时候交稿', sources: ['chat'], budget: 5000 });
  check(corrected.text.includes('下周一上午九点') && !corrected.text.includes('周四下午四点'), 'fresh recall uses edited source across entrances');
  await db.messages.put(long);
  const world = await worldRepo.ensureDefaultWorld(U);
  const sceneId = await worldSceneRepo.createScene({ userId: U, worldId: world.id, characterIds: [A], title: '山城同行', place: '山城', timeLabel: '故事历三年夏夜', mood: '平静' });
  await worldSceneRepo.setSceneStatus(sceneId, 'active');
  const sceneAt = Date.now() + 100;
  await db.worldSceneEntries.bulkPut([
    { id: 'scene-late-detail', sceneId, kind: 'user_input', content: padding + '；雾岭约定不要走北门，改从西门会合。', createdAt: sceneAt },
    ...Array.from({ length: 25 }, (_, i) => ({ id: 'scene-later-' + i, sceneId, kind: 'user_input', content: '接着看看沿途风景' + i, createdAt: sceneAt + 1 + i })),
  ] as any);
  const sceneHit = await findSceneSegmentHistory({ userId: U, worldId: world.id, characterId: A, query: '雾岭约定从哪里会合' });
  check(sceneHit.some(h => h.text.includes('不要走北门，改从西门会合')), 'long scene original keeps the actual meeting instruction');
  for (const mode of modes) {
    const context = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '雾岭约定从哪里会合', mode, sources: ['world'], budget: 5000 });
    check(context.text.includes('不要走北门，改从西门会合'), mode + ': witnessed scene detail follows the character');
  }
  const unseen = await buildCharacterMemoryContext({ userId: U, characterId: B, topic: '雾岭约定从哪里会合', sources: ['world'] });
  check(!unseen.text.includes('西门会合'), 'unwitnessed scene detail stays private to its participant');
  const scopeDenied = await findSceneSegmentHistory({ userId: 'other-owner', worldId: world.id, characterId: A, query: '雾岭约定' });
  check(!scopeDenied.length, 'world ownership still gates excerpt lookup');
  const nextWorld = { ...world, id: 'portability-next-world', name: '新的星域', isDefault: false };
  await db.worlds.put(nextWorld);
  const nextScene = await worldSceneRepo.createScene({ userId: U, worldId: nextWorld.id, characterIds: [A], title: '新地点', place: '海边', timeLabel: '故事历四年春晨', mood: '平静' });
  const crossing = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '雾岭约定从哪里会合', mode: 'world-scene', scene: { worldId: nextWorld.id, sceneId: nextScene }, sources: ['world'], budget: 5000 });
  check(crossing.text.includes('西门会合') && crossing.text.includes('不是本场现场'), 'entering a new world retains a personally witnessed old-world detail as history');
  check(crossing.sections.historical.includes('西门会合'), 'prior-world experience is placed in the historical section rather than current scene facts');
  const crossingExplicit = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '雾岭约定', worldId: nextWorld.id, scene: { worldId: nextWorld.id, sceneId: nextScene }, sources: ['world'] });
  check(!crossingExplicit.text.includes('西门会合'), 'explicit world-only retrieval still excludes older worlds');
  const crossingShared = await buildCharacterMemoryContext({ userId: U, characterId: A, audience: [A, B], topic: '雾岭约定', scene: { worldId: nextWorld.id, sceneId: nextScene }, sources: ['world'] });
  check(!crossingShared.text.includes('西门会合'), 'cross-world continuity never widens the shared audience');
  await db.worlds.put({ ...nextWorld, id: 'foreign-context-world', userId: 'another-owner' });
  const foreignContext = await buildCharacterMemoryContext({ userId: U, characterId: A, scene: { worldId: 'foreign-context-world' }, topic: '青岚项目' });
  check(!foreignContext.references.length, 'foreign current-world context cannot open account-wide recall');
  const performanceSamples = [];
  // Same unchanged short source and exact prompt hash on both source versions.
  for (const topic of ['枫桥预约在什么时候', '青岚项目什么时候交稿', '没有匹配的主题']) {
    for (let i = 0; i < 3; i++) {
      reads = {}; counting = true; const start = performance.now();
      let context;
      try {
        context = await buildCharacterMemoryContext({ userId: U, characterId: A, topic, excludeSessionId: 'current-chat', budget: 5000 });
        context = await revalidateCharacterMemoryContext({ userId: U, characterId: A, topic }, context);
      } finally { counting = false; }
      performanceSamples.push({ topic, iteration: i, preparationMs: performance.now() - start, reads, payloadHash: await digest(collectContext(context!)), ids: context!.references.map(r => r.id) });
    }
  }
  await db.groups.put({ id: 'witnessed-group', userId: U, name: '曾经的讨论组', characterIds: [B], createdAt: now, updatedAt: now });
  await db.sessions.put({ id: 'witnessed-session', userId: U, type: 'group', groupId: 'witnessed-group', characterId: '', title: '讨论', createdAt: now, updatedAt: now } as any);
  await db.messages.put({ id: 'witnessed-long', sessionId: 'witnessed-session', role: 'user', content: padding + '；云栖排练约在周六三点，不是周日。', witnessedBy: [A], createdAt: now + 500, revision: 1, isProactive: false });
  for (const mode of modes) {
    const context = await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '云栖排练约在什么时候', mode, sources: ['group'], budget: 2600 });
    check(context.text.includes('周六三点，不是周日'), mode + ': long witnessed group message survives leaving the group and a bounded prompt');
  }
  const notWitnessed = await buildCharacterMemoryContext({ userId: U, characterId: B, topic: '云栖排练', sources: ['group'] });
  check(!notWitnessed.text.includes('周六三点'), 'current group membership never substitutes for historical witnessing');
  const groupShared = await buildCharacterMemoryContext({ userId: U, characterId: A, audience: [A, B], topic: '云栖排练', sources: ['group'] });
  check(!groupShared.text.includes('周六三点'), 'group excerpt still requires every listener to have witnessed it');
  check(await digest((await db.messages.get(long.id))!.content) === originalContentHash, 'excerpt extraction never rewrites archived original');
  await memorySourceTombstoneRepo.record({ userId: U, characterId: A, sourceType: 'message', sourceId: long.id, sourceRevision: 1, suppressedMessageIds: [long.id], status: 'withdrawn' });
  check(!(await recallHistoricalPrivateChat({ userId: U, characterId: A, query: '青岚项目什么时候交稿' })).some(h => h.messageId === long.id), 'withdrawn source cannot return through excerpt lookup');
  await db.messages.delete(short.id);
  check(!(await recallHistoricalPrivateChat({ userId: U, characterId: A, query: '枫桥预约' })).some(h => h.messageId === short.id), 'deleted source disappears from indexed recall');
  // Actual send service, fixed simulated transport; no external API or microphone.
  const activeCharacter = (await db.characters.get(A))!;
  useChatStore.setState({ characters: [activeCharacter], currentSessionId: 'current-chat', selectedCharacterId: A, messages: [], hasMoreMessages: false });
  const source: Message = { id: 'actual-send', sessionId: 'current-chat', role: 'user', content: '雾岭约定从哪里会合', createdAt: Date.now() + 1000, revision: 1, isProactive: false };
  await db.messages.put(source); useChatStore.getState().addMessage(source);
  webApi.context.summarize = async () => ({ error: 'isolated-test' });
  webApi.context.settle = async () => ({ error: 'isolated-test' });
  webApi.memory.extract = async () => ({ memories: [] });
  let transportCalls = 0, preparationMs = 0, firstBodyMs = 0, firstVisibleMs = 0, input = '';
  let sendReads: Record<string, Metric> = {};
  const start = performance.now();
  webApi.chat.send = async params => {
    transportCalls++; preparationMs = performance.now() - start; sendReads = reads; counting = false;
    input = JSON.stringify({ systemPrompt: params.systemPrompt, history: params.history, message: params.message });
    await new Promise(resolve => setTimeout(resolve, 60)); firstBodyMs = performance.now() - start;
    const reply = params.systemPrompt.includes('西门会合') ? '你说改从西门会合，不走北门。' : '这轮未找到可引用的约定。';
    params.onDelta?.(reply); return { content: reply };
  };
  const stream = new ChatReplyStream(source.sessionId, () => { firstVisibleMs ||= performance.now() - start; });
  reads = {}; counting = true;
  try { await sendRoleChatReply(activeCharacter, source, { userId: U, controller: new AbortController(), stream, completed: false, stopped: false }, { userId: U, text: source.content }); }
  finally { counting = false; stream.dispose(); }
  check(transportCalls === 1, 'actual send uses exactly one simulated model request');
  check(input.includes('西门会合'), 'actual role-send model input contains the late scene instruction');
  check(firstVisibleMs >= firstBodyMs && firstBodyMs >= preparationMs, 'per-turn preparation, body and first visible callback are recorded separately');
  const send = { transportCalls, preparationMs, firstBodyMs, firstVisibleMs, totalMs: performance.now() - start, inputHash: await digest(input), reads: sendReads };
  reads = {}; counting = true; const voiceStarted = performance.now();
  const voice = await prepareCallContext({ userId: U, characterId: A, sessionId: 'current-chat', worldId: nextWorld.id }, '雾岭约定从哪里会合', [], new AbortController().signal, 'text');
  const voicePreparationMs = performance.now() - voiceStarted;
  const voicePrompt = voice.messages.find(m => m.role === 'system')?.content ?? '';
  const voiceDebug = { length: voicePrompt.length, memoryStart: voicePrompt.indexOf('【你在不同地方'), excerpt: voicePrompt.slice(Math.max(0, voicePrompt.indexOf('【你在不同地方')), Math.max(0, voicePrompt.indexOf('【你在不同地方')) + 2600) };
  check(voice.messages.some(m => m.role === 'system' && m.content.includes('西门会合')), 'actual voice context carries witnessed old-world detail without microphone or model use');
  await voice.assertCurrent();
  check(true, 'voice pre-send source validation accepts the same cross-world evidence');
  const voiceReads = reads; counting = false;
  await db.worldSceneEntries.update('scene-late-detail', { content: '雾岭约定已经更改。' });
  let voiceRevoked = false;
  try { await voice.assertCurrent(); } catch { voiceRevoked = true; }
  check(voiceRevoked, 'voice source edit after preparation blocks the stale cross-world memory');
  const sharedMemory = { id: 'exact-shared-memory', userId: U, worldId: world.id, title: '月岛约定', summary: '月岛约定在周三正午见面。', sourceType: 'message', sourceId: 'original-shared', characterIds: [A], participants: [`c:${A}`], visibility: 'selected', visibleTo: [A], createdAt: now, updatedAt: now };
  await db.sharedMemories.put(sharedMemory as any);
  await db.worldEvents.bulkPut(Array.from({ length: 1000 }, (_, i) => ({ id: 'unrelated-event-' + i, userId: U, worldId: world.id, type: 'pulse', title: '无关事件' + i, summary: '', sourceType: 'user', sourceId: 'unrelated-' + i, visibility: 'private', visibleTo: [], timestamp: now - i, createdAt: now, updatedAt: now, memoryIds: [] })) as any);
  await db.worldEvents.put({ id: 'exact-shared-event', userId: U, worldId: world.id, type: 'shared_memory', title: '月岛约定', summary: sharedMemory.summary, sourceType: 'shared_memory', sourceId: sharedMemory.id, visibility: 'selected', visibleTo: [A], timestamp: Date.now() + 100, createdAt: now, updatedAt: now, memoryIds: [sharedMemory.id] } as any);
  await knowledgeRepo.upsert({ userId: U, worldId: world.id, characterId: A, eventId: 'exact-shared-event', knowledgeLevel: 'full', canMention: true });
  const selectedRequest = { userId: U, characterId: A, topic: '月岛约定什么时候见面', worldId: world.id, sources: ['world' as const], budget: 5000 };
  const selectedContext = await buildCharacterMemoryContext(selectedRequest);
  check(selectedContext.references.some(r => r.id === sharedMemory.id), 'selected-reference performance fixture contains the actual shared-memory source');
  reads = {}; counting = true; const validationStarted = performance.now();
  const selectedChecked = await revalidateCharacterMemoryContext(selectedRequest, selectedContext);
  const selectedValidation = { elapsedMs: performance.now() - validationStarted, reads, payloadHash: await digest(collectContext(selectedChecked)) }; counting = false;
  check(selectedChecked.references.some(r => r.id === sharedMemory.id), 'exact shared-event validation retains the owned known memory');
  check((selectedValidation.reads.worldEvents?.bodyRows ?? 0) < 50, 'selected shared-memory validation does not rescan 1000 unrelated world events');
  await knowledgeRepo.upsert({ userId: U, worldId: world.id, characterId: A, eventId: 'exact-shared-event', knowledgeLevel: 'full', canMention: false });
  check(!(await revalidateCharacterMemoryContext(selectedRequest, selectedContext)).references.some(r => r.id === sharedMemory.id), 'shared-memory permission revocation is checked fresh after exact-source optimization');
  await worldSceneRepo.setSceneStatus(nextScene, 'active');
  await db.worldSceneEntries.put({ id: 'private-next-world', sceneId: nextScene, kind: 'user_input', content: '霜桥约定周五黄昏在东门会合。', createdAt: Date.now() + 100 } as any);
  const group = { id: 'actual-portability-group', userId: U, name: '跨入口验证', characterIds: [A, B], createdAt: Date.now(), updatedAt: Date.now() };
  await db.groups.put(group);
  await db.sessions.put({ id: 'actual-group-session', userId: U, characterId: '', groupId: group.id, type: 'group', title: group.name, createdAt: Date.now(), updatedAt: Date.now() } as any);
  useGroupStore.setState({ currentGroup: group, currentGroupId: group.id, currentSessionId: 'actual-group-session', groupMessages: [], groupSending: false });
  const originalFetch = window.fetch;
  const groupPrompts: any[] = [];
  const responses = [JSON.stringify({ turns: [{ speaker: activeCharacter.name, content: '导演草稿甲' }, { speaker: B, content: '导演草稿乙' }] }), '我在听。', JSON.stringify({ safe: true }), '我听见了。', JSON.stringify({ safe: true })];
  window.fetch = async (_url, init) => {
    groupPrompts.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(JSON.stringify({ choices: [{ message: { content: responses.shift() ?? '我在听。' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try { await useGroupStore.getState().sendGroupMessage('聊聊霜桥约定'); } finally { window.fetch = originalFetch; }
  const systemAt = (index: number) => String(groupPrompts[index]?.messages?.[0]?.content ?? '');
  check(groupPrompts.length >= 5 && !useGroupStore.getState().groupError, 'actual group store completes separate actor and disclosure-review mock requests');
  check(systemAt(1).includes('周五黄昏在东门会合'), 'actual group actor receives its personally known nondefault-world memory');
  check(!systemAt(3).includes('周五黄昏在东门会合'), 'actual other group actor never receives that private world memory');
  check(!systemAt(0).includes('周五黄昏在东门会合'), 'actual shared group director never receives an actor-private world detail');
  await db.moments.put({ id: 'actual-recall-post', userId: U, authorCharacterId: null, text: '霜桥约定', mediaIds: [], visibility: 'selected', audienceCharacterIds: [A], visibilityRevision: 1, deleted: false, createdAt: Date.now(), updatedAt: Date.now() } as any);
  await db.momentReactions.put({ id: 'actual-user-comment', userId: U, momentId: 'actual-recall-post', type: 'comment', content: '聊聊霜桥约定', status: 'active', createdAt: Date.now(), updatedAt: Date.now() });
  await db.momentJobs.put({ id: 'actual-recall-job', userId: U, characterId: A, momentId: 'actual-recall-post', type: 'reply', replyToId: 'actual-user-comment', visibilityRevision: 1, status: 'queued', availableAt: 0, attempts: 0, createdAt: Date.now(), updatedAt: Date.now() });
  const momentPrompts: any[] = [];
  window.fetch = async (_url, init) => {
    momentPrompts.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(JSON.stringify({ choices: [{ message: { content: momentPrompts.length === 1 ? '这个话题挺有意思。' : JSON.stringify({ safe: true }) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try { await momentsRepo.processJobs(U); } finally { window.fetch = originalFetch; }
  check(String(momentPrompts[0]?.messages?.[0]?.content ?? '').includes('周五黄昏在东门会合'), 'actual moment comment preparation receives the same character nondefault-world memory');
  const savedComment = await db.momentReactions.get('moment-comment:actual-user-comment:' + A);
  check(savedComment?.content === '这个话题挺有意思。' && !savedComment.content.includes('东门'), 'actual moment reply keeps private facts out of the published mock comment');
  return { complete: checks.every(c => c.pass), checks, performanceSamples, send, voiceDebug, voicePreparationMs, voiceReads, selectedValidation, modelCalls: 0, modelTokens: 0, microphoneCalls: 0,
    fixture: { messages: 512, tombstones: 8105, unrelatedKnowledge: 900, privateDiaries: 120 }, scope: 'isolated Chrome/IndexedDB + actual send service; simulated 60ms transport; visibility is stream callback, not Android display timing' };
} });
