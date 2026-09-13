/**
 * VirtuGene 5.0.0 Living World 验收 B：多智能体与知识隔离
 * （§18 / §20 / §23 / §24 / §25 / §26 / §27 / §40 / §97 / §98）
 *
 * 要证明的四件事：
 *  1. **不机械轮流发言**：谁该回应由导演决定，点名的人一定回应，无关的人不说话。
 *  2. **知识隔离在结构上成立**：角色 A 的提示词里有的事，角色 B 的提示词里根本没有
 *     ——不是"嘱咐模型别说"，而是"模型看不到"。
 *  3. **角色之间真的在互动**：顺序生成时，后面的角色能读到前面角色刚说的话。
 *  4. **一致性守护能改到实处**：改写会落回数据库那一行，而不是只存在于返回值里。
 */
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { ensureCanvasScene, loadCanvas } from '../../src/lib/world/world-canvas';
import { runWorldTurn } from '../../src/lib/world/world-turn';
import { buildWorldContext, renderCharacterContext, renderWorldLayer } from '../../src/lib/world/world-context';
import { fallbackPlan, parseDirectorOutput, requiredSpeakers, type TurnSpeaker } from '../../src/lib/world/world-director';
import { buildActorSystem, parseActorOutput } from '../../src/lib/world/world-actor';
import { applyGuard, shouldGuard } from '../../src/lib/world/world-consistency';
import { normalizeWorldAction } from '../../src/lib/world/world-actions';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import { fakeCharacter, installFakeLlm, createReporter, seedWorld } from './world-harness';
import type { ActorBeat } from '../../src/lib/world/world-actor';
import type { WorldContext } from '../../src/lib/world/world-context';

const U = 'u-worldB';
const C1 = 'cB-moon';
const C2 = 'cB-star';
const C3 = 'cB-man';
const C4 = 'cB-rain';

const rep = createReporter();
const { check, section } = rep;
const llm = installFakeLlm();
const realFetch = llm.realFetch;

const list = () => [
  fakeCharacter(C1, '古月娜', U),
  fakeCharacter(C2, '星遥', U),
  fakeCharacter(C3, '小满', U),
  fakeCharacter(C4, '雨宫', U),
];

async function run() {
  const { worldId } = await seedWorld({
    userId: U,
    characters: [
      { id: C1, name: '古月娜' }, { id: C2, name: '星遥' },
      { id: C3, name: '小满' }, { id: C4, name: '雨宫' },
    ],
  });
  const characters = list();

  /* ================= P. 导演的纯逻辑 ================= */
  section('P. 导演：谁需要回应（§18）');
  const scene = await ensureCanvasScene({ userId: U, worldId, characters });
  const scene2 = await worldSceneRepo.addParticipant(scene.id, C3);
  const scene3 = await worldSceneRepo.addParticipant(scene.id, C4);
  void scene2; void scene3;
  const fullScene = (await worldSceneRepo.getScene(scene.id))!;
  const ctx: WorldContext = await buildWorldContext({ userId: U, worldId, scene: fullScene, characters });

  {
    check('① 四位角色都在场（这是多角色测试的前提）', ctx.presence.length === 4, ctx.presence);

    const plan = parseDirectorOutput(JSON.stringify({
      narration: '屋里安静下来。',
      speakers: [
        { character: '古月娜', intent: '回应', mode: 'both' },
        { character: '星遥', intent: '也回应', mode: 'dialogue' },
        { character: '小满', intent: '插一句', mode: 'dialogue' },
        { character: '雨宫', intent: '再说一句', mode: 'dialogue' },
        { character: '不存在的人', intent: '乱入', mode: 'dialogue' },
      ],
      sequential: false, worldChanges: [], shouldSettle: false,
    }), ctx, 2);
    check('② 导演最多只能让 2 个人说话（不机械轮流）', plan.speakers.length === 2, plan.speakers);
    check('③ 不在场/不存在的人被丢弃（绝不张冠李戴）',
      plan.speakers.every((s) => ctx.presence.includes(s.characterId)), plan.speakers);

    const action = normalizeWorldAction({ intent: 'talk', addressedCharacters: ['星遥'] }, '星遥，你说说看', [
      { id: C1, name: '古月娜' }, { id: C2, name: '星遥' },
    ]);
    check('④ 点名的人必须被算作"必须回应"', JSON.stringify(requiredSpeakers(action, ctx)) === JSON.stringify([C2]), requiredSpeakers(action, ctx));

    const fb = fallbackPlan(normalizeWorldAction({ intent: 'talk', addressedCharacters: ['小满'] }, '小满', [
      { id: C3, name: '小满' },
    ]), ctx, 2);
    check('⑤ 兜底计划也优先让点名的人先说（模型挂了也不乱）',
      fb.speakers[0]?.characterId === C3, fb.speakers);

    const silent = parseDirectorOutput(JSON.stringify({ speakers: [{ character: '古月娜', intent: 'x' }] }), ctx, 2);
    check('⑥ 只给 speakers、不给 narration 也是合法的计划', silent.via === 'json' && silent.speakers.length === 1);
    const broken = parseDirectorOutput('这不是 JSON', ctx, 2);
    check('⑦ 导演输出坏了 ⇒ 返回空计划（由上层兜底），不抛错', broken.via === 'none' && broken.speakers.length === 0);
  }

  /* ================= Q. 角色输出的解析与降级 ================= */
  section('Q. 角色（Actor）输出：结构失败也要保住正文（§64）');
  {
    check('① 标准 JSON',
      parseActorOutput('{"dialogue":"嗯。","action":"她点了点头。"}', C1).via === 'json');
    check('② 围栏 JSON', parseActorOutput('```json\n{"dialogue":"嗯。"}\n```', C1).via === 'json');
    const salvaged = parseActorOutput('我不知道该说什么，但我不想让你一个人待着。', C1);
    check('③ 结构完全失败但正文可用 ⇒ 保留正文（不让整轮失败）',
      salvaged.via === 'salvaged' && (salvaged.dialogue ?? '').includes('不想让你一个人'), salvaged);
    check('④ 空输出 ⇒ 如实报告"没有内容"，不编造', parseActorOutput('', C1).via === 'none');
  }

  /* ================= R. 知识隔离（§20 / §97） ================= */
  section('R. 知识隔离：A 知道的，B 的提示词里根本没有');
  const memoryTitle = '那个只有古月娜知道的秘密';
  {
    // 一条只对 C1 可见的共同记忆（走的是与生产完全相同的三张表）
    const memoryId = await sharedMemoryRepo.create({
      userId: U, worldId, title: memoryTitle, summary: '她在雨里说了一句话，只有你和她听见。',
      participants: [userRef(U), characterRef(C1)], sourceType: 'message', sourceId: 'msg-secret',
      importance: 0.9, visibility: 'selected', visibleTo: [C1], tags: ['测试'],
    });
    const eventId = await worldEventRepo.create({
      userId: U, worldId, type: 'shared_memory', title: memoryTitle, summary: '雨里的那句话',
      participants: [userRef(U), characterRef(C1)], sourceType: 'sharedMemory', sourceId: memoryId,
      visibility: 'selected', visibleTo: [C1], memoryIds: [memoryId],
    });
    await knowledgeRepo.upsert({ userId: U, worldId, characterId: C1, eventId, knowledgeLevel: 'full', canMention: true, isSecret: true, secretOwnerId: C1 });

    const iso = await buildWorldContext({ userId: U, worldId, scene: (await worldSceneRepo.getScene(scene.id))!, characters });
    const c1ctx = renderCharacterContext(iso, C1);
    const c2ctx = renderCharacterContext(iso, C2);
    check('① 古月娜的私有上下文里有这件事', c1ctx.includes(memoryTitle), c1ctx.slice(0, 200));
    check('② 星遥的私有上下文里**完全没有**这件事（结构隔离，不是"嘱咐别说"）',
      !c2ctx.includes(memoryTitle) && !c2ctx.includes('雨里'), c2ctx.slice(0, 200));
    check('③ 世界层（含全部世界设定）也不含这条私有记忆的正文泄漏',
      !renderWorldLayer(iso).includes('只有古月娜知道'), renderWorldLayer(iso).slice(0, 160));
    check('④ 秘密会被列入"守护者可见"清单（用于一致性检查）',
      iso.secrets.some((s) => s.title === memoryTitle), iso.secrets);
  }

  /* ================= S. 多角色互动（§24 / §25 / §40 / §98） ================= */
  section('S. 多角色互动：顺序生成、自动续拍、中断');
  {
    const speakerOf = (id: string, intent: string): TurnSpeaker => ({ characterId: id, intent, mode: 'both' });
    void speakerOf;
    const seenStart = llm.seen.length;
    const before = llm.calls();
    llm.push(JSON.stringify({ intent: 'character_interaction', addressedCharacters: ['古月娜', '星遥'] }));
    llm.push(JSON.stringify({
      narration: '她们看着彼此。',
      speakers: [{ character: '古月娜', intent: '先开口', mode: 'both' }, { character: '星遥', intent: '回应她', mode: 'both' }],
      sequential: true, worldChanges: [], shouldSettle: false,
    }));
    llm.push(JSON.stringify({ dialogue: '你最近是不是有心事。', action: '她把杯子放下。' }));
    llm.push(JSON.stringify({ dialogue: '没有。', action: '她看向窗外。' }));
    llm.push(JSON.stringify({ dialogue: '你骗不了我。' }));   // 自动第 1 拍
    llm.push(JSON.stringify({ dialogue: '……好吧。' }));       // 自动第 2 拍
    // 这个世界里有秘密（R 段造的）⇒ 每轮多一次一致性守护，这是设计如此（§27）
    llm.push(JSON.stringify({ ok: true, issues: [], rewrites: [] }));

    const result = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '你们两个自己聊聊，我听着。', characters, call: llm.stub,
    });
    const calls = llm.calls() - before;
    check('① 「你们两个自己聊聊」⇒ 初次回应 2 人 + 自动续 2 拍 + 1 次守护 = 7 次（§40）',
      calls === 7 && llm.pending() === 0, { calls, pending: llm.pending() });
    check('② 自动续拍的内容也进了世界流（用户逐条看到，不是一次性弹出）',
      result.entries.filter((e) => e.kind === 'dialogue').length === 4,
      result.entries.map((e) => `${e.kind}:${e.content}`));

    // 顺序生成：第二位角色的提示词里要能看到第一位刚说的话
    const actor2Prompt = JSON.stringify(llm.seen[seenStart + 3]);
    const auto1Prompt = JSON.stringify(llm.seen[seenStart + 4]);
    check('③ 顺序生成：后一位角色的上下文里带着前一位刚说的话（真正的互动，§24）',
      actor2Prompt.includes('你最近是不是有心事'), actor2Prompt.slice(0, 80));
    check('④ 自动续拍时角色看得到对方刚刚说的（不是各自独白）',
      auto1Prompt.includes('没有。') || auto1Prompt.includes('你最近是不是有心事'), auto1Prompt.slice(0, 80));
    const actor1Prompt = JSON.stringify(llm.seen[seenStart + 2]);
    const auto2Prompt = JSON.stringify(llm.seen[seenStart + 5]);
    check('⑤ 互动之后隔离依然成立：知道的人（古月娜）上下文里有，不知道的人（星遥）**完全没有**',
      actor1Prompt.includes(memoryTitle) && !actor2Prompt.includes(memoryTitle) && !auto2Prompt.includes(memoryTitle),
      { knows: actor1Prompt.includes(memoryTitle), star1: actor2Prompt.includes(memoryTitle), star2: auto2Prompt.includes(memoryTitle) });

    // 中断：shouldInterrupt 为真时立刻停
    const beforeStop = llm.calls();
    llm.push(JSON.stringify({ intent: 'character_interaction', addressedCharacters: ['古月娜', '星遥'] }));
    llm.push(JSON.stringify({
      narration: '', speakers: [{ character: '古月娜', intent: 'a', mode: 'both' }, { character: '星遥', intent: 'b', mode: 'both' }],
      sequential: true, worldChanges: [], shouldSettle: false,
    }));
    llm.push(JSON.stringify({ dialogue: '他们开始了。' }));
    llm.push(JSON.stringify({ dialogue: '嗯。' }));
    llm.push(JSON.stringify({ ok: true, issues: [], rewrites: [] }));
    const stopped = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '你们继续。', characters, call: llm.stub,
      shouldInterrupt: () => true,
    });
    check('⑥ 用户一输入就立刻中断自动互动：这一轮只有初次回应，没有续拍（§40）',
      llm.calls() - beforeStop === 5 && stopped.entries.filter((e) => e.kind === 'dialogue').length === 2,
      { calls: llm.calls() - beforeStop, dialogues: stopped.entries.filter((e) => e.kind === 'dialogue').length });
  }

  /* ================= T. 一致性守护（§27） ================= */
  section('T. Consistency Guard：重要轮次才跑，且改写要落到数据库');
  {
    const plan = {
      speakers: [{ characterId: C1, intent: 'x', mode: 'both' as const }],
      sequential: false, worldChanges: [], shouldSettle: true, suggestions: [], llmCalls: 1, via: 'json' as const,
    };
    const beats: ActorBeat[] = [{ characterId: C1, dialogue: '我知道了那个秘密。', via: 'json' }];
    check('① 值得结算的轮次 ⇒ 守护', shouldGuard({ plan, action: normalizeWorldAction({ intent: 'talk' }, 'x', []), beats, ctx }));
    check('② 普通寒暄 ⇒ 不守护（不给每一轮多花一次调用）',
      !shouldGuard({
        plan: { ...plan, shouldSettle: false },
        action: normalizeWorldAction({ intent: 'talk' }, '你好', []),
        beats, ctx: { ...ctx, secrets: [] },
      }));
    check('③ 涉及世界规则的轮次 ⇒ 守护',
      shouldGuard({ plan: { ...plan, shouldSettle: false }, action: normalizeWorldAction({ intent: 'world_rule' }, 'x', []), beats, ctx: { ...ctx, secrets: [] } }));
    check('④ 没有角色输出 ⇒ 不守护', !shouldGuard({ plan, action: normalizeWorldAction({ intent: 'talk' }, 'x', []), beats: [], ctx }));

    const applied = applyGuard(beats, [{ characterId: C1, dialogue: '我什么都不知道。' }]);
    check('⑤ 守护改写会被应用（按角色 id 精确对应）', applied[0].dialogue === '我什么都不知道。');
    const dropped = applyGuard(beats, [{ characterId: C1, drop: true }]);
    check('⑥ 守护可以整条丢弃（不可用时宁可不显示）', dropped.length === 0);

    // 真实一轮：守护把泄漏的那句改写掉，并且**改写落回数据库**
    const before = llm.calls();
    llm.push(JSON.stringify({ intent: 'talk', addressedCharacters: ['古月娜'] }));
    llm.push(JSON.stringify({
      narration: '', speakers: [{ character: '古月娜', intent: '不小心说漏嘴', mode: 'dialogue' }],
      sequential: false, worldChanges: [], shouldSettle: false,
    }));
    llm.push(JSON.stringify({ dialogue: '那个雨里的秘密我知道了。' }));
    llm.push(JSON.stringify({ ok: false, issues: ['泄露了不该知道的秘密'], rewrites: [{ character: '古月娜', dialogue: '……没什么。' }] }));
    const guarded = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '你还记得那件事吗？', characters, call: llm.stub,
    });
    check('⑦ 有秘密在场 ⇒ 这一轮多跑了一次守护', llm.calls() - before === 4, llm.calls() - before);
    const canvas = await loadCanvas(scene.id);
    const rewritten = canvas!.entries.find((e) => e.kind === 'dialogue' && e.content === '……没什么。');
    check('⑧ 改写真的落回了数据库那一行（不是只改了返回值）', !!rewritten, canvas!.entries.slice(-4).map((e) => e.content));
    const leaked = canvas!.entries.find((e) => e.content.includes('那个雨里的秘密我知道了'));
    check('⑨ 泄漏版本已经从世界流里消失', !leaked);
    check('⑩ 返回值与落库一致', guarded.beats.some((b) => b.dialogue === '……没什么。'));
  }

  /* ================= U. 纪律 ================= */
  section('U. 纪律');
  {
    check('① 全程零计划外网络请求', llm.netCalls() === 0, llm.netCalls());
    const dialogueCount = (await db.worldSceneEntries.where('sceneId').equals(scene.id).toArray())
      .filter((e) => e.kind === 'dialogue').length;
    check('② 角色台词只落 worldSceneEntries，不进聊天表', dialogueCount >= 6, dialogueCount);
  }

  section('清理');
  await worldRepo.clearForUser(U);
  check('清理后世界层为空',
    (await db.worldScenes.count()) === 0 && (await db.sharedMemories.count()) === 0 && (await db.characterKnowledge.count()) === 0);
}

run()
  .catch((err) => {
    rep.check(`抛出异常 :: ${String(err && (err as Error).stack ? (err as Error).stack : err)}`, false);
  })
  .finally(() => {
    llm.restore();
    rep.finish(realFetch);
  });
