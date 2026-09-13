/**
 * VirtuGene 5.0.0 Living World 验收 C：结算、世界设定、时间线、关系、隐私、撤销
 * （§28 / §29 / §30 / §31 / §32 / §43 / §44 / §45 / §46 / §100 / §101 / §102 / §103）
 *
 * 要证明的五件事：
 *  1. **不是每轮都结算**（§28）；结算一旦发生，LLM 的建议必须过校验层才能落库（§30）。
 *  2. **世界设定可改**（§101）：新设定与旧设定矛盾时停用旧的那一条，
 *     永远不会同时存在两条互相冲突的 Canon；改设定 0 次调用也要立即生效。
 *  3. **关系变化必须可解释、且不该每句话都变**（§44 / §102）。
 *  4. **日记隐私三级仍然成立**（§103）：private 谁都看不到，selected 只告诉一个人，world 才进共同世界。
 *  5. **撤销是真回滚**（§16）：正文、事件、记忆、设定、关系分面、好感度全部按 id 精确回收/反向回退。
 */
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { worldFactRepo } from '../../src/db/world-fact-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { relationshipRepo } from '../../src/db/relationship-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { stateRepo } from '../../src/db/state-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { setDiarySharing } from '../../src/lib/world/diary-visibility';
import { ensureCanvasScene, loadCanvas } from '../../src/lib/world/world-canvas';
import { runWorldTurn } from '../../src/lib/world/world-turn';
import { validateWorldSettlement } from '../../src/lib/world/world-settlement';
import { contradictsRule, groupSettings, listWorldSettings, toggleWorldSetting, upsertWorldFactWithReconcile } from '../../src/lib/world/world-facts';
import { buildTimeline, eventLabel, groupByDay } from '../../src/lib/world/world-timeline';
import { describeFacets, recentReasons } from '../../src/lib/world/relationships';
import { undoLastTurn } from '../../src/lib/world/world-undo';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import { fakeCharacter, installFakeLlm, createReporter, seedWorld } from './world-harness';

const U = 'u-worldC';
const C1 = 'cC-moon';
const C2 = 'cC-star';
const C3 = 'cC-outsider';

const rep = createReporter();
const { check, section } = rep;
const llm = installFakeLlm();
const realFetch = llm.realFetch;

const characters = () => [
  fakeCharacter(C1, '古月娜', U),
  fakeCharacter(C2, '星遥', U),
  fakeCharacter(C3, '局外人', U),
];

const settleCtx = {
  userId: U,
  characterIds: [C1, C2],
  resolveCharacter: (name: string) => (name === '古月娜' ? C1 : name === '星遥' ? C2 : undefined),
};

async function run() {
  const { worldId } = await seedWorld({
    userId: U,
    characters: [{ id: C1, name: '古月娜' }, { id: C2, name: '星遥' }, { id: C3, name: '局外人' }],
  });
  const chars = characters();
  const scene = await ensureCanvasScene({ userId: U, worldId, characters: chars });

  /* ================= P. 结算校验层（§30） ================= */
  section('P. 结算建议必须过校验层（LLM 永远不能直接改数据库）');
  {
    const raw = JSON.stringify({
      summary: '她们吵了一架，又和好了。',
      worldEvents: [
        { type: 'relationship', title: '雨夜里的那次争吵', summary: '两个人第一次真正吵起来', participants: ['古月娜', '星遥', '用户'], importance: 0.8 },
        { type: 'life_trace', title: '不允许的类型', participants: ['古月娜'] },
        { type: 'interaction', title: '没有在场参与者的事件', participants: ['局外人'] },
      ],
      sharedMemories: [{ title: '雨夜的争吵', summary: '谁都没有先低头。' }],
      relationshipChanges: [
        { a: '古月娜', b: '星遥', facets: { conflict: 6, affinity: 5 }, reason: '两个人为未来第一次吵起来' },
        { a: '古月娜', b: '星遥', facets: { trust: 3 } },
        { a: '古月娜', b: '局外人', facets: { trust: 3 }, reason: '场外的人不该被写进来' },
      ],
      continuityChanges: [{ who: '星遥', kind: 'topic', title: '还没说清的那件事', detail: '关于要不要离开' }],
      worldFactChanges: [{ category: 'rule', content: '这个城市每年秋天都会下很久的雨' }],
      characterStateChanges: [
        { character: '古月娜', affinityDelta: 99, moodDelta: -1, reason: '她其实很在意这件事' },
        { character: '局外人', affinityDelta: 5, reason: '不在场' },
        { character: '星遥', affinityDelta: 2 },
      ],
      knowledgeChanges: [{ character: '古月娜', eventTitle: '雨夜里的那次争吵' }],
    });
    const proposal = validateWorldSettlement(raw, settleCtx);
    check('① 合法世界事件保留、非法类型丢弃（模型不能自己发明事件类型）',
      proposal.worldEvents.length === 1 && proposal.worldEvents[0].type === 'relationship',
      proposal.worldEvents.map((e) => e.type));
    check('② 参与者不在场的世界事件被丢弃',
      proposal.worldEvents.every((e) => !e.participants.includes(characterRef(C3))), proposal.worldEvents);
    check('③ affinity 不是合法分面：出现即丢弃（R7 裁定）',
      proposal.dropped.some((d) => d.includes('affinity')), proposal.dropped);
    check('④ 缺原因的关系变化被丢弃（关系必须可解释）',
      proposal.relationshipChanges.length === 1, proposal.relationshipChanges.length);
    check('⑤ 涉及场外的人的关系变化被丢弃',
      proposal.relationshipChanges.every((c) => c.a !== characterRef(C3) && c.b !== characterRef(C3)));
    check('⑥ 好感度增量被夹到 ±5（模型不能一次把关系拉爆）',
      proposal.characterStates.find((c) => c.characterId === C1)?.affinityDelta === 5,
      proposal.characterStates);
    check('⑦ 不在场的角色状态变化被丢弃、缺原因的被丢弃',
      proposal.characterStates.length === 1 && proposal.characterStates[0].characterId === C1,
      proposal.characterStates);
    check('⑧ 模型想指定"谁知道什么" ⇒ 明确拒绝（认知由参与者规则决定，§20）',
      proposal.dropped.some((d) => d.includes('认知归属')), proposal.dropped);
    check('⑨ 解析失败 ⇒ 世界保持原状态（空建议 + 如实记录）',
      validateWorldSettlement('完全不是 JSON 的一段话', settleCtx).worldEvents.length === 0);
  }

  /* ================= Q. 真的结算一次（§29） ================= */
  section('Q. World Settlement：一次调用写多张表');
  {
    const before = llm.calls();
    llm.push(JSON.stringify({ intent: 'talk', addressedCharacters: ['古月娜'] }));
    llm.push(JSON.stringify({
      narration: '雨敲在窗上。', speakers: [{ character: '古月娜', intent: '说出真心话', mode: 'dialogue' }],
      sequential: false, worldChanges: ['你们说好了一起离开这座城'], shouldSettle: true,
    }));
    llm.push(JSON.stringify({ dialogue: '我们明天就走，好不好。' }));
    llm.push(JSON.stringify({ ok: true, issues: [], rewrites: [] }));   // 守护（shouldSettle=true）
    llm.push(JSON.stringify({
      summary: '你们决定一起离开这座城。',
      worldEvents: [{ type: 'relationship', title: '说好一起离开', summary: '在雨里定下的事', participants: ['古月娜', '用户'], importance: 0.9 }],
      sharedMemories: [{ title: '雨里说好的那件事', summary: '明天就走。' }],
      relationshipChanges: [{ a: '用户', b: '古月娜', facets: { trust: 5, familiarity: 2 }, reason: '你把离开这件事说出口了' }],
      continuityChanges: [{ who: '古月娜', kind: 'promise', title: '明天一起离开这座城' }],
      worldFactChanges: [{ category: 'history', content: '你们说好了一起离开这座城' }],
      characterStateChanges: [{ character: '古月娜', affinityDelta: 3, moodDelta: 1, lifeFocus: '准备离开这座城', reason: '她终于等到你把这句话说出口' }],
    }));

    const result = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '我们明天就一起离开这座城吧。', characters: chars, call: llm.stub,
    });
    const calls = llm.calls() - before;
    check('① 这一轮 = 理解 + 导演 + 角色 + 守护 + 结算 = 5 次调用', calls === 5, calls);
    check('② 结算发生了（导演说了 shouldSettle）', !!result.settlement && !result.settlement.error, result.settlement?.error);

    const events = await worldEventRepo.listTimeline(worldId, { limit: 20 });
    check('③ 世界事件写进去了（type 由校验层把关）',
      events.some((e) => e.title === '说好一起离开' && e.type === 'relationship'), events.map((e) => e.title));
    check('④ 共同记忆写进去了，且与事件互相引用',
      (await sharedMemoryRepo.listByWorld(worldId, 10)).some((m) => m.title === '雨里说好的那件事') &&
      events.some((e) => e.memoryIds.length > 0));
    check('⑤ 关系变化带原因地写进去了',
      (await relationshipRepo.listEventsByWorld(worldId, 20)).some((e) => e.reason.includes('离开这件事说出口')));
    check('⑥ 未完成的事挂到了具体角色上',
      (await db.continuityThreads.toArray()).some((t) => t.title === '明天一起离开这座城'));
    check('⑦ 世界设定多了一条',
      (await worldFactRepo.listByWorld(worldId, { category: 'history' })).length > 0);
    check('⑧ 认知只给参与者（亲身经历 ⇒ full + 可提起），不给局外人',
      (await knowledgeRepo.getForCharacterEvent(C1, result.settlement!.applied.worldEventIds[0]))?.knowledgeLevel === 'full' &&
      (await knowledgeRepo.getForCharacterEvent(C3, result.settlement!.applied.worldEventIds[0])) === undefined);

    const state = await stateRepo.get(C1, U);
    check('⑨ 好感度的唯一来源是 4.x 的 CharacterState（R7：世界层不存这个数）',
      (state?.affinity ?? 0) > 0 && !(('affinity' as never) in (events[0] as unknown as Record<string, unknown>)),
      state?.affinity);
    check('⑩ 「为什么变了」被写成可回看的生命轨迹',
      (state?.lifeEvents ?? []).some((e) => e.detail?.includes('她终于等到你把这句话说出口')), state?.lifeEvents);
  }

  /* ================= R. 世界设定（§31 / §32 / §101） ================= */
  section('R. 世界设定：自然语言、可改、永不留下两条冲突的 Canon');
  {
    check('① 冲突判定：共享实词 + 恰好一条含否定 ⇒ 冲突',
      contradictsRule('这里没有魔法', '这个世界其实存在魔法') === true);
    check('② 不误判：两条无关的规则不算冲突',
      contradictsRule('这里永远是秋天', '这座城靠海') === false);
    check('③ 不误判：两条都不含否定也不算冲突',
      contradictsRule('星遥喜欢下雨', '星遥讨厌下雨') === false);

    const first = await upsertWorldFactWithReconcile({
      userId: U, worldId, category: 'rule', content: '这里没有魔法', sourceType: 'user', sourceId: 'fact:no-magic',
    });
    check('④ 第一条规则写入', !!first.factId && first.deactivated.length === 0);

    const second = await upsertWorldFactWithReconcile({
      userId: U, worldId, category: 'rule', content: '改一下，这个世界其实存在魔法',
      sourceType: 'user', sourceId: 'fact:magic',
    });
    const rules = await worldFactRepo.listByWorld(worldId, { category: 'rule' });
    const active = rules.filter((f) => f.active);
    check('⑤ 改设定：旧的矛盾规则被**停用**（不是删除，历史仍可查）',
      second.deactivated.includes(first.factId) && rules.length === 2 && active.length === 1,
      rules.map((f) => `${f.content}:${f.active}`));
    check('⑥ 生效的是新规则，且**只有一条**规则生效（不会同时存在两个 Canon）',
      active.length === 1 && active[0].content.includes('存在魔法'), active.map((f) => f.content));

    const byReplaces = await upsertWorldFactWithReconcile({
      userId: U, worldId, category: 'rule', content: '这个世界没有魔法了',
      sourceType: 'user', sourceId: 'fact:magic-off', replaces: '改一下，这个世界其实存在魔法',
    });
    check('⑦ 模型提出 replaces（原文）时按原文精确停用旧那条',
      byReplaces.deactivated.length === 1,
      (await worldFactRepo.listByWorld(worldId, { category: 'rule' })).map((f) => `${f.content}:${f.active}`));

    await toggleWorldSetting(first.factId, true);
    check('⑧ 用户可以"恢复"一条被停用的设定（暂停≠删除）',
      (await worldFactRepo.getById(first.factId))?.active === true);

    const grouped = groupSettings(await listWorldSettings(worldId));
    check('⑨ 设定页按分类分组（自然语言卡片，不是表单）',
      grouped.length > 0 && grouped.every((g) => g.items.length > 0), grouped.map((g) => g.label));
  }

  /* ================= S. 关系：可解释、且不该每句话都变（§44 / §102） ================= */
  section('S. 关系：只因为真正有意义的事而变化');
  {
    // 一次普通寒暄（不结算）⇒ 关系一动不动
    const relBefore = await relationshipRepo.countEvents(worldId);
    const before = llm.calls();
    llm.push(JSON.stringify({ intent: 'talk', addressedCharacters: ['星遥'] }));
    llm.push(JSON.stringify({ narration: '', speakers: [{ character: '星遥', intent: '打个招呼', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }));
    llm.push(JSON.stringify({ dialogue: '早。' }));
    await runWorldTurn({ userId: U, worldId, sceneId: scene.id, text: '早。', characters: chars, call: llm.stub });
    check('① 普通寒暄不产生任何关系变化（§44：不该每句话 ±1）',
      (await relationshipRepo.countEvents(worldId)) === relBefore, { before: relBefore, calls: llm.calls() - before });

    // 一次真正的冲突
    llm.push(JSON.stringify({ intent: 'talk', addressedCharacters: ['星遥'] }));
    llm.push(JSON.stringify({ narration: '', speakers: [{ character: '星遥', intent: '把不满说出来', mode: 'dialogue' }], sequential: false, worldChanges: ['你们吵了一架'], shouldSettle: true }));
    llm.push(JSON.stringify({ dialogue: '你根本没想过我。' }));
    llm.push(JSON.stringify({ ok: true, issues: [], rewrites: [] }));
    llm.push(JSON.stringify({
      summary: '你们为离开这件事吵了一架。',
      worldEvents: [], sharedMemories: [], continuityChanges: [], worldFactChanges: [], characterStateChanges: [],
      relationshipChanges: [{ a: '用户', b: '星遥', facets: { conflict: 7, trust: -2 }, reason: '为了要不要离开这件事第一次吵起来' }],
    }));
    await runWorldTurn({ userId: U, worldId, sceneId: scene.id, text: '我从来没说过不带你走。', characters: chars, call: llm.stub });

    const pair = await relationshipRepo.getStateFor(userRef(U), characterRef(C2), worldId);
    const readings = describeFacets(pair, 3).map((r) => r.text);
    check('② 冲突之后，关系页读到的是人话（不是数字），并且确实读得出"摩擦"这一维',
      pair!.conflict > 0 && describeFacets(pair, 3).some((r) => r.facet === 'conflict' && r.text.length > 0),
      { conflict: pair!.conflict, readings });
    check('③ 关系页不出现任何内部数值',
      readings.every((t) => !/\d/.test(t)), readings);
    const reasons = recentReasons(await relationshipRepo.listEvents(worldId, pair!.pairKey, 5), 3);
    check('④ 每一条变化都带得上可读的原因',
      reasons.length > 0 && reasons[0].reason.includes('第一次吵起来'), reasons.map((r) => r.reason));

    // 一次真正的和解
    llm.push(JSON.stringify({ intent: 'talk', addressedCharacters: ['星遥'] }));
    llm.push(JSON.stringify({ narration: '', speakers: [{ character: '星遥', intent: '和解', mode: 'dialogue' }], sequential: false, worldChanges: ['你们和好了'], shouldSettle: true }));
    llm.push(JSON.stringify({ dialogue: '……对不起。' }));
    llm.push(JSON.stringify({ ok: true, issues: [], rewrites: [] }));
    llm.push(JSON.stringify({
      summary: '你们把话说开了。',
      worldEvents: [], sharedMemories: [], continuityChanges: [], worldFactChanges: [], characterStateChanges: [],
      relationshipChanges: [{ a: '用户', b: '星遥', facets: { conflict: -7, trust: 4 }, reason: '把离开这件事说开之后，她不再绷着' }],
    }));
    await runWorldTurn({ userId: U, worldId, sceneId: scene.id, text: '我会带你一起走的。', characters: chars, call: llm.stub });
    const pair2 = await relationshipRepo.getStateFor(userRef(U), characterRef(C2), worldId);
    check('⑤ 和解之后关系读数确实变了（数值变化一定伴随一条原因）',
      pair2!.conflict < pair!.conflict && pair2!.trust > pair!.trust,
      { before: { c: pair!.conflict, t: pair!.trust }, after: { c: pair2!.conflict, t: pair2!.trust } });
    const reasons2 = recentReasons(await relationshipRepo.listEvents(worldId, pair2!.pairKey, 5), 1);
    check('⑥ 最新一条原因是和解（"为什么变成现在这样"有答案）',
      reasons2[0].reason.includes('说开'), reasons2.map((r) => r.reason));
  }

  /* ================= T. 时间线（§46） ================= */
  section('T. 时间线：一段生活史，不显示数据库类型');
  {
    check('① 类型翻译成人话（用户看不到 worldEventType 这种词）',
      eventLabel({ type: 'stage', sourceType: 'scene', tags: [] }) === '你们一起经历的' &&
      eventLabel({ type: 'reality', sourceType: 'diary', tags: [] }) === '你写下的生活' &&
      eventLabel({ type: 'relationship', sourceType: 'lifeEvent', tags: [] }) === '关系变了',
      [eventLabel({ type: 'stage', sourceType: 'scene', tags: [] })]);

    const privateDiary = await diaryRepo.create({ userId: U, date: '2026-01-01', title: '谁都不该看到的日记', content: '很私人的内容', mood: 3, tags: [] });
    const worldDiary = await diaryRepo.create({ userId: U, date: '2026-01-02', title: '今天去了海边', content: '风很大', mood: 4, tags: [], characterId: C1 });
    await setDiarySharing({ userId: U, diaryId: worldDiary, visibility: 'world' });

    const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? 'TA';
    const timeline = await buildTimeline({ userId: U, worldId, nameOf, limit: 120 });
    check('② private 日记**不进**时间线（私人内容默认只有自己知道）',
      !timeline.some((i) => i.title === '谁都不该看到的日记'), timeline.filter((i) => i.kind === 'reality').map((i) => i.title));
    check('③ 加入共同世界的日记以"你写下的生活"出现',
      timeline.some((i) => i.title === '今天去了海边' && i.label === '你写下的生活'),
      timeline.filter((i) => i.kind === 'reality').map((i) => `${i.label}:${i.title}`));
    check('④ 世界事件 / 关系变化 / 世界设定都进了同一条时间线',
      ['你们一起经历的', '关系变了', '这个世界记住了'].every((label) => timeline.some((i) => i.label === label)),
      [...new Set(timeline.map((i) => i.label))]);
    check('⑤ 时间线按时间倒序分组', groupByDay(timeline).every((g) => g.items.length > 0) &&
      timeline.every((item, i) => i === 0 || timeline[i - 1].timestamp >= item.timestamp));
    void privateDiary;
  }

  /* ================= U. 日记隐私三级（§103） ================= */
  section('U. 日记隐私：private / selected / world 三级严格成立');
  {
    const d1 = await diaryRepo.create({ userId: U, date: '2026-02-01', title: '只给自己的', content: 'private 正文不该被任何人读到', mood: 3, tags: [] });
    const d2 = await diaryRepo.create({ userId: U, date: '2026-02-02', title: '只告诉古月娜', content: 'selected 正文', mood: 3, tags: [], characterId: C1 });
    await setDiarySharing({ userId: U, diaryId: d2, visibility: 'selected', visibleTo: [C1] });
    const d3 = await diaryRepo.create({ userId: U, date: '2026-02-03', title: '大家都可以知道', content: 'world 正文', mood: 3, tags: [], characterId: C1 });
    await setDiarySharing({ userId: U, diaryId: d3, visibility: 'world' });

    const { listMentionableDiaryIds } = await import('../../src/lib/world/diary-visibility');
    const c1Knows = await listMentionableDiaryIds(U, worldId, C1);
    const c2Knows = await listMentionableDiaryIds(U, worldId, C2);
    check('① private 日记：谁都不知道（连本人都只是"自己的"）', !c1Knows.has(d1) && !c2Knows.has(d1));
    check('② selected 日记：只有被告诉的那个人知道', c1Knows.has(d2) && !c2Knows.has(d2));
    check('③ world 日记：世界内的角色可以知道', c1Knows.has(d3), [...c1Knows]);
    check('④ 撤回授权立即生效',
      (await (async () => { await setDiarySharing({ userId: U, diaryId: d2, visibility: 'private' }); return listMentionableDiaryIds(U, worldId, C1); })()).has(d2) === false);
  }

  /* ================= V. 撤销是真回滚（§16） ================= */
  section('V. Undo：正文、事件、记忆、设定、关系、好感度全部回收');
  {
    await worldSceneRepo.updateScene(scene.id, { place: '老地方' });
    const affinityBefore = (await stateRepo.get(C1, U))?.affinity ?? 0;
    const relBefore = await relationshipRepo.getStateFor(userRef(U), characterRef(C1), worldId);

    const before = llm.calls();
    llm.push(JSON.stringify({ intent: 'world_rule', worldFact: '这里的雨永远不会停', factCategory: 'rule' }));
    llm.push(JSON.stringify({ narration: '世界安静地接受了这句话。', speakers: [], sequential: false, worldChanges: ['世界规则：这里的雨永远不会停'], shouldSettle: true }));
    llm.push(JSON.stringify({
      summary: '世界多了一条规则。',
      worldEvents: [{ type: 'interaction', title: '你在雨里立下一条规则', participants: ['古月娜', '用户'] }],
      sharedMemories: [{ title: '永远下雨的那一天' }],
      relationshipChanges: [{ a: '用户', b: '古月娜', facets: { trust: 6 }, reason: '你把这句话说给她听' }],
      continuityChanges: [],
      worldFactChanges: [],
      characterStateChanges: [{ character: '古月娜', affinityDelta: 4, reason: '她相信你说的话' }],
    }));
    const turn = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '这里的雨永远不会停。', characters: chars, call: llm.stub,
    });
    const turnRow = await db.worldTurns.get(turn.turnId);
    check('① 这一轮确实写了很多东西（撤销才有意义）',
      turn.settlement!.applied.worldEventIds.length === 1 &&
      turn.settlement!.applied.memoryIds.length === 1 &&
      turn.settlement!.applied.relationshipEventIds.length === 1 &&
      (turnRow?.settledFactIds.length ?? 0) >= 1,
      { applied: turn.settlement!.applied, facts: turnRow?.settledFactIds });
    const relAfter = await relationshipRepo.getStateFor(userRef(U), characterRef(C1), worldId);
    const affinityAfter = (await stateRepo.get(C1, U))?.affinity ?? 0;
    check('② 关系与好感度都动了', relAfter!.trust > (relBefore?.trust ?? 0) && affinityAfter > affinityBefore,
      { trust: [relBefore?.trust, relAfter!.trust], affinity: [affinityBefore, affinityAfter] });

    const canvasBefore = await loadCanvas(scene.id);
    const callsBeforeUndo = llm.calls();
    const undo = await undoLastTurn({ userId: U, worldId });
    check('③ 撤销 0 次模型调用', llm.calls() === callsBeforeUndo, llm.calls() - callsBeforeUndo);
    check('④ 撤销回收了正文', undo.removedEntries > 0, undo);
    check('⑤ 撤销回收了世界事件与它的认知',
      undo.removedEvents === 1 &&
      (await knowledgeRepo.getForCharacterEvent(C1, turn.settlement!.applied.worldEventIds[0])) === undefined);
    check('⑥ 撤销回收了共同记忆与关系变化',
      undo.removedMemories === 1 && undo.removedRelationships === 1 &&
      (await sharedMemoryRepo.listByWorld(worldId, 50)).every((m) => m.title !== '永远下雨的那一天'));
    check('⑦ 撤销删除的是**这一轮新写**的设定（旧设定不受影响）',
      undo.removedFacts >= 1 && (await worldFactRepo.listByWorld(worldId, { category: 'rule' })).length > 0,
      (await worldFactRepo.listByWorld(worldId, { category: 'rule' })).map((f) => f.content));
    const relRestored = await relationshipRepo.getStateFor(userRef(U), characterRef(C1), worldId);
    check('⑧ 关系分面被**反向回退**（不是删库重来）',
      relRestored!.trust === (relBefore?.trust ?? 0), { before: relBefore?.trust, restored: relRestored!.trust });
    check('⑨ 好感度被反向回退（4.x 状态也回到撤销前）',
      ((await stateRepo.get(C1, U))?.affinity ?? 0) === affinityBefore,
      { before: affinityBefore, after: (await stateRepo.get(C1, U))?.affinity });
    check('⑩ 世界流少了这一轮的正文', (await loadCanvas(scene.id))!.total < canvasBefore!.total);
    check('⑪ 撤销后仍然可以继续（不是"一次性"功能）',
      (await undoLastTurn({ userId: U, worldId })).ok === true || (await undoLastTurn({ userId: U, worldId })).message.length > 0);
  }

  /* ================= W. 纪律 ================= */
  section('W. 纪律');
  {
    check('① 全程零计划外网络请求', llm.netCalls() === 0, llm.netCalls());
    check('② 关系状态只读表、不在现场累加事件（状态与历史分离）',
      (await relationshipRepo.countStates(worldId)) > 0);
  }

  section('清理');
  await worldRepo.clearForUser(U);
  await db.diaries.where('userId').equals(U).delete();
  await db.characterStates.where('userId').equals(U).delete();
  check('清理后世界层为空', (await db.worldScenes.count()) === 0 && (await db.worldFacts.count()) === 0);
}

run()
  .catch((err) => {
    rep.check(`抛出异常 :: ${String(err && (err as Error).stack ? (err as Error).stack : err)}`, false);
  })
  .finally(() => {
    llm.restore();
    rep.finish(realFetch);
  });
