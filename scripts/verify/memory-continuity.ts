/**
 * 跨模式记忆连续性验收（用户 6 条场景）
 *
 * 目标不是"每次提示词完全相同"，而是两件事：
 *   1. 换一个模式，同一个角色对自己经历过的事给出一致的回答；
 *   2. 换一个角色，绝不会继承别人的个人记忆。
 *
 * 六条场景（与需求一一对应）：
 *   ① 私聊告诉 A 的事，A 在星域与群聊可按需想起；B 在任何模式都不知道。
 *   ② A 在星域较早片段作过的约定，隔很多轮后私聊仍能准确找回（未结束的星域也成立）。
 *   ③ A 看过动态、B 没看过时两人回答不同；被明确提起后 B 不能冒称"我早就看过"。
 *   ④ 日记只授权 A，随后撤权：A 下一轮不再引用，B 从始至终不知道；
 *      日记也不能因为"加入共同世界"就进入多人共享的世界提示词。
 *   ⑤ 同一事实被更正、或源内容被删除后，私聊 / 群聊 / 星域同时停止使用旧版本。
 *   ⑥ 长对话压缩后，"记住"的事、命中的旧事和最近几轮仍能取回；
 *      角色不会连续几轮机械重复同一件事。
 *
 * 全程真实 IndexedDB、零网络（网络被显式禁掉）。
 */
import { db } from '../../src/db/index';
import { messageRepo } from '../../src/db/message-repo';
import { memoryRepo } from '../../src/db/memory-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { sharedEventRepo } from '../../src/db/shared-event-repo';
import { worldRepo } from '../../src/db/world-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { buildCharacterMemoryContext, detectRecallIntent } from '../../src/lib/character-memory';
import { rankConversationMemories, findSpokenMemoryIds } from '../../src/lib/memory-engine';
import { buildWorldContext, renderCharacterContext, renderWorldBrief, renderWorldLayer } from '../../src/lib/world/world-context';
import { clearDiarySharing, listMentionableDiaryIds, setDiarySharing } from '../../src/lib/world/diary-visibility';
import { importSyncData } from '../../src/lib/sync';

const report = window.fetch.bind(window);

async function run() {
  let count = 0;
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); count++; };
  // 进度上报：内容不匹配 runner 的判定行，因此只会被当成"还在跑"，
  // 超时时能看出卡在哪一段而不是只有一个 TIMEOUT。
  const section = (label: string) => { console.log(`--- ${label}`); void report('/result', { method: 'POST', body: `running: ${label} (${count} assertions)` }); };
  window.fetch = (() => { throw new Error('Unexpected network'); }) as typeof fetch;
  await db.open();

  const now = Date.now();
  await db.characters.bulkPut(['a', 'b', 'c'].map((id) => ({ id, createdBy: 'u', name: id, systemPrompt: 'test', createdAt: now })) as any);
  await db.characters.put({ id: 'foreign', createdBy: 'other', name: 'foreign', createdAt: now } as any);
  const defaultWorld = await worldRepo.ensureDefaultWorld('u');
  const DEFAULT_WORLD = defaultWorld.id;

  const recall = (characterId: string, extra: Record<string, unknown> = {}) =>
    buildCharacterMemoryContext({ userId: 'u', characterId, ...extra } as any);

  // 旧的备份导入辅助（与其它套件同一口径：只带需要验证的那几张表）
  const backupImport = (rows: Record<string, unknown>) => importSyncData({
    __meta__: { app: 'VirtuGene', kind: 'sync', version: '5.2.2', exportedAt: new Date().toISOString(), userId: 'u' },
    characters: [], sessions: [], messages: [], memories: [], emotionSnapshots: [], characterStates: [], diaries: [],
    ...rows,
  } as any);

  /* ───────────────────────── 入口与意图 ───────────────────────── */
  section('入口');
  check((await recall('foreign')).text === '', 'only the account owner own characters can recall anything');
  check(detectRecallIntent('今天天气不错').explicit === false, 'ordinary small talk is not treated as an old-topic question');
  check(detectRecallIntent('还记得上次那件事吗').explicit === true, 'explicit wording is recognised as an old-topic question');
  check(detectRecallIntent('朋友圈那条动态').moment === true, 'channel words are recognised without a per-caller regex');

  /* ─────────── ① 私聊 → 星域 / 群聊；B 一无所知 ─────────── */
  section('场景一：一个角色的经历，其它入口能想起，别的角色不知道');
  await db.groups.put({ id: 'g1', userId: 'u', characterIds: ['a', 'b'], name: '朋友群', createdAt: now, updatedAt: now } as any);
  await db.sessions.put({ id: 'gs1', userId: 'u', type: 'group', groupId: 'g1', characterId: '', createdAt: now, updatedAt: now } as any);
  await messageRepo.create({ id: 'gm1', sessionId: 'gs1', role: 'user', content: 'GROUP_COMMON_88 周末一起打球', createdAt: now, isProactive: false });
  await memoryRepo.create({
    id: 'priv-a', userId: 'u', characterId: 'a', content: 'A_ONLY_SECRET_17 我的生日是三月十七',
    type: 'auto', status: 'active', memoryKind: 'fact', createdAt: now, updatedAt: now,
  } as any);
  await db.worldScenes.put({
    id: 'sc-a', userId: 'u', worldId: DEFAULT_WORLD, characterIds: ['a'], status: 'active', title: '海边',
    place: '海边', timeLabel: '傍晚', mood: '安静', createdAt: now, updatedAt: now,
    state: { participants: [{ characterId: 'a', goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'memory', enteredAt: now - 10_000 }] },
  } as any);

  check((await recall('a', { topic: '我的生日是什么时候' })).text.includes('A_ONLY_SECRET_17'), 'private chat recalls what the user told this character');
  check((await recall('a', { mode: 'world-scene', worldId: DEFAULT_WORLD, scene: { worldId: DEFAULT_WORLD, sceneId: 'sc-a' }, topic: '我的生日是什么时候' })).text.includes('A_ONLY_SECRET_17'), 'the same character recalls it inside a world scene');
  check((await recall('a', { mode: 'group-chat', audience: ['a'], topic: '我的生日是什么时候' })).text.includes('A_ONLY_SECRET_17'), 'the same character recalls it when speaking in a group');
  check((await recall('a', { mode: 'group-chat', audience: ['a', 'b'], topic: '我的生日是什么时候' })).text.includes('A_ONLY_SECRET_17') === false, 'a shared multi-character prompt never receives one character private fact');
  for (const [label, extra] of [
    ['private chat', { topic: '我的生日是什么时候' }],
    ['world scene', { mode: 'world-scene', worldId: DEFAULT_WORLD, scene: { worldId: DEFAULT_WORLD, sceneId: 'sc-a' }, topic: '我的生日是什么时候' }],
    ['group chat', { mode: 'group-chat', audience: ['b'], topic: '我的生日是什么时候' }],
    ['explicit question', { topic: 'A_ONLY_SECRET_17 是什么意思' }],
  ] as const) {
    check((await recall('b', extra as any)).text.includes('A_ONLY_SECRET_17') === false, `another character never inherits it (${label})`);
  }
  check((await recall('a', { mode: 'group-chat', audience: ['a'], topic: '周末打球' })).text.includes('GROUP_COMMON_88'), 'group experience is recallable by a witness');

  /* ─────────── ② 进行中的星域：较早片段可回查 ─────────── */
  section('场景二：未结束的星域里较早的约定，隔很多轮仍能找回');
  await db.worldScenes.put({
    id: 'sc-long', userId: 'u', worldId: DEFAULT_WORLD, characterIds: ['a'], status: 'active', title: '长夜',
    place: '屋顶', timeLabel: '深夜', mood: '安静', createdAt: now - 600_000, updatedAt: now,
    state: { participants: [{ characterId: 'a', goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'memory', enteredAt: now - 500_000 }] },
  } as any);
  const longEntries = Array.from({ length: 60 }, (_, index) => ({
    id: `sc-long-entry-${index}`, sceneId: 'sc-long', index, kind: index % 3 === 0 ? 'dialogue' : 'narration',
    act: 1, content: index === 3 ? '我跟你说好：下次见面带桂花糕给你' : `普通的第 ${index} 段对白`,
    witnessedBy: ['a'], createdAt: now - 590_000 + index * 1000,
  }));
  await db.worldSceneEntries.bulkPut(longEntries as any);
  const longRecall = await recall('a', {
    topic: '那天你说的桂花糕还算数吗', worldId: DEFAULT_WORLD, scene: { worldId: DEFAULT_WORLD, sceneId: 'sc-long' },
  });
  check(longRecall.text.includes('桂花糕'), 'an older in-progress scene segment is retrievable by keyword long after it happened');
  check(longRecall.sections.historical.includes('桂花糕'), 'the older segment is reported as historical evidence, not as recent chatter');
  check(longRecall.sections.recent.includes('桂花糕') === false, 'the same segment is not part of the recent-steps window');
  check(longRecall.provenance.some((item) => item.source === 'world' && item.learnedBy === 'witnessed'), 'the segment is marked as something the character witnessed');
  // 场景只决定"此刻适合提起什么"：入场晚的参与者不继承入场前的正文
  await db.worldScenes.update('sc-long', {
    characterIds: ['a', 'c'],
    state: {
      participants: [
        { characterId: 'a', goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'memory', enteredAt: now - 500_000 },
        { characterId: 'c', goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'present', enteredAt: now },
      ],
    },
  } as any);
  const lateJoiner = await recall('c', {
    topic: '桂花糕还算数吗', worldId: DEFAULT_WORLD, scene: { worldId: DEFAULT_WORLD, sceneId: 'sc-long' },
  });
  check(lateJoiner.text.includes('桂花糕') === false, 'a late joiner who chose "from now on" does not inherit pre-arrival scene text');
  const sharedLate = await recall('a', {
    topic: '桂花糕还算数吗', worldId: DEFAULT_WORLD, scene: { worldId: DEFAULT_WORLD, sceneId: 'sc-long' }, audience: ['c'],
  });
  check(sharedLate.references.every((item) => item.id !== 'sc-long-entry-3'), 'shared context drops a segment one listener is not allowed to read');

  /* ─────────── ③ 朋友圈：看过 / 没看过 ─────────── */
  section('场景三：看过动态的角色与被提起后才查看的角色回答不同');
  await db.moments.put({
    id: 'm-rainbow', userId: 'u', text: '今天在海边看到了彩虹', mediaIds: [], visibility: 'selected',
    visibleTo: ['a', 'b'], audienceCharacterIds: ['a', 'b'], deleted: false, createdAt: now, updatedAt: now, visibilityRevision: 1,
  } as any);
  await db.momentViews.put({ id: 'view-a-rainbow', userId: 'u', momentId: 'm-rainbow', characterId: 'a', viewedAt: now } as any);
  const aMoment = await recall('a', { topic: '朋友圈那条彩虹' });
  const bMoment = await recall('b', { topic: '朋友圈那条彩虹' });
  check(aMoment.text.includes('彩虹') && aMoment.text.includes('之前看过'), 'a character that actually saw the post recalls it as something it saw');
  check(bMoment.text.includes('彩虹') && bMoment.text.includes('不代表你之前看过'), 'a character that never saw it is told it is only looking now');
  check(bMoment.text.includes('你之前看过或亲自发过') === false, 'the character that never saw it cannot claim it already knew');
  check((await recall('b', { topic: '彩虹是什么' })).text.includes('彩虹') === false, 'an unseen post is not volunteered without being asked about');
  check((await recall('a', { topic: '彩虹是什么' })).text.includes('彩虹'), 'a post the character really saw may be recalled ambiently');
  check(aMoment.provenance.some((item) => item.source === 'moment' && item.learnedBy === 'viewed'), 'the post is recorded as something the character viewed');

  /* ─────────── ④ 日记：只授权 A，撤权即失效 ─────────── */
  section('场景四：日记只授权一个角色，撤权后各模式都不再召回');
  const diaryId = await diaryRepo.create({ userId: 'u', date: '2026-09-20', title: '雨天', content: '只授权给A的日记内容 QX31', mood: 3, tags: [], characterId: 'a' });
  await setDiarySharing({ userId: 'u', diaryId, visibility: 'selected', visibleTo: ['a'] });
  check((await diaryRepo.listVisibleFor('a', 'u', 100)).some((diary) => diary.id === diaryId), 'the shared diary becomes visible to the authorized character');
  const anchorRow = await db.characterKnowledge.where('eventId').equals(`diary:${diaryId}`).first();
  check(Boolean(anchorRow), 'sharing writes the knowledge anchor');
  check(anchorRow?.worldId === DEFAULT_WORLD, `the knowledge anchor lives in the default world (${anchorRow?.worldId})`);
  check((await listMentionableDiaryIds('u', DEFAULT_WORLD, 'a')).has(diaryId), 'the authorized character may mention the diary');
  const aDiary = await recall('a', { topic: '还记得我日记里写的吗', worldId: DEFAULT_WORLD });
  check(aDiary.text.includes('QX31'), 'the authorized character can recall the diary');
  check((await recall('b', { topic: '还记得我日记里写的吗', worldId: DEFAULT_WORLD })).text.includes('QX31') === false, 'an unauthorized character never knows the diary');
  await clearDiarySharing('u', diaryId);
  check((await recall('a', { topic: '还记得我日记里写的吗', worldId: DEFAULT_WORLD })).text.includes('QX31') === false, 'after the grant is withdrawn the character stops recalling it');
  check((await recall('b', { topic: '还记得我日记里写的吗', worldId: DEFAULT_WORLD })).text.includes('QX31') === false, 'and the other character still knows nothing');

  // 「加入共同世界」写的是时间线记录，不是"所有人都知道"——共享层不得出现日记正文
  const worldDiaryId = await diaryRepo.create({ userId: 'u', date: '2026-09-21', title: '橘色天文穹顶', content: '那晚在橘色天文穹顶下看到了流星', mood: 4, tags: [], characterId: 'a' });
  await setDiarySharing({ userId: 'u', diaryId: worldDiaryId, visibility: 'world' });
  const worldDiary = await db.diaries.get(worldDiaryId);
  const worldDiaryEvent = worldDiary?.worldEventId ? await db.worldEvents.get(worldDiary.worldEventId) : undefined;
  check(Boolean(worldDiaryEvent), 'a world-shared diary is recorded on the world timeline');
  const diaryScene: any = {
    id: 'sc-diary', userId: 'u', worldId: DEFAULT_WORLD, characterIds: ['a', 'b'], place: '屋顶', timeLabel: '夜晚', mood: '安静',
    state: { participants: ['a', 'b'].map((characterId) => ({ characterId, goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'memory' })) },
  };
  const characters = await db.characters.toArray();
  const diaryContext = await buildWorldContext({ userId: 'u', worldId: DEFAULT_WORLD, scene: diaryScene, characters, userText: '今晚聊点什么' });
  check(renderCharacterContext(diaryContext, 'a').includes('橘色天文穹顶'), 'the linked character still knows their own shared diary');
  check(renderWorldLayer(diaryContext).includes('流星') === false, 'shared diary text never enters the shared world layer');
  check(renderWorldBrief(diaryContext).includes('流星') === false, 'shared diary text never enters the shared Director brief');
  check(renderCharacterContext(diaryContext, 'b').includes('流星') === false, 'other characters do not receive it either');

  /* ─────────── ⑤ 更正 / 删除源内容 ─────────── */
  section('场景五：更正与删除在三种模式同时生效');
  await db.memories.put({ id: 'c-old', userId: 'u', characterId: 'a', content: '用户不吃香菜', memoryKind: 'preference', status: 'active', type: 'auto', createdAt: now } as any);
  await db.memories.put({ id: 'c-new', userId: 'u', characterId: 'a', content: '其实我很喜欢香菜', memoryKind: 'preference', status: 'active', type: 'auto', createdAt: now + 1 } as any);
  await memoryRepo.supersedeLikelyCorrections('a', 'u', { id: 'c-new', userId: 'u', characterId: 'a', content: '其实我很喜欢香菜', memoryKind: 'preference', type: 'auto', createdAt: now + 1 } as any);
  check((await db.memories.get('c-old'))?.status === 'superseded', 'a clear correction retires the old version');
  for (const mode of ['private', 'group', 'world'] as const) {
    const extra = mode === 'private' ? { topic: '香菜' }
      : mode === 'group' ? { mode: 'group-chat', audience: ['a'], topic: '香菜' }
        : { mode: 'world-scene', worldId: DEFAULT_WORLD, scene: { worldId: DEFAULT_WORLD, sceneId: 'sc-a' }, topic: '香菜' };
    const result = await recall('a', extra as any);
    check(result.text.includes('不吃香菜') === false, `the corrected version is gone from ${mode} recall`);
    check(result.text.includes('其实我很喜欢香菜'), `the corrected version is what ${mode} recall uses now`);
  }
  await db.sessions.put({ id: 'gs2', userId: 'u', type: 'group', groupId: 'g1', characterId: '', createdAt: now, updatedAt: now } as any);
  await messageRepo.create({ id: 'gm-del', sessionId: 'gs2', role: 'user', content: 'DELETED_SOURCE_55 我们约好去青海', createdAt: now, isProactive: false });
  await memoryRepo.create({
    id: 'm-del', userId: 'u', characterId: 'a', content: 'DELETED_SOURCE_55 我们约好去青海', type: 'auto', status: 'active',
    sourceSessionId: 'gs2', sourceMessageIds: ['gm-del'], sourceMessageRevisions: { 'gm-del': 1 }, createdAt: now, updatedAt: now,
  } as any);
  await messageRepo.deleteById('gm-del');
  check((await db.memories.get('m-del'))?.status === 'superseded', 'deleting the source message retires the memory derived from it');
  check((await recall('a', { topic: '青海' })).text.includes('DELETED_SOURCE_55') === false, 'the deleted source is gone from private chat');
  check((await recall('a', { mode: 'group-chat', audience: ['a', 'b'], topic: '青海' })).text.includes('DELETED_SOURCE_55') === false, 'the deleted source is gone from group chat');
  check((await recall('a', { mode: 'world-scene', worldId: DEFAULT_WORLD, scene: { worldId: DEFAULT_WORLD, sceneId: 'sc-a' }, topic: '青海' })).text.includes('DELETED_SOURCE_55') === false, 'the deleted source is gone from the world scene');

  /* ─────────── ⑥ 长对话压缩后仍能取回、且不机械重复 ─────────── */
  section('场景六：摘要压缩不吞掉原文，重复提起有冷却');
  await db.sessions.put({ id: 'long', userId: 'u', characterId: 'a', type: 'single', title: '很长的一段对话', createdAt: now - 900_000, updatedAt: now, unreadCount: 0 } as any);
  await db.messages.put({
    id: 'old-promise', sessionId: 'long', role: 'user', content: 'OLD_PROMISE_77 我们说好十月一起去看银杏',
    createdAt: now - 800_000, isProactive: false, revision: 1,
  } as any);
  await db.messages.bulkPut(Array.from({ length: 200 }, (_, index) => ({
    id: `long-filler-${index}`, sessionId: 'long', role: index % 2 === 0 ? 'user' : 'assistant',
    content: `普通闲聊第 ${index} 条`, createdAt: now - 700_000 + index * 100, isProactive: false,
  })) as any);
  await sessionRepo.updateSummary('long', '对话摘要：聊了工作、旅行和最近的天气', undefined, ['long-filler-199'], { 'long-filler-199': 1 });
  const compressedRecall = await recall('a', { topic: '还记得我们说好的银杏吗' });
  check(compressedRecall.sections.historical.includes('OLD_PROMISE_77'), 'after compression an explicit question still reaches the original wording');
  check((await recall('a', { topic: '今天好累' })).text.includes('OLD_PROMISE_77') === false, 'compression does not make an unrelated old promise resurface on its own');
  const repeatMemory = { id: 'm-repeat', userId: 'u', characterId: 'a', content: '用户喜欢银杏', memoryKind: 'preference', status: 'active', type: 'auto', createdAt: now } as any;
  const spoken = findSpokenMemoryIds('你喜欢银杏我记得很清楚。', [repeatMemory]);
  check(spoken.includes('m-repeat'), 'a memory really echoed in the reply is marked as spoken');
  check(rankConversationMemories([repeatMemory], '银杏', new Set(spoken), 8).length === 0, 'a memory just spoken is cooled down instead of being repeated every turn');
  check(rankConversationMemories([{ ...repeatMemory, pinned: true }], '银杏', new Set(spoken), 8).length === 1, 'a pinned fact the user asked to remember is never cooled down');

  /* ─────────── 写入侧回归（旧备份不能复活隐私状态） ─────────── */
  section('旧备份与恢复');
  await db.sharedStoryEvents.put({
    id: 'shared-story-1', userId: 'u', characterIds: ['a', 'b'], characterId: 'a', type: '约定', title: '一起看银杏',
    detail: '约好十月看银杏', createdAt: now, updatedAt: now,
  } as any);
  const sharedStoryRow = await db.sharedStoryEvents.get('shared-story-1');
  await sharedEventRepo.remove('shared-story-1');
  check(!(await db.sharedStoryEvents.get('shared-story-1')), 'removing a shared story event deletes it');
  await backupImport({ sharedStoryEvents: [sharedStoryRow] });
  check(!(await db.sharedStoryEvents.get('shared-story-1')), 'an old backup cannot resurrect a removed shared story event');

  await db.momentContacts.put({ id: 'contact-a', userId: 'u', characterId: 'a', blocked: true, updatedAt: now } as any);
  await backupImport({ momentContacts: [{ id: 'contact-a', userId: 'u', characterId: 'a', muted: true, updatedAt: now - 1000 }] });
  check((await db.momentContacts.get('contact-a'))?.blocked === true, 'an older backup cannot un-block a blocked character');
  check((await db.momentContacts.get('contact-a'))?.muted === true, 'the two switches on one contact row merge instead of overwriting each other');

  await db.worldEvents.put({
    id: 'rev-event', userId: 'u', worldId: DEFAULT_WORLD, type: 'stage', title: '旧世界事件', summary: '旧摘要',
    visibility: 'selected', visibleTo: ['a'], timestamp: now, createdAt: now, updatedAt: now, memoryIds: [],
  } as any);
  await worldEventRepo.update('rev-event', { summary: '正文被正常改写后的摘要' });
  await knowledgeRepo.grantForEvent({ userId: 'u', worldId: DEFAULT_WORLD, characterId: 'a', eventId: 'rev-event' });
  const grantedRow = await db.characterKnowledge.where('eventId').equals('rev-event').first();
  check(grantedRow?.sourceRevision === (await db.worldEvents.get('rev-event'))?.updatedAt, 'granting knowledge records the source revision it was based on');
  if (grantedRow) await db.characterKnowledge.delete(grantedRow.id);
  const { sourceRevision: _dropped, ...legacyKnowledge } = (grantedRow ?? {}) as Record<string, unknown>;
  await backupImport({ characterKnowledge: [{ ...legacyKnowledge, id: 'legacy-knowledge-row' }] });
  check(Boolean(await db.characterKnowledge.where('eventId').equals('rev-event').first()), 'restoring a backup brings back knowledge even when the row carries no revision');

  /* ─────────── 注销：账本与待办一起清空 ─────────── */
  section('注销');
  await db.todos.put({ id: 'todo-keep', userId: 'u', title: '注销前待办', recurrence: { kind: 'none' }, status: 'todo', visibility: 'selected', visibleTo: ['a'], createdAt: now, updatedAt: now } as any);
  await db.memoryClaims.put({ id: 'claim-keep', userId: 'u', canonicalKey: 'k', subjectType: 'user', subjectId: 'u', predicate: 'fact', value: '注销测试', memoryKind: 'fact', status: 'active', importance: 0.5, confidence: 0.8, stability: 'stable', mentionCount: 0, createdAt: now, updatedAt: now } as any);
  useAuthStore.setState({ userId: 'u' });
  await useChatStore.getState().deleteAccount();
  check((await db.memoryClaims.where('userId').equals('u').count()) === 0, 'deleting the account clears the memory ledger');
  check((await db.todos.where('userId').equals('u').count()) === 0, 'deleting the account clears todos');
  check((await db.groups.where('userId').equals('u').count()) === 0, 'deleting the account clears groups');

  document.body.textContent = `ok   ${count} assertions (real IndexedDB, zero network)\n\nALL PASS`;
  await report('/result', { method: 'POST', body: document.body.textContent });
}
run().catch(async (error) => {
  document.body.textContent = `FAIL ${error?.message ?? error}\n${error?.stack ?? ''}\n\n1 FAILED`;
  await report('/result', { method: 'POST', body: document.body.textContent });
});
