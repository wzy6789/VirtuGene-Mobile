/**
 * VirtuGene 5.2.0 星域统一播放器验收 F：
 * 结束结算幂等 / 「保存这一刻」forceSettle / 失败轮正文回收与重试去重 /
 * 一致性守护不错位 / 旧世界兼容读取。
 *
 * 全部走真实 Dexie 数据库 + 注入式假 LLM（零网络）。
 * 假 LLM 按请求特征路由（maxTokens / temperature），与调用顺序解耦——
 * 本地规则层是否拦截意图不会改变后续剧本。
 */
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { worldTurnRepo } from '../../src/db/world-turn-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { ensureCanvasScene, loadCanvas, loadEarlier } from '../../src/lib/world/world-canvas';
import { buildWorldContext } from '../../src/lib/world/world-context';
import { runWorldTurn, retryWorldTurn } from '../../src/lib/world/world-turn';
import { finishSceneAndSettle } from '../../src/lib/world/scene-runtime';
import { installFakeLlm, createReporter, seedWorld, sleep, fakeCharacter } from './world-harness';
import type { Character } from '../../src/db/index';

const U = 'u-worldF';
const C1 = 'cF-moon';
const C2 = 'cF-star';

const rep = createReporter();
const { check, section } = rep;
const llm = installFakeLlm();
const realFetch = llm.realFetch;

type Role = 'intent' | 'director' | 'narrator' | 'actor' | 'actorFallback' | 'guard' | 'settle';
type RoleResponse = string | (() => never) | Array<string | (() => never) | undefined>;
type Script = Partial<Record<Role, RoleResponse>>;

/** 按请求特征识别管线角色（与调用顺序无关），从剧本中取响应；同角色多次调用按序取，缺失即报错 */
function routerStub(script: Script, seen?: Role[]) {
  return (async (params: unknown) => {
    const p = params as { maxTokens?: number; temperature?: number };
    let role: Role;
    if (p.maxTokens === 400) role = 'intent';
    else if (p.maxTokens === 300) role = 'narrator';
    else if (p.maxTokens === 1200) role = 'settle';
    else if (p.maxTokens === 800) role = 'actorFallback';
    else if (p.maxTokens === 500) role = 'actor';
    else if (p.temperature === 0.1) role = 'guard';
    else role = 'director';
    seen?.push(role);
    let response = script[role];
    if (Array.isArray(response)) response = response.find((item) => item !== undefined);
    if (typeof response === 'function') throw response();
    if (response === undefined) throw new Error(`worldF 剧本缺少 ${role} 的响应`);
    if (Array.isArray(script[role])) {
      const list = script[role] as Array<string | (() => never) | undefined>;
      const used = list.indexOf(response);
      if (used >= 0) list[used] = undefined; // 消费掉，下一个同角色调用取下一份
    }
    return { content: response, truncated: false, usage: { inputTokens: 1, outputTokens: 1 }, modelId: 'router' };
  }) as never;
}

const talkIntent = JSON.stringify({ intent: 'talk', addressedCharacters: ['古月娜'] });

async function run() {
  await seedWorld({ userId: U, characters: [{ id: C1, name: '古月娜' }, { id: C2, name: '星遥' }] });
  const chars: Character[] = [fakeCharacter(C1, '古月娜', U), fakeCharacter(C2, '星遥', U)];
  const world = await worldRepo.ensureDefaultWorld(U);

  /* ================= A. 结束世界结算幂等 ================= */
  section('A. 结束这个世界：重复点击只结算一次');
  const sceneA = await ensureCanvasScene({ userId: U, worldId: world.id, characters: chars });
  await worldSceneRepo.appendEntry(sceneA.id, { kind: 'user_input', content: '第一晚的同行。' });
  await worldSceneRepo.appendEntry(sceneA.id, { kind: 'dialogue', content: '我在。', speakerId: C1 });
  {
    const settleScene = JSON.stringify({
      summary: '便利店的一晚告一段落',
      memory: { title: '雨夜同行', summary: '' },
      relationshipChanges: [],
      unresolved: [{ who: '古月娜', kind: 'promise', title: '下次一起去看海' }],
    });
    llm.queue.push(settleScene);
    const first = await finishSceneAndSettle({ userId: U, sceneId: sceneA.id, apiKey: 'sk-fake', callLlm: llm.stub });
    check('① 第一次结束：结算成功', !first.error && !!first.worldEventId, first.error);
    const sceneEvents = () => worldEventRepo.listBySourceType(world.id, 'scene', 50, U);
    const sceneMemories = async () => (await sharedMemoryRepo.listByWorld(world.id, 100, U)).filter((m) => m.sourceType === 'scene');
    const eventsAfterFirst = await sceneEvents();
    const memoriesAfterFirst = await sceneMemories();
    check('② 世界事件 / 共同记忆 / 未完成事件各落一份', eventsAfterFirst.length === 1 && memoriesAfterFirst.length === 1 && first.unresolvedThreads === 1,
      { events: eventsAfterFirst.length, memories: memoriesAfterFirst.length, threads: first.unresolvedThreads });
    check('③ 场景已标为 finished', (await worldSceneRepo.getScene(sceneA.id))?.status === 'finished');

    llm.reset();
    const second = await finishSceneAndSettle({ userId: U, sceneId: sceneA.id, apiKey: 'sk-fake', callLlm: llm.stub });
    check('④ 第二次结束：被拒绝且**没有**多花调用', !!second.error && llm.calls() === 0, { error: second.error, calls: llm.calls() });
    const eventsAfterSecond = await sceneEvents();
    const memoriesAfterSecond = await sceneMemories();
    check('⑤ 重复结束没有重复写世界层', eventsAfterSecond.length === 1 && memoriesAfterSecond.length === 1,
      { events: eventsAfterSecond.length, memories: memoriesAfterSecond.length });

    const turnOnFinished = await runWorldTurn({
      userId: U, worldId: world.id, sceneId: sceneA.id, text: '结束后的世界还能发言吗', characters: chars, call: llm.stub,
    });
    check('⑥ 已结束的世界拒绝新一轮（只读，0 次调用）', turnOnFinished.status === 'failed' && turnOnFinished.turnId === '' && llm.calls() === 0, turnOnFinished.status);
  }

  /* ================= B. 「保存这一刻」= 强制结算，不等于结束 ================= */
  section('B. forceSettle：保存这一刻写入世界层，世界继续');
  {
    const sceneB = await ensureCanvasScene({ userId: U, worldId: world.id, characters: chars });
    const result = await runWorldTurn({
      userId: U, worldId: world.id, sceneId: sceneB.id, text: '把刚刚这一刻记下来。', characters: chars,
      call: routerStub({
        intent: talkIntent,
        director: JSON.stringify({ narration: '夜色沉下来。', speakers: [], sequential: false, worldChanges: [], shouldSettle: false }),
        settle: JSON.stringify({
          summary: '值得记住的一刻',
          worldEvents: [{ type: 'interaction', title: '被记住的一刻', participants: ['用户', '古月娜'], importance: 0.6 }],
        }),
      }),
      forceSettle: true,
    });
    check('① 这一轮完成（可见内容 + 后台结算）', result.status === 'completed', { status: result.status, error: result.error });
    const turnEvents = await worldEventRepo.listBySourceType(world.id, 'turn', 50, U);
    check('② 世界层写入了这一回合的来源事件（sourceType=turn）', turnEvents.length === 1, turnEvents.length);
    const turnRow = await worldTurnRepo.getById(result.turnId);
    check('③ 强制结算意图随轮次落库（重试路径可还原）', turnRow?.forceSettle === true, turnRow?.forceSettle);
    check('④ 世界仍在进行（没有 finished）', (await worldSceneRepo.getScene(sceneB.id))?.status !== 'finished');
  }

  /* ================= C. 失败轮正文回收 + 重试去重 ================= */
  section('C. 重试：失败轮已写的正文被精确回收，不重复、不丢用户原话');
  {
    const sceneCId = await worldSceneRepo.createScene({
      userId: U, worldId: world.id, title: '重试隔离', place: '测试地点', timeLabel: '夜晚', mood: '安静', characterIds: [C1, C2],
      participants: [C1, C2].map((characterId) => ({
        characterId, entryMemoryMode: 'memory' as const, goals: [], knowsEventIds: [], secrets: [],
      })),
    });
    const sceneC = (await worldSceneRepo.getScene(sceneCId))!;
    // 超过旧的 400 条窗口后，仍要读到最新发言，重试也必须找到本轮条目。
    await db.worldSceneEntries.bulkPut(Array.from({ length: 430 }, (_, index) => ({
      id: `worldF-long-${index}`, sceneId: sceneC.id, index,
      kind: 'narration' as const, act: 1, witnessedBy: [C1, C2], content: `旧记录 ${index}`, createdAt: Date.now() - 430 + index,
    })));
    const recent = await worldSceneRepo.listRecentEntries(sceneC.id, 12);
    check('⓪ 长世界取最近 12 条，而不是最早 12 条', recent[0]?.content === '旧记录 418' && recent.at(-1)?.content === '旧记录 429');
    const view = await loadCanvas(sceneC.id, { userId: U });
    check('⓪ 长世界首屏显示最新内容且总数准确', view?.total === 430 && view.entries.at(-1)?.content === '旧记录 429');
    const earlier = await loadEarlier(sceneC.id, view!.entries[0].index, 12, U);
    check('⓪ 向前翻页紧邻当前首条', earlier.length === 12 && earlier.at(-1)?.index === view!.entries[0].index - 1);
    const context = await buildWorldContext({ userId: U, worldId: world.id, scene: sceneC, characters: chars });
    check('⓪ 模型上下文里最近一条确实是最新记录', context.recentEntries[0]?.content === '旧记录 429');
    const text = '重试去重测试：这句话只说一次。';
    // 正文全部落库之后、写回导演状态时注入一次数据库失败：
    // 这一轮如实失败（用户已看到内容），但旁白与对白都已在库里——
    // 重试必须精确回收它们，不能在世界流里留下两份。
    const originalPatch = worldSceneRepo.patchSceneState;
    let boom = true;
    (worldSceneRepo as unknown as { patchSceneState: unknown }).patchSceneState = async (id: string, patch: unknown) => {
      if (boom) { boom = false; throw new Error('db io error'); }
      return (originalPatch as (a: string, b: unknown) => Promise<unknown>).call(worldSceneRepo, id, patch);
    };
    const failed = await runWorldTurn({
      userId: U, worldId: world.id, sceneId: sceneC.id, text, characters: chars,
      call: routerStub({
        intent: talkIntent,
        director: JSON.stringify({ narration: '夜色沉下来。', speakers: [{ character: '古月娜', intent: '回应', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }),
        actor: JSON.stringify({ dialogue: '失败轮的对白。' }),
        // 前一场戏留下了只对古月娜可说的记忆；多人场景先走隐私边界检查。
        guard: JSON.stringify({ ok: true, issues: [], rewrites: [] }),
      }),
    });
    (worldSceneRepo as unknown as { patchSceneState: unknown }).patchSceneState = originalPatch;
    const failedTurnRow = await worldTurnRepo.getById(failed.turnId);
    rep.note(`C 失败轮 entryIds=${failedTurnRow?.entryIds.length}，其中 narration=${failedTurnRow?.entryIds.length}`);
    check('① 这一轮如实失败（正文已落库后出错）', failed.status === 'failed', failed.status);
    const afterFail = await worldSceneRepo.listRecentEntries(sceneC.id, 400);
    check('② 失败时旁白与对白都在库里、用户原话也在',
      afterFail.some((e) => e.content === '夜色沉下来。') && afterFail.some((e) => e.content === '失败轮的对白。') && afterFail.filter((e) => e.content === text).length === 1);

    const retried = await retryWorldTurn({
      turnId: failed.turnId, characters: chars,
      call: routerStub({
        director: JSON.stringify({ narration: '这一次世界回应了。', speakers: [{ character: '古月娜', intent: '回应', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }),
        actor: JSON.stringify({ dialogue: '我在。' }),
        guard: JSON.stringify({ ok: true, issues: [], rewrites: [] }),
      }),
    });
    const afterRetry = await worldSceneRepo.listRecentEntries(sceneC.id, 400);
    const countOf = (needle: string) => afterRetry.filter((e) => e.content === needle).length;
    check('③ 重试成功', retried?.status === 'completed', retried?.status);
    check('④ 失败轮的旁白与对白被回收（新旧不并存）',
      countOf('夜色沉下来。') === 0 && countOf('失败轮的对白。') === 0 && countOf('这一次世界回应了。') === 1,
      { staleNarration: countOf('夜色沉下来。'), staleDialogue: countOf('失败轮的对白。'), fresh: countOf('这一次世界回应了。') });
    check('⑤ 用户原话仍只有一条', countOf(text) === 1, countOf(text));
    check('⑥ 重试正文落库', countOf('我在。') === 1, countOf('我在。'));
  }

  /* ================= D. 一致性守护：改写不错位到别人的条目 ================= */
  section('D. 守护改写按角色归属，静默角色不会被当成别人的行');
  {
    const sceneDId = await worldSceneRepo.createScene({
      userId: U, worldId: world.id, title: '守护隔离', place: '测试地点', timeLabel: '夜晚', mood: '安静', characterIds: [C1, C2],
    });
    const sceneD = (await worldSceneRepo.getScene(sceneDId))!;
    const rolesSeen: Role[] = [];
    const result = await runWorldTurn({
      userId: U, worldId: world.id, sceneId: sceneD.id, text: '今晚下雨了，你们怎么看？', characters: chars,
      call: routerStub({
        intent: JSON.stringify({ intent: 'talk', addressedCharacters: ['古月娜', '星遥'], raw: '今晚下雨了，你们怎么看？' }),
        director: JSON.stringify({
          narration: '雨落下来。',
          speakers: [{ character: '古月娜', intent: 'a', mode: 'dialogue' }, { character: '星遥', intent: 'b', mode: 'dialogue' }],
          sequential: true, worldChanges: [], shouldSettle: true,
        }),
        // 古月娜沉默：主模型空回应 + 兜底也无效 ⇒ 她的 beat 被跳过；星遥正常回应
        actor: [JSON.stringify({}), JSON.stringify({ dialogue: '星遥的话' })],
        actorFallback: ['{"broken'],
        guard: JSON.stringify({ ok: true, issues: ['复述'], rewrites: [{ character: '古月娜', dialogue: '被错改的话' }] }),
        settle: JSON.stringify({
          summary: '设定了夜晚的雨',
          worldEvents: [{ type: 'interaction', title: '定下世界的雨', participants: ['用户', '古月娜', '星遥'], importance: 0.5 }],
        }),
      }, rolesSeen),
    });
    rep.note(`D 命中角色: ${rolesSeen.join('>')}`);
    const entries = await worldSceneRepo.listEntries(sceneD.id, { limit: 4000 });
    rep.note(`D 正文: ${entries.map((e) => `${e.kind}:${e.speakerId ?? ''}:${e.content.slice(0, 12)}`).join(' | ')}`);
    check('① 这一轮完成', result.status === 'completed', { status: result.status, error: result.error });
    check('② 星遥的条目原样保留（没被别人的守护改写覆盖）',
      entries.some((e) => e.kind === 'dialogue' && e.speakerId === C2 && e.content === '星遥的话'));
    check('③ 错位的改写没有写进任何条目', !entries.some((e) => e.content === '被错改的话'));
  }

  /* ================= E. 旧世界兼容读取 ================= */
  section('E. 旧版本世界：缺默认状态可继续，正文原样');
  {
    const sceneEId = await worldSceneRepo.createScene({
      userId: U, worldId: world.id, title: '旧世界', place: '旧地点', timeLabel: '傍晚', mood: '安静', characterIds: [C1],
    });
    // 模拟 4.x 旧数据：SceneState 没有 conversation / visual；正文没有 meta
    const legacyScene = await worldSceneRepo.getScene(sceneEId);
    await db.worldScenes.put({
      ...legacyScene!,
      state: {
        currentAct: 1, currentTension: 0, activeSecrets: [], activeConflicts: [],
        pendingConsequences: [], resolvedEventIds: [], newEventIds: [], participants: [],
      },
    });
    await db.worldSceneEntries.put({
      id: 'legacy-e1', sceneId: sceneEId, index: 0, kind: 'dialogue', act: 1, speakerId: C1,
      content: '旧世界的最后一句话。', createdAt: Date.now() - 86_400_000,
    });
    // 再塞一条 index 损坏的行：appendEntry 不能把 NaN 传下去
    await db.worldSceneEntries.put({
      id: 'legacy-broken', sceneId: sceneEId, index: Number.NaN as unknown as number, kind: 'narration', act: 1,
      content: '损坏索引行。', createdAt: Date.now() - 86_400_000,
    });

    const result = await runWorldTurn({
      userId: U, worldId: world.id, sceneId: sceneEId, text: '我回来了。', characters: chars,
      call: routerStub({
        intent: talkIntent,
        director: JSON.stringify({ narration: '新的时刻开始了。', speakers: [{ character: '古月娜', intent: '回应', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }),
        actor: JSON.stringify({ dialogue: '你回来了。' }),
      }),
    });
    check('① 旧世界可以直接继续（新管线补默认状态后跑通）', result.status === 'completed', { status: result.status, error: result.error });
    const patched = await worldSceneRepo.getScene(sceneEId);
    check('② 缺失的导演/沉浸状态被补齐', !!patched?.state.conversation && !!patched?.state.visual);
    const entries = await worldSceneRepo.listEntries(sceneEId, { limit: 4000 });
    check('③ 旧正文原样保留（内容一条不多一条不少）',
      entries.some((e) => e.id === 'legacy-e1' && e.content === '旧世界的最后一句话。' && e.meta === undefined));
    check('④ 新条目的 index 没有受损坏行影响（有限且递增）',
      entries.filter((e) => e.id !== 'legacy-broken').every((e) => Number.isFinite(e.index)) &&
      entries.some((e) => e.content === '你回来了。' && Number.isFinite(e.index) && e.index >= 2),
      entries.map((e) => ({ id: e.id, index: e.index })));
  }

  /* ================= 纪律与清理 ================= */
  section('纪律');
  check('① 全程零计划外网络请求', llm.netCalls() === 0, llm.netCalls());

  section('清理');
  await worldRepo.clearForUser(U);
  await db.characters.where('createdBy').equals(U).delete();
  await db.users.delete(U);
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
