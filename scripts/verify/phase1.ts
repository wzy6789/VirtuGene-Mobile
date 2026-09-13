/**
 * VirtuGene 5.0.0 Phase 1 验收脚本（12 项）
 *
 * 在真实浏览器 + 真实 IndexedDB 上执行：
 *   1. 用 **4.1.0 的 v15 schema** 建库并写入 4.x 形态数据（模拟老用户）
 *   2. 关闭，再用应用真实的 db（v17）打开 → 触发 Dexie v16/v17 升级与幂等迁移
 *   3. 跑 12 项断言
 *
 * 运行方式见同目录 README.md。
 */
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { relationshipRepo } from '../../src/db/relationship-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { characterRef, defaultWorldId, subjectPairKey, userRef } from '../../src/lib/world/subjects';
import type { CharacterState, ContinuityThread, Diary, MemoryItem, SharedStoryEvent, User } from '../../src/db/index';

const DB_NAME = 'virtugene';
const U_A = 'u-a';
const U_B = 'u-b';
const C_X = 'c-xingyao';
const C_L = 'c-linjian';
const NOW = Date.now();
const DAY = 86_400_000;

const lines: string[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

function section(title: string) {
  lines.push(`\n--- ${title} ---`);
}

/** 4.1.0 的 v15 schema（与 src/db/index.ts 中 version(15) 完全一致） */
function legacySchema() {
  return {
    users: 'id,username',
    characters: 'id,isPreset,published,createdBy',
    sessions: 'id,characterId,userId,[characterId+userId],updatedAt,groupId',
    messages: 'id,sessionId,[sessionId+createdAt]',
    memories: 'id,characterId,userId,createdAt',
    emotionSnapshots: 'id,sessionId,characterId,createdAt',
    characterStates: '[characterId+userId]',
    diaries: 'id,userId,date,[userId+date]',
    groups: 'id,userId',
    continuityThreads: 'id,characterId,userId,[characterId+userId],[characterId+status],status,createdAt',
    sharedStoryEvents: 'id,userId,*characterIds,createdAt',
  };
}

const OLD_TABLES = Object.keys(legacySchema());

/** 用 4.1.0 的 schema 建库并写入 4.x 数据，返回升级前各表主键快照 */
async function seedLegacy(): Promise<Record<string, string[]>> {
  const legacy = new Dexie(DB_NAME);
  legacy.version(15).stores(legacySchema());
  await legacy.open();

  await legacy.table('users').bulkPut([
    { id: U_A, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: NOW - 90 * DAY },
    { id: U_B, username: '乙', passwordHash: 'x', passwordSalt: 'y', createdAt: NOW - 30 * DAY },
  ] satisfies User[]);

  await legacy.table('characters').bulkPut([
    { id: C_X, name: '星遥', avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true, published: false, createdBy: U_A, createdAt: NOW, proactivity: 0.5, signature: '', greeting: '' },
    { id: C_L, name: '林间', avatar: '🌲', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true, published: false, createdBy: U_A, createdAt: NOW, proactivity: 0.5, signature: '', greeting: '' },
  ]);

  const stateX: CharacterState = {
    characterId: C_X,
    userId: U_A,
    affinity: 85,
    mood: 70,
    milestones: [],
    lifeFocus: '天台上没说完的话',
    lifeEvents: [
      { id: 'le-1', type: 'interaction', title: '第一次一起看星星', detail: '在天台', createdAt: NOW - 20 * DAY },
      { id: 'le-2', type: 'memory', title: '记住了她怕黑', detail: '', createdAt: NOW - 15 * DAY },
      { id: 'le-3', type: 'relationship', title: '关系进入「知己」阶段', detail: '', createdAt: NOW - 10 * DAY },
    ],
    storyRelations: [{ targetCharacterId: C_L, label: '旧友', createdAt: NOW - 60 * DAY }],
    updatedAt: NOW,
  };
  const stateL: CharacterState = {
    characterId: C_L,
    userId: U_A,
    affinity: 40,
    mood: 55,
    milestones: [],
    lifeEvents: [{ id: 'le-4', type: 'goal', title: '说好毕业一起去旅行', detail: '', createdAt: NOW - 5 * DAY }],
    storyRelations: [{ targetCharacterId: C_X, label: '旧友', createdAt: NOW - 60 * DAY }],
    updatedAt: NOW,
  };
  const stateB: CharacterState = { characterId: 'c-other', userId: U_B, affinity: 10, mood: 60, milestones: [], updatedAt: NOW };
  await legacy.table('characterStates').bulkPut([stateX, stateL, stateB]);

  const threads: ContinuityThread[] = [
    { id: 'th-1', characterId: C_X, userId: U_A, kind: 'promise', title: '答应陪她去看海', status: 'open', createdAt: NOW - 3 * DAY, updatedAt: NOW - 3 * DAY },
    { id: 'th-2', characterId: C_X, userId: U_A, kind: 'plan', title: '一起把小说读完', status: 'done', createdAt: NOW - 8 * DAY, updatedAt: NOW - 2 * DAY, completedAt: NOW - 2 * DAY },
    { id: 'th-3', characterId: 'c-other', userId: U_B, kind: 'topic', title: '乙的未完成话题', status: 'open', createdAt: NOW - DAY, updatedAt: NOW - DAY },
  ];
  await legacy.table('continuityThreads').bulkPut(threads);

  const shared: SharedStoryEvent[] = [
    { id: 'se-1', userId: U_A, characterIds: [C_L, C_X], type: '分歧', title: '毕业旅行要不要去', detail: '两个人意见不同', viewpoints: { [C_X]: '希望留下', [C_L]: '希望离开' }, origin: 'user', createdAt: NOW - 12 * DAY, updatedAt: NOW - 12 * DAY },
  ];
  await legacy.table('sharedStoryEvents').bulkPut(shared);

  const diaries: Diary[] = [
    { id: 'd-1', userId: U_A, date: '2026-09-10', title: '课题组', content: '第一次参加课题组讨论，有点紧张。', mood: 3, tags: [], createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY },
    { id: 'd-2', userId: U_A, date: '2026-09-11', title: '', content: '今天很平静。', mood: 4, tags: [], createdAt: NOW - DAY, updatedAt: NOW - DAY },
  ];
  await legacy.table('diaries').bulkPut(diaries);

  const memories: MemoryItem[] = [
    { id: 'm-1', characterId: C_X, userId: U_A, content: '用户喜欢猫', type: 'auto', createdAt: NOW - 6 * DAY },
    { id: 'm-2', characterId: C_X, userId: U_A, content: '用户在准备毕业论文', type: 'auto', createdAt: NOW - 4 * DAY },
  ];
  await legacy.table('memories').bulkPut(memories);

  // 升级前快照：每张旧表的主键集合 + 行数
  const snapshot: Record<string, string[]> = {};
  for (const name of OLD_TABLES) {
    const keys = await legacy.table(name).toCollection().primaryKeys();
    snapshot[name] = keys.map((k) => JSON.stringify(k)).sort();
  }
  legacy.close();
  return snapshot;
}

async function run() {
  const before = await seedLegacy();
  lines.push(`旧数据快照：${OLD_TABLES.map((t) => `${t}=${before[t].length}`).join(', ')}`);

  // 触发真实升级（db 的第一次操作会 open → 跑 v16/v17 upgrade）
  await db.open();

  section('基础：版本与表');
  check('Dexie 版本为 18（v17 建立世界层，v18 增补世界事实与世界轮次）', db.verno === 18, db.verno);
  const tableNames = db.tables.map((t) => t.name);
  const newTables = ['worlds', 'worldEvents', 'worldScenes', 'worldSceneEntries', 'characterKnowledge', 'sharedMemories', 'relationshipStates', 'relationshipEvents'];
  check('8 张世界层新表已建立', newTables.every((t) => tableNames.includes(t)), tableNames);

  section('验收 1：旧数据零丢失');
  for (const name of OLD_TABLES) {
    const after = (await db.table(name).toCollection().primaryKeys()).map((k) => JSON.stringify(k)).sort();
    check(`旧表 ${name} 主键集合完全一致（${before[name].length} 行）`, JSON.stringify(after) === JSON.stringify(before[name]), {
      before: before[name].length,
      after: after.length,
      missing: before[name].filter((k) => !after.includes(k)).slice(0, 3),
    });
  }

  section('验收 2：派生数量正确');
  const worldIdA = defaultWorldId(U_A);
  const worldIdB = defaultWorldId(U_B);
  check('每个用户各有一个默认世界', (await db.worlds.count()) === 2, await db.worlds.count());
  check('默认世界 isDefault = true', (await db.worlds.toArray()).every((w) => w.isDefault));
  const eventsA = await worldEventRepo.listTimeline(worldIdA, { limit: 200 });
  // A 侧：4 条生命轨迹（星遥 3 + 林间 1）+ 2 条未完成事件 + 1 条人物共同事件 = 7
  check('A 的世界事件 = 4 条生命轨迹 + 2 条未完成 + 1 条人物事件 = 7', eventsA.length === 7, eventsA.map((e) => `${e.type}:${e.title}`));
  check('B 的世界事件 = 1 条未完成', (await worldEventRepo.listTimeline(worldIdB, { limit: 200 })).length === 1);
  // A 侧认知：星遥 3+2+1=6，林间 1+1=2；B 侧 c-other 1；全局 9
  check('认知派生总数 = A(6+2) + B(1) = 9', (await db.characterKnowledge.count()) === 9, await db.characterKnowledge.count());
  check('A 侧认知 = 8（星遥 6 + 林间 2）', (await knowledgeRepo.listKnownBy(C_X, worldIdA)).length + (await knowledgeRepo.listKnownBy(C_L, worldIdA)).length === 8);
  check('关系状态：u↔星遥、u↔林间、星遥↔林间、uB↔c-other = 4', (await db.relationshipStates.count()) === 4, await db.relationshipStates.count());
  check('关系变化史：1 条 relationship 生命轨迹 + 1 条人物事件 = 2', (await db.relationshipEvents.count()) === 2, await db.relationshipEvents.count());
  check('共同记忆不参与回填（=0）', (await db.sharedMemories.count()) === 0, await db.sharedMemories.count());
  check('场景不回填（=0）', (await db.worldScenes.count()) === 0);

  section('验收 3：迁移幂等');
  const countsBefore = {
    worlds: await db.worlds.count(),
    worldEvents: await db.worldEvents.count(),
    characterKnowledge: await db.characterKnowledge.count(),
    relationshipStates: await db.relationshipStates.count(),
    relationshipEvents: await db.relationshipEvents.count(),
  };
  const r1 = await worldRepo.rerunMigration();
  const r2 = await worldRepo.rerunMigration();
  const countsAfter = {
    worlds: await db.worlds.count(),
    worldEvents: await db.worldEvents.count(),
    characterKnowledge: await db.characterKnowledge.count(),
    relationshipStates: await db.relationshipStates.count(),
    relationshipEvents: await db.relationshipEvents.count(),
  };
  check('二次/三次迁移行数完全不变', JSON.stringify(countsBefore) === JSON.stringify(countsAfter), { countsBefore, countsAfter });
  check('重复迁移 created 全为 0', r2.worldsCreated === 0 && r2.worldEventsCreated === 0 && r2.characterKnowledgeCreated === 0 && r2.relationshipStatesCreated === 0 && r2.relationshipEventsCreated === 0, r2);
  check('重复迁移 skipped > 0（确实走了"存在即跳过"）', r2.worldEventsSkipped > 0 && r2.characterKnowledgeSkipped > 0, { ev: r2.worldEventsSkipped, kn: r2.characterKnowledgeSkipped });
  // R7 裁定：迁移不再往世界层写好感度；全新升级（v15 → v17）没有旧快照可清，因此 stripped 应为 0。
  // "清理旧快照"这条路径由 phase2b6 单独覆盖（它先造一条带 affinity 的旧行，再跑迁移）。
  check('R7 收尾：升级后世界层里没有任何好感度字段',
    (await db.relationshipStates.toArray()).every((s) => !('affinity' in (s as object))),
    (await db.relationshipStates.toArray()).map((s) => Object.keys(s)));
  check('R7 收尾：全新升级没有需要清理的旧快照（该分支由 phase2b6 覆盖）', r1.legacyAffinityStripped === 0, r1.legacyAffinityStripped);
  void r1;

  section('验收 4：跨用户隔离');
  const kal = await knowledgeRepo.listKnownBy(C_X, worldIdA);
  check('A 的认知行全部属于 u-a', kal.every((k) => k.userId === U_A), kal.map((k) => k.userId));
  const eventsB = await worldEventRepo.listTimeline(worldIdB, { limit: 200 });
  check('B 的世界看不到 A 的任何事件', eventsB.every((e) => e.userId === U_B) && eventsB.length === 1);
  check('A/B 世界 id 不同', worldIdA !== worldIdB);

  section('验收 5：旧日记一律 private');
  const diaries = await db.diaries.toArray();
  check('全部日记 visibility = private', diaries.every((d) => d.visibility === 'private'), diaries.map((d) => d.visibility));
  const vis = await diaryRepo.countByVisibility(U_A);
  check('可见性分布：private=2，其余为 0', vis.private === 2 && vis.selected === 0 && vis.world === 0 && vis.unset === 0, vis);
  check('没有任何角色能看到旧日记', (await diaryRepo.listVisibleFor(C_X, U_A)).length === 0);
  check('旧日记没有派生世界事件', eventsA.every((e) => e.sourceType !== 'diary'));

  section('验收 6：按角色 / 按对查询');
  const knownByX = await knowledgeRepo.listKnownBy(C_X, worldIdA);
  check('星遥的认知 = 3(生命轨迹) + 2(未完成) + 1(人物事件) = 6', knownByX.length === 6, knownByX.length);
  const pairKeyXL = subjectPairKey(characterRef(C_X), characterRef(C_L));
  const relEvents = await relationshipRepo.listEvents(worldIdA, pairKeyXL);
  check('星遥↔林间 关系史 = 1 条，且原因可读', relEvents.length === 1 && relEvents[0].reason === '毕业旅行要不要去', relEvents.map((e) => e.reason));
  check('canMention：亲身经历的事件可以提起', (await knowledgeRepo.canMention(C_X, (await worldEventRepo.listTimeline(worldIdA, { limit: 200 })).find((e) => e.sourceId === 'th-1')!.id)) === true);
  check('未知事件不能凭空提起', (await knowledgeRepo.canMention(C_X, 'we_not_exist')) === false);

  section('验收 7：tsc / vite build');
  lines.push('（由命令行单独执行并在报告中给出结果，浏览器内不重复运行）');

  section('验收 8：World 隔离');
  const world2 = await worldRepo.create({ userId: U_A, name: '平行世界线 A' });
  await worldEventRepo.create({ userId: U_A, worldId: world2.id, type: 'stage', title: '平行世界的一场戏', participants: [userRef(U_A), characterRef(C_X)], sourceType: 'stage', sourceId: 'scene-w2' });
  const w2Events = await worldEventRepo.listTimeline(world2.id, { limit: 50 });
  const w1Events = await worldEventRepo.listTimeline(worldIdA, { limit: 50 });
  check('世界 2 只有它自己的 1 条事件', w2Events.length === 1 && w2Events[0].title === '平行世界的一场戏', w2Events.length);
  check('世界 1 看不到世界 2 的事件', w1Events.every((e) => e.worldId === worldIdA) && !w1Events.some((e) => e.title === '平行世界的一场戏'));
  await sharedMemoryRepo.create({ userId: U_A, worldId: world2.id, title: '平行世界的记忆', summary: '', participants: [userRef(U_A), characterRef(C_X)], sourceType: 'stage', sourceId: 'scene-w2', visibility: 'world' });
  check('共同记忆也按 worldId 隔离', (await sharedMemoryRepo.listByWorld(world2.id)).length === 1 && (await sharedMemoryRepo.listByWorld(worldIdA)).length === 0);
  const sceneId2 = await worldSceneRepo.createScene({ userId: U_A, worldId: world2.id, title: '平行场景', place: '天台', timeLabel: '深夜', mood: '安静', characterIds: [C_X] });
  check('场景按 worldId 隔离', (await worldSceneRepo.listScenes(world2.id)).length === 1 && (await worldSceneRepo.listScenes(worldIdA)).length === 0, sceneId2);
  await worldRepo.clearWorld(world2.id);
  check('清空世界 2 后，世界 1 仍完好', (await worldEventRepo.countByWorld(world2.id)) === 0 && (await worldEventRepo.countByWorld(worldIdA)) === 7, {
    w2: await worldEventRepo.countByWorld(world2.id),
    w1: await worldEventRepo.countByWorld(worldIdA),
  });

  section('验收 9：关系状态读写（用户↔角色 / 角色↔角色）');
  const meX = await relationshipRepo.getStateFor(userRef(U_A), characterRef(C_X), worldIdA);
  // R7 裁定（5.0.0 Phase 2b-6）：世界层**不再保存好感度**——唯一来源是 4.x CharacterState.affinity。
  // 因此这里断言"状态行里没有这个字段"，而不是断言它等于 85（那是旧契约）。
  check('用户↔角色 状态存在，且**不含好感度字段**（唯一来源是 4.x）',
    !!meX && !('affinity' in (meX as object)), meX && Object.keys(meX));
  check('4.x 好感度仍然完好地留在 CharacterState 里（迁移没有动它）',
    ((await db.characterStates.get([C_X, U_A]))?.affinity ?? 0) === 85,
    (await db.characterStates.get([C_X, U_A]))?.affinity);
  check('四个世界层分面仍在（0 = 尚无记录）', meX?.trust === 0 && meX?.dependency === 0 && meX?.conflict === 0 && meX?.familiarity === 0, meX);
  const xl = await relationshipRepo.getStateFor(characterRef(C_X), characterRef(C_L), worldIdA);
  check('角色↔角色 状态存在（数值留 0 = 尚无记录）', !!xl && xl.trust === 0 && xl.conflict === 0, xl);
  check('角色↔角色 可通过角色反查', (await relationshipRepo.listStatesForCharacter(worldIdA, C_X)).length === 2, (await relationshipRepo.listStatesForCharacter(worldIdA, C_X)).map((s) => s.pairKey));
  const created = await relationshipRepo.ensureState(U_A, worldIdA, characterRef(C_X), 'c-newcomer');
  check('ensureState 可新建（且不重置已有）', created.pairKey === subjectPairKey(characterRef(C_X), 'c-newcomer'));

  section('验收 10：RelationshipEvent → State（同一事务）');
  const beforeState = (await relationshipRepo.getStateFor(characterRef(C_X), characterRef(C_L), worldIdA))!;
  const applied = await relationshipRepo.applyEvent({
    userId: U_A, worldId: worldIdA, a: characterRef(C_X), b: characterRef(C_L),
    facets: { trust: -8, conflict: 12, familiarity: 5 }, reason: '因为用户的决定，两人对彼此产生了新的分歧',
    sourceType: 'stage', sourceId: 'scene-1', idempotencyKey: 'scene-1',
  });
  check(
    '事件写入后状态被同一事务更新（trust 从 0 减 8 被夹到 0，符合 0~100 语义）',
    applied.applied === true && applied.state.trust === 0 && applied.state.conflict === 12 && applied.state.familiarity === 5 && beforeState.conflict === 0,
    applied.state,
  );
  check('零增量分面不写入事件（facets 只保留真实变化）', Object.keys(applied.event.facets).length === 3 && applied.event.facets.trust === -8, applied.event.facets);
  const replay = await relationshipRepo.applyEvent({
    userId: U_A, worldId: worldIdA, a: characterRef(C_X), b: characterRef(C_L),
    facets: { trust: -8, conflict: 12, familiarity: 5 }, reason: '重放同一次来源',
    sourceType: 'stage', sourceId: 'scene-1', idempotencyKey: 'scene-1',
  });
  const afterReplay = (await relationshipRepo.getStateFor(characterRef(C_X), characterRef(C_L), worldIdA))!;
  check('同一来源重放不会重复施加（幂等）', replay.applied === false && afterReplay.trust === applied.state.trust && afterReplay.conflict === 12, { trust: afterReplay.trust, conflict: afterReplay.conflict });
  check('关系史只多出一条并保留原因', (await relationshipRepo.listEvents(worldIdA, pairKeyXL)).length === 2, (await relationshipRepo.listEvents(worldIdA, pairKeyXL)).map((e) => e.reason));
  let threw = false;
  try {
    await relationshipRepo.applyEvent({ userId: U_A, worldId: worldIdA, a: characterRef(C_X), b: characterRef(C_L), facets: { trust: 5 }, reason: '', sourceType: 'test', sourceId: 'bad' });
  } catch { threw = true; }
  const afterBad = (await relationshipRepo.getStateFor(characterRef(C_X), characterRef(C_L), worldIdA))!;
  check('非法输入抛错且事务回滚（状态不变）', threw && afterBad.trust === afterReplay.trust, { threw, trust: afterBad.trust });

  section('验收 11：WorldEvent 类型正确');
  const bySource = new Map(eventsA.map((e) => [e.sourceId, e]));
  check('continuityThread(open) → continuity（不是 stage）', bySource.get('th-1')?.type === 'continuity', bySource.get('th-1')?.type);
  check('continuityThread(done) → continuity 且 resolved=true', bySource.get('th-2')?.type === 'continuity' && bySource.get('th-2')?.resolved === true, bySource.get('th-2'));
  check('未完成的 thread → resolved=false', bySource.get('th-1')?.resolved === false);
  check('lifeEvent(interaction) → interaction（不是 stage）', bySource.get('le-1')?.type === 'interaction', bySource.get('le-1')?.type);
  check('lifeEvent(memory) → shared_memory', bySource.get('le-2')?.type === 'shared_memory', bySource.get('le-2')?.type);
  check('lifeEvent(relationship) → relationship', bySource.get('le-3')?.type === 'relationship', bySource.get('le-3')?.type);
  check('lifeEvent(goal) → continuity（不是 stage）', bySource.get('le-4')?.type === 'continuity', bySource.get('le-4')?.type);
  check('sharedStoryEvent → relationship', bySource.get('se-1')?.type === 'relationship', bySource.get('se-1')?.type);
  check('世界内没有任何 stage 事件（迁移不伪造舞台）', eventsA.every((e) => e.type !== 'stage'));

  section('验收 12：selected 可见性靠 visibleTo 限制');
  const evPrivate = await worldEventRepo.create({ userId: U_A, worldId: worldIdA, type: 'shared_memory', title: '只有用户知道的事', participants: [userRef(U_A), characterRef(C_X)], sourceType: 'test', sourceId: 'v-private', visibility: 'private' });
  const evSelected = await worldEventRepo.create({ userId: U_A, worldId: worldIdA, type: 'shared_memory', title: '只让星遥知道的事', participants: [userRef(U_A), characterRef(C_X), characterRef(C_L)], sourceType: 'test', sourceId: 'v-selected', visibility: 'selected', visibleTo: [C_X] });
  const evWorld = await worldEventRepo.create({ userId: U_A, worldId: worldIdA, type: 'shared_memory', title: '全世界都知道的事', participants: [userRef(U_A)], sourceType: 'test', sourceId: 'v-world', visibility: 'world' });
  const mPrivate = await sharedMemoryRepo.create({ userId: U_A, worldId: worldIdA, title: '私密记忆', summary: '', participants: [userRef(U_A), characterRef(C_X)], sourceType: 'test', sourceId: 'm-private', visibility: 'private' });
  const mSelected = await sharedMemoryRepo.create({ userId: U_A, worldId: worldIdA, title: '只给星遥的记忆', summary: '', participants: [userRef(U_A), characterRef(C_X), characterRef(C_L)], sourceType: 'test', sourceId: 'm-selected', visibility: 'selected', visibleTo: [C_X] });
  const mWorld = await sharedMemoryRepo.create({ userId: U_A, worldId: worldIdA, title: '世界记忆', summary: '', participants: [userRef(U_A)], sourceType: 'test', sourceId: 'm-world', visibility: 'world' });
  const visibleToX = await sharedMemoryRepo.listVisibleFor(C_X, worldIdA);
  const visibleToL = await sharedMemoryRepo.listVisibleFor(C_L, worldIdA);
  check('星遥可见：selected(命中 + world)，不含 private', visibleToX.some((m) => m.id === mSelected) && visibleToX.some((m) => m.id === mWorld) && !visibleToX.some((m) => m.id === mPrivate), visibleToX.map((m) => m.title));
  check('林间（参与者但不在 visibleTo）看不到 selected 记忆', !visibleToL.some((m) => m.id === mSelected) && visibleToL.some((m) => m.id === mWorld) && !visibleToL.some((m) => m.id === mPrivate), visibleToL.map((m) => m.title));
  check('participants 与 visibleTo 是两个维度（林间是参与者却看不到）', (await sharedMemoryRepo.getById(mSelected))!.participants.includes(characterRef(C_L)) && !visibleToL.some((m) => m.id === mSelected));
  const eventsVisibleToX = await worldEventRepo.listVisibleToCharacter(worldIdA, C_X);
  const eventsVisibleToL = await worldEventRepo.listVisibleToCharacter(worldIdA, C_L);
  check('世界事件同样按可见性过滤', eventsVisibleToX.some((e) => e.id === evSelected) && !eventsVisibleToL.some((e) => e.id === evSelected) && !eventsVisibleToL.some((e) => e.id === evPrivate) && eventsVisibleToL.some((e) => e.id === evWorld));
  const aware = await knowledgeRepo.listUnaware([C_X, C_L], evSelected);
  check('可见性 ≠ 认知：仅仅"被允许知道"不等于"已经知道"（两人都还没学到）', aware.includes(C_L) && aware.includes(C_X), aware);
  await knowledgeRepo.teach({ userId: U_A, worldId: worldIdA, characterId: C_X, eventId: evSelected, sourceCharacterId: undefined });
  const aware2 = await knowledgeRepo.listUnaware([C_X, C_L], evSelected);
  check('§62：只教给星遥之后，只有星遥知道，林间仍然不知道', !aware2.includes(C_X) && aware2.includes(C_L), aware2);
  check('被教授的认知可被提起', (await knowledgeRepo.canMention(C_X, evSelected)) === true);

  section('附加：场景结构与角色删除清理');
  const sceneId = await worldSceneRepo.createScene({ userId: U_A, worldId: worldIdA, title: '深夜的天台', place: '学校天台', timeLabel: '深夜', mood: '克制', characterIds: [C_X, C_L], sceneGoal: '把没说出口的话说出来', participants: [{ characterId: C_X, goals: ['留下'], knowsEventIds: [], secrets: [] }, { characterId: C_L, goals: ['离开'], knowsEventIds: [], secrets: ['已经准备离开这座城市'] }] });
  await worldSceneRepo.appendEntry(sceneId, { kind: 'narration', content: '夜风把话吹散了一半。' });
  await worldSceneRepo.appendEntry(sceneId, { kind: 'dialogue', speakerId: C_X, content: '……你今天话很少。' });
  await worldSceneRepo.appendEntry(sceneId, { kind: 'choice', content: '你准备：', meta: { options: ['告诉她真相', '暂时沉默', '转移话题'] } });
  const entries = await worldSceneRepo.listEntries(sceneId);
  check('场景正文按 index 顺序独立存储', entries.length === 3 && entries[0].kind === 'narration' && entries[1].speakerId === C_X && entries[2].meta?.options?.length === 3, entries.map((e) => `${e.index}:${e.kind}`));
  check('场景状态是结构化的（不是一段 Prompt 文本）', (await worldSceneRepo.getScene(sceneId))!.state.participants[1].secrets[0] === '已经准备离开这座城市');
  check('场景不写入 sessions/messages', (await db.sessions.count()) === 0 && (await db.messages.count()) === 0);
  // 一个完全空白的 draft 场景（用于验证"没内容的才算可丢弃"）
  const emptySceneId = await worldSceneRepo.createScene({ userId: U_A, worldId: worldIdA, title: '还没开始的想法', place: '未定', timeLabel: '未定', mood: '平静', characterIds: [C_X, C_L] });
  const cleanup = await worldRepo.cleanupCharacter(U_A, C_L);
  check('删除角色：认知随角色消失（林间 2 条：1 生命轨迹 + 1 人物事件）', cleanup.knowledge === 2, cleanup);
  check('删除角色：涉及林间的关系状态与关系史一并移除', cleanup.relationshipStates === 2 && cleanup.relationshipEvents === 2, cleanup);
  check('删除角色：世界事件保留历史、只摘掉引用', (await worldEventRepo.countByWorld(worldIdA)) > 0 && (await db.worldEvents.get(bySource.get('se-1')!.id))!.participants.every((p) => p !== characterRef(C_L)), cleanup.events);
  check('删除角色：已写过正文的场景保留正文，只摘掉该角色', (await worldSceneRepo.getScene(sceneId))!.characterIds.length === 1 && (await worldSceneRepo.listEntries(sceneId)).length === 3);
  check('删除角色：完全空白的 draft 场景被删除', (await worldSceneRepo.getScene(emptySceneId)) === undefined);
  check('删除角色：共同记忆保留（事情真的发生过），只摘掉该角色引用', (await db.sharedMemories.count()) === 3 && !(await sharedMemoryRepo.getById(mSelected))!.participants.includes(characterRef(C_L)) && !(await sharedMemoryRepo.getById(mSelected))!.characterIds.includes(C_L), {
    count: await db.sharedMemories.count(),
    participants: (await sharedMemoryRepo.getById(mSelected))!.participants,
  });

  section('清理');
  await worldRepo.clearForUser(U_A);
  await worldRepo.clearForUser(U_B);
  check('注销清理后世界层为空', (await db.worlds.count()) === 0 && (await db.worldEvents.count()) === 0 && (await db.characterKnowledge.count()) === 0, {
    worlds: await db.worlds.count(), events: await db.worldEvents.count(), knowledge: await db.characterKnowledge.count(),
  });
}

run()
  .catch((err) => {
    failures += 1;
    lines.push(`FAIL 抛出异常 :: ${String(err && (err as Error).stack ? (err as Error).stack : err)}`);
  })
  .finally(() => {
    const text = `${lines.join('\n')}\n\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`;
    const out = document.createElement('pre');
    out.id = 'result';
    out.textContent = text;
    document.body.appendChild(out);
    document.title = failures === 0 ? 'VERIFY-OK' : 'VERIFY-FAIL';
    void fetch('/result', { method: 'POST', body: text }).catch(() => undefined);
  });
