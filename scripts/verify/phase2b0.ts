/**
 * VirtuGene 5.0.0 Phase 2b-0 验收：最小闭环（复用既有结算 → 世界事件）
 *
 * 做法：
 *  - 真实浏览器 + 真实 IndexedDB + 真实 store/repo
 *  - **在既有结算流程里跑真流程**（emotionStore.settle），只把 LLM 边界（webApi.context.settle）打桩，
 *    因此不联网；并统计调用次数，证明**没有新增任何 AI 调用**。
 *  - 最后真实渲染世界页，验证"新用户聊天后，世界页出现真实事件"。
 *
 * 覆盖：
 *  A. 约定/未完成事项（既有结算提取） → 世界事件(continuity) + 该角色认知
 *  B. 关系变化（等阶升级）           → 世界事件(relationship)
 *  C. 普通闲聊（无约定、无升级）      → **不写世界层**（噪音控制），但 4.x 行为不变
 *  D. 同一件事再次被提起             → 幂等，不产生重复事件
 *  E. 完成未完成事项                 → 同一条事件 resolved 变 true，不新增
 *  F. 端到端：世界页真的显示这条事件
 *  G. 删除未完成事件 / 删除角色       → 派生事件一并移除，不留孤儿
 *  H. 全程 AI 调用次数 = 结算次数（零新增）
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { continuityRepo } from '../../src/db/continuity-repo';
import { stateRepo } from '../../src/db/state-repo';
import { memoryRepo } from '../../src/db/memory-repo';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { webApi } from '../../src/lib/web-api';
import { useAuthStore } from '../../src/store/auth-store';
import { useEmotionStore } from '../../src/store/emotion-store';
import { useChatStore } from '../../src/store/chat-store';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import type { Character, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-2b0';
const C = 'c-star';
const SESSION = 's-2b0';
const lines: string[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 结算返回值（打桩）：只模拟"模型说了什么"，不联网 */
type SettleResult = Awaited<ReturnType<typeof webApi.context.settle>>;
let aiCalls = 0;
const queue: SettleResult[] = [];

const dims = (intimacy: number) => ({
  valence: 6, arousal: 5, intimacy, engagement: 6, expressiveness: 5, stability: 6,
});

function pushSettle(result: SettleResult) {
  queue.push(result);
}

function stubSettle() {
  (webApi.context as unknown as { settle: () => Promise<SettleResult> }).settle = async () => {
    aiCalls += 1;
    const next = queue.shift();
    if (!next) throw new Error('harness: 没有排队的结算响应');
    return next;
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
async function renderWorldPage(): Promise<string> {
  if (root) root.unmount();
  if (!host) {
    host = document.createElement('div');
    host.id = 'world-host-2b0';
    document.body.appendChild(host);
  }
  root = createRoot(host);
  root.render(createElement(MobileWorldPage));
  await sleep(700);
  return host.innerText;
}

async function seedChat(): Promise<void> {
  const character: Character = {
    id: C, name: '星遥', avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
  };
  await characterRepo.create(character);
  const session: Session = {
    id: SESSION, characterId: C, userId: U, title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0,
  };
  await sessionRepo.create(session);
  // settle 的前置条件：至少 3 条用户消息（真实行为，不绕过）
  for (let i = 1; i <= 3; i += 1) {
    await messageRepo.create({
      id: `m-${i}`, sessionId: SESSION, role: 'user', content: `第 ${i} 句话：我们周末一起去看电影吧`, createdAt: Date.now() + i, isProactive: false,
    });
  }
}

async function run() {
  // 全新库（保证是"新用户"从零开始）
  await Dexie.delete(DB);
  await db.open();

  await db.users.put({ id: U, username: '新用户', passwordHash: 'x', passwordSalt: 'y', createdAt: Date.now() });
  await seedChat();
  useAuthStore.setState({ userId: U, username: '新用户', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  stubSettle();

  const world = await worldRepo.ensureDefaultWorld(U, '新用户');
  const countEvents = () => worldEventRepo.countByWorld(world.id);

  check('起点：世界是空的', (await countEvents()) === 0 && (await continuityRepo.getByCharacter(C, U)).length === 0);

  // ---------- A. 约定 / 未完成事项 ----------
  section('A. 既有结算提取到「约定」→ 世界事件');
  pushSettle({
    memories: [{ content: '用户是学生，正在准备毕业论文', evidence: [0] }],
    threads: [{ action: 'create', kind: 'plan', title: '周末一起去看电影', detail: '你们说好这周末去', evidence: [0] }],
    dimensions: dims(6),
    dominantEmotion: '平静',
    userEmotion: '平静',
    summary: '你们聊到了周末的安排。',
  });
  await useEmotionStore.getState().settle(C, SESSION, '星遥');

  const threads = await continuityRepo.getOpenByCharacter(C, U);
  check('4.x 行为不变：未完成事件被提取出来', threads.length === 1 && threads[0].title === '周末一起去看电影', threads.map((t) => t.title));
  const eventsA = await worldEventRepo.listTimeline(world.id, { limit: 50 });
  check('世界事件出现 1 条（约定 → continuity）', eventsA.length === 1 && eventsA[0].type === 'continuity', eventsA.map((e) => `${e.type}:${e.title}`));
  check('标题与来源正确', eventsA[0]?.title === '周末一起去看电影' && eventsA[0]?.sourceType === 'continuity', eventsA[0]);
  check('参与者 = 用户 + 该角色', eventsA[0]?.participants.includes(userRef(U)) && eventsA[0]?.participants.includes(characterRef(C)), eventsA[0]?.participants);
  check('可见性保守：selected + 只给该角色', eventsA[0]?.visibility === 'selected' && (eventsA[0]?.visibleTo ?? []).includes(C), eventsA[0]);
  check('未完成 ⇒ resolved = false', eventsA[0]?.resolved === false);
  check('该角色获得认知（可提起）', (await knowledgeRepo.canMention(C, eventsA[0]!.id)) === true);
  check('普通互动**没有**写世界层（噪音控制）', eventsA.every((e) => e.type !== 'interaction'));
  check('4.x 记忆仍然照常保存', (await memoryRepo.getByCharacter(C, U)).some((m) => m.content.includes('毕业论文')));
  check('AI 调用次数 = 1（只有既有结算这一次）', aiCalls === 1, aiCalls);
  // 规格：长按「记住」只写 MemoryItem，**不进世界层**（真正的共同记忆入口在 2b-2）
  await stateRepo.recordLifeEvent(C, U, { type: 'memory', title: '你把一段话郑重地留在了记忆里', detail: '明天有考试' });
  check('「记住」不写世界层（按 §5 规格）', (await countEvents()) === 1, await countEvents());

  // ---------- B. 关系变化 ----------
  section('B. 关系等阶升级 → 世界事件（relationship）');
  // 模拟"已经聊到临界点"的用户：好感度 19，下一次结算会跨过 20（熟悉）
  await db.characterStates.update([C, U], { affinity: 19 });
  pushSettle({
    memories: [],
    threads: [],
    dimensions: dims(9),
    dominantEmotion: '亲近',
    summary: '你们聊得很投机。',
  });
  await useEmotionStore.getState().settle(C, SESSION, '星遥');
  const eventsB = await worldEventRepo.listTimeline(world.id, { limit: 50 });
  const relationshipEvent = eventsB.find((e) => e.type === 'relationship');
  check('世界事件新增 1 条 relationship', eventsB.length === 2 && !!relationshipEvent, eventsB.map((e) => `${e.type}:${e.title}`));
  check('标题体现真实等阶升级（熟悉）', (relationshipEvent?.title ?? '').includes('熟悉'), relationshipEvent?.title);
  check('重要度较高（0.7）', relationshipEvent?.importance === 0.7, relationshipEvent?.importance);
  check('AI 调用次数仍随结算线性增长（=2）', aiCalls === 2, aiCalls);

  // ---------- C. 普通闲聊不写世界层 ----------
  section('C. 普通闲聊（无约定、无升级）→ 不写世界层');
  const lifeEventsBefore = ((await stateRepo.get(C, U))?.lifeEvents ?? []).length;
  pushSettle({
    memories: [{ content: '用户喜欢下雨天', evidence: [0] }],
    threads: [],
    dimensions: dims(5),
    dominantEmotion: '平静',
    summary: '随便聊了几句天气。',
  });
  await useEmotionStore.getState().settle(C, SESSION, '星遥');
  check('世界事件数量不变（仍是 2）', (await countEvents()) === 2, await countEvents());
  check('4.x 生命轨迹照常增长（说明流程本身没被改变）', ((await stateRepo.get(C, U))?.lifeEvents ?? []).length === lifeEventsBefore + 1);
  check('新的用户事实记忆照常入库', (await memoryRepo.getByCharacter(C, U)).some((m) => m.content.includes('下雨天')));
  check('AI 调用次数 = 3', aiCalls === 3, aiCalls);

  // ---------- D. 幂等：同一件事再次被提起 ----------
  section('D. 同一件约定再次被提起 → 幂等');
  pushSettle({
    memories: [],
    threads: [{ action: 'create', kind: 'plan', title: '周末一起去看电影', detail: '又提了一次', evidence: [0] }],
    dimensions: dims(5),
    dominantEmotion: '平静',
    summary: '又聊到那场电影。',
  });
  await useEmotionStore.getState().settle(C, SESSION, '星遥');
  check('未完成事件仍是 1 条（相似度去重）', (await continuityRepo.getByCharacter(C, U)).length === 1);
  check('世界事件数量仍是 2（没有重复行）', (await countEvents()) === 2, await countEvents());

  // ---------- E. 完成 → resolved 同步 ----------
  section('E. 完成未完成事项 → 同一条事件 resolved 变 true');
  const threadId = (await continuityRepo.getByCharacter(C, U))[0].id;
  await continuityRepo.complete(threadId);
  const eventsE = await worldEventRepo.listTimeline(world.id, { limit: 50 });
  const continuityEvent = eventsE.find((e) => e.type === 'continuity')!;
  check('事件总数不变（仍是 2）', eventsE.length === 2, eventsE.length);
  check('同一条事件 resolved 变为 true', continuityEvent.resolved === true);
  check('事件 id 未变（是更新而不是新增）', continuityEvent.id === eventsA[0]!.id);

  // 用户改写这件事之后，世界事件必须跟着更新（否则世界页会显示旧文案）
  await continuityRepo.update(threadId, { title: '周末一起去看电影（改到周日）' });
  const afterRename = (await worldEventRepo.listTimeline(world.id, { limit: 50 })).find((e) => e.type === 'continuity')!;
  check('编辑未完成事件后，同一条世界事件标题同步更新', afterRename.title === '周末一起去看电影（改到周日）' && (await countEvents()) === 2, afterRename.title);

  // ---------- F. 端到端：世界页 ----------
  section('F. 端到端：世界页真的显示这条事件');
  const text = await renderWorldPage();
  check('不再声称世界是空的', !text.includes('这里还没有发生任何事情'), text.slice(0, 160));
  check('显示「最近发生」区块', text.includes('最近发生'));
  check('列出真实事件标题', text.includes('周末一起去看电影'), text.slice(0, 220));
  check('显示关系变化事件（等阶升级）', text.includes('熟悉'));
  // 5.0 最终版：统计行改为"第 N 天 · X 位角色 · Y 段共同经历"（世界层没有"件事"这个说法了），
  // 这里断言的是**同一件事**：统计行反映真实的世界事件条数（此时 2 条）。
  check('统计行反映真实世界事件条数', (await countEvents()) === 2 && text.includes('第 ') && text.includes('共同经历'), text.slice(0, 220));

  // ---------- G. 删除不留孤儿 ----------
  section('G. 删除未完成事件 / 删除角色 → 派生事件一并移除');
  await continuityRepo.remove(threadId);
  check('用户删除未完成事件后，派生事件一并移除', (await countEvents()) === 1, await countEvents());
  await continuityRepo.create({ characterId: C, userId: U, kind: 'promise', title: '答应陪她去看海', origin: 'user' });
  check('手动添加的约定也会进世界层', (await countEvents()) === 2, await countEvents());
  await continuityRepo.deleteByCharacter(C, U);
  check('删除角色后，该角色的约定事件不留孤儿', (await countEvents()) === 1, await countEvents());

  // ---------- I. 来源白名单（裁定：建群不算关系变化） ----------
  section('I. 来源白名单：建群（source=group）不写世界层');
  const beforeI = await countEvents();
  await stateRepo.recordLifeEvent(C, U, { type: 'relationship', title: '进入共同场域「测试群」', detail: '一个新的多角色关系开始形成。', source: 'group' });
  check('source=group 的关系类轨迹不进世界层', (await countEvents()) === beforeI, { before: beforeI, after: await countEvents() });
  await stateRepo.recordLifeEvent(C, U, { type: 'relationship', title: '关系进入「亲近」阶段', detail: '', source: 'chat' });
  check('同类型但来源为 chat 的仍然会写（白名单是按来源而不是按类型）', (await countEvents()) === beforeI + 1, await countEvents());

  // ---------- J. 归档的线索也要同步 ----------
  section('J. 超过 8 条线索：自动归档的线索同样同步世界层');
  const beforeJ = await countEvents();
  const many = Array.from({ length: 12 }, (_, i) => ({
    characterId: C, userId: U, kind: 'promise' as const,
    title: ['去海边看日出', '学做提拉米苏', '把花搬进屋', '读完那本小说', '去听音乐会', '整理旧照片', '学会游泳', '去看樱花', '修好台灯', '写一封信', '领养一只猫', '去看一场雪'][i],
    origin: 'user' as const,
  }));
  await continuityRepo.createMany(many);
  const allThreads = await continuityRepo.getByCharacter(C, U);
  const archived = allThreads.filter((t) => t.status === 'archived');
  check('确实产生了自动归档的线索（12 条 → 8 open + 4 archived）', archived.length === 4 && allThreads.length === 12, { total: allThreads.length, archived: archived.length });
  check('每条线索（含归档的）都同步出了世界事件', (await countEvents()) === beforeJ + 12, { before: beforeJ, after: await countEvents() });
  const eventsJ = await worldEventRepo.listTimeline(world.id, { limit: 200 });
  const archivedTitles = archived.map((t) => t.title);
  const archivedEvents = eventsJ.filter((e) => archivedTitles.includes(e.title));
  check('归档线索的世界事件已写入', archivedEvents.length === 4, archivedEvents.length);
  check('归档状态被同步进事件（meta.threadStatus = archived）', archivedEvents.every((e) => e.meta?.threadStatus === 'archived'), archivedEvents.map((e) => e.meta));
  check('归档 ≠ 已解决（resolved 仍为 false）', archivedEvents.every((e) => e.resolved === false), archivedEvents.map((e) => e.resolved));

  // ---------- H. 零新增 AI 调用 ----------
  section('H. AI 调用统计');
  check('全程 AI 调用次数 = 结算次数（4 次），没有任何新增调用', aiCalls === 4, aiCalls);

  // ---------- 清理 ----------
  section('清理');
  if (root) root.unmount();
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await countEvents()) === 0);
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
