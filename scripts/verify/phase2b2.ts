/**
 * VirtuGene 5.0.0 Phase 2b-2 验收：「收藏为共同记忆」
 *
 * 做法：真实浏览器 + 真实 IndexedDB + **真实函数/真实组件**，断言数据与 DOM，不靠肉眼。
 * 关键点：全程**不允许联网**（window.fetch 打点，任何一次调用都算失败），
 * 因此"零新增 AI 调用"是被证明的，而不是被相信的。
 *
 * 覆盖：
 *  P. splitForMemory 纯函数：标题/正文切分、不重复、不丢内容
 *  A. 收藏写入：sharedMemories + shared_memory 世界事件 + 该角色认知（一个动作三处写入）
 *  B. 幂等：同一条消息重复收藏不产生第二行
 *  C. 边界：可见性 selected 只给该角色；认知只给参与者（另一角色仍不知道）
 *  D. 分工：收藏**不写** memories（用户事实）、不改消息、不改生命轨迹
 *  E. 世界页端到端：共同记忆区块出现；同一件事不在「最近发生」重复
 *  F. 长按菜单（真实 MessageBubble）：出现「收藏为共同记忆」/ 已收藏后显示「已是共同记忆」
 *  G. 端到端（真实 ChatWindow）：长按 → 收藏 → 明确反馈 →「去世界看看」真的进世界页
 *  H. 原子性：世界事件写失败 ⇒ 整笔回滚，不留半写
 *  I. 隐私边界：可见性是**过滤条件**而不是评分加分项（审核指出的前置修复，记忆/事件/日记同一份闸门）
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { worldRepo } from '../../src/db/world-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { collectMessageAsSharedMemory, MEMORY_SOURCE_TYPE } from '../../src/lib/world/world-writer';
import { splitForMemory } from '../../src/lib/world/world-picks';
import { derivedWorldEventId, stableId, characterRef, userRef } from '../../src/lib/world/subjects';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import { ChatWindow } from '../../src/components/chat/ChatWindow';
import type { Character, Message, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-2b2';
const C1 = 'c-star';
const C2 = 'c-moon';
const SESSION = 's-2b2';
const MSG_USER = 'm-2b2-user';
const MSG_AI = 'm-2b2-ai';
const AI_TEXT = '记得。那天凌晨三点，你说「就算没人用，我也要把它写完」——后来我们把灯关了，看着窗外的天慢慢亮起来。';
const USER_TEXT = '你还记得我们一起熬夜改那段代码吗';

const lines: string[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- 联网打点：任何一次 fetch 都记为失败（证明零 AI 调用） ---------- */
let netCalls = 0;
let netPatched = false;
const realFetch = window.fetch.bind(window);
function patchNetwork() {
  if (netPatched) return;
  netPatched = true;
  netCalls = 0;
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    netCalls += 1;
    return Promise.reject(new Error(`harness: 不该联网 -> ${String(args[0])}`));
  }) as typeof fetch;
}
function restoreNetwork() {
  if (!netPatched) return;
  netPatched = false;
  window.fetch = realFetch;
}

/* ---------- 渲染工具 ---------- */
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
  // 必须把旧 host 从 DOM 里摘掉：否则旧页面的文案会留在 document.body.innerText 里，断言会互相污染
  if (activeHost) { activeHost.remove(); activeHost = null; }
}

/** 取某个区块的列表正文（标题定位 → 同 section 内其后的第一个 <ul>） */
function blockText(scope: HTMLElement, label: string): string {
  const labelEl = Array.from(scope.querySelectorAll('p')).find((p) => (p.textContent ?? '').trim() === label);
  if (!labelEl) return '';
  const sectionEl: HTMLElement = labelEl.closest('section') ?? scope;
  const list = Array.from(sectionEl.querySelectorAll('ul')).find(
    (ul) => (labelEl.compareDocumentPosition(ul) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  return list ? (list as HTMLElement).innerText : '';
}

/** 打开某条消息气泡的长按菜单（真实 contextmenu 事件） */
function openMenu(bubble: HTMLElement): void {
  bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
}
function menuHostText(): string {
  return document.body.innerText;
}
function clickButtonByText(text: string): boolean {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) return false;
  btn.click();
  return true;
}
function bubbleWithText(rootEl: HTMLElement, text: string): HTMLElement | null {
  const bubbles = Array.from(rootEl.querySelectorAll('.vg-message-bubble')) as HTMLElement[];
  return bubbles.find((b) => (b.innerText ?? '').includes(text)) ?? null;
}

function makeCharacter(id: string, name: string): Character {
  return {
    id, name, avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
  };
}

async function run() {
  /* ---------------- P. 纯函数 ---------------- */
  section('P. splitForMemory（标题/正文切分，纯函数）');
  {
    const short = splitForMemory('今天风很大');
    check('短消息：标题=原文、正文为空', short.title === '今天风很大' && short.summary === '', short);
    const longText = `${'A'.repeat(40)}${'B'.repeat(20)}`;
    const long = splitForMemory(longText);
    check('长消息：标题截断到 40 字并加省略号', long.title === `${'A'.repeat(40)}…`, long.title);
    check('正文接上被截掉的部分（内容不丢、不与标题重复）',
      long.summary === 'B'.repeat(20) && !long.title.includes('B'), long.summary);
    const multi = splitForMemory('第一行标题\n第二行正文\n第三行正文');
    check('多行消息：标题只取第一行、正文为其余内容',
      multi.title === '第一行标题' && multi.summary === '第二行正文\n第三行正文', multi);
    const blank = splitForMemory('   \n\n  ');
    check('空白内容：返回空（由调用方给如实占位，不在这里编造）', blank.title === '' && blank.summary === '', blank);
    const messy = splitForMemory('  前面有空格  \n\n\n\n后面有空行  ');
    check('首尾空白与连续空行被归一化', messy.title === '前面有空格' && messy.summary === '后面有空行', messy);
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
  const userMsg: Message = {
    id: MSG_USER, sessionId: SESSION, role: 'user', content: USER_TEXT, createdAt: Date.now() - 60_000, isProactive: false,
  };
  const aiMsg: Message = {
    id: MSG_AI, sessionId: SESSION, role: 'assistant', content: AI_TEXT, createdAt: Date.now() - 30_000, isProactive: false,
  };
  await messageRepo.create(userMsg);
  await messageRepo.create(aiMsg);
  useAuthStore.setState({ userId: U, username: '智毅', apiKey: '', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  useUIStore.getState().setMobileTab('world');

  const world = await worldRepo.ensureDefaultWorld(U, '智毅');

  /* ---------------- A. 收藏写入 ---------------- */
  section('A. 收藏为共同记忆：一个动作写三处（真实函数 + 真实数据库）');
  patchNetwork();
  const first = await collectMessageAsSharedMemory({ userId: U, characterId: C1, message: aiMsg });
  check('返回 created = true（首次收藏）', first.created === true, first);
  check('记忆 id 是确定性 id（同一条消息只可能有一条）',
    first.memoryId === stableId('smem', U, world.id, MEMORY_SOURCE_TYPE, MSG_AI), first.memoryId);
  check('事件 id 由记忆派生（可互相追溯）',
    first.eventId === derivedWorldEventId(U, world.id, 'sharedMemory', first.memoryId), first.eventId);
  check('整个收藏过程零网络请求（fetch 调用 = 0）', netCalls === 0, netCalls);
  restoreNetwork();

  const mem = await sharedMemoryRepo.getById(first.memoryId);
  const evt = await worldEventRepo.getById(first.eventId);
  check('共同记忆已写入（sharedMemories 第一条生产数据）', !!mem, mem);
  check('标题/正文 = 纯函数的切分结果', !!mem && mem.title === splitForMemory(AI_TEXT).title && mem.summary === splitForMemory(AI_TEXT).summary, mem && { t: mem.title, s: mem.summary });
  check('参与者 = 你 + 该角色', !!mem && mem.participants.join('|') === [userRef(U), characterRef(C1)].join('|'), mem?.participants);
  check('可见性保守：selected + 只给该角色（不是 world）',
    !!mem && mem.visibility === 'selected' && (mem.visibleTo ?? []).join('|') === C1, mem && { v: mem.visibility, to: mem.visibleTo });
  check('可回溯到原始消息（sourceType/sourceId）',
    !!mem && mem.sourceType === MEMORY_SOURCE_TYPE && mem.sourceId === MSG_AI, mem && { t: mem.sourceType, id: mem.sourceId });
  check('世界事件已写入且类型是 shared_memory（不是 stage）', !!evt && evt.type === 'shared_memory', evt?.type);
  check('事件引用这条记忆（memoryIds），不是两套互不相干的数据',
    !!evt && evt.memoryIds.includes(first.memoryId), evt?.memoryIds);
  check('事件参与者与记忆一致', !!evt && evt.participants.join('|') === [userRef(U), characterRef(C1)].join('|'), evt?.participants);
  check('记忆是"已经发生的事"⇒ resolved = true', evt?.resolved === true, evt?.resolved);
  check('重要度按分档（共同记忆 0.7）', evt?.importance === 0.7 && mem?.importance === 0.7, { e: evt?.importance, m: mem?.importance });

  const know = await knowledgeRepo.getForCharacterEvent(C1, first.eventId);
  check('参与的角色获得认知（亲身经历 ⇒ full + 可提起）',
    !!know && know.knowledgeLevel === 'full' && know.canMention === true, know && { l: know.knowledgeLevel, m: know.canMention });
  check('认知行挂在世界与用户下（世界隔离成立）', !!know && know.worldId === world.id && know.userId === U);

  /* ---------------- B. 幂等 ---------------- */
  section('B. 幂等：同一条消息重复收藏');
  const memoryCountBefore = await db.sharedMemories.count();
  const eventCountBefore = await db.worldEvents.count();
  const knowCountBefore = await db.characterKnowledge.count();
  const second = await collectMessageAsSharedMemory({ userId: U, characterId: C1, message: aiMsg });
  check('第二次收藏返回 created = false', second.created === false, second);
  check('返回的还是同一条记忆 id', second.memoryId === first.memoryId && second.eventId === first.eventId, second);
  check('记忆/事件/认知行数都没有增加',
    (await db.sharedMemories.count()) === memoryCountBefore &&
    (await db.worldEvents.count()) === eventCountBefore &&
    (await db.characterKnowledge.count()) === knowCountBefore,
    [await db.sharedMemories.count(), await db.worldEvents.count(), await db.characterKnowledge.count()]);
  check('按来源查询能查到（聊天页据此显示"已收藏"态）',
    (await sharedMemoryRepo.getBySource(U, world.id, MEMORY_SOURCE_TYPE, MSG_AI))?.id === first.memoryId);
  check('listSourceIds 返回已收藏的消息 id', (await sharedMemoryRepo.listSourceIds(U, world.id, MEMORY_SOURCE_TYPE)).join('|') === MSG_AI);

  /* ---------------- C. 边界 ---------------- */
  section('C. 认知边界：发生过 ≠ 所有人都知道');
  check('该角色可以提起这件事', await knowledgeRepo.canMention(C1, first.eventId));
  check('另一个角色不能凭空知道', (await knowledgeRepo.canMention(C2, first.eventId)) === false);
  check('listUnaware 只把"不知情"的角色列出来',
    (await knowledgeRepo.listUnaware([C1, C2], first.eventId)).join('|') === C2);
  check('可见的记忆只给被选中的角色',
    (await sharedMemoryRepo.listVisibleFor(C1, world.id)).length === 1 &&
    (await sharedMemoryRepo.listVisibleFor(C2, world.id)).length === 0);
  check('"共同经历"看参与者，不看可见性（另一角色没有经历过）',
    (await sharedMemoryRepo.listExperiencedWith(C1, world.id)).length === 1 &&
    (await sharedMemoryRepo.listExperiencedWith(C2, world.id)).length === 0);
  check('另一角色没有留下任何认知行',
    (await db.characterKnowledge.where('characterId').equals(C2).count()) === 0);

  /* ---------------- D. 与 4.x 的分工 ---------------- */
  section('D. 收藏 ≠ 「记住」：不写 memories、不改消息、不改生命轨迹');
  check('memories（用户事实）仍为 0 条', (await db.memories.count()) === 0, await db.memories.count());
  check('消息本身没有被改动（仍是 2 条，内容原样）',
    (await db.messages.count()) === 2 && (await messageRepo.getById(MSG_AI))?.content === AI_TEXT);
  const states = await db.characterStates.toArray();
  const lifeEventCount = states.reduce((n, s) => n + (s.lifeEvents?.length ?? 0), 0);
  check('没有新增生命轨迹（收藏不是 4.x 事件）', lifeEventCount === 0, lifeEventCount);
  check('没有新增未完成事件', (await db.continuityThreads.count()) === 0);
  check('没有碰 4.x 的人物事件表', (await db.sharedStoryEvents.count()) === 0);

  /* ---------------- E. 世界页端到端 ---------------- */
  section('E. 世界页端到端：共同记忆真的出现，且不在「最近发生」重复');
  // 再放一条关系变化事件，让「最近发生」确实需要渲染（否则它整块隐藏，断言会变成空断言）
  await worldEventRepo.create({
    userId: U, worldId: world.id, type: 'relationship', title: '关系进入「熟悉」阶段',
    summary: '你们聊得越来越多。', participants: [userRef(U), characterRef(C1)],
    sourceType: 'test', sourceId: 'ev-rel-2b2', importance: 0.7, resolved: true,
    visibility: 'selected', visibleTo: [C1],
  });
  useUIStore.getState().setMobileTab('world');
  const host = mount(createElement(MobileWorldPage));
  await sleep(800);
  const text = host.innerText;
  check('弱化统计显示真实共同记忆条数（1 段）', text.includes('1 段共同记忆'), text.slice(0, 200));
  check('共同记忆区块出现并列出真实内容',
    blockText(host, '共同记忆').includes(splitForMemory(AI_TEXT).title), blockText(host, '共同记忆'));
  check('「最近发生」照常渲染其他真实事件', blockText(host, '最近发生').includes('关系进入「熟悉」阶段'), blockText(host, '最近发生'));
  check('同一段记忆不在「最近发生」里重复出现（同屏只说一次）',
    blockText(host, '最近发生').length > 0 && !blockText(host, '最近发生').includes(splitForMemory(AI_TEXT).title.slice(0, 12)),
    blockText(host, '最近发生'));
  check('事件计数把这条记忆算进去了（2 件事）', /已经记下了 2 件事/.test(text), text.slice(0, 240));
  check('页面不暴露任何内部数值字段', !/trust|affinity|conflict|familiarity/i.test(text), text.slice(0, 300));
  unmount();

  /* ---------------- F. 长按菜单（真实 MessageBubble） ---------------- */
  section('F. 长按菜单：出现「收藏为共同记忆」，已收藏后显示「已是共同记忆」');
  const bubblesHost = mount(
    createElement(MessageBubble, {
      message: userMsg, avatar: '🧬',
      onRemember: () => undefined,
      onCollectMemory: () => undefined,
    }),
    300,
  );
  await sleep(200);
  const userBubble = bubbleWithText(bubblesHost, USER_TEXT);
  check('消息气泡渲染成功', !!userBubble);
  if (userBubble) {
    openMenu(userBubble);
    await sleep(80);
    check('长按菜单出现「收藏为共同记忆」', menuHostText().includes('收藏为共同记忆'), menuHostText().slice(0, 200));
    check('菜单里「记住」与「收藏」是两个不同的动作（互不替代）',
      menuHostText().includes('记住') && menuHostText().includes('收藏为共同记忆'));
    // 关掉菜单（点空白）再换"已收藏"态重渲染
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(50);
  }
  unmount();
  let collectedCalls = 0;
  const bubblesHost2 = mount(
    createElement(MessageBubble, {
      message: userMsg, avatar: '🧬',
      onCollectMemory: () => { collectedCalls += 1; },
      collected: true,
    }),
    300,
  );
  await sleep(200);
  const userBubble2 = bubbleWithText(bubblesHost2, USER_TEXT);
  if (userBubble2) {
    openMenu(userBubble2);
    await sleep(80);
    check('已收藏的消息显示「已是共同记忆」而不是再收藏一次', menuHostText().includes('已是共同记忆'), menuHostText().slice(0, 200));
    check('已收藏态下不再提供「收藏为共同记忆」按钮（不会重复收藏）',
      !menuHostText().includes('收藏为共同记忆'));
    check('已收藏态没有触发任何回调（菜单本身不写数据）', collectedCalls === 0, collectedCalls);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(50);
  }
  unmount();

  /* ---------------- G. 端到端：真实 ChatWindow ---------------- */
  section('G. 端到端（真实 ChatWindow）：长按 → 收藏 → 明确反馈 → 去世界看看');
  useChatStore.setState({
    characters: [makeCharacter(C1, '星遥'), makeCharacter(C2, '月见')],
    selectedCharacterId: C1,
    currentSessionId: SESSION,
    messages: [userMsg],
    hasMoreMessages: false,
  } as never);
  const chatHost = mount(createElement(ChatWindow), 900);
  await sleep(900);
  const chatText = chatHost.innerText;
  check('ChatWindow 渲染出真实消息（虚拟滚动里能看到气泡）', chatText.includes(USER_TEXT), chatText.slice(0, 200));
  const chatBubble = bubbleWithText(chatHost, USER_TEXT);
  check('找到该条消息的气泡', !!chatBubble);
  if (chatBubble) {
    openMenu(chatBubble);
    await sleep(80);
    check('长按聊天里的消息，菜单里有「收藏为共同记忆」', menuHostText().includes('收藏为共同记忆'));
    const memoriesBefore = await db.sharedMemories.count();
    patchNetwork();
    const clicked = clickButtonByText('收藏为共同记忆');
    await sleep(600);
    check('点击后真的走了收藏这条路径', clicked);
    check('收藏过程零网络请求（UI 路径同样不联网）', netCalls === 0, netCalls);
    restoreNetwork();
    check('数据库里多了一条共同记忆', (await db.sharedMemories.count()) === memoriesBefore + 1);
    const collected = await sharedMemoryRepo.getBySource(U, world.id, MEMORY_SOURCE_TYPE, MSG_USER);
    check('收藏的是被长按的那条消息（来源可回溯）', !!collected && collected.sourceId === MSG_USER, collected?.sourceId);
    check('收藏后给出明确反馈（世界层在另一个页面，不能没有反馈）',
      menuHostText().includes('已收藏为共同记忆'), menuHostText().slice(-260));
    const wentToWorld = clickButtonByText('去世界看看');
    await sleep(120);
    check('反馈里的「去世界看看」真的切到世界页', wentToWorld && useUIStore.getState().mobileTab === 'world',
      { clicked: wentToWorld, tab: useUIStore.getState().mobileTab });
    check('同时清掉了"从列表推入聊天"的标记（否则会停在聊天页）',
      useUIStore.getState().chatFromList === false && useUIStore.getState().chatFromCharacters === false);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(50);
  }
  unmount();

  /* ---------------- H. 原子性 ---------------- */
  section('H. 原子性：世界事件写不进去时整笔回滚');
  // 用一条还没收藏过的消息（G 组已经把 MSG_USER 收藏了，否则这里会走"已存在"的早退分支）
  const MSG_USER2 = 'm-2b2-user2';
  const userMsg2: Message = {
    id: MSG_USER2, sessionId: SESSION, role: 'user', content: '那我们下次还去那家店', createdAt: Date.now(), isProactive: false,
  };
  await messageRepo.create(userMsg2);
  const memBefore = await db.sharedMemories.count();
  const knowBefore = await db.characterKnowledge.count();
  const originalCreate = worldEventRepo.create.bind(worldEventRepo);
  (worldEventRepo as unknown as { create: typeof worldEventRepo.create }).create = async () => {
    throw new Error('fault-injection: 世界事件写不进去');
  };
  let threw = false;
  try {
    await collectMessageAsSharedMemory({ userId: U, characterId: C1, message: userMsg2 });
  } catch {
    threw = true;
  }
  check('写入失败会如实抛错（调用方据此提示"没能存下来"，而不是假装成功）', threw);
  check('没有留下半写的共同记忆（事务回滚）', (await db.sharedMemories.count()) === memBefore,
    { before: memBefore, after: await db.sharedMemories.count() });
  check('也没有留下半写的认知', (await db.characterKnowledge.count()) === knowBefore);
  check('失败的那条消息确实没有入库', (await sharedMemoryRepo.getBySource(U, world.id, MEMORY_SOURCE_TYPE, MSG_USER2)) === undefined);
  (worldEventRepo as unknown as { create: typeof worldEventRepo.create }).create = originalCreate;
  const recovered = await collectMessageAsSharedMemory({ userId: U, characterId: C1, message: userMsg2 });
  check('恢复后可以正常收藏（一次失败不影响后续）', recovered.created === true && (await db.sharedMemories.count()) === memBefore + 1);

  /* ---------------- I. 可见性闸门（审核指出的前置修复） ---------------- */
  section('I. 隐私边界：可见性是过滤条件，不是评分加分项');
  {
    // 现有数据：mem1/mem2/mem3 都是 selected + 只给 C1。这里再补四种边界数据。
    const privateMem = await sharedMemoryRepo.create({
      userId: U, worldId: world.id, title: '只有我自己知道的一段话', summary: '',
      participants: [userRef(U), characterRef(C1)], sourceType: 'test', sourceId: 'i-private',
      visibility: 'private', importance: 1,
    });
    // 参与度最高、最新、最重要，但**只给用户自己**——旧实现会因为"相关度打分"把它排到最前面
    const loudPrivate = await sharedMemoryRepo.create({
      userId: U, worldId: world.id, title: '私人但参与度极高的一段话', summary: '',
      participants: [userRef(U), characterRef(C1), characterRef(C2)], sourceType: 'test', sourceId: 'i-private-loud',
      visibility: 'private', importance: 1, createdAt: Date.now(),
    });
    const toC2 = await sharedMemoryRepo.create({
      userId: U, worldId: world.id, title: '只给月见的记忆', summary: '',
      participants: [userRef(U), characterRef(C2)], sourceType: 'test', sourceId: 'i-c2',
      visibility: 'selected', visibleTo: [C2], importance: 0.9,
    });
    const toBoth = await sharedMemoryRepo.create({
      userId: U, worldId: world.id, title: '两个人都知道的记忆', summary: '',
      participants: [userRef(U), characterRef(C1), characterRef(C2)], sourceType: 'test', sourceId: 'i-both',
      visibility: 'selected', visibleTo: [C1, C2], importance: 0.9,
    });

    const forC1 = await sharedMemoryRepo.listRelevant(world.id, [C1], 50);
    const ids1 = forC1.map((m) => m.id);
    check('① 单聊：只返回对该角色可见的记忆', ids1.includes(first.memoryId) && ids1.includes(toBoth) && ids1.includes(toC2) === false,
      forC1.map((m) => m.title));
    check('① private 记忆永远不返回给角色（即使参与度最高、最新、最重要）',
      !ids1.includes(privateMem) && !ids1.includes(loudPrivate), forC1.map((m) => m.title));
    check('① 只给另一个角色的 selected 记忆不返回', !ids1.includes(toC2));

    const forC2 = await sharedMemoryRepo.listRelevant(world.id, [C2], 50);
    const ids2 = forC2.map((m) => m.id);
    check('② 换一个角色：能看到给 TA 的那条，看不到只给别人的那条',
      ids2.includes(toC2) && ids2.includes(toBoth) && !ids2.includes(first.memoryId), forC2.map((m) => m.title));
    check('② 同样不会拿到任何 private 记忆', !ids2.includes(privateMem) && !ids2.includes(loudPrivate));

    const forBoth = await sharedMemoryRepo.listRelevant(world.id, [C1, C2], 50);
    const idsBoth = forBoth.map((m) => m.id);
    check('③ 多人在场：只注入**所有人都被允许知道**的记忆（保守）',
      idsBoth.includes(toBoth) && !idsBoth.includes(first.memoryId) && !idsBoth.includes(toC2), forBoth.map((m) => m.title));

    check('④ 空角色列表 ⇒ 返回空数组（every 对空数组恒真，不能当闸门）',
      (await sharedMemoryRepo.listRelevant(world.id, [])).length === 0);

    check('⑤ 与 listVisibleFor 口径一致：两条入口返回的可见集合相同',
      forC1.map((m) => m.id).sort().join('|') ===
      (await sharedMemoryRepo.listVisibleFor(C1, world.id, 50)).map((m) => m.id).sort().join('|'),
      { relevant: forC1.length, visible: (await sharedMemoryRepo.listVisibleFor(C1, world.id, 50)).length });

    check('⑥ limit 仍然生效（取 1 条）', (await sharedMemoryRepo.listRelevant(world.id, [C1], 1)).length === 1);

    // 兄弟查询走同一份闸门（世界事件 / 日记）
    const privateEvent = await worldEventRepo.create({
      userId: U, worldId: world.id, type: 'reality', title: '只有我自己知道的事',
      participants: [userRef(U)], sourceType: 'test', sourceId: 'i-private-event', visibility: 'private',
    });
    const visibleEvents = await worldEventRepo.listVisibleToCharacter(world.id, C1, 50);
    check('⑦ 世界事件同样过闸门：private 事件不返回给角色',
      visibleEvents.every((e) => e.id !== privateEvent) && visibleEvents.length > 0, visibleEvents.map((e) => e.title));

    const privateDiary = await diaryRepo.create({
      userId: U, date: '2026-09-10', title: '私密日记', content: '这段基因序列只属于我。', mood: 3, tags: [],
    });
    const sharedDiary = await diaryRepo.create({
      userId: U, date: '2026-09-11', title: '愿意告诉星遥的一页', content: '今天想让你知道。', mood: 4, tags: [],
      visibility: 'selected', visibleTo: [C1],
    });
    const visibleDiaries = await diaryRepo.listVisibleFor(C1, U, 50);
    check('⑧ 日记同样过闸门：private 不返回、selected 命中才返回（正面控制）',
      visibleDiaries.every((d) => d.id !== privateDiary) && visibleDiaries.some((d) => d.id === sharedDiary),
      visibleDiaries.map((d) => d.title));
  }

  /* ---------------- 清理 ---------------- */
  section('清理');
  unmount();
  restoreNetwork();
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await worldEventRepo.countByWorld(world.id)) === 0 && (await db.sharedMemories.count()) === 0);
}

run()
  .catch((err) => {
    failures += 1;
    lines.push(`FAIL 抛出异常 :: ${String(err && (err as Error).stack ? (err as Error).stack : err)}`);
  })
  .finally(() => {
    restoreNetwork();
    const text = `${lines.join('\n')}\n\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`;
    const out = document.createElement('pre');
    out.id = 'result';
    out.textContent = text;
    document.body.appendChild(out);
    document.title = failures === 0 ? 'VERIFY-OK' : 'VERIFY-FAIL';
    void realFetch('/result', { method: 'POST', body: text }).catch(() => undefined);
  });
