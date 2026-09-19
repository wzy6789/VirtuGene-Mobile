/**
 * VirtuGene 5.0.0 Phase 3 验收：世界舞台（Scene Director）
 *
 * 规格（§56/§57）与本次验收的对应关系：
 *  - **一次调用出多条**：每一轮只允许 1 次 LLM 调用，但产出多条正文（逐轮计数）
 *  - **打开 / 离开舞台 0 次调用**；只有用户动作与"结束结算"各 1 次
 *  - **正文只进 worldSceneEntries**（不碰 sessions / messages）
 *  - **结构化状态**进 WorldScene.state（不是塞进 Prompt）
 *  - **LLM 负责演，VirtuGene 负责记**：结算建议必须过校验层；非法内容一律丢弃并如实记录
 *  - 后果真正落库：stage 世界事件 / 共同记忆 / 关系变化（带原因）/ 未完成事件（带 sourceSceneId）/ 参与者认知
 *  - 模型输出不可用时自动换备用模型；所有模型都失败才只保留用户真实动作
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { relationshipRepo } from '../../src/db/relationship-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { continuityRepo } from '../../src/db/continuity-repo';
import { parseSceneOutput } from '../../src/lib/ai/scene-director';
import { validateSettlement } from '../../src/lib/world/scene-consequences';
import {
  finishSceneAndSettle,
  loadScene,
  pauseScene,
  runSceneTurn,
  startScene,
} from '../../src/lib/world/scene-runtime';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { MobileStagePage } from '../../src/components/world/MobileStagePage';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { MobileRelationsPage } from '../../src/components/world/MobileRelationsPage';
import type { Character, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-p3';
const C1 = 'c-p3-star';
const C2 = 'c-p3-moon';
const C3 = 'c-p3-outsider';
const SESSION = 's-p3';

const lines: string[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- 零网络 ---------- */
let netCalls = 0;
const realFetch = window.fetch.bind(window);
window.fetch = ((...args: Parameters<typeof fetch>) => {
  netCalls += 1;
  return Promise.reject(new Error('harness: 不该联网'));
}) as typeof fetch;

/* ---------- LLM 打桩（记录调用次数与收到的 messages） ---------- */
type LlmResult = { content: string; truncated?: boolean; usage?: { inputTokens: number; outputTokens: number }; modelId?: string };
let llmCalls = 0;
const llmQueue: (string | { error: string })[] = [];
const seenMessages: unknown[][] = [];
const stubLlm = (async (params: { messages: unknown[] }) => {
  llmCalls += 1;
  seenMessages.push(params.messages);
  const next = llmQueue.shift();
  if (next === undefined) return { content: '' } as LlmResult;
  if (typeof next === 'object' && 'error' in next) throw new Error(next.error);
  return { content: next, truncated: false, usage: { inputTokens: 100, outputTokens: 50 }, modelId: 'stub' } as LlmResult;
}) as never;

let activeRoot: Root | null = null;
let activeHost: HTMLDivElement | null = null;
function mount(el: ReactElement, height = 900): HTMLDivElement {
  unmount();
  const host = document.createElement('div');
  host.style.height = `${height}px`;
  document.body.appendChild(host);
  activeHost = host;
  activeRoot = createRoot(host);
  activeRoot.render(el);
  return host;
}
function unmount() {
  if (activeRoot) { activeRoot.unmount(); activeRoot = null; }
  if (activeHost) { activeHost.remove(); activeHost = null; }
}
function makeCharacter(id: string, name: string): Character {
  return {
    id, name, avatar: '🌙', systemPrompt: `${name}：说话克制，直接。`, tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
    voice: { ...DEFAULT_VOICE },
  };
}

const turnJson = (entries: unknown[]) => JSON.stringify({ entries, tension: 0.4, newConflict: '两个人都不肯先低头' });

async function run() {
  /* ---------------- P. 纯函数 ---------------- */
  section('P. 纯函数：导演输出解析 + 结算校验');
  {
    const members = [
      { characterId: C1, name: '星遥', persona: 'x' },
      { characterId: C2, name: '月见', persona: 'y' },
    ];
    const parsed = parseSceneOutput(
      JSON.stringify({
        entries: [
          { kind: 'narration', content: '雨还在下。' },
          { kind: 'dialogue', speaker: '星遥', content: '你来了。' },
          { kind: 'dialogue', speaker: C2, content: '我一直在。' },
          { kind: 'dialogue', speaker: '路人甲', content: '……' },
        ],
        tension: 1.7,
        newConflict: '  谁也不肯先开口  ',
      }),
      members,
      4,
    );
    check('① 旁白/对白都能解析（名字与 id 都认）', parsed.entries.length === 3, parsed.entries);
    check('② 未知发言人被**丢弃**（不随便安在别人头上）并如实记录',
      parsed.unknownSpeakers.join('|') === '路人甲' && !parsed.entries.some((e) => e.content === '……'), parsed.unknownSpeakers);
    check('③ 张力被夹到 0~1', parsed.tension === 1, parsed.tension);
    check('④ 建议文本去空白', parsed.newConflict === '谁也不肯先开口', parsed.newConflict);
    check('⑤ 模型给了非 JSON ⇒ 不猜、返回空', parseSceneOutput('今晚月色真美', members).entries.length === 0);
    check('⑥ 条数受上限约束',
      parseSceneOutput(JSON.stringify({ entries: Array.from({ length: 9 }, (_, i) => ({ kind: 'narration', content: `第${i}句` })) }), members, 3).entries.length === 3);

    const ctx = { userId: U, characterIds: [C1, C2], resolveCharacter: (name: string) => (name === '星遥' ? C1 : name === '月见' ? C2 : undefined) };
    const { proposal, dropped } = validateSettlement(
      JSON.stringify({
        summary: ' 他们在雨里把话说开了 ',
        memory: { title: '雨夜那次长谈', summary: '你们终于没有再绕开。' },
        relationshipChanges: [
          { a: '用户', b: '星遥', facets: { trust: 3, conflict: -2 }, reason: '把话说开了' },
          { a: '用户', b: '星遥', facets: { affinity: 5 }, reason: '试图改好感度' },
          { a: '用户', b: '星遥', facets: { trust: 2 } },
          { a: '用户', b: '场外的人', facets: { trust: 9 }, reason: '拉一个不在场的人' },
          { a: '用户', b: '月见', facets: { trust: 99 }, reason: '数值离谱' },
        ],
        unresolved: [
          { who: '月见', kind: 'promise', title: '答应下次带伞' },
          { who: '场外的人', kind: 'plan', title: '不该存在的事' },
        ],
        knowledge: [{ characterId: C2, level: 'full' }],
      }),
      ctx,
    );
    check('⑦ summary 去空白保留', proposal.summary === '他们在雨里把话说开了', proposal.summary);
    check('⑧ 共同记忆被采纳', proposal.memory?.title === '雨夜那次长谈', proposal.memory);
    check('⑨ 合法关系变化被采纳（两端映射成 SubjectRef）',
      proposal.relationshipChanges.length === 2 &&
      proposal.relationshipChanges[0].a === userRef(U) && proposal.relationshipChanges[0].b === characterRef(C1),
      proposal.relationshipChanges);
    check('⑩ affinity 被丢弃（R7 之后世界层没有这个分面）', dropped.some((d) => d.includes('affinity')), dropped);
    check('⑪ 缺原因的关系变化被丢弃', dropped.some((d) => d.includes('缺原因')), dropped);
    check('⑫ 涉及场外的人被丢弃', dropped.some((d) => d.includes('场外')), dropped);
    check('⑬ 离谱数值被夹到单次上限（±10）', proposal.relationshipChanges[1].facets.trust === 10, proposal.relationshipChanges[1].facets);
    check('⑭ 未完成事件只接受在场角色', proposal.unresolved.length === 1 && proposal.unresolved[0].characterId === C2, proposal.unresolved);
    check('⑮ 模型不得指定认知归属（忽略并记录）', dropped.some((d) => d.includes('认知')), dropped);
    check('⑯ 无法解析的结算 ⇒ 空建议 + 如实记录',
      validateSettlement('不是 JSON', ctx).proposal.relationshipChanges.length === 0 && validateSettlement('不是 JSON', ctx).dropped.length > 0);
  }

  /* ---------------- 准备 ---------------- */
  await Dexie.delete(DB);
  await db.open();
  await db.users.put({ id: U, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: Date.now() });
  await characterRepo.create(makeCharacter(C1, '星遥'));
  await characterRepo.create(makeCharacter(C2, '月见'));
  await characterRepo.create(makeCharacter(C3, '旁观者'));
  const session: Session = {
    id: SESSION, characterId: C1, userId: U, title: '新对话',
    createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0,
  };
  await sessionRepo.create(session);
  await messageRepo.create({ id: 'm-1', sessionId: SESSION, role: 'user', content: '你好', createdAt: Date.now(), isProactive: false });
  useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');
  const messagesBefore = await db.messages.count();
  const sessionsBefore = await db.sessions.count();

  /* ---------------- A. 开场不花钱 ---------------- */
  section('A. 开始一场戏：0 次调用，正文不落聊天');
  let sceneId = '';
  {
    const before = llmCalls;
    sceneId = await startScene({
      userId: U, worldId: world.id,
      title: '雨夜的便利店', place: '凌晨的便利店', timeLabel: '凌晨两点', mood: '潮湿安静',
      characterIds: [C1, C2], sceneGoal: '把上次没说完的话说完',
    });
    check('① 开场不产生任何 LLM 调用', llmCalls - before === 0, llmCalls - before);
    const scene = await worldSceneRepo.getScene(sceneId);
    check('② 场景已建立且状态是 active', scene?.status === 'active', scene?.status);
    check('③ 结构化状态就位（不是塞进 Prompt）',
      scene?.state.currentAct === 1 && scene.state.currentTension === 0 && Array.isArray(scene.state.activeConflicts), scene?.state);
    check('④ 参与者正确', scene?.characterIds.join('|') === [C1, C2].join('|'), scene?.characterIds);
    check('⑤ 只写了一条 system 提示，没有正文', (await worldSceneRepo.countEntries(sceneId)) === 1);
    check('⑥ 没有污染聊天：messages / sessions 数量不变',
      (await db.messages.count()) === messagesBefore && (await db.sessions.count()) === sessionsBefore);
  }

  /* ---------------- B. 一轮 = 1 次调用 ---------------- */
  section('B. 推演一轮：恰好 1 次调用 → 多条正文 + 结构化状态');
  {
    llmQueue.push(turnJson([
      { kind: 'narration', content: '雨点敲在玻璃上，店里只有你们两个客人。' },
      { kind: 'dialogue', speaker: '星遥', content: '你来得比我早。' },
      { kind: 'dialogue', speaker: '月见', content: '我怕你不来。' },
      { kind: 'dialogue', speaker: '路人甲', content: '（不该出现的人）' },
    ]));
    const before = llmCalls;
    const result = await runSceneTurn({ userId: U, sceneId, apiKey: 'sk-fake', callLlm: stubLlm });
    check('① 一轮只调用 1 次 LLM（不是每角色一次）', llmCalls - before === 1, llmCalls - before);
    check('② 返回条目数 = 1 旁白 + 2 对白（未知发言人被丢弃）', result.entries.filter((e) => e.kind !== 'system').length === 3, result.entries.map((e) => e.kind));
    const entries = await worldSceneRepo.listEntries(sceneId, { limit: 50 });
    const kinds = entries.map((e) => e.kind).join(',');
    check('③ 正文进 worldSceneEntries 且顺序正确（system, narration, dialogue, dialogue）',
      kinds === 'system,narration,dialogue,dialogue', kinds);
    check('④ index 递增有序', entries.every((e, i) => e.index === i), entries.map((e) => e.index));
    check('⑤ 说话人映射正确',
      entries.filter((e) => e.kind === 'dialogue').map((e) => e.speakerId).join('|') === [C1, C2].join('|'),
      entries.filter((e) => e.kind === 'dialogue').map((e) => e.speakerId));
    check('⑥ 结构化状态被更新（张力 + 新冲突）',
      (await worldSceneRepo.getScene(sceneId))?.state.currentTension === 0.4 &&
      ((await worldSceneRepo.getScene(sceneId))?.state.activeConflicts ?? []).includes('两个人都不肯先低头'),
      (await worldSceneRepo.getScene(sceneId))?.state);
    check('⑦ 依然没有污染聊天', (await db.messages.count()) === messagesBefore);

    // 第二轮：用户动作 + 历史带上
    llmQueue.push(turnJson([
      { kind: 'narration', content: '她把伞往你那边挪了挪。' },
      { kind: 'dialogue', speaker: '星遥', content: '上次那句，我想接着说。' },
    ]));
    const before2 = llmCalls;
    await runSceneTurn({ userId: U, sceneId, apiKey: 'sk-fake', userAction: '我把伞收起来，坐到她对面', callLlm: stubLlm });
    check('⑧ 用户动作也是一轮 1 次调用', llmCalls - before2 === 1, llmCalls - before2);
    const entries2 = await worldSceneRepo.listEntries(sceneId, { limit: 50 });
    check('⑨ 用户动作作为 user_input 落库', entries2.some((e) => e.kind === 'user_input' && e.content.includes('坐到她对面')));
    const lastMessages = JSON.stringify(seenMessages[seenMessages.length - 1]);
    check('⑩ 这一轮的提示里带上了前文（角色不会失忆）',
      lastMessages.includes('雨点敲在玻璃上') && lastMessages.includes('你来得比我早'), lastMessages.slice(0, 200));
  }

  /* ---------------- C. 结束并结算 = 1 次调用 ---------------- */
  section('C. 结束这场戏：1 次结算调用，后果真正落库');
  {
    llmQueue.push(JSON.stringify({
      summary: '两个人在雨里把那句没说完的话说完了。',
      memory: { title: '雨夜便利店的长谈', summary: '你们终于没有再绕开那件事。' },
      relationshipChanges: [
        { a: '用户', b: '星遥', facets: { trust: 4, conflict: -1 }, reason: '把上次没说完的话说完了' },
        { a: '用户', b: '月见', facets: { affinity: 8 }, reason: '试图改好感度' },
        { a: '用户', b: '旁观者', facets: { trust: 5 }, reason: '把场外的人拉进来' },
      ],
      unresolved: [
        { who: '月见', kind: 'promise', title: '答应下次带两把伞' },
        { who: '旁观者', kind: 'plan', title: '不该出现的事' },
      ],
      knowledge: [{ characterId: C1, level: 'full' }],
    }));
    const before = llmCalls;
    const settled = await finishSceneAndSettle({ userId: U, sceneId, apiKey: 'sk-fake', callLlm: stubLlm });
    check('① 结算只调用 1 次 LLM', llmCalls - before === 1, llmCalls - before);
    check('② 结算没有报错', !settled.error, settled.error);

    const event = settled.worldEventId ? await worldEventRepo.getById(settled.worldEventId) : undefined;
    check('③ 写下了 stage 世界事件（真实场景才允许有 stage）', event?.type === 'stage', event?.type);
    check('④ 事件标题/摘要来自这场戏，且参与者 = 用户 + 在场角色',
      event?.title === '雨夜的便利店' && event.summary.includes('说完了') &&
      event.participants.join('|') === [userRef(U), characterRef(C1), characterRef(C2)].join('|'),
      event && { t: event.title, p: event.participants });
    check('⑤ 可见性保守：selected + 只给在场角色',
      event?.visibility === 'selected' && (event.visibleTo ?? []).sort().join('|') === [C1, C2].sort().join('|'), event && { v: event.visibility, to: event.visibleTo });
    check('⑥ 可回溯到场景', event?.sourceType === 'scene' && event?.sourceId === sceneId, event && { t: event.sourceType, id: event.sourceId });

    const memory = settled.memoryId ? await sharedMemoryRepo.getById(settled.memoryId) : undefined;
    check('⑦ 共同记忆写入（sourceType=scene、参与者与可见性正确）',
      memory?.title === '雨夜便利店的长谈' && memory.sourceType === 'scene' &&
      memory.participants.join('|') === [userRef(U), characterRef(C1), characterRef(C2)].join('|'),
      memory && { t: memory.title, s: memory.sourceType });
    check('⑧ 世界事件与共同记忆互相引用', (event?.memoryIds ?? []).includes(settled.memoryId ?? ''), event?.memoryIds);

    const pairKey = [characterRef(C1), userRef(U)].sort().join('|');
    const relEvents = await relationshipRepo.listEvents(world.id, pairKey, 10);
    check('⑨ 关系变化写入且带可读原因',
      relEvents.length === 1 && relEvents[0].reason.includes('说完了'), relEvents.map((e) => e.reason));
    check('⑩ 关系变化只含合法分面（affinity 被挡下）',
      Object.keys(relEvents[0]?.facets ?? {}).join('|') === 'trust|conflict', relEvents[0]?.facets);
    const relState = await relationshipRepo.getStateFor(userRef(U), characterRef(C1), world.id);
    check('⑪ 关系状态被同事务更新（trust 4 / conflict 夹到 0）',
      relState?.trust === 4 && relState?.conflict === 0, relState && { t: relState.trust, c: relState.conflict });
    check('⑫ 世界层里仍然没有好感度字段',
      !!relState && !('affinity' in (relState as object)), relState && Object.keys(relState));

    const threads = await continuityRepo.getOpenByCharacter(C2, U);
    check('⑬ 未完成事件写入并带上 sourceSceneId',
      threads.length === 1 && threads[0].sourceSceneId === sceneId && threads[0].title === '答应下次带两把伞', threads);
    check('⑭ 未完成事件照旧派生 continuity 世界事件（既有 writer 生效）',
      (await worldEventRepo.listByType(world.id, 'continuity', 10)).some((e) => e.title === '答应下次带两把伞'));

    check('⑮ 认知只给在场角色（旁观者一无所知）',
      (await knowledgeRepo.getForCharacterEvent(C1, settled.worldEventId!))?.knowledgeLevel === 'full' &&
      (await knowledgeRepo.getForCharacterEvent(C2, settled.worldEventId!))?.canMention === true &&
      (await knowledgeRepo.getForCharacterEvent(C3, settled.worldEventId!)) === undefined);
    check('⑯ 非法建议被丢弃且如实记录（affinity / 场外的人 / 认知归属）',
      settled.dropped.some((d) => d.includes('affinity')) &&
      settled.dropped.some((d) => d.includes('旁观者')) &&
      settled.dropped.some((d) => d.includes('认知')),
      settled.dropped);

    const scene = await worldSceneRepo.getScene(sceneId);
    check('⑰ 场景标记结束并挂上事件', scene?.status === 'finished' && scene.worldEventId === settled.worldEventId, scene && { s: scene.status });
    check('⑱ 已落地的待结算后果被清空', (scene?.state.pendingConsequences ?? []).length === 0, scene?.state.pendingConsequences);
    check('⑲ 正文末尾留下结束标记', (await worldSceneRepo.listEntries(sceneId, { limit: 60 })).some((e) => e.kind === 'system' && e.content.includes('结束了')));

    // 重复结算：不得再调用、不得重复写
    const before3 = llmCalls;
    const again = await finishSceneAndSettle({ userId: U, sceneId, apiKey: 'sk-fake', callLlm: stubLlm });
    check('⑳ 已结束的场景再次结算 ⇒ 0 次调用 + 如实报错',
      llmCalls - before3 === 0 && !!again.error, { calls: llmCalls - before3, error: again.error });
  }

  /* ---------------- D. 离开舞台不花钱、无后果 ---------------- */
  section('D. 先离开（暂停）：0 次调用、不产生任何后果');
  {
    const id2 = await startScene({
      userId: U, worldId: world.id, title: '屋顶上的黄昏', place: '天台', timeLabel: '黄昏', mood: '安静',
      characterIds: [C1],
    });
    llmQueue.push(turnJson([{ kind: 'narration', content: '风把她的头发吹乱了。' }]));
    await runSceneTurn({ userId: U, sceneId: id2, apiKey: 'sk-fake', callLlm: stubLlm });
    const before = llmCalls;
    await pauseScene(id2);
    check('① 离开不产生 LLM 调用', llmCalls - before === 0, llmCalls - before);
    check('② 状态是 paused（不是 finished）', (await worldSceneRepo.getScene(id2))?.status === 'paused');
    check('③ 没有 stage 世界事件、没有共同记忆',
      (await worldEventRepo.listByType(world.id, 'stage', 20)).length === 1 &&
      (await db.sharedMemories.count()) === 1);
    await worldSceneRepo.deleteScene(id2);
    check('④ 删除场景连同正文一起消失', (await worldSceneRepo.getScene(id2)) === undefined);
  }

  /* ---------------- E. 模型兜底 ---------------- */
  section('E. 首选模型输出不可用时：备用大模型接住，仍不编造');
  {
    const id3 = await startScene({
      userId: U, worldId: world.id, title: '失败的尝试', place: '走廊', timeLabel: '深夜', mood: '冷',
      characterIds: [C1],
    });
    llmQueue.push('今晚月色真美'); // 首选模型两次都不是结构化输出
    llmQueue.push('今晚月色真美');
    llmQueue.push(turnJson([{ kind: 'narration', content: '备用模型把走廊的灯光接了回来。' }]));
    const before = llmCalls;
    const result = await runSceneTurn({ userId: U, sceneId: id3, apiKey: 'sk-fake', userAction: '我敲了敲门', callLlm: stubLlm });
    check('① 首选模型失败后由备用大模型接住', !result.error && result.fallback === true, result);
    check('② 只写入用户动作与备用模型正文，没有本地编造',
      result.entries.some((e) => e.kind === 'user_input') && result.entries.some((e) => e.content.includes('备用模型')),
      result.entries.map((e) => e.kind));
    check('③ 备用模型的结构化状态正常写入',
      (await worldSceneRepo.getScene(id3))?.state.currentTension === 0.4);
    check('④ 首选两次 + 备用一次 = 3 次调用',
      llmCalls - before === 3, llmCalls - before);
    await worldSceneRepo.deleteScene(id3);
  }

  /* ---------------- F. 与既有系统打通 ---------------- */
  section('F. 打通：世界页 / 关系页 / 剧场页');
  {
    // 剧场页渲染（真实组件）——打开页面不消耗调用
    const before = llmCalls;
    useUIStore.getState().setActiveView('stage');
    const stageHost = mount(createElement(MobileStagePage), 900);
    await sleep(900);
    check('① 打开剧场页不产生任何 LLM 调用', llmCalls - before === 0, llmCalls - before);
    check('② 剧场页列出这场戏与状态', stageHost.innerText.includes('世界剧场') && stageHost.innerText.includes('雨夜的便利店') && stageHost.innerText.includes('已经结束'), stageHost.innerText.slice(0, 300));
    // 5.0 最终版 §76：产品正式版不出现"系统施工感"文案（成本说明属于实现细节，
    // 不该出现在用户界面里）；成本纪律本身由 ①（打开 0 次调用）与后续逐轮计数保证。
    check('③ 剧场页不出现施工感/实现细节文案（纪律由①的 0 次调用本身保证）',
      !stageHost.innerText.includes('不消耗任何模型调用'), stageHost.innerText.slice(0, 300));
    unmount();

    // 世界页：舞台事件出现在星图信号中，并标记为已写入世界
    useUIStore.getState().setActiveView('chat');
    useUIStore.getState().setMobileTab('world');
    const worldHost = mount(createElement(MobileWorldPage));
    await sleep(800);
    const worldText = worldHost.innerText;
    check('④ 世界页星图信号出现这场戏', worldText.includes('雨夜的便利店') && worldText.includes('已写入世界'), worldText.slice(0, 500));
    // 5.0 最终版 §77：World Stage 作为**一级入口**退出主 UI（世界空间才是核心交互面），
    // 但"一起演过的戏"仍然可以从「记忆」页回看（能力没有删除）。
    check('⑤ 世界页不再有「世界剧场」一级入口，改由「记忆」进入（§7/§77）',
      !worldText.includes('世界剧场') && !worldText.includes('和他们一起演一场戏') && worldText.includes('记忆'), worldText.slice(0, 400));
    unmount();

    // 关系页：把"为什么"讲出来（场景给的原因）
    const relHost = mount(createElement(MobileRelationsPage));
    await sleep(800);
    const relText = relHost.innerText;
    check('⑥ 关系页把场景造成的变化讲成原因', relText.includes('把上次没说完的话说完了'), relText.slice(0, 500));
    check('⑦ 关系页照旧不暴露任何内部数值', !/好感度|trust|affinity|conflict|\d+\/100/.test(relText));
    unmount();
  }

  /* ---------------- G. 角色被删除 ---------------- */
  section('G. 角色被删除：正文保留，只摘掉参与者');
  {
    await worldRepo.cleanupCharacter(U, C2);
    const scene = await worldSceneRepo.getScene(sceneId);
    check('① 场景正文保留（真的发生过的事不会消失）',
      (await worldSceneRepo.countEntries(sceneId)) > 3 && scene?.characterIds.join('|') === C1, scene?.characterIds);
    const event = (await worldEventRepo.listByType(world.id, 'stage', 10))[0];
    check('② 世界事件保留历史，只摘掉该角色的引用', !event.participants.includes(characterRef(C2)), event.participants);
  }

  /* ---------------- H. 纪律 ---------------- */
  section('H. 纪律');
  {
    check('① 全程零网络请求（LLM 边界全部被打桩）', netCalls === 0, netCalls);
    check('② 调用总数 = 4 次推演 + 1 次结算 + 备用模型接住失败轮次 = 7', llmCalls === 7, llmCalls);
  }

  section('清理');
  unmount();
  window.fetch = realFetch;
  await worldRepo.clearForUser(U);
  check('清理后世界层为空',
    (await db.worldScenes.count()) === 0 && (await worldEventRepo.countByWorld(world.id)) === 0);
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
    void realFetch('/result', { method: 'POST', body: text }).catch(() => undefined);
  });
