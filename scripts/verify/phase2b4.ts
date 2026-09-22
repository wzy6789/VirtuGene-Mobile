/**
 * VirtuGene 5.0.0 Phase 2b-4 验收：我的生活三级可见性 + R6 收口
 *
 * 审核明确要求覆盖的六件事（全部在真实 ChatWindow 的 systemPrompt 上断言）：
 *  1. 默认"仅自己可见"
 *  2. "告诉某角色"只授予该角色认知与可提起权限（不写世界事件）
 *  3. "加入共同世界"才写世界事件，并按参与者建立认知
 *  4. 删除授权 / 改回私密后，聊天上下文**立即**不再注入
 *  5. 旧的全局开关（即使残留在历史设置里）不再影响提示词
 *  6. 私密日记绝不进入其他角色的提示词
 *
 * 覆盖：
 *  P. 纯函数：日记区块文案 + 溯源契约（未完整注入不记录）
 *  A. 默认 private：不写事件、不给认知
 *  B. 告诉某角色：只给该角色认知，且**不写世界事件**
 *  C. 加入共同世界：写 reality 事件 + 按参与者认知
 *  D. 真实两次发送：注入 → 撤回 → 立即不注入
 *  E. R6 收口：旧开关形同不存在；私密/授权给别人/授权给当前角色的三种情况
 *  F. 回收站与彻底删除：软删除不进上下文；恢复后可再进；彻底删除收回认知与事件
 *  G. 角色被删除：授权摘掉、认知消失、回到仅自己
 *  H. 世界页：加入共同世界后出现在「最近发生」并标为「你的生活」
 *  I. UI（真实组件）：三级可见性控件与总览的收回入口
 *  J. 成本：每次发送只调 1 次 LLM，全程零网络
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, useState, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { diaryRepo, todayStr } from '../../src/db/diary-repo';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import {
  setDiarySharing,
  listMentionableDiaryIds,
  diaryKnowledgeAnchor,
  derivedDiaryWorldEventId,
  describeSharing,
} from '../../src/lib/world/diary-visibility';
import { buildDiaryContext } from '../../src/lib/chat-context';
import { buildContextTrace } from '../../src/lib/chat-trace';
import { compileChatContext } from '../../src/lib/chat-context-compiler';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { webApi } from '../../src/lib/web-api';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useUIStore } from '../../src/store/ui-store';
import { ChatWindow } from '../../src/components/chat/ChatWindow';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { DiarySharingControl, DiarySharingOverviewModal } from '../../src/components/diary/DiarySharing';
import type { Character, Diary, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-2b4';
const C1 = 'c-2b4-star';
const C2 = 'c-2b4-moon';
const SESSION = 's-2b4';
const PRIVATE_TEXT = '今天在楼下看到一只很丑的橘猫，我笑了很久。';
const TOLD_TEXT = '我最近其实有点撑不住，但不想让别人知道。';
const WORLD_TEXT = '我们把那面墙刷成了青色，累到坐在楼梯上吃泡面。';

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
  return Promise.reject(new Error('harness: 不该联网'));
}) as typeof fetch;

/* ---------- LLM 打桩 ---------- */
let llmCalls = 0;
let capturedPrompt = '';
const STUB_REPLIES = [
  '那只猫我记住样子了，下次一起去看。',
  '撑不住的时候跟我说，别一个人扛。',
  '刷墙那天你脸上全是漆，我笑得不行。',
  '行，听你的。',
];
const originalSend = webApi.chat.send.bind(webApi.chat);
(webApi.chat as unknown as { send: typeof webApi.chat.send }).send = (async (params: { systemPrompt: string }) => {
  llmCalls += 1;
  capturedPrompt = params.systemPrompt;
  return {
    content: STUB_REPLIES[(llmCalls - 1) % STUB_REPLIES.length],
    usage: { inputTokens: 900, outputTokens: 20 },
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
    voice: { ...DEFAULT_VOICE },
  };
}

/** 在真实 ChatWindow 里发送一句话，返回这一轮的 systemPrompt */
async function sendAndCapture(host: HTMLElement, text: string): Promise<string> {
  capturedPrompt = '';
  const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!textarea) throw new Error('harness: 找不到输入框');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('harness: 无法设置输入框');
  setter.call(textarea, text);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(60);
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(1500);
  return capturedPrompt;
}

function clickButtonByText(text: string, root: ParentNode = document.body): boolean {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) return false;
  (btn as HTMLButtonElement).click();
  return true;
}

async function makeDiary(content: string, date: string, characterId?: string): Promise<string> {
  return diaryRepo.create({
    userId: U, date, title: content.slice(0, 12), content, mood: 3, tags: [],
    ...(characterId ? { characterId } : {}),
  });
}

async function run() {
  useUIStore.getState().setWorldTheaterOpen(true);
  /* ---------------- P. 纯函数 ---------------- */
  section('P. 纯函数：日记区块文案 + 溯源契约');
  {
    check('① 没有日记时区块为空（不产生空区块）', buildDiaryContext([]) === '');
    const text = buildDiaryContext([
      { id: 'd1', date: '2026-09-10', title: '那只猫', content: PRIVATE_TEXT },
      { id: 'd2', date: '2026-09-11', title: '', content: TOLD_TEXT },
    ] as never);
    check('② 含日期/标题/正文', text.includes('2026-09-10') && text.includes('那只猫') && text.includes(PRIVATE_TEXT), text.slice(0, 200));
    check('③ 不含任何内部字段', !/visibility|visibleTo|importance|worldId|selected/.test(text), text);
    check('④ 明确说明"这是用户主动让你知道的"，并禁止暗示知道别的日记',
      text.includes('用户主动让你知道的日记') && text.includes('没让你知道的其它日记'));
    check('⑤ 最多只写 3 条',
      (buildDiaryContext([
        { id: '1', date: '2026-01-01', title: 'a', content: 'A' },
        { id: '2', date: '2026-01-02', title: 'b', content: 'B' },
        { id: '3', date: '2026-01-03', title: 'c', content: 'C' },
        { id: '4', date: '2026-01-04', title: 'd', content: 'D' },
      ] as never).match(/^【/gm) ?? []).length === 3);

    check('⑥ 人话描述：private / selected / world 三态',
      describeSharing({ visibility: 'private' } as never, () => '星遥') === '仅自己可见' &&
      describeSharing({ visibility: 'selected', visibleTo: [C1] } as never, () => '星遥') === '只告诉了 星遥' &&
      describeSharing({ visibility: 'world' } as never, () => '星遥').includes('共同世界'));

    // 溯源：只有完整注入才记录 diaryIds
    const BUDGET = 6000;
    const full = compileChatContext('IDENT', [{ key: 'diary', text: 'x'.repeat(1000), priority: 70 }], BUDGET);
    check('⑦ 完整注入 ⇒ 记录 diaryIds',
      buildContextTrace({ compiled: full, diaries: [{ id: 'd1' }, { id: 'd2' }] }).diaryIds?.join('|') === 'd1|d2');
    const partial = compileChatContext('IDENT', [{ key: 'other', text: 'x'.repeat(5000), priority: 100 }, { key: 'diary', text: 'x'.repeat(3000), priority: 70 }], BUDGET);
    check('⑧ 构造出的确是被截断的区块', partial.partial.includes('diary'), { included: partial.included, partial: partial.partial });
    check('⑨ 被截断 ⇒ **不**记录 diaryIds（不谎报）',
      buildContextTrace({ compiled: partial, diaries: [{ id: 'd1' }] }).diaryIds === undefined);
    const omitted = compileChatContext('IDENT', [{ key: 'a', text: 'x'.repeat(5800), priority: 100 }, { key: 'b', text: 'x'.repeat(3000), priority: 95 }, { key: 'diary', text: 'x'.repeat(400), priority: 40 }], BUDGET);
    check('⑩ 被丢弃 ⇒ 不记录', omitted.omitted.includes('diary') && buildContextTrace({ compiled: omitted, diaries: [{ id: 'd1' }] }).diaryIds === undefined);
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
  useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');

  const privateDiary = await makeDiary(PRIVATE_TEXT, '2026-09-09');
  const toldDiary = await makeDiary(TOLD_TEXT, '2026-09-10');
  const worldDiary = await makeDiary(WORLD_TEXT, '2026-09-11', C1);

  /* ---------------- A. 默认 private ---------------- */
  section('A. 默认：仅自己可见（不写事件、不给认知）');
  {
    const d = await diaryRepo.getById(privateDiary);
    check('① 新建日记 visibility = private、visibleTo 为空',
      d?.visibility === 'private' && (d?.visibleTo ?? []).length === 0, d && { v: d.visibility, to: d.visibleTo });
    check('② 没有派生世界事件', (await db.worldEvents.count()) === 0, await db.worldEvents.count());
    check('③ 没有任何认知行（连锚点都没有）', (await knowledgeRepo.getForCharacterEvent(C1, diaryKnowledgeAnchor(privateDiary))) === undefined);
    check('④ 任何角色都看不到它',
      (await diaryRepo.listVisibleFor(C1, U)).length === 0 && (await diaryRepo.listVisibleFor(C2, U)).length === 0);
    check('⑤ 认知闸门也不认为 TA 知道', (await listMentionableDiaryIds(U, world.id, C1)).size === 0);
  }

  /* ---------------- B. 告诉某角色 ---------------- */
  section('B. 告诉某角色：只给 TA 认知与可提起权限，**不写世界事件**');
  {
    const r = await setDiarySharing({ userId: U, diaryId: toldDiary, visibility: 'selected', visibleTo: [C1] });
    check('① 只授权给指定角色', r.visibility === 'selected' && r.visibleTo.join('|') === C1 && r.granted.join('|') === C1, r);
    const anchor = diaryKnowledgeAnchor(toldDiary);
    const know = await knowledgeRepo.getForCharacterEvent(C1, anchor);
    check('② 该角色获得认知（full + 可提起）',
      know?.knowledgeLevel === 'full' && know?.canMention === true, know && { l: know.knowledgeLevel, m: know.canMention });
    check('③ 另一个角色没有任何认知', (await knowledgeRepo.getForCharacterEvent(C2, anchor)) === undefined);
    check('④ **没有**写世界事件（"只告诉你一个人"不在世界年表留痕）',
      (await db.worldEvents.count()) === 0, await worldEventRepo.listTimeline(world.id));
    check('⑤ 认知闸门：只有被告诉的角色能提起',
      (await listMentionableDiaryIds(U, world.id, C1)).has(toldDiary) &&
      !(await listMentionableDiaryIds(U, world.id, C2)).has(toldDiary));
    check('⑥ 可见性也只给被告诉的角色',
      (await diaryRepo.listVisibleFor(C1, U)).some((d) => d.id === toldDiary) &&
      !(await diaryRepo.listVisibleFor(C2, U)).some((d) => d.id === toldDiary));
    check('⑦ 只选人但选空 ⇒ 视为 private（不留半开的口子）',
      (await setDiarySharing({ userId: U, diaryId: privateDiary, visibility: 'selected', visibleTo: [] })).visibility === 'private');
  }

  /* ---------------- C. 加入共同世界 ---------------- */
  section('C. 加入共同世界：写 reality 事件 + 按参与者建立认知');
  {
    const r = await setDiarySharing({ userId: U, diaryId: worldDiary, visibility: 'world' });
    const eventId = derivedDiaryWorldEventId(U, world.id, worldDiary);
    check('① 世界事件已写入（确定性 id）', r.worldEventId === eventId, r);
    const evt = await worldEventRepo.getById(eventId);
    check('② 类型是 reality（不是 stage）', evt?.type === 'reality', evt?.type);
    check('③ 可见性是 world', evt?.visibility === 'world', evt?.visibility);
    check('④ 标题/正文来自这条日记', evt?.title === WORLD_TEXT.slice(0, 12) && evt?.summary.includes('青'), evt);
    check('⑤ 参与者 = 你 + 这条日记关联的角色',
      evt?.participants.join('|') === [`u:${U}`, `c:${C1}`].join('|'), evt?.participants);
    check('⑥ 关联角色获得认知（按参与者）', (await listMentionableDiaryIds(U, world.id, C1)).has(worldDiary));
    check('⑦ 没被关联/没被授权的角色仍然不知道', !(await listMentionableDiaryIds(U, world.id, C2)).has(worldDiary));
    check('⑧ 日记行记下了 worldEventId', (await diaryRepo.getById(worldDiary))?.worldEventId === eventId);
    check('⑨ 降级回"仅自己"会移除世界事件与字段',
      (await setDiarySharing({ userId: U, diaryId: worldDiary, visibility: 'private' })).visibility === 'private' &&
      (await worldEventRepo.getById(eventId)) === undefined &&
      (await diaryRepo.getById(worldDiary))?.worldEventId === undefined);
    // 复原成 world，供后面的世界页断言使用
    await setDiarySharing({ userId: U, diaryId: worldDiary, visibility: 'world' });
  }

  /* ---------------- D. 真实发送：注入 → 撤回 → 立即不注入 ---------------- */
  section('D. 真实 ChatWindow：授权进上下文、撤回立即失效');
  useChatStore.setState({
    characters: [makeCharacter(C1, '星遥'), makeCharacter(C2, '月见')],
    selectedCharacterId: C1,
    currentSessionId: SESSION,
    messages: [],
    hasMoreMessages: false,
  } as never);
  const host = mount(createElement(ChatWindow), 900);
  await sleep(900);
  {
    const p1 = await sendAndCapture(host, '今天有点累');
    check('① 被授权的日记进了 prompt', p1.includes('[用户主动让你知道的日记]') && p1.includes(TOLD_TEXT), p1.slice(p1.indexOf('[用户主动让你知道的日记]'), p1.indexOf('[用户主动让你知道的日记]') + 200));
    check('② 私密日记**没有**进 prompt', !p1.includes(PRIVATE_TEXT));
    check('③ 加入共同世界的日记也进了（关联角色知道）', p1.includes(WORLD_TEXT));
    const assistant = (await messageRepo.getPage(SESSION, { limit: 50 })).filter((m) => m.role === 'assistant').pop();
    check('④ 溯源如实记录 diaryIds（两条都完整注入了）',
      (assistant?.contextTrace?.diaryIds ?? []).length === 2 &&
      assistant!.contextTrace!.diaryIds!.includes(toldDiary) && assistant!.contextTrace!.diaryIds!.includes(worldDiary),
      assistant?.contextTrace);

    // 撤回"告诉某角色"
    await setDiarySharing({ userId: U, diaryId: toldDiary, visibility: 'private' });
    check('⑤ 撤回后认知行真的被删掉', (await knowledgeRepo.getForCharacterEvent(C1, diaryKnowledgeAnchor(toldDiary))) === undefined);
    const p2 = await sendAndCapture(host, '那我先睡了');
    check('⑥ 撤回后**下一次发送立即**不再注入', !p2.includes(TOLD_TEXT), p2.slice(0, 260));
    const assistant2 = (await messageRepo.getPage(SESSION, { limit: 50 })).filter((m) => m.role === 'assistant').pop();
    check('⑦ 溯源也不再记录它', !(assistant2?.contextTrace?.diaryIds ?? []).includes(toldDiary), assistant2?.contextTrace);

    // 改授权：C1 → C2（用真实切换角色验证"旧的立即失去、新的立即获得"）
    await setDiarySharing({ userId: U, diaryId: toldDiary, visibility: 'selected', visibleTo: [C2] });
    const p3 = await sendAndCapture(host, '周末有安排吗');
    check('⑧ 改授权后，旧角色立刻看不到', !p3.includes(TOLD_TEXT));
    check('⑨ 新角色拿到授权（认知与可提起）',
      (await listMentionableDiaryIds(U, world.id, C2)).has(toldDiary) &&
      !(await listMentionableDiaryIds(U, world.id, C1)).has(toldDiary));
    check('⑩ 新角色的可见集合里也有它', (await diaryRepo.listVisibleFor(C2, U)).some((d) => d.id === toldDiary));
  }

  /* ---------------- E. R6 收口 ---------------- */
  section('E. R6 收口：旧的全局开关不再影响任何角色的提示词');
  {
    check('① settings-store 里已经没有这个键（旧入口被删除）',
      !('diarySharedWithCharacters' in useSettingsStore.getState()),
      Object.keys(useSettingsStore.getState()).filter((k) => k.toLowerCase().includes('diary')));
    // 模拟"历史设置里还残留着 true"
    useSettingsStore.setState({ diarySharedWithCharacters: true } as never);
    const before = llmCalls;
    const p = await sendAndCapture(host, '你还记得我昨天写了什么吗');
    check('② 即使把旧开关强行塞回 state，私密日记仍然不进 prompt', !p.includes(PRIVATE_TEXT), p.slice(0, 260));
    check('③ 授权给**别人**的日记也不进当前角色的 prompt', !p.includes(TOLD_TEXT));
    check('④ 授权给当前角色的（共同世界那条）照常在', p.includes(WORLD_TEXT));
    check('⑤ 这次发送只调 1 次 LLM（旧开关没有额外行为）', llmCalls - before === 1, llmCalls - before);
    check('⑥ 别的角色同样拿不到私密日记（换成月见）',
      !(await diaryRepo.listVisibleFor(C2, U)).some((d) => d.visibility === 'private' || d.id === privateDiary));
    delete (useSettingsStore.getState() as unknown as Record<string, unknown>).diarySharedWithCharacters;
  }

  /* ---------------- F. 回收站与彻底删除 ---------------- */
  section('F. 回收站：软删除不进上下文；恢复后可再进；彻底删除收回授权');
  {
    await setDiarySharing({ userId: U, diaryId: toldDiary, visibility: 'selected', visibleTo: [C1] });
    await diaryRepo.softDelete(toldDiary);
    check('① 进回收站后不再可见', !(await diaryRepo.listVisibleFor(C1, U)).some((d) => d.id === toldDiary));
    const p = await sendAndCapture(host, '算了');
    check('② 回收站里的日记不进 prompt（即使授权还在）', !p.includes(TOLD_TEXT));
    await diaryRepo.restore(toldDiary);
    const p2 = await sendAndCapture(host, '我想说件事');
    check('③ 从回收站恢复后又可以进 prompt', p2.includes(TOLD_TEXT));
    await diaryRepo.purge(toldDiary);
    check('④ 彻底删除后认知行被收回', (await knowledgeRepo.getForCharacterEvent(C1, diaryKnowledgeAnchor(toldDiary))) === undefined);
    const p3 = await sendAndCapture(host, '没事');
    check('⑤ 彻底删除后不再注入', !p3.includes(TOLD_TEXT));
  }

  /* ---------------- G. 角色被删除 ---------------- */
  section('G. 角色被删除：授权摘掉、认知消失、回到仅自己');
  {
    const d2 = await makeDiary('这是只告诉月见的一页。', '2026-09-12');
    await setDiarySharing({ userId: U, diaryId: d2, visibility: 'selected', visibleTo: [C1, C2] });
    check('① 两人都被授权',
      (await diaryRepo.getById(d2))?.visibleTo?.sort().join('|') === [C1, C2].sort().join('|'));
    await worldRepo.cleanupCharacter(U, C2);
    const after = await diaryRepo.getById(d2);
    check('② 被删角色从 visibleTo 摘掉（另一人保留）', after?.visibleTo?.join('|') === C1, after?.visibleTo);
    check('③ 被删角色的认知行消失', (await knowledgeRepo.getForCharacterEvent(C2, diaryKnowledgeAnchor(d2))) === undefined);
    await setDiarySharing({ userId: U, diaryId: d2, visibility: 'selected', visibleTo: [C1] });
    await worldRepo.cleanupCharacter(U, C1);
    const onlyMine = await diaryRepo.getById(d2);
    check('④ 授权对象全没了 ⇒ 自动回到"仅自己"',
      onlyMine?.visibility === 'private' && (onlyMine?.visibleTo ?? []).length === 0, onlyMine && { v: onlyMine.visibility, to: onlyMine.visibleTo });
  }

  /* ---------------- H. 世界页 ---------------- */
  section('H. 世界页：加入共同世界后出现在「此刻」详情');
  {
    unmount();
    useUIStore.getState().setMobileTab('world');
    const worldHost = mount(createElement(MobileWorldPage));
    await sleep(800);
    const summaryText = worldHost.innerText;
    const expand = Array.from(worldHost.querySelectorAll('button')).find((button) => (button.textContent ?? '').includes('看看发生了什么'));
    expand?.click();
    await sleep(80);
    const text = worldHost.innerText;
    check('① 世界统计行如实反映真实数据（天数 / 角色数 / 共同经历）', /第 \d+ 天/.test(text) && text.includes('共同经历'), text.slice(0, 200));
    check('② 首屏克制，展开「此刻」后列出真实生活记录', !summaryText.includes(WORLD_TEXT.slice(0, 12)) && text.includes(WORLD_TEXT.slice(0, 12)), text.slice(0, 500));
    check('③ 类别用人话「你写下的生活」', text.includes('你写下的生活'), text.slice(0, 400));
    unmount();
  }

  /* ---------------- I. UI：真实组件 ---------------- */
  section('I. UI（真实组件）：三级可见性控件与总览收回');
  {
    const d3 = await makeDiary('想吃楼下那家的面。', '2026-09-13');
    (useChatStore.setState as (s: unknown) => void)({ characters: [makeCharacter(C1, '星遥'), makeCharacter(C2, '月见')] });
    /**
     * 真实页面里 `diary` 是父组件的 state（DiaryChatPage 用 `onChange` 把它 setState 回去，
     * 见 DiaryChatPage 里 <DiarySharingControl onChange={...setDiary} />）。
     * 验收里必须照样给它一个有状态的父层，否则控件拿到的是快照、文案永远不会变——
     * 那是"测试接错了"，不是产品问题。
     */
    function SharingHarness({ initial }: { initial: Diary }) {
      const [current, setCurrent] = useState(initial);
      return createElement(DiarySharingControl, { diary: current, onChange: setCurrent });
    }
    const initial = (await diaryRepo.getById(d3))!;
    const ctrlHost = mount(createElement(SharingHarness, { initial }), 200);
    await sleep(300);
    check('① 默认显示「仅自己可见」', ctrlHost.innerText.includes('仅自己可见'), ctrlHost.innerText);
    check('② 点开后有三级选项', clickButtonByText('仅自己可见', ctrlHost), ctrlHost.innerText);
    await sleep(200);
    const menuText = ctrlHost.innerText;
    check('③ 三个选项文案齐全（仅自己 / 告诉某角色 / 加入共同世界）',
      menuText.includes('仅自己可见') && menuText.includes('告诉某一个角色') && menuText.includes('加入共同世界'), menuText);
    const told = clickButtonByText('星遥', ctrlHost);
    await sleep(700);
    const afterTold = await diaryRepo.getById(d3);
    check('④ 点「星遥」后真的写入了授权', told && afterTold?.visibility === 'selected' && afterTold?.visibleTo?.join('|') === C1, afterTold && { v: afterTold.visibility, to: afterTold.visibleTo });
    check('⑤ 认知行也随之写入',
      (await knowledgeRepo.getForCharacterEvent(C1, diaryKnowledgeAnchor(d3)))?.canMention === true);
    check('⑥ 控件文案跟着变成「只告诉了 星遥」（真实父层 setState 生效）', ctrlHost.innerText.includes('只告诉了 星遥'), ctrlHost.innerText);
    unmount();

    // 总览 + 收回
    const overviewHost = mount(createElement(DiarySharingOverviewModal, { open: true, onClose: () => undefined }), 500);
    await sleep(500);
    const overText = document.body.innerText;
    check('⑦ 总览列出了已授权的日记与其去向',
      overText.includes('谁能看到我的日记') && overText.includes('想吃楼下那家的面') && overText.includes('只告诉了 星遥'),
      overText.slice(0, 300));
    check('⑧ 提供「收回」入口', clickButtonByText('收回'), overText);
    await sleep(700);
    const afterRevoke = await diaryRepo.getById(d3);
    check('⑨ 收回后真的回到仅自己', afterRevoke?.visibility === 'private' && (afterRevoke?.visibleTo ?? []).length === 0, afterRevoke && { v: afterRevoke.visibility });
    check('⑩ 认知行同时被删掉', (await knowledgeRepo.getForCharacterEvent(C1, diaryKnowledgeAnchor(d3))) === undefined);
    unmount();
    overviewHost.remove();
  }

  /* ---------------- J. 成本 ---------------- */
  section('J. 成本：没有新增 AI 调用或网络请求');
  {
    const host2 = mount(createElement(ChatWindow), 900);
    await sleep(900);
    const before = llmCalls;
    await sendAndCapture(host2, '在吗');
    check('① 一次发送 = 1 次 LLM 调用（日记闸门没有额外调用）', llmCalls - before === 1, llmCalls - before);
    unmount();

    // 直接量一次"日记闸门"本身：可见性 + 认知两道查询都不该联网
    const n0 = netCalls;
    await diaryRepo.listVisibleFor(C1, U, 20);
    await listMentionableDiaryIds(U, world.id, C1);
    check('② 日记闸门（可见性 + 认知）本身零网络请求', netCalls === n0, netCalls - n0);

    /**
     * 关于"全程零网络"：4.x 在**用户消息累计到一定条数**时会做一次上下文整合
     * （`webApi.context.settle` → `consolidateContext`），它走自己的 `fetchWithTimeout`，
     * 与本阶段无关，但在被 patched 的 fetch 下会被记到。
     * 因此这里按**调用栈归因**，而不是笼统断言"一次都没有"：
     * 只要没有任何一次请求来自本阶段新增的代码路径（日记 / 召回 / 可见性），结论就成立。
     */
    const fromNewCode = fetchStacks.filter((s) => /diary|recall|visibility/i.test(s));
    check('③ 没有一次网络请求来自本阶段新增的代码路径', fromNewCode.length === 0, fromNewCode);
    check('④ 出现的网络请求全部来自 4.x 既有路径（上下文整合 / 声线分配），已被如实归因',
      fetchStacks.every((s) => /consolidateContext|assignVoice/.test(s)), fetchStacks);
  }

  /* ---------------- K. 审核发现的两个未覆盖问题（回归） ---------------- */
  section('K. P1：私密日记的**情绪**也不得泄露；P2：同一区块不得重复注入');
  {
    // ---- P2：编译器层面 同一个 key 只注入一次 ----
    const dup = compileChatContext('IDENT', [
      { key: 'diary', text: '【区块A】同样的日记内容', priority: 70 },
      { key: 'diary', text: '【区块A】同样的日记内容', priority: 70 },
    ], 6000);
    check('① 编译器层面：同一 key 重复传入只注入一次（结构上防止重复区块）',
      (dup.prompt.match(/【区块A】/g) ?? []).length === 1 && dup.included.filter((k) => k === 'diary').length === 1,
      { prompt: dup.prompt, included: dup.included });
    const dupPriority = compileChatContext('IDENT', [
      { key: 'diary', text: '【低优先级】', priority: 10 },
      { key: 'diary', text: '【高优先级】', priority: 90 },
    ], 6000);
    check('② 重复时保留优先级更高的那一条（可预测，不随机）',
      dupPriority.prompt.includes('【高优先级】') && !dupPriority.prompt.includes('【低优先级】'), dupPriority.prompt);

    // ---- P1 + P2：真实 ChatWindow 上的心情与重复 ----
    // 今天的一篇**私密**日记，心情很低落（旧实现会把这份情绪告诉每一个角色）
    const today = todayStr();
    await diaryRepo.getByDate(U, today).then(async (list) => { for (const d of list) await diaryRepo.purge(d.id); });
    const moodDiary = await diaryRepo.create({
      userId: U, date: today, title: '今天很难', content: '今天真的有点撑不住了，什么都做不好。', mood: 1, tags: [],
    });
    const host3 = mount(createElement(ChatWindow), 900);
    await sleep(900);

    const pPrivate = await sendAndCapture(host3, '在吗');
    check('③ 私密日记的**心情**不再泄露（prompt 不含"低落的心情"）', !pPrivate.includes('低落的心情'), pPrivate.slice(0, 240));
    check('④ 私密日记的内容同样不在', !pPrivate.includes('什么都做不好'));

    // 正面控制：授权给当前角色后，内容和心情都应该进来
    await setDiarySharing({ userId: U, diaryId: moodDiary, visibility: 'selected', visibleTo: [C1] });
    const pShared = await sendAndCapture(host3, '今天过得怎么样');
    check('⑤ 授权后：心情联动照常生效（含"低落的心情"）', pShared.includes('低落的心情'), pShared.slice(pShared.indexOf('[补充]'), pShared.indexOf('[补充]') + 80));
    check('⑥ 授权后：内容也在', pShared.includes('什么都做不好'));
    check('⑦ P2：日记区块在 prompt 里**只出现一次**',
      (pShared.match(/\[用户主动让你知道的日记\]/g) ?? []).length === 1,
      { blocks: (pShared.match(/\[用户主动让你知道的日记\]/g) ?? []).length });
    check('⑧ P2：日记正文也只出现一次（没有重复注入）',
      (pShared.match(/什么都做不好/g) ?? []).length === 1,
      { times: (pShared.match(/什么都做不好/g) ?? []).length });

    // 撤回：内容与心情都必须立刻消失
    await setDiarySharing({ userId: U, diaryId: moodDiary, visibility: 'private' });
    const pRevoked = await sendAndCapture(host3, '我先去忙了');
    check('⑨ 撤回后：内容与心情**都**立刻不注入',
      !pRevoked.includes('什么都做不好') && !pRevoked.includes('低落的心情'), pRevoked.slice(0, 240));

    // 授权给别人（月见）时，星遥这里同样连心情都不该有
    await setDiarySharing({ userId: U, diaryId: moodDiary, visibility: 'selected', visibleTo: [C2] });
    const pToOther = await sendAndCapture(host3, '那你呢');
    check('⑩ 授权给别人时，当前角色的 prompt 里既没有内容也没有心情',
      !pToOther.includes('什么都做不好') && !pToOther.includes('低落的心情'), pToOther.slice(0, 240));
    await setDiarySharing({ userId: U, diaryId: moodDiary, visibility: 'private' });

    // 非今天的日记不参与心情联动（语义边界）
    const pastMood = await diaryRepo.create({
      userId: U, date: '2026-08-01', title: '很久以前', content: '那天也很低落。', mood: 1, tags: [],
    });
    await setDiarySharing({ userId: U, diaryId: pastMood, visibility: 'selected', visibleTo: [C1] });
    const pPast = await sendAndCapture(host3, '随便聊聊');
    check('⑪ 心情联动只认"今天"的日记（旧日记的内容进上下文，但不影响语气）',
      pPast.includes('那天也很低落') && !pPast.includes('低落的心情'), pPast.slice(pPast.indexOf('[用户主动让你知道的日记]'), pPast.indexOf('[用户主动让你知道的日记]') + 200));
    await setDiarySharing({ userId: U, diaryId: pastMood, visibility: 'private' });
    unmount();
  }

  /* ---------------- 清理 ---------------- */
  section('清理');
  unmount();
  (webApi.chat as unknown as { send: typeof webApi.chat.send }).send = originalSend;
  window.fetch = realFetch;
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await worldEventRepo.countByWorld(world.id)) === 0);
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
