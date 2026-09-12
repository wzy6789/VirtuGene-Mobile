/**
 * VirtuGene 5.0.0 Phase 2b-3 验收（L1：让角色说得出来）
 *
 * 目标：证明"共同记忆真的进了角色说话时的上下文"，而且**只进该进的那几条**。
 *
 * 做法：
 *  - 真实浏览器 + 真实 IndexedDB + **真实 ChatWindow**：在输入框里打字、按回车，
 *    只把 LLM 边界（`webApi.chat.send`）打桩并**捕获真实的 systemPrompt**，
 *    因此可以逐字断言"角色到底看到了什么"，同时不联网。
 *  - 知识闸门 / 可见性闸门 / 预算截断 都在真实函数上验证。
 *
 * 覆盖：
 *  P. 纯函数：buildContextTrace（含"被截断就不记录"）、buildSharedMemoryContext
 *  A. 三道闸门：可见性 + 认知（full 且可提起）+ 只挑相关几条（真实 DB）
 *  B. 端到端：真实发送 → systemPrompt 里真的有"你们一起经历过的事"，且不含不该有的
 *  C. 溯源：assistant 消息上记录 sharedMemoryIds，并能用「记忆依据」面板如实展示
 *  D. 成本：一次发送只调 1 次 LLM，召回全程 0 次网络请求
 *  E. 4.x 未被替换：同一轮里长期记忆/未完成事项区块照常注入
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { memoryRepo } from '../../src/db/memory-repo';
import { continuityRepo } from '../../src/db/continuity-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { worldRepo } from '../../src/db/world-repo';
import { collectMessageAsSharedMemory } from '../../src/lib/world/world-writer';
import { selectRecallableSharedMemories } from '../../src/lib/world/recall';
import { buildContextTrace, hasTraceContent } from '../../src/lib/chat-trace';
import { buildSharedMemoryContext } from '../../src/lib/chat-context';
import { compileChatContext } from '../../src/lib/chat-context-compiler';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { webApi } from '../../src/lib/web-api';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { ChatWindow } from '../../src/components/chat/ChatWindow';
import { MemoryBasisModal } from '../../src/components/chat/MemoryBasisModal';
import type { Character, Message, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-2b3';
const C1 = 'c-2b3-star';
const C2 = 'c-2b3-moon';
const SESSION = 's-2b3';
/** 2b-2 真实收藏路径产生的共同记忆（"角色确实知道"的那条） */
const COLLECTED_TEXT = '那天凌晨三点，你说就算没人用也要把它写完，后来我们关灯看天亮。';
const PRIVATE_TITLE = '只有我自己知道的一段话';
const NO_KNOWLEDGE_TITLE = '全世界都知道、但这个角色并不知情的事';
const USER_FACT = '用户喜欢在深夜写代码';

const lines: string[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- 联网打点 ---------- */
let netCalls = 0;
const fetchStacks: string[] = [];
const realFetch = window.fetch.bind(window);
window.fetch = ((...args: Parameters<typeof fetch>) => {
  netCalls += 1;
  fetchStacks.push(`${String(args[0])} ← ${(new Error('fetch').stack ?? '').split('\n').slice(1, 4).join(' | ')}`);
  return Promise.reject(new Error(`harness: 不该联网 -> ${String(args[0])}`));
}) as typeof fetch;

/* ---------- LLM 打桩：捕获真实 systemPrompt ---------- */
let llmCalls = 0;
let capturedPrompt = '';
/** 每次回复都**明显不同**：否则 4.x 的"重复自己"自检会触发静默重试，多算一次调用 */
const STUB_REPLIES = [
  '那晚的风我到现在都还记得，你当时冻得直跺脚。',
  '哦，你说的是我们改代码那次吧，天亮得特别快。',
  '怎么可能忘，你敲键盘的声音我都能想起来。',
  '行，那就今晚，你说了算。',
];
const originalSend = webApi.chat.send.bind(webApi.chat);
(webApi.chat as unknown as { send: typeof webApi.chat.send }).send = (async (params: { systemPrompt: string }) => {
  llmCalls += 1;
  capturedPrompt = params.systemPrompt;
  return {
    content: STUB_REPLIES[(llmCalls - 1) % STUB_REPLIES.length],
    usage: { inputTokens: 1200, outputTokens: 30 },
    modelId: 'stub-model',
  };
}) as typeof webApi.chat.send;

/* ---------- 渲染 ---------- */
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
    id, name, avatar: '🌙', systemPrompt: '你是星遥，说话克制、直接。', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
    // 预置合法声线：否则进入聊天时 4.x 会调一次 AI 去判定声线（真实网络请求），
    // 那是既有行为、与本阶段无关，但会污染"零联网"的测量
    voice: { ...DEFAULT_VOICE },
  };
}

/** 在真实 ChatWindow 里把一句话发出去（原生 setter + input 事件 + 回车） */
async function sendFromUI(host: HTMLElement, text: string): Promise<boolean> {
  const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!textarea) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) return false;
  setter.call(textarea, text);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(60);
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(1500);
  return true;
}

/** 造一条"手动可控"的共同记忆 + 世界事件（用于闸门的边界用例） */
async function seedMemory(cfg: {
  sourceId: string;
  title: string;
  visibility: 'private' | 'selected' | 'world';
  visibleTo?: string[];
  participants?: string[];
  importance?: number;
  createdAt?: number;
  knowledge?: { characterId: string; level: 'hint' | 'partial' | 'full'; canMention: boolean }[];
}): Promise<{ memoryId: string; eventId: string }> {
  const worldId = (await worldRepo.ensureDefaultWorld(U)).id;
  const participants = cfg.participants ?? [userRef(U), characterRef(C1)];
  const memoryId = await sharedMemoryRepo.create({
    userId: U, worldId, title: cfg.title, summary: '',
    participants, sourceType: 'test', sourceId: cfg.sourceId,
    visibility: cfg.visibility, ...(cfg.visibleTo ? { visibleTo: cfg.visibleTo } : {}),
    importance: cfg.importance ?? 0.5, ...(cfg.createdAt ? { createdAt: cfg.createdAt } : {}),
  });
  const eventId = await worldEventRepo.create({
    userId: U, worldId, type: 'shared_memory', title: cfg.title, participants,
    sourceType: 'test', sourceId: cfg.sourceId, visibility: cfg.visibility,
    ...(cfg.visibleTo ? { visibleTo: cfg.visibleTo } : {}),
    importance: cfg.importance ?? 0.5, resolved: true, memoryIds: [memoryId],
    ...(cfg.createdAt ? { timestamp: cfg.createdAt } : {}),
  });
  for (const k of cfg.knowledge ?? []) {
    await knowledgeRepo.upsert({
      userId: U, worldId, characterId: k.characterId, eventId: eventId,
      knowledgeLevel: k.level, canMention: k.canMention,
    });
  }
  return { memoryId, eventId };
}

async function run() {
  /* ---------------- P. 纯函数 ---------------- */
  section('P. 纯函数：溯源契约 + 共同记忆文案');
  {
    const members = [{ id: 'sm-1' }, { id: 'sm-2' }];
    const bigSection = (key: string, len: number, priority: number) => ({ key, text: 'x'.repeat(len), priority });
    // 注意：compileChatContext 的预算是 max(6000, budget)，所以必须显式给一个小预算才能触发截断
    const BUDGET = 6000;

    // 完整注入 ⇒ 记录
    const full = compileChatContext('IDENT', [bigSection('shared-memory', 3000, 100)], BUDGET);
    const traceFull = buildContextTrace({ compiled: full, sharedMemories: members, now: 1 });
    check('① 区块完整注入 ⇒ 记录 sharedMemoryIds', traceFull.sharedMemoryIds?.join('|') === 'sm-1|sm-2' && traceFull.at === 1, traceFull);

    // 被预算截断 ⇒ 不记录（宁可少报，也不谎报"已参考"）
    const partial = compileChatContext('IDENT', [bigSection('other', 5000, 100), bigSection('shared-memory', 3000, 90)], BUDGET);
    check('② 构造出的确是被截断的区块', partial.partial.includes('shared-memory') && !partial.included.includes('shared-memory'), { included: partial.included, partial: partial.partial, omitted: partial.omitted });
    const tracePartial = buildContextTrace({ compiled: partial, sharedMemories: members });
    check('③ 被截断 ⇒ **不**记录 sharedMemoryIds（不谎报）', tracePartial.sharedMemoryIds === undefined, tracePartial);

    // 完全没进 prompt ⇒ 不记录
    const omitted = compileChatContext('IDENT', [bigSection('other', 5800, 100), bigSection('other2', 3000, 95), bigSection('shared-memory', 500, 50)], BUDGET);
    check('④ 构造出的确是被丢弃的区块', omitted.omitted.includes('shared-memory') && !omitted.partial.includes('shared-memory'), { included: omitted.included, partial: omitted.partial, omitted: omitted.omitted });
    check('⑤ 被丢弃 ⇒ 不记录', buildContextTrace({ compiled: omitted, sharedMemories: members }).sharedMemoryIds === undefined);

    // 4.x 三个来源的规则保持不变
    const plain = compileChatContext('IDENT', [bigSection('memory', 100, 80), bigSection('continuity', 100, 70), bigSection('shared-events', 100, 60), bigSection('recall', 100, 50)], BUDGET);
    const trace4x = buildContextTrace({
      compiled: plain,
      memories: [{ id: 'm1' }], recalledMemoryId: 'm2',
      continuityThreads: [{ id: 't1' }], sharedEvents: [{ id: 'e1' }],
    });
    check('⑥ 4.x 三个来源照旧记录（且记忆与主动回忆合并去重）',
      trace4x.memoryIds?.join('|') === 'm1|m2' && trace4x.continuityThreadIds?.join('|') === 't1' && trace4x.sharedEventIds?.join('|') === 'e1',
      trace4x);
    check('⑦ hasTraceContent：全空 ⇒ false（不往消息上挂空对象）', hasTraceContent(buildContextTrace({ compiled: { prompt: '', included: [], partial: [], omitted: [] } })) === false);
    check('⑦ hasTraceContent：只有共同记忆 ⇒ true', hasTraceContent(traceFull) === true);

    check('⑧ 没有共同记忆时区块文本为空（不产生空区块）', buildSharedMemoryContext([]) === '');
    const text = buildSharedMemoryContext([
      { id: 'sm-1', title: '天台上那个晚上', summary: '你们聊到很晚。' },
      { id: 'sm-2', title: '一起改过的代码', summary: '' },
    ] as never);
    check('⑨ 区块含真实标题与正文', text.includes('天台上那个晚上') && text.includes('你们聊到很晚。') && text.includes('一起改过的代码'), text.slice(0, 200));
    check('⑩ 区块不含任何内部字段/数值', !/visibility|visibleTo|importance|0\.\d|selected|worldId/.test(text), text);
    check('⑪ 区块明确要求"不要编造、不要当成别的角色的经历"',
      text.includes('不要编造') && text.includes('别的角色'), text.slice(-120));
    check('⑫ 最多只写 3 条', (buildSharedMemoryContext([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }] as never).match(/^- /gm) ?? []).length === 3);
  }

  /* ---------------- 准备数据 ---------------- */
  await Dexie.delete(DB);
  await db.open();
  await db.users.put({ id: U, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: Date.now() });
  await characterRepo.create(makeCharacter(C1, '星遥'));
  await characterRepo.create(makeCharacter(C2, '月见'));
  const session: Session = {
    id: SESSION, characterId: C1, userId: U, title: '新对话',
    createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0,
  };
  await sessionRepo.create(session);
  const collectedMsg: Message = {
    id: 'm-2b3-collected', sessionId: SESSION, role: 'assistant', content: COLLECTED_TEXT,
    createdAt: Date.now() - 60_000, isProactive: false,
  };
  await messageRepo.create(collectedMsg);
  useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');

  // ① 走 2b-2 的**真实收藏路径**：这条记忆角色确实知道（认知 full + 可提起）
  const collected = await collectMessageAsSharedMemory({ userId: U, characterId: C1, message: collectedMsg });
  // ② 边界数据：private（即使误造了认知也不该泄漏）
  const privateMem = await seedMemory({
    sourceId: 'p-private', title: PRIVATE_TITLE, visibility: 'private',
    knowledge: [{ characterId: C1, level: 'full', canMention: true }],
  });
  // ③ 边界数据：world 可见但角色**没有认知**（§62：被允许知道 ≠ 已经知道）
  const unknownMem = await seedMemory({ sourceId: 'p-unknown', title: NO_KNOWLEDGE_TITLE, visibility: 'world' });
  // ④ 4.x 数据：一条"关于用户的事实" + 一件还没做完的事（用来证明没有被替换）
  await memoryRepo.create({
    id: 'mem-2b3', characterId: C1, userId: U, content: USER_FACT, type: 'auto',
    createdAt: Date.now() - 86_400_000, confidence: 1, updatedAt: Date.now(),
  });
  await continuityRepo.create({
    characterId: C1, userId: U, kind: 'promise', title: '答应陪她去看海', origin: 'user',
  });

  /* ---------------- A. 真实发送：角色到底看到了什么 ---------------- */
  section('A. 端到端：真实发送一次，检查真实的 systemPrompt');
  useChatStore.setState({
    characters: [makeCharacter(C1, '星遥'), makeCharacter(C2, '月见')],
    selectedCharacterId: C1,
    currentSessionId: SESSION,
    messages: [],
    hasMoreMessages: false,
  } as never);
  const chatHost = mount(createElement(ChatWindow), 900);
  await sleep(900);
  const llmBeforeSend = llmCalls;
  const netBeforeSend = netCalls;
  const sent = await sendFromUI(chatHost, '你还记得我们那天晚上聊到几点吗');
  check('① 消息真的发出去了（走的真实 ChatWindow 输入管线）', sent && llmCalls - llmBeforeSend === 1, { sent, delta: llmCalls - llmBeforeSend });
  check('①b 这一次发送没有产生任何网络请求（LLM 边界被打桩）', netCalls - netBeforeSend === 0, netCalls - netBeforeSend);
  check('② systemPrompt 里出现了「你和用户一起经历过的事」区块', capturedPrompt.includes('[你和用户一起经历过的事]'), capturedPrompt.slice(0, 300));
  check('③ 区块里就是那条真实收藏的共同记忆（标题取自原话）',
    capturedPrompt.includes('那天凌晨三点'), capturedPrompt.slice(capturedPrompt.indexOf('[你和用户一起经历过的事]'), capturedPrompt.indexOf('[你和用户一起经历过的事]') + 240));
  check('④ 提示里要求"不要每次提、不要编造"（不是硬塞给角色复述）',
    capturedPrompt.includes('不要每次都提') && capturedPrompt.includes('不要编造细节'));
  check('⑤ 私密记忆没有进 prompt（即使存在认知行）', !capturedPrompt.includes(PRIVATE_TITLE), PRIVATE_TITLE);
  check('⑥ 角色没有认知的 world 记忆没有进 prompt', !capturedPrompt.includes(NO_KNOWLEDGE_TITLE), NO_KNOWLEDGE_TITLE);
  check('⑦ 4.x 长期记忆区块仍在（是扩展不是替换）', capturedPrompt.includes(USER_FACT), capturedPrompt.slice(0, 400));
  check('⑧ 4.x 未完成事项区块仍在', capturedPrompt.includes('答应陪她去看海'));
  check('⑨ 候选里只有"该知道且知道"的那条',
    (await selectRecallableSharedMemories({ worldId: world.id, characterId: C1 })).map((r) => r.memory.id).join('|') === collected.memoryId);

  /* ---------------- B. 溯源 ---------------- */
  section('B. 溯源：这条回复"参考了哪些共同记忆"必须是真的');
  const assistant = (await messageRepo.getPage(SESSION, { limit: 50 }))
    .filter((m) => m.role === 'assistant' && m.id !== collectedMsg.id)
    .pop();
  check('① assistant 消息已落库', !!assistant, assistant?.content);
  check('② 记下了 sharedMemoryIds（就是被注入的那条）',
    assistant?.contextTrace?.sharedMemoryIds?.join('|') === collected.memoryId, assistant?.contextTrace);
  check('③ 同时如实保留了 4.x 的溯源字段', (assistant?.contextTrace?.memoryIds?.length ?? 0) > 0 && (assistant?.contextTrace?.continuityThreadIds?.length ?? 0) > 0, assistant?.contextTrace);
  unmount();
  const modalHost = mount(
    createElement(MemoryBasisModal, {
      open: true, onClose: () => undefined, trace: assistant!.contextTrace, characterName: '星遥',
    }),
    600,
  );
  await sleep(500);
  const modalText = document.body.innerText;
  check('④「记忆依据」面板出现「你们一起经历过的事」区块', modalText.includes('你们一起经历过的事'), modalText.slice(0, 300));
  check('⑤ 面板里能读到那条共同记忆的真实内容', modalText.includes('那天凌晨三点'), modalText.slice(0, 400));
  unmount();
  modalHost.remove();

  /* ---------------- C. 三道闸门（真实 DB） ---------------- */
  section('C. 闸门：可见性 + 认知（full 且可提起）+ 只挑相关几条');
  {
    const recallIds = async (characterId = C1, limit?: number) =>
      (await selectRecallableSharedMemories({ worldId: world.id, characterId, ...(limit ? { limit } : {}) }))
        .map((r) => r.memory.id).sort().join('|');

    const partial = await seedMemory({
      sourceId: 'p-partial', title: '只知道一半的事', visibility: 'selected', visibleTo: [C1],
      knowledge: [{ characterId: C1, level: 'partial', canMention: true }],
    });
    const noMention = await seedMemory({
      sourceId: 'p-nomention', title: '知道但不能主动说的事', visibility: 'selected', visibleTo: [C1],
      knowledge: [{ characterId: C1, level: 'full', canMention: false }],
    });
    const toC2 = await seedMemory({
      sourceId: 'p-toc2', title: '只属于月见的记忆', visibility: 'selected', visibleTo: [C2],
      participants: [userRef(U), characterRef(C2)],
      knowledge: [{ characterId: C2, level: 'full', canMention: true }],
    });

    const forC1 = await recallIds();
    check('① 只召回"可见 + 知情(full) + 可提起"的那条', forC1 === collected.memoryId, forC1);
    check('② 只知道一部分（partial）⇒ 不召回', !forC1.includes(partial.memoryId));
    check('③ 知道但不能主动说（canMention=false）⇒ 不召回', !forC1.includes(noMention.memoryId));
    check('④ 只给另一个角色的记忆 ⇒ 不召回', !forC1.includes(toC2.memoryId));
    check('⑤ private + 误造认知 ⇒ 仍然不召回（可见性优先）', !forC1.includes(privateMem.memoryId));
    check('⑥ world 可见但没有认知 ⇒ 不召回（§62）', !forC1.includes(unknownMem.memoryId));
    check('⑦ 换成月见的视角，只召回属于 TA 的那条', (await recallIds(C2)) === toC2.memoryId, await recallIds(C2));

    // 排序与条数上限：重要度高的优先（同样参与度、同样新鲜度）
    const now = Date.now();
    const high = await seedMemory({
      sourceId: 'p-high', title: '最重要的一段经历', visibility: 'selected', visibleTo: [C1],
      importance: 1, createdAt: now - 1000, knowledge: [{ characterId: C1, level: 'full', canMention: true }],
    });
    const low = await seedMemory({
      sourceId: 'p-low', title: '比较普通的一段经历', visibility: 'selected', visibleTo: [C1],
      importance: 0.2, createdAt: now, knowledge: [{ characterId: C1, level: 'full', canMention: true }],
    });
    const ordered = await selectRecallableSharedMemories({ worldId: world.id, characterId: C1, limit: 3 });
    check('⑧ 重要度高的排在前面（即使另一条更新）', ordered[0]?.memory.id === high.memoryId && ordered.map((r) => r.memory.id).includes(low.memoryId), ordered.map((r) => r.memory.title));
    check('⑨ limit 生效（只要 1 条就只给 1 条）', (await selectRecallableSharedMemories({ worldId: world.id, characterId: C1, limit: 1 })).length === 1);
    check('⑩ 每条召回都带得上可溯源的世界事件 id',
      (await selectRecallableSharedMemories({ worldId: world.id, characterId: C1 })).every((r) => r.eventIds.length > 0));

    // 新召回的记忆会真的进入下一轮 prompt（不是只改了排序）
    const host2 = mount(createElement(ChatWindow), 900);
    await sleep(900);
    capturedPrompt = '';
    const llmBefore = llmCalls;
    await sendFromUI(host2, '最近还好吗');
    check('⑪ 下一轮 prompt 里出现了新的共同记忆', capturedPrompt.includes('最重要的一段经历'), capturedPrompt.slice(capturedPrompt.indexOf('[你和用户一起经历过的事]'), capturedPrompt.indexOf('[你和用户一起经历过的事]') + 200));
    check('⑫ 仍然没有私密/不知情的内容', !capturedPrompt.includes(PRIVATE_TITLE) && !capturedPrompt.includes(NO_KNOWLEDGE_TITLE));
    check('⑬ 这次发送同样只调用 1 次 LLM', llmCalls - llmBefore === 1, llmCalls - llmBefore);
    unmount();
  }

  /* ---------------- D. 成本 ---------------- */
  section('D. 成本：召回本身不联网、不多调 AI');
  {
    const before = netCalls;
    await selectRecallableSharedMemories({ worldId: world.id, characterId: C1, limit: 3 });
    check('① 一次召回 = 0 次网络请求（纯本地读三张表）', netCalls === before, netCalls - before);
    check('② 两次真实发送 = 2 次 LLM 调用（召回没有带来任何额外调用）', llmCalls === 2, llmCalls);
    check('③ 全程零网络请求（fetch 一次都没成功发出）', netCalls === 0, fetchStacks.slice(0, 2));
  }

  /* ---------------- 清理 ---------------- */
  section('诊断（不计入验收，用于如实说明环境噪声）');
  lines.push(`fetch 调用：${netCalls} 次${fetchStacks.length ? `\n  ${fetchStacks.join('\n  ')}` : ''}`);

  section('清理');
  unmount();
  (webApi.chat as unknown as { send: typeof webApi.chat.send }).send = originalSend;
  window.fetch = realFetch;
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await worldEventRepo.countByWorld(world.id)) === 0 && (await db.sharedMemories.count()) === 0);
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
