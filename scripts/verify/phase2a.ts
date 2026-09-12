/**
 * VirtuGene 5.0.0 Phase 2a 验收：世界入口 + 真实空状态
 *
 * 做法：真实浏览器 + 真实 IndexedDB + **真实渲染组件**（React createRoot），
 * 断言 DOM 文案与交互结果，而不是靠肉眼。
 *
 * 覆盖：
 *  A. 底部一级导航 = 消息｜世界｜角色｜我的（4 个，无手账 tab）
 *  B. 空世界 → 真实空状态文案 + 两个真实动作
 *  C. 「写下今天」/「我的生活」→ 真的打开我的生活（activeView === 'diary'）
 *  D. 世界有数据（迁移/运行期产生）→ 空状态消失，显示真实事件与计数
 *  E. 新建日记默认 private（世界可见性不继承旧的全局开关）
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { continuityRepo } from '../../src/db/continuity-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { characterRepo } from '../../src/db/character-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore, MOBILE_TABS } from '../../src/store/ui-store';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { MobileLayout } from '../../src/components/layout/MobileLayout';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import type { Character, WorldEvent } from '../../src/db/index';

const U = 'u-phase2a';
const C1 = 'c-xingyao';
const C2 = 'c-linjian';
const lines: string[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/** 渲染世界页并等待其异步数据加载完成（真实 DB 查询） */
async function renderWorldPage(): Promise<string> {
  if (root) root.unmount();
  if (!host) {
    host = document.createElement('div');
    host.id = 'world-host';
    document.body.appendChild(host);
  }
  root = createRoot(host);
  root.render(createElement(MobileWorldPage));
  await sleep(600);
  return host.innerText;
}

/**
 * 取某个区块的**列表正文**：先按区块标题定位，再取标题之后同 section 内第一个 <ul>。
 * 这样断言就被限制在该区块内，不会因为区块顺序变化（例如「未完成的故事」紧跟其后）
 * 而误判成"最近发生里出现了未完成事项"。
 */
function blockText(label: string): string {
  if (!host) return '';
  const labelEl = Array.from(host.querySelectorAll('p')).find((p) => (p.textContent ?? '').trim() === label);
  if (!labelEl) return '';
  const scope: HTMLElement = labelEl.closest('section') ?? host;
  const list = Array.from(scope.querySelectorAll('ul')).find(
    (ul) => (labelEl.compareDocumentPosition(ul) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  return list ? (list as HTMLElement).innerText : '';
}

function clickByText(text: string): boolean {
  if (!host) return false;
  const buttons = Array.from(host.querySelectorAll('button'));
  const target = buttons.find((b) => (b.textContent ?? '').includes(text));
  if (!target) return false;
  target.click();
  return true;
}

function makeCharacter(id: string, name: string): Character {
  return {
    id, name, avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
  };
}

async function run() {
  // ---------- A. 一级导航 ----------
  section('A. 底部一级导航');
  check('一级导航正好 4 个', MOBILE_TABS.length === 4, MOBILE_TABS);
  check('顺序与文案 = 消息｜世界｜角色｜我的',
    MOBILE_TABS.map((t) => t.key).join(',') === 'chat,world,characters,me' &&
    MOBILE_TABS.map((t) => t.label).join('|') === '消息|世界|角色|我的',
    MOBILE_TABS);
  check('手账不再是底部 tab', !MOBILE_TABS.some((t) => (t.key as string) === 'diary'));

  // ---------- 准备数据 ----------
  await db.open();
  await db.users.put({ id: U, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: Date.now() });
  await characterRepo.create(makeCharacter(C1, '星遥'));
  await characterRepo.create(makeCharacter(C2, '林间'));
  useAuthStore.setState({ userId: U, username: '智毅', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  useUIStore.getState().setActiveView('chat');
  useUIStore.getState().setMobileTab('world');

  // ---------- B. 真实空状态 ----------
  section('B. 真实空状态（世界层确实还没有记录）');
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');
  check('世界页会创建/取回默认世界（幂等）', world.isDefault === true && (await db.worlds.count()) === 1, world);
  check('此时世界事件为 0', (await worldEventRepo.countByWorld(world.id)) === 0);

  let text = await renderWorldPage();
  check('显示问候语（真实用户名）', text.includes('智毅') && text.includes('欢迎回到你的世界。'), text.slice(0, 120));
  check('显示弱化统计（角色数 / 天数 / 共同记忆）', text.includes('2 个角色') && text.includes('第 1 天') && text.includes('0 段共同记忆'));
  check('显示真实空状态文案', text.includes('你的世界还没有开始'));
  check('空状态给出两个真实动作', text.includes('去和一个角色说说话') && text.includes('写下今天'));
  check('空状态下不出现"最近发生"', !text.includes('最近发生'));
  check('始终提供「我的生活」入口', text.includes('我的生活') && text.includes('默认只有你自己知道'));
  // 2a 修正：空状态**不得**承诺"聊天/写日记就会在这里留下痕迹"（当前还没有生产写入路径）
  check('空状态不再承诺尚未实现的自动记录', !text.includes('都会在这里留下痕迹') && !text.includes('留下痕迹'), text);
  // 2b-0 之后：文案只列**已经真的会写入**的两类来源，世界剧场明确是"往后"
  check('空状态如实说明写入来源（约定 / 关系变化）', text.includes('约定') && text.includes('关系发生的变化'), text);

  // ---------- C. 入口真的能用 ----------
  section('C. 交互：我的生活入口');
  check('「写下今天」按钮存在并可点击', clickByText('写下今天'));
  await sleep(50);
  check('点击后真的打开了我的生活（activeView = diary）', useUIStore.getState().activeView === 'diary', useUIStore.getState().activeView);
  // 回到世界（模拟点底部一级导航）
  useUIStore.getState().setActiveView('chat');
  check('回到世界后 activeView 复位', useUIStore.getState().activeView === 'chat');

  // ---------- D. 世界有数据 ----------
  section('D. 世界已经发生事情（真实数据）');
  // 2b-1 起的新规则：**未结束的未完成事项**由大卡与「未完成的故事」区块承担，
  // 不再出现在「最近发生」里（避免同一件事在同一屏出现两次）。
  // 因此这里用真实线索（会同时派生世界事件）+ 一条已解决的关系变化来覆盖两个区块。
  await continuityRepo.create({ characterId: C1, userId: U, kind: 'plan', title: '周末一起去看电影', detail: '你们说好这周末去。', origin: 'user' });
  // 第二条线索：2b-1 起「未完成的故事」区块只列"其余事项"，只有一条时整块隐藏，
  // 所以这里给两条，才能覆盖该区块（大卡 1 条 + 区块 1 条）
  await continuityRepo.create({ characterId: C2, userId: U, kind: 'promise', title: '答应给林间带一本书', origin: 'user' });
  await worldEventRepo.create({
    userId: U, worldId: world.id, type: 'relationship', title: '关系进入「熟悉」阶段', summary: '你们聊得越来越多。',
    participants: [userRef(U), characterRef(C1)], sourceType: 'test', sourceId: 'ev-relationship', importance: 0.7, resolved: true,
  });
  await sharedMemoryRepo.create({
    userId: U, worldId: world.id, title: '没有一起离开的那个晚上', summary: '深夜天台上，你没有走。',
    participants: [userRef(U), characterRef(C1), characterRef(C2)], sourceType: 'stage', sourceId: 'scene-demo-1',
    visibility: 'world', importance: 0.9,
  });

  text = await renderWorldPage();
  check('空状态消失', !text.includes('你的世界还没有开始'));
  check('显示真实事件条数', /已经记下了 \d+ 件事/.test(text), text.slice(0, 200));
  check('显示「最近发生」与真实事件标题', text.includes('最近发生') && text.includes('关系进入「熟悉」阶段'));
  check('事件类型标签正确（relationship → 你们之间的关系）', text.includes('你们之间的关系'));
  // 断言限定在「最近发生」自己的列表里；未结束的线索由大卡 +「未完成的故事」承担
  const recentBlock = blockText('最近发生');
  const restBlock = blockText('未完成的故事');
  check('未结束的未完成事项不作为"最近发生"重复出现',
    recentBlock.length > 0 && !recentBlock.includes('周末一起去看电影'), recentBlock);
  check('未结束的线索确实由「未完成的故事」区块承担（正面控制）',
    restBlock.includes('周末一起去看电影'), restBlock);
  check('共同记忆计入弱化统计', text.includes('1 段共同记忆'));
  check('未完成的事会给出数量提示', text.includes('还有') && text.includes('件没说清'));
  check('有事件 + 有记忆时同时展示两个区块', text.includes('最近发生') && text.includes('共同记忆') && text.includes('没有一起离开的那个晚上'));

  // ---------- D2. 只有共同记忆（审核发现的矛盾场景） ----------
  section('D2. 只有共同记忆、没有任何世界事件');
  await db.worldEvents.clear(); // 只清事件，留下共同记忆
  text = await renderWorldPage();
  check('空状态不出现（因为确实有共同记忆）', !text.includes('你的世界还没有开始'));
  check('不再出现自相矛盾的"已经记下了 0 件事"', !text.includes('已经记下了 0 件事'), text.slice(0, 220));
  check('改为按真实数据描述（已经留下了 N 段共同记忆）', text.includes('已经留下了 1 段共同记忆'), text.slice(0, 220));
  check('不渲染空的「最近发生」区块', !text.includes('最近发生'));
  check('单独渲染「共同记忆」区块并列出真实标题', text.includes('共同记忆') && text.includes('没有一起离开的那个晚上'));

  // ---------- D3. 读取失败 ≠ 空世界 ----------
  section('D3. 数据库读取失败时给出错误态（不是"空世界"）');
  const originalList = worldEventRepo.listTimeline;
  (worldEventRepo as unknown as { listTimeline: typeof originalList }).listTimeline = () => {
    throw new Error('fault-injection: world read failed');
  };
  text = await renderWorldPage();
  check('显示"世界读取失败"而不是空状态', text.includes('世界读取失败') && !text.includes('你的世界还没有开始'), text.slice(0, 200));
  check('提供真实的重试按钮', text.includes('重新读取'));
  (worldEventRepo as unknown as { listTimeline: typeof originalList }).listTimeline = originalList;
  text = await renderWorldPage();
  check('恢复后重新读取成功（回到真实数据）', text.includes('共同记忆') && !text.includes('世界读取失败'));

  // ---------- E. 日记默认私密 ----------
  section('E. 我的生活：新建日记默认 private');
  const diaryId = await diaryRepo.create({ userId: U, date: '2026-09-12', title: '', content: '今天第一次参加课题组讨论，有点紧张。', mood: 3, tags: [] });
  const diary = (await diaryRepo.getById(diaryId))!;
  check('新建日记 visibility = private', diary.visibility === 'private', diary.visibility);
  check('新建日记 visibleTo 为空数组', Array.isArray(diary.visibleTo) && diary.visibleTo.length === 0, diary.visibleTo);
  check('任何角色都看不到它', (await diaryRepo.listVisibleFor(C1, U)).length === 0);

  // ---------- F. 外壳回归：四个一级 tab + 我的生活覆盖页 ----------
  section('F. 外壳回归（切 tab 不崩、旧路径可达、手账不会"进得去出不来"）');
  const errors: string[] = [];
  const onError = (e: ErrorEvent) => errors.push(String(e.message));
  window.addEventListener('error', onError);
  const navHost = document.createElement('div');
  Object.assign(navHost.style, { position: 'fixed', inset: '0', overflow: 'hidden' });
  document.body.appendChild(navHost);
  const navRoot = createRoot(navHost);
  navRoot.render(createElement(MobileLayout));
  await sleep(900);

  const navButtons = () => Array.from(navHost.querySelectorAll('nav button'));
  check('底部导航渲染出 4 个一级入口', navButtons().length === 4, navButtons().map((b) => b.textContent));
  check('导航文案 = 消息/世界/角色/我的', navButtons().map((b) => (b.textContent ?? '').trim()).join('|').includes('消息'), navButtons().map((b) => (b.textContent ?? '').trim()));

  const sweep: { tab: 'chat' | 'world' | 'characters' | 'me'; marker: string }[] = [
    { tab: 'chat', marker: '对话，有了以后。' },
    { tab: 'world', marker: '欢迎回到你的世界。' },
    { tab: 'characters', marker: '我的角色宇宙' },
    { tab: 'me', marker: '我的生命空间' },
  ];
  for (const item of sweep) {
    useUIStore.getState().setMobileTab(item.tab);
    await sleep(500);
    check(`切到「${item.tab}」渲染正常（含标记文案）`, navHost.innerText.includes(item.marker), navHost.innerText.slice(0, 160));
  }

  // 我的生活（手账）覆盖页：从世界进入，底部导航必须仍在（不隐藏 → 用户点任意 tab 都能出来）
  useUIStore.getState().setMobileTab('world');
  await sleep(200);
  useUIStore.getState().setActiveView('diary');
  await sleep(900);
  check('我的生活覆盖页渲染正常', navHost.innerText.includes('我的手账'), navHost.innerText.slice(0, 160));
  check('覆盖页打开时底部导航仍可见（4 个入口）', navButtons().length === 4, navButtons().length);
  check('覆盖页打开时高亮「世界」', navButtons()[1]?.getAttribute('aria-current') === 'page', navButtons().map((b) => b.getAttribute('aria-current')));
  // 点一级导航应退出覆盖页（手机端不会出现"进去了出不来"）
  navButtons()[0]?.click();
  await sleep(500);
  check('点「消息」后退出我的生活并回到会话列表', useUIStore.getState().activeView === 'chat' && navHost.innerText.includes('对话，有了以后。'), {
    activeView: useUIStore.getState().activeView,
    text: navHost.innerText.slice(0, 120),
  });
  check('整个过程没有未捕获错误', errors.length === 0, errors);

  // ---------- 清理 ----------
  section('清理');
  navRoot.unmount();
  window.removeEventListener('error', onError);
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await db.worlds.count()) === 0 && (await db.worldEvents.count()) === 0);
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
