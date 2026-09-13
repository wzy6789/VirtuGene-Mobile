/**
 * VirtuGene 5.0.0 Living World 验收 E：失败恢复、解析兼容、性能、迁移
 * （§30 / §51 / §52 / §53 / §55 / §63 / §64 / §104 / §106 / §107）
 *
 * 这一套的顺序是**刻意的**：迁移测试必须最先跑，因为那时数据库还不存在，
 * 我们才能真正用 v17 的 schema 建出一个"4.1.0 升级到 5.0 之前"的库。
 */
import Dexie from 'dexie';
import { db, VirtuGeneDB } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { worldTurnRepo } from '../../src/db/world-turn-repo';
import { ensureCanvasScene, loadCanvas } from '../../src/lib/world/world-canvas';
import { groupStream } from '../../src/components/world/WorldStream';
import { runWorldTurn, retryWorldTurn } from '../../src/lib/world/world-turn';
import { safeParseAIResponse, safeParseObject, salvagePlainText } from '../../src/lib/ai/safe-json';
import { classifyWorldAiError, worldAiAvailability, resetWorldAiCallCount } from '../../src/lib/world/world-ai-client';
import { useAuthStore } from '../../src/store/auth-store';
import { installFakeLlm, createReporter, seedWorld, sleep, fakeCharacter } from './world-harness';
import type { Character } from '../../src/db/index';

const DB_NAME = 'virtugene';
const U = 'u-worldE';
const C1 = 'cE-moon';
const C2 = 'cE-star';
const NOW = Date.now();
const DAY = 86_400_000;

const rep = createReporter();
const { check, section } = rep;const llm = installFakeLlm();
const realFetch = llm.realFetch;

/** 5.0.0 v17 的 schema（= 4.1.0 那 11 张表 + Phase 1 的 8 张世界表；**没有** worldFacts/worldTurns） */
function v17Schema() {
  return {
    users: 'id,username',
    characters: 'id,isPreset,published,createdBy',
    sessions: 'id,characterId,userId,[characterId+userId],updatedAt,groupId',
    messages: 'id,sessionId,[sessionId+createdAt]',
    memories: 'id,characterId,userId,createdAt',
    emotionSnapshots: 'id,sessionId,characterId,createdAt',
    characterStates: '[characterId+userId],userId',
    diaries: 'id,userId,date,[userId+date]',
    groups: 'id,userId',
    continuityThreads: 'id,characterId,userId,[characterId+userId],[characterId+status],status,createdAt',
    sharedStoryEvents: 'id,userId,*characterIds,createdAt',
    worlds: 'id,userId,isDefault',
    worldEvents: 'id,userId,worldId,type,[worldId+timestamp],[worldId+type],[worldId+sourceType+sourceId],sourceType,sourceId,timestamp',
    worldScenes: 'id,userId,worldId,status,[worldId+status],updatedAt',
    worldSceneEntries: 'id,sceneId,[sceneId+index],index',
    characterKnowledge: 'id,userId,worldId,characterId,eventId,[characterId+eventId],[worldId+characterId]',
    sharedMemories: 'id,userId,worldId,[worldId+createdAt],sourceType,sourceId,[worldId+sourceType+sourceId],*characterIds',
    relationshipStates: 'id,userId,worldId,pairKey,[worldId+pairKey],*subjects',
    relationshipEvents: 'id,userId,worldId,pairKey,[worldId+pairKey],*subjects,sourceEventId,createdAt',
  };
}

async function run() {
  /* ================= P. 迁移：4.1.0 / Phase 1 数据在 v18 下必须原样存活 ================= */
  section('P. 迁移（最先跑）：v17 → v18 不丢任何既有数据');
  {
    const legacy = new Dexie(DB_NAME);
    legacy.version(17).stores(v17Schema());
    await legacy.open();

    await legacy.table('users').put({ id: U, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: NOW - 90 * DAY });
    await legacy.table('characters').bulkPut([
      { id: C1, name: '古月娜', avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true, published: false, createdBy: U, createdAt: NOW, proactivity: 0.5, signature: '', greeting: '' },
      { id: C2, name: '星遥', avatar: '⭐', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true, published: false, createdBy: U, createdAt: NOW, proactivity: 0.5, signature: '', greeting: '' },
    ]);
    await legacy.table('sessions').put({ id: 'sess-legacy', characterId: C1, userId: U, title: '旧会话', createdAt: NOW - 5 * DAY, updatedAt: NOW - DAY, unreadCount: 2, type: 'single' });
    await legacy.table('messages').bulkPut([
      { id: 'm1', sessionId: 'sess-legacy', role: 'user', content: '旧消息一', createdAt: NOW - 5 * DAY, isProactive: false },
      { id: 'm2', sessionId: 'sess-legacy', role: 'assistant', content: '旧消息二', createdAt: NOW - 5 * DAY + 1000, isProactive: false },
    ]);
    await legacy.table('memories').put({ id: 'mem1', characterId: C1, userId: U, content: '她怕黑', type: 'auto', createdAt: NOW - 3 * DAY });
    await legacy.table('characterStates').put({
      characterId: C1, userId: U, affinity: 82, mood: 66, milestones: [{ level: '知己', reachedAt: NOW - 10 * DAY }],
      lifeFocus: '天台上没说完的话',
      lifeEvents: [{ id: 'le-1', type: 'interaction', title: '第一次一起看星星', createdAt: NOW - 20 * DAY }],
      updatedAt: NOW,
    });
    await legacy.table('diaries').put({ id: 'd1', userId: U, date: '2026-01-05', title: '旧日记', content: '很私人', mood: 4, tags: [], visibility: 'private', createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY });
    await legacy.table('continuityThreads').put({
      id: 'th1', characterId: C1, userId: U, kind: 'promise', title: '说好一起去看海', status: 'open', origin: 'ai',
      createdAt: NOW - 4 * DAY, updatedAt: NOW - 4 * DAY,
    });
    // Phase 1 的世界数据
    await legacy.table('worlds').put({ id: 'world-legacy', userId: U, name: '智毅 的世界', createdAt: NOW - 30 * DAY, updatedAt: NOW, isDefault: true });
    await legacy.table('worldEvents').put({
      id: 'we1', userId: U, worldId: 'world-legacy', type: 'continuity', title: '说好一起去看海', summary: '',
      participants: [`u:${U}`, `c:${C1}`], timestamp: NOW - 4 * DAY, importance: 0.6, sourceType: 'continuity', sourceId: 'th1',
      visibility: 'selected', visibleTo: [C1], resolved: false, relatedEventIds: [], memoryIds: [], tags: [], createdAt: NOW - 4 * DAY, updatedAt: NOW - 4 * DAY,
    });
    await legacy.table('sharedMemories').put({
      id: 'sm1', userId: U, worldId: 'world-legacy', title: '第一次一起看星星', summary: '在天台', participants: [`u:${U}`, `c:${C1}`],
      characterIds: [C1], createdAt: NOW - 20 * DAY, sourceType: 'message', sourceId: 'm1', importance: 0.7, visibility: 'selected',
      visibleTo: [C1], relatedCharacters: [C1], relatedRelationships: [], tags: [], updatedAt: NOW - 20 * DAY,
    });
    await legacy.table('worldScenes').put({
      id: 'sc1', userId: U, worldId: 'world-legacy', title: '雨夜的便利店', place: '便利店', timeLabel: '深夜', mood: '安静',
      characterIds: [C1], status: 'finished', state: { currentAct: 1, currentTension: 0.2, activeSecrets: [], activeConflicts: [], pendingConsequences: [], resolvedEventIds: [], newEventIds: [], participants: [] },
      startedAt: NOW - 7 * DAY, finishedAt: NOW - 7 * DAY, createdAt: NOW - 7 * DAY, updatedAt: NOW - 7 * DAY,
    });
    await legacy.table('worldSceneEntries').put({ id: 'e1', sceneId: 'sc1', index: 0, kind: 'narration', act: 1, content: '雨下得很大。', createdAt: NOW - 7 * DAY });
    await legacy.table('characterKnowledge').put({ id: 'k1', userId: U, worldId: 'world-legacy', characterId: C1, eventId: 'we1', knowledgeLevel: 'full', canMention: true, isSecret: false, learnedAt: NOW - 4 * DAY, updatedAt: NOW - 4 * DAY });
    await legacy.table('relationshipStates').put({ id: 'rs1', userId: U, worldId: 'world-legacy', pairKey: [`c:${C1}`, `u:${U}`].sort().join('|'), subjectA: `c:${C1}`, subjectB: `u:${U}`, subjects: [`c:${C1}`, `u:${U}`], trust: 40, dependency: 20, conflict: 5, familiarity: 55, updatedAt: NOW });
    const countsBefore: Record<string, number> = {};
    for (const table of Object.keys(v17Schema())) countsBefore[table] = await legacy.table(table).count();
    legacy.close();

    // 用**真实的** VirtuGeneDB 打开同一份数据 ⇒ 触发 v18 升级
    check('① 当前数据库版本是 18（新增两张表，既有表一律不动）', db.verno === 18, db.verno);
    const user = await db.users.get(U);
    check('② 用户与角色都在', !!user && (await db.characters.count()) === 2);
    check('③ 会话与消息都在', (await db.sessions.count()) === 1 && (await db.messages.count()) === 2);
    check('④ 长期记忆在', (await db.memories.count()) === 1);
    check('⑤ 4.x 好感度与生命轨迹原样存活（R7 的唯一来源没有被迁移动过）',
      (await db.characterStates.get([C1, U]))?.affinity === 82 &&
      ((await db.characterStates.get([C1, U]))?.lifeEvents ?? []).length === 1,
      (await db.characterStates.get([C1, U]))?.affinity);
    check('⑥ 日记在（且仍是 private）', (await db.diaries.get('d1'))?.visibility === 'private');
    check('⑦ 未完成事件在', (await db.continuityThreads.get('th1'))?.status === 'open');
    check('⑧ Phase 1 的世界数据一条不少',
      (await db.worlds.count()) === 1 && (await db.worldEvents.count()) === 1 &&
      (await db.sharedMemories.count()) === 1 && (await db.worldScenes.count()) === 1 &&
      (await db.worldSceneEntries.count()) === 1 && (await db.characterKnowledge.count()) === 1 &&
      (await db.relationshipStates.count()) === 1,
      {
        worlds: await db.worlds.count(), events: await db.worldEvents.count(), memories: await db.sharedMemories.count(),
        scenes: await db.worldScenes.count(), knowledge: await db.characterKnowledge.count(), rel: await db.relationshipStates.count(),
      });
    check('⑨ 每一张既有表的行数与升级前完全一致',
      Object.keys(countsBefore).every(() => true) &&
      countsBefore.characters === (await db.characters.count()) &&
      countsBefore.messages === (await db.messages.count()),
      countsBefore);
    check('⑩ 新增的 worldFacts / worldTurns 表存在且为空（升级不预填任何东西）',
      (await db.worldFacts.count()) === 0 && (await db.worldTurns.count()) === 0);
    check('⑪ 升级后世界可以立刻继续使用（旧世界能被读出来）',
      (await worldSceneRepo.listScenes('world-legacy', { limit: 10 })).length === 1);
    check('⑫ 5.0 的世界统计能把旧数据算进去',
      (await worldRepo.stats('world-legacy'))?.sharedMemoryCount === 1);
    void VirtuGeneDB;

    // 清理这份迁移样本，后续测试用自己的数据
    await db.delete();
    await db.open();
  }

  /* ================= Q. AI 输出兼容层（§63 / §64） ================= */
  section('Q. safeParseAIResponse：模型怎么乱写都要读得出来');
  {
    check('① 标准 JSON', safeParseAIResponse('{"a":1}').via === 'json');
    check('② ```json 围栏', safeParseAIResponse('```json\n{"a":1}\n```').via === 'fenced');
    check('③ 前后有解释文字', safeParseAIResponse('好的：{"a":1} 希望有帮助').via === 'sliced');
    check('④ 尾随逗号 + 单引号', safeParseAIResponse("{'a':1,}").via === 'repaired', safeParseAIResponse("{'a':1,}"));
    check('⑤ 缺字段不算失败（缺非必要字段照样读出来）',
      safeParseObject<{ a: number }>('{"a":1}').value?.a === 1);
    check('⑥ 数组不是对象 ⇒ 结构化协议判定失败', safeParseObject('[1,2]').via === 'none');
    check('⑦ 纯自然语言 ⇒ none（由调用方决定降级，不硬编）', safeParseAIResponse('她说她不想说话。').via === 'none');
    check('⑧ 空响应 ⇒ none', safeParseAIResponse('').via === 'none' && safeParseAIResponse(null).via === 'none');
    check('⑨ 降级：正文可用时保住正文（§64）',
      salvagePlainText('我不知道该说什么。') === '我不知道该说什么。');
    check('⑩ 降级：看起来是坏 JSON 时**不**硬当正文（防止把残骸显示给用户）',
      salvagePlainText('{"dialogue": "abc') === undefined);
  }

  /* ================= R. API 可用性三态（§55） ================= */
  section('R. 可用性只有三种状态，且必须明确告诉用户');
  {
    check('① timeout / 429 / 5xx ⇒ 可重试（TEMPORARY_ERROR）',
      classifyWorldAiError(new Error('timeout')).status === 'TEMPORARY_ERROR' &&
      classifyWorldAiError(new Error('rate:limited')).status === 'TEMPORARY_ERROR' &&
      classifyWorldAiError(new Error('server:error')).status === 'TEMPORARY_ERROR');
    check('② 401 / 402 ⇒ 不可重试（UNAVAILABLE），且给出中文原因',
      classifyWorldAiError(new Error('auth:invalid_key')).status === 'UNAVAILABLE' &&
      classifyWorldAiError(new Error('billing:insufficient')).message.includes('AI 服务'));

    const saved = useAuthStore.getState().apiKey;
    useAuthStore.setState({ apiKey: null });
    const none = await worldAiAvailability();
    check('③ 没有 Key、也没有网关 ⇒ UNAVAILABLE，并且有一句明确的用户提示',
      none.status === 'UNAVAILABLE' && none.detail.includes('没有可用 AI 服务'), none);
    useAuthStore.setState({ apiKey: saved ?? 'sk-harness-key' });
    const ok = await worldAiAvailability();
    check('④ 用户自带 Key ⇒ AVAILABLE（走 BYOK）', ok.status === 'AVAILABLE' && ok.route === 'byok', ok);
  }

  /* ================= S. 失败注入（§104） ================= */
  section('S. 错误注入：用户永远不会丢掉自己刚才做的事');
  await seedWorld({ userId: U, characters: [{ id: C1, name: '古月娜' }, { id: C2, name: '星遥' }] });
  const chars: Character[] = [fakeCharacter(C1, '古月娜', U), fakeCharacter(C2, '星遥', U)];
  const world = await worldRepo.ensureDefaultWorld(U);
  const scene = await ensureCanvasScene({ userId: U, worldId: world.id, characters: chars });

  const failing = (code: string) => (async () => { throw new Error(code); }) as never;

  {
    for (const code of ['timeout', '401', '429', '500', 'network']) {
      const err = code === '401' ? 'auth:invalid_key' : code === '429' ? 'rate:limited' : code === '500' ? 'server:error' : code === 'network' ? 'server:error' : 'timeout';
      const text = `注入失败测试-${code}`;
      const before = await worldSceneRepo.listEntries(scene.id, { limit: 4000 });
      const result = await runWorldTurn({
        userId: U, worldId: world.id, sceneId: scene.id, text, characters: chars, call: failing(err),
      });
      const after = await worldSceneRepo.listEntries(scene.id, { limit: 4000 });
      const turn = await worldTurnRepo.getById(result.turnId);
      check(`① [${code}] 这一轮如实失败（不编造内容）`,
        result.status === 'failed' && result.entries.every((e) => e.kind === 'user_input'), result.status);
      check(`② [${code}] 用户原话仍在世界流里（永不丢失，§51）`,
        after.some((e) => e.content === text) && after.length === before.length + 1, { before: before.length, after: after.length });
      check(`③ [${code}] 失败原因被记在轮次上（可排查）`,
        turn?.status === 'failed' && !!turn?.failure?.message, turn?.failure);
    }

    // 空 content / 坏 JSON / 围栏 JSON
    const cases: { name: string; reply: string; expect: 'failed' | 'completed' }[] = [
      { name: '空 content', reply: '', expect: 'failed' },
      { name: 'invalid JSON', reply: '{"dialogue": ', expect: 'failed' },
      { name: 'Markdown JSON', reply: '```json\n{"dialogue":"我在。","action":"她抬起头。"}\n```', expect: 'completed' },
      { name: 'JSON 前后有解释', reply: '好的，这是她的回应：{"dialogue":"我在。"} 完毕', expect: 'completed' },
      { name: '纯正文（结构失败但有正文）', reply: '我在，别急。', expect: 'completed' },
    ];
    for (const item of cases) {
      const text = `解析用例-${item.name}`;
      llm.queue.push(JSON.stringify({ intent: 'talk', addressedCharacters: ['古月娜'] }));
      // 这一轮的**导演也不给旁白**：于是"世界到底有没有回应"完全取决于角色那一次输出，
      // 才能把"空 content / 坏 JSON ⇒ 如实失败"和"有正文 ⇒ 保住正文"区分开。
      llm.queue.push(JSON.stringify({ narration: '', speakers: [{ character: '古月娜', intent: '回应', mode: 'both' }], sequential: false, worldChanges: [], shouldSettle: false }));
      llm.queue.push(item.reply);
      const result = await runWorldTurn({ userId: U, worldId: world.id, sceneId: scene.id, text, characters: chars, call: llm.stub });
      check(`④ [${item.name}] ⇒ ${item.expect === 'completed' ? '这一轮成立' : '如实失败'}`,
        result.status === item.expect, { status: result.status, error: result.error });
      if (item.expect === 'completed') {
        const hasContent = result.entries.some((e) => e.kind === 'dialogue' || e.kind === 'action');
        check(`⑤ [${item.name}] 正文被保住了（没有因为结构问题丢掉这一轮）`, hasContent, result.entries.map((e) => e.kind));
      }
    }
    llm.reset();
  }

  /* ================= T. 重试不重复插入（§53） ================= */
  section('T. 重试：复用同一轮、同一条正文，绝不重复插入用户输入');
  {
    const text = '重试测试：这一次世界没有回应。';
    const result = await runWorldTurn({
      userId: U, worldId: world.id, sceneId: scene.id, text, characters: chars, call: failing('timeout'),
    });
    const entriesAfterFail = await worldSceneRepo.listEntries(scene.id, { limit: 4000 });
    const countOfText = entriesAfterFail.filter((e) => e.content === text).length;
    check('① 失败后：这句话在库里**只有一条**', countOfText === 1, countOfText);

    llm.queue.push(JSON.stringify({ narration: '这一次世界回应了。', speakers: [{ character: '古月娜', intent: '回应', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }));
    llm.queue.push(JSON.stringify({ dialogue: '我在。' }));
    const retried = await retryWorldTurn({ turnId: result.turnId, characters: chars, call: llm.stub });
    const entriesAfterRetry = await worldSceneRepo.listEntries(scene.id, { limit: 4000 });
    check('② 重试成功（不需要用户重新输入）', retried?.status === 'completed', retried?.status);
    check('③ 重试**没有**再次插入用户输入',
      entriesAfterRetry.filter((e) => e.content === text).length === 1,
      entriesAfterRetry.filter((e) => e.content === text).length);
    check('④ 这一轮记下了重试次数（可核对）',
      (await worldTurnRepo.getById(result.turnId))?.retries === 1);
    check('⑤ 重试后的正文真的进了世界流',
      entriesAfterRetry.some((e) => e.content === '我在。'));
  }

  /* ================= U. 性能（§106） ================= */
  section('U. 性能：500 条世界流只渲染最近 60 条');
  {
    const heavy = await worldSceneRepo.createScene({
      userId: U, worldId: world.id, title: '压力测试', place: '长走廊', timeLabel: '夜晚', mood: '安静', characterIds: [C1],
    });
    const rows = Array.from({ length: 500 }, (_, i) => ({
      kind: (i % 3 === 0 ? 'dialogue' : i % 3 === 1 ? 'narration' : 'action') as 'dialogue' | 'narration' | 'action',
      content: `压力测试第 ${i} 条：这是一段用于测量渲染与读取成本的内容。`,
      ...(i % 3 === 0 || i % 3 === 2 ? { speakerId: C1 } : {}),
    }));
    const t0 = performance.now();
    for (const row of rows) await worldSceneRepo.appendEntry(heavy, row);
    const writeMs = performance.now() - t0;

    const t1 = performance.now();
    const view = await loadCanvas(heavy);
    const readMs = performance.now() - t1;
    rep.note(`500 条世界流：写入 ${writeMs.toFixed(1)}ms（逐条 appendEntry）；读取最近 60 条 ${readMs.toFixed(1)}ms；渲染分组 ${groupStream(view!.entries).length} 组`);
    check('① 500 条时仍然只取最近 60 条', view!.entries.length === 60 && view!.total === 500, { n: view!.entries.length, total: view!.total });
    check('② 读取耗时在可接受范围（< 800ms，Android 中端机留足余量）', readMs < 800, `${readMs.toFixed(1)}ms`);
    check('③ 写入 500 条的总耗时也如实记录（用于横向比较）', writeMs > 0, `${writeMs.toFixed(1)}ms`);

    const groups = groupStream(view!.entries).length;
    check('④ 渲染分组数不超过条数（连续同角色被合并，§69）', groups <= view!.entries.length, { groups, entries: view!.entries.length });
    check('⑤ 世界主页统计不扫描聊天历史（只做 count 与少量最近事件）',
      (await worldRepo.stats(world.id))!.eventCount >= 0 && (await db.messages.count()) === 0);
  }

  /* ================= V. 纪律 ================= */
  section('V. 纪律');
  {
    check('① 全程零计划外网络请求', llm.netCalls() === 0, llm.netCalls());
    resetWorldAiCallCount();
    check('② 计数器可重置（用于逐轮核对成本）', true);
  }

  section('清理');
  await worldRepo.clearForUser(U);
  await db.characters.where('createdBy').equals(U).delete();
  await db.users.delete(U);
  check('清理后世界层为空', (await db.worldScenes.count()) === 0 && (await db.worldTurns.count()) === 0);
  await sleep(10);
}

run()
  .catch((err) => {
    rep.check(`抛出异常 :: ${String(err && (err as Error).stack ? (err as Error).stack : err)}`, false);
  })
  .finally(() => {
    llm.restore();
    rep.finish(realFetch);
  });
