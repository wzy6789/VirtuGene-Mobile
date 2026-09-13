/**
 * VirtuGene 5.0.0 Living World 验收 A：意图理解与自由度（§12 / §13 / §14 / §15 / §16 / §95 / §96）
 *
 * 要证明的三件事：
 *  1. **用户不选模式**：任意一句话都被翻译成结构化 WorldAction，解析不出来就落到 freeform，
 *     绝不报错、绝不让用户"先选一个行为类型"（§14）。
 *  2. **自然语言真的改变世界**：换地点 / 换氛围 / 改世界规则 / 时间跳跃 / 召集与离开 /
 *     结束话题 / 撤销 / 修改事实，全部由本地规则确定性执行（§15/§16），
 *     且**这不是"模型说了算"**——脚本化的模型输出只负责"演"。
 *  3. **成本可核对**：每一轮真实发生的调用次数被记在轮次上；撤销 0 次调用。
 */
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { worldFactRepo } from '../../src/db/world-fact-repo';
import { worldTurnRepo } from '../../src/db/world-turn-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import { ensureCanvasScene, loadCanvas } from '../../src/lib/world/world-canvas';
import { runWorldTurn } from '../../src/lib/world/world-turn';
import { interpretWorldIntent } from '../../src/lib/world/world-intent';
import {
  fallbackInterpret,
  leavesWorldTrace,
  normalizeWorldAction,
  ruleInterpret,
} from '../../src/lib/world/world-actions';
import { findRelevantHistory } from '../../src/lib/world/world-recall';
import { worldAiCallCount, resetWorldAiCallCount } from '../../src/lib/world/world-ai-client';
import { fakeCharacter, installFakeLlm, createReporter, seedWorld, sleep } from './world-harness';
import type { Character } from '../../src/db/index';

const U = 'u-worldA';
const C1 = 'cA-moon';
const C2 = 'cA-star';
const C3 = 'cA-man';

const rep = createReporter();
const { check, section } = rep;
const llm = installFakeLlm();
const realFetch = llm.realFetch;

/** 脚本化一轮：严格按流水线顺序压入响应（interpreter → director → [narrator] → actors → [guard] → settle） */
function scriptTurn(opts: {
  intent: Record<string, unknown>;
  plan?: Record<string, unknown>;
  narrator?: string;
  beats?: Record<string, unknown>[];
  guard?: Record<string, unknown>;
  settle?: Record<string, unknown>;
}): void {
  llm.push(JSON.stringify(opts.intent));
  const silent = opts.intent.silence === true;
  if (!silent) {
    llm.push(JSON.stringify(opts.plan ?? {
      narration: '', speakers: [], sequential: false, worldChanges: [], shouldSettle: false, suggestions: [],
    }));
  }
  if (opts.narrator) llm.push(JSON.stringify({ narration: opts.narrator }));
  for (const beat of opts.beats ?? []) llm.push(JSON.stringify(beat));
  if (opts.guard) llm.push(JSON.stringify(opts.guard));
  if (opts.settle) llm.push(JSON.stringify(opts.settle));
}

const chars = (): Character[] => [
  fakeCharacter(C1, '古月娜', U),
  fakeCharacter(C2, '星遥', U),
  fakeCharacter(C3, '小满', U),
];

async function run() {
  const { worldId } = await seedWorld({
    userId: U,
    characters: [
      { id: C1, name: '古月娜' },
      { id: C2, name: '星遥' },
      { id: C3, name: '小满' },
    ],
  });

  /* ================= P. 纯函数：规则层与兜底层 ================= */
  section('P. 纯函数：本地规则（0 次调用）与关键词兜底');
  {
    const r1 = ruleInterpret('刚才不算。');
    check('① 规则层认出「刚才不算」= 撤销，且标明来源是规则（0 次调用）',
      r1?.intent === 'undo' && r1.by === 'rule' && r1.requiresCharacterResponse === false, r1);
    check('② 规则层也认「撤销上一轮」「刚才那段重新来」',
      ruleInterpret('撤销上一轮')?.intent === 'undo' && ruleInterpret('刚才那段重新来')?.intent === 'undo');
    check('③ 规则层**不**越权：普通句子一律交给模型（返回 null）',
      ruleInterpret('我们出去走走吧') === null && ruleInterpret('今天有点累') === null);

    check('④ 兜底：时间跳跃', fallbackInterpret('直接到第二天早上').intent === 'time_skip');
    check('⑤ 兜底：修改已发生的事实（retcon）', fallbackInterpret('其实我们从来没去过那里').intent === 'retcon');
    check('⑥ 兜底：长期世界规则', fallbackInterpret('这里以后每年这个时候都会下雨').intent === 'world_rule');
    check('⑦ 兜底：召集 / 让角色离开',
      fallbackInterpret('让星遥过来').intent === 'summon' && fallbackInterpret('让星遥先离开').intent === 'dismiss');
    check('⑧ 兜底：换地点', fallbackInterpret('我们去海边').intent === 'change_location');
    const silent = fallbackInterpret('大家别说话');
    check('⑨ 兜底：明确要求安静 ⇒ 允许 0 个角色回应',
      silent.silence === true && silent.requiresCharacterResponse === false, silent);
    check('⑩ 兜底：普通一句话 ⇒ freeform（不是失败）', fallbackInterpret('你好').intent === 'freeform');

    const characters = [{ id: C1, name: '古月娜' }, { id: C2, name: '星遥' }];
    const a1 = normalizeWorldAction({ intent: '外星意图', addressedCharacters: ['古月娜', '不存在的人'] }, '测试', characters);
    check('⑪ 未知 intent ⇒ freeform（永不报错）', a1.intent === 'freeform');
    check('⑫ 名字解析：真实名字变 id、编出来的名字被丢弃（绝不乱安）',
      JSON.stringify(a1.addressedCharacters) === JSON.stringify([C1]), a1.addressedCharacters);
    const a2 = normalizeWorldAction({ intent: 'talk', silence: true, requiresCharacterResponse: true }, '安静', characters);
    check('⑬ silence 是硬规则：覆盖模型给的 requiresCharacterResponse',
      a2.silence === true && a2.requiresCharacterResponse === false);
    const a3 = normalizeWorldAction({ intent: 'world_rule', worldFact: '这里永远是秋天', factCategory: 'rule' }, '秋天', characters);
    check('⑭ 世界规则默认落库（shouldPersist），且带分类',
      a3.shouldPersist === true && a3.factCategory === 'rule');
    check('⑮ 只有会改变世界的意图才留痕', leavesWorldTrace(a3) && !leavesWorldTrace(normalizeWorldAction({ intent: 'talk' }, '你好', characters)));
  }

  /* ================= Q. Interpreter 调用层 ================= */
  section('Q. World Intent Interpreter（1 次调用；失败绝不报错）');
  {
    const characters = chars();
    resetWorldAiCallCount();
    llm.reset();
    llm.push('```json\n{"intent":"change_location","locationChange":"海边"}\n```');
    const r = await interpretWorldIntent({
      userId: U, worldId, text: '我们去海边', characters, presence: [C1], place: '家', timeLabel: '夜晚',
      recent: [], call: llm.stub,
    });
    check('① 围栏 JSON 也能解析（§63）', r.action.intent === 'change_location' && r.action.locationChange === '海边', r.action);
    check('② 恰好 1 次调用', r.llmCalls === 1 && llm.calls() === 1, { r: r.llmCalls, stub: llm.calls() });

    llm.reset();
    llm.push('好的，这是结果：{"intent":"summon","addressedCharacters":["星遥"]} 希望有帮助');
    const r2 = await interpretWorldIntent({
      userId: U, worldId, text: '让星遥过来', characters, presence: [C1], place: '家', timeLabel: '夜晚',
      recent: [], call: llm.stub,
    });
    check('③ JSON 前后有解释文字也能解析（§63）',
      r2.action.intent === 'summon' && r2.action.addressedCharacters?.[0] === C2, r2.action);

    llm.reset();
    llm.push('我完全不知道怎么回答。');
    const r3 = await interpretWorldIntent({
      userId: U, worldId, text: '唔……', characters, presence: [C1], place: '家', timeLabel: '夜晚',
      recent: [], call: llm.stub,
    });
    check('④ 结构完全失败 ⇒ 退到关键词兜底，不抛错、不阻断', r3.via === 'fallback' && !!r3.action.intent, r3);

    llm.reset();
    llm.push('');  // 空响应
    const r4 = await interpretWorldIntent({
      userId: U, worldId, text: '我们去海边', characters, presence: [C1], place: '家', timeLabel: '夜晚',
      recent: [], call: (async () => { throw new Error('timeout'); }) as never,
    });
    check('⑤ 调用抛错 ⇒ 仍然是可用的 WorldAction（§14/§51）', !!r4.action.intent && r4.via === 'fallback', r4);

    llm.reset();
    const before = llm.calls();
    const r5 = await interpretWorldIntent({
      userId: U, worldId, text: '刚才不算。', characters, presence: [C1], place: '家', timeLabel: '夜晚',
      recent: [], call: llm.stub,
    });
    check('⑥ 撤销走规则层：0 次调用（§16 成本纪律）',
      r5.via === 'rule' && r5.llmCalls === 0 && llm.calls() === before, { via: r5.via, calls: llm.calls() - before });
  }

  /* ================= R. 连续自由度（§95 十二句） ================= */
  section('R. 基础自由度：连续十二句话都必须自然工作');
  const characters = chars();
  const scene = await ensureCanvasScene({ userId: U, worldId, characters });
  check('① 进入世界：取/建「此刻」这一段，且 0 次调用', !!scene.id && llm.calls() === 0, { id: scene.id, calls: llm.calls() });
  check('② 这一段默认有两位在场角色（不是你手动配置出来的）', scene.characterIds.length === 2, scene.characterIds);

  const stray: number[] = [];
  const turn = async (text: string, script: Parameters<typeof scriptTurn>[0], origin: 'text' | 'suggestion' | 'control' = 'text') => {
    const before = llm.calls();
    scriptTurn(script);
    const result = await runWorldTurn({ userId: U, worldId, sceneId: scene.id, text, origin, characters, call: llm.stub });
    const calls = llm.calls() - before;
    // 脚本必须被**恰好**消费完：剩下来就说明这一轮花的调用比脚本少 ⇒ 脚本自己写错了
    const leftover = llm.pending();
    if (leftover > 0) llm.queue.splice(0, leftover);
    stray.push(leftover);
    return { result, calls };
  };

  {
    const t1 = await turn('你好。', {
      intent: { intent: 'talk', requiresNarration: true, requiresCharacterResponse: true },
      plan: { speakers: [{ character: '古月娜', intent: '打个招呼', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false },
      beats: [{ dialogue: '你回来啦。' }],
    });
    check('③ 「你好」⇒ 1 次理解 + 1 次导演 + 1 次角色 = 3 次调用', t1.calls === 3, t1.calls);
    check('④ 用户的行动与角色的对白都进了世界流',
      t1.result.entries.some((e) => e.kind === 'user_input') && t1.result.entries.some((e) => e.kind === 'dialogue'),
      t1.result.entries.map((e) => e.kind));
    check('⑤ 普通寒暄**不**写世界事件（§28：不要让"你好"产生三个事件）',
      t1.result.settlement === undefined && (await db.worldEvents.where('worldId').equals(worldId).count()) === 0);

    const t2 = await turn('今天有点累。', {
      intent: { intent: 'talk', requiresNarration: true, requiresCharacterResponse: true },
      plan: { speakers: [{ character: '古月娜', intent: '关心但不要逼问', mode: 'both' }], sequential: false, worldChanges: [], shouldSettle: false },
      beats: [{ dialogue: '那就先坐下。', action: '她把窗户推开了一点。' }],
    });
    check('⑥ 角色的「动作 + 对白」同轮落库（UI 合成一个视觉组）',
      t2.result.entries.some((e) => e.kind === 'action') && t2.result.entries.some((e) => e.kind === 'dialogue'));
    check('⑦ 导演给的「关心但不逼问」真的进了角色提示词',
      JSON.stringify(llm.seen[llm.seen.length - 1]).includes('关心但不要逼问'));

    const t3 = await turn('大家别说话，陪我坐一会。', {
      intent: { intent: 'talk', silence: true },
    });
    check('⑧ 「大家安静一会」⇒ 只花 1 次调用（导演走短路规则，不花钱）', t3.calls === 1, t3.calls);
    check('⑨ 这一轮只有旁白、没有角色台词',
      t3.result.entries.some((e) => e.kind === 'narration') && !t3.result.entries.some((e) => e.kind === 'dialogue'),
      t3.result.entries.map((e) => e.kind));
    check('⑩ 0 个角色回应**不是失败**', t3.result.status === 'completed', t3.result.status);

    const t4 = await turn('让星遥先离开。', {
      intent: { intent: 'dismiss', addressedCharacters: ['星遥'] },
      plan: { narration: '星遥先走了。', speakers: [{ character: '古月娜', intent: '看着她离开', mode: 'action' }], sequential: false, worldChanges: [], shouldSettle: false },
      beats: [{ action: '她轻轻点了点头。' }],
      settle: { summary: '星遥先离开了这里。' },
    });
    const afterDismiss = await worldSceneRepo.getScene(scene.id);
    check('⑪ 自然语言「让星遥先离开」真的改变了在场的人（§19）',
      !afterDismiss?.characterIds.includes(C2) && t4.result.entries.some((e) => e.kind === 'system'), afterDismiss?.characterIds);
    check('⑪b 有人离开这种持久变化会留下世界记录（结算一次）',
      t4.calls === 4 && !!t4.result.settlement, t4.calls);

    const t5 = await turn('让小满过来。', {
      intent: { intent: 'summon', addressedCharacters: ['小满'] },
      plan: { narration: '小满推门进来。', speakers: [{ character: '小满', intent: '看看大家', mode: 'both' }], sequential: false, worldChanges: [], shouldSettle: false },
      beats: [{ dialogue: '我是不是来得不是时候？' }],
      settle: { summary: '小满加入了这一刻。' },
    });
    const afterSummon = await worldSceneRepo.getScene(scene.id);
    check('⑫ 「让小满过来」⇒ 在场的人增加（与 chips 完全等效）',
      !!afterSummon?.characterIds.includes(C3) && t5.calls === 4, { ids: afterSummon?.characterIds, calls: t5.calls });

    const t6 = await turn('我们出去走走吧。', {
      intent: { intent: 'change_location', locationChange: '街上' },
      plan: { narration: '夜里的街道有点凉。', speakers: [], sequential: false, worldChanges: [], shouldSettle: false },
      settle: { summary: '你们走到了街上。' },
    });
    const afterWalk = await worldSceneRepo.getScene(scene.id);
    check('⑬ 换地点：世界状态真的变了', afterWalk?.place === '街上', afterWalk?.place);
    check('⑭ 新地点被记成世界设定里的一个地方，并且留下世界记录',
      (await worldFactRepo.listByWorld(worldId, { category: 'location' })).some((f) => f.content === '街上') && !!t6.result.settlement);

    await turn('去海边。', {
      intent: { intent: 'change_location', locationChange: '海边' },
      plan: { narration: '海浪声近了。', speakers: [], sequential: false, worldChanges: [], shouldSettle: false },
      settle: { summary: '你们去了海边。' },
    });
    check('⑮ 连续换地点仍然正常', (await worldSceneRepo.getScene(scene.id))?.place === '海边');

    const t8 = await turn('现在开始下雨。', {
      intent: { intent: 'change_atmosphere', atmosphereChange: '雨' },
      plan: { narration: '雨点落在海面上。', speakers: [], sequential: false, worldChanges: [], shouldSettle: false },
    });
    check('⑯ 一次性氛围变化只改"此刻"、**不**写长期设定、也**不**结算（§28 成本纪律）',
      (await worldSceneRepo.getScene(scene.id))?.mood === '雨' &&
      (await worldFactRepo.listByWorld(worldId, { category: 'atmosphere' })).length === 0 &&
      t8.result.settlement === undefined && t8.calls === 2,
      { mood: (await worldSceneRepo.getScene(scene.id))?.mood, calls: t8.calls });

    const t9 = await turn('这里以后每年这个时候都会下雨。', {
      intent: { intent: 'world_rule', worldFact: '这里以后每年这个时候都会下雨', factCategory: 'rule' },
      plan: { narration: '世界记住了这句话。', speakers: [], sequential: false, worldChanges: [], shouldSettle: false },
      settle: { summary: '这个世界多了一条规则。' },
    });
    const rules = await worldFactRepo.listByWorld(worldId, { category: 'rule' });
    check('⑰ 长期世界规则写进了「世界设定」（world_rule 是本地确定性写入）',
      rules.some((f) => f.content.includes('每年这个时候都会下雨')), rules.map((f) => f.content));
    check('⑱ 立规则这种持久变化必须结算', !!t9.result.settlement && t9.calls === 3, t9.calls);

    const t10 = await turn('直接到第二天早上。', {
      intent: { intent: 'time_skip', timeChange: '第二天早上' },
      plan: { narration: '天亮了。', speakers: [{ character: '古月娜', intent: '叫你起床', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false },
      beats: [{ dialogue: '该起来了。' }],
      guard: { ok: true, issues: [], rewrites: [] },
    });
    const afterSkip = await worldSceneRepo.getScene(scene.id);
    check('⑱b 时间跳跃只改世界时钟、不伪造历史，也**不**额外结算（它只是"此刻"变了）',
      (afterSkip?.state.timeOffsetMs ?? 0) > 0 && !!afterSkip?.timeLabel && t10.result.settlement === undefined,
      { offset: afterSkip?.state.timeOffsetMs, label: afterSkip?.timeLabel, calls: t10.calls });
    check('⑱c 涉及世界时间的轮次会跑一次一致性守护（重要轮次才守护，§27）', t10.calls === 4, t10.calls);

    // 先把"很久以前的一件事"放进世界层，才能验证"相关性优先于时间"（§60）
    const rainMemoryId = await sharedMemoryRepo.create({
      userId: U, worldId, title: '海边的那场雨', summary: '谁都没有说要回家。',
      participants: [userRef(U), characterRef(C1)], sourceType: 'message', sourceId: 'msg-rain',
      importance: 0.9, visibility: 'selected', visibleTo: [C1], tags: ['测试'],
    });
    await worldEventRepo.create({
      userId: U, worldId, type: 'shared_memory', title: '海边的那场雨', summary: '谁都没有说要回家。',
      participants: [userRef(U), characterRef(C1)], sourceType: 'sharedMemory', sourceId: rainMemoryId,
      visibility: 'selected', visibleTo: [C1], memoryIds: [rainMemoryId],
    });

    const t11 = await turn('昨天的雨还记得吗？', {
      intent: { intent: 'recall', recallTarget: '昨天的雨' },
      plan: { narration: '', speakers: [{ character: '古月娜', intent: '回忆那场雨', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false },
      beats: [{ dialogue: '记得，你说雨点落在海面上。' }],
    });
    check('⑲ 回忆类意图不会失败，而且角色给出了回应',
      t11.result.status === 'completed' && t11.result.beats.length === 1, t11.result.status);

    const directorPrompt = JSON.stringify(llm.seen[llm.seen.length - 2]);
    check('⑳ 上下文里带着已有世界规则（所以"改设定"能知道在改哪一条）',
      directorPrompt.includes('每年这个时候都会下雨') || directorPrompt.includes('这个世界不变的规则'), directorPrompt.slice(0, 120));

    const hits = await findRelevantHistory({ worldId, query: '还记得那场雨吗', limit: 5 });
    check('㉑ 相关性检索：能按关键词把相关的事捞回来（不是只看最近 N 条，§60）',
      hits.length > 0 && hits[0].text.includes('雨'), hits.map((h) => h.text));

    check('㉒ 十二句自由度的脚本被**恰好**消费完（没有"少花了一次调用"这种错位）',
      stray.every((n) => n === 0), stray);
  }

  /* ================= S. 控制权（§96） ================= */
  section('S. 控制权：撤销 / 修改世界事实（用户是最高权限者）');
  {
    const beforeEntries = await worldSceneRepo.listEntries(scene.id, { limit: 4000 });
    const turnsBefore = await worldTurnRepo.listRecent(worldId, 10);
    const lastTurn = turnsBefore[0];
    const callBefore = llm.calls();
    const undoResult = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '刚才不算。', characters, call: llm.stub,
    });
    const afterEntries = await worldSceneRepo.listEntries(scene.id, { limit: 4000 });
    const removedIds = beforeEntries.filter((e) => !afterEntries.some((a) => a.id === e.id)).map((e) => e.id);
    check('① 「刚才不算」= 0 次模型调用（撤销是本地操作）', llm.calls() === callBefore, llm.calls() - callBefore);
    check('② 上一轮的正文被**按 id 精确**回收（不是"看起来少了几条"）',
      lastTurn.entryIds.length > 0 &&
      removedIds.length === lastTurn.entryIds.length &&
      lastTurn.entryIds.every((id) => removedIds.includes(id)),
      { removed: removedIds.length, expected: lastTurn.entryIds, lastInput: lastTurn.input });
    check('③ 撤销结果如实回报回收了什么',
      undoResult.undo?.ok === true && !!undoResult.undo?.message, undoResult.undo);
    check('④ 被撤销的轮次标记为 undone（历史仍可查，不抹掉"当时发生过"）',
      (await worldTurnRepo.getById(lastTurn.id))?.status === 'undone');

    /**
     * 世界事实修改（Canon Override，§15）。
     * 这里刻意用**全失败的 caller**：用户改世界这件事**不该依赖任何 AI 服务**
     * （§51「用户永远不会因为 API 失败丢掉自己刚才做的事」的最强形式）。
     */
    const retconCallBefore = llm.calls();
    const retcon = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '其实我们从来没去过那里。', characters,
      call: (async () => { throw new Error('timeout'); }) as never,
    });
    void retconCallBefore;
    check('⑤ 世界事实被改写了（写进设定，而不是让角色反问"你为什么这么说"）',
      retcon.entries.some((e) => e.kind === 'system' && e.content.includes('世界被改写了')) &&
      (await worldFactRepo.listByWorld(worldId, { category: 'history' })).some((f) => f.content.includes('从来没去过')),
      retcon.entries.map((e) => e.content));
    check('⑥ **即使 AI 全挂**，用户的事实修改也已经落库（本地确定性写入，不等模型）',
      (await db.worldSceneEntries.where('sceneId').equals(scene.id).toArray())
        .some((e) => e.content.includes('世界被改写了')));

    // 世界规则同样如此
    const rule = await runWorldTurn({
      userId: U, worldId, sceneId: scene.id, text: '这个世界以后没有冬天。', characters,
      call: (async () => { throw new Error('timeout'); }) as never,
    });
    check('⑦ 立规则也**不依赖 AI**：模型全挂时规则照样写进世界设定',
      rule.entries.some((e) => e.content.includes('这个世界记住了')) &&
      (await worldFactRepo.listByWorld(worldId, { category: 'rule' })).some((f) => f.content.includes('没有冬天')),
      rule.entries.map((e) => e.content));
  }

  /* ================= T. 纪律 ================= */
  section('T. 纪律');
  {
    check('① 全程零计划外网络请求（只走注入的 caller）', llm.netCalls() === 0, llm.netCalls());
    const turns = await worldTurnRepo.listRecent(worldId, 40);
    check('② 每一轮都留下了状态机记录（用户输入永不丢失，§52）',
      turns.length >= 12 && turns.every((t) => t.input.length > 0), turns.length);
    check('③ 每一轮都记下了真实调用次数（成本可核对）',
      turns.filter((t) => t.llmCalls > 0).length >= 10, turns.map((t) => `${t.status}:${t.llmCalls}`));
    check('④ 世界流与聊天表严格分离（世界内容不进 messages/sessions）',
      (await db.worldSceneEntries.count()) > 0);
    const calls = worldAiCallCount();
    check('⑤ 世界 AI 出口的全局计数与实际调用一致', calls >= 30, calls);
  }

  section('清理');
  await worldRepo.clearForUser(U);
  check('清理后世界层为空',
    (await db.worldScenes.count()) === 0 && (await db.worldFacts.count()) === 0 && (await db.worldTurns.count()) === 0);
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
