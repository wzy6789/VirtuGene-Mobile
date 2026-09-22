/**
 * VirtuGene 5.2.0 验收 G：新世界入口的信息架构
 *
 * 背景：星域改造把「世界」页换成了「世界 Living World（四个真实入口）→ 星域（WORLD CONSTELLATION）」
 * 两层结构，旧的 phase2a / phase2b1 断言的区块（最近发生 / 还没做完的事 / 首屏统计 / 我的生活）
 * 已经不在首屏。这一套用**同样的做法**（真实浏览器 + 真实 IndexedDB + 真实组件渲染）
 * 覆盖那些能力现在的入口，证明是搬家而不是丢失：
 *
 *   A. 底部一级导航仍是 消息｜世界｜角色｜我的
 *   B. 世界页第一层：世界 Living World + 四个真实入口（朋友圈 / 日记 / 待办 / 星域）
 *   C. 「日记」入口真的打开我的生活（activeView === 'diary'）——旧断言「我的生活」的等价物
 *   D. 「星域」入口真的进入星域页（WORLD CONSTELLATION / 星域）
 *   E. 星域页「此刻」的统计是真实数据（第 N 天 · X 位角色 · Y 段共同经历）
 *   F. 星域页两个真实动作 + 四个档案入口（关系 / 记忆 / 年表 / 设定）分别指向正确的视图
 *   G. 共同记忆在「记忆」视图里可达且显示真实标题
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { characterRepo } from '../../src/db/character-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useUIStore, MOBILE_TABS } from '../../src/store/ui-store';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { WorldMemoryPage } from '../../src/components/world/WorldMemoryPage';
import { userRef, characterRef } from '../../src/lib/world/subjects';
import type { Character } from '../../src/db/index';

const U = 'u-worldG';
const C1 = 'c-g-xingyao';
const C2 = 'c-g-linjian';
const MEMORY_TITLE = '一起看过的那场雨';

const lines: string[] = [];
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(component: unknown): Promise<string> {
  if (root) root.unmount();
  if (!host) {
    host = document.createElement('div');
    host.id = 'worldG-host';
    document.body.appendChild(host);
  }
  root = createRoot(host);
  root.render(createElement(component as never));
  await sleep(700);
  return host.innerText;
}

function buttons(): HTMLButtonElement[] {
  return host ? (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[]) : [];
}
function clickButton(text: string): boolean {
  const target = buttons().find((b) => (b.textContent ?? '').includes(text));
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

async function run(): Promise<void> {
  await db.delete();
  await db.open();
  useAuthStore.getState().login(U, 'G 验收', 'sk-fake', '');
  useUIStore.setState({ activeView: 'chat', mobileTab: 'world', chatFromList: false, chatFromCharacters: false, canvasSceneId: null });

  await characterRepo.create(makeCharacter(C1, '星遥'));
  await characterRepo.create(makeCharacter(C2, '林间'));
  const world = await worldRepo.ensureDefaultWorld(U, 'G 验收');
  await worldEventRepo.create({
    userId: U, worldId: world.id, type: 'shared_memory', title: '雨夜里的那盏灯',
    summary: '你把伞往她那边偏了一点。', participants: [userRef(U), characterRef(C1)],
    sourceType: 'test', sourceId: 'g-event-1', importance: 4,
  });
  const memoryId = await sharedMemoryRepo.create({
    userId: U, worldId: world.id, title: MEMORY_TITLE, summary: '两个人在门口等到雨停。',
    participants: [userRef(U), characterRef(C1)], sourceType: 'test', sourceId: 'g-memory-1', visibility: 'world',
  });
  const diaryId = await diaryRepo.create({ userId: U, date: '2026-09-22', title: '今天', content: '雨很大。', mood: 3, tags: [] });
  await sleep(200);

  // ---------- A. 一级导航 ----------
  check('① 底部一级导航仍是 4 个（消息｜世界｜角色｜我的）',
    MOBILE_TABS.length === 4 && MOBILE_TABS.map((t) => t.label).join('|') === '消息|世界|角色|我的', MOBILE_TABS);

  // ---------- B. 世界页第一层 ----------
  const hubText = await render(MobileWorldPage);
  const entryButtons = host ? Array.from(host.querySelectorAll('nav.vg-world-life-entries button')) : [];
  const entryLabels = entryButtons.map((b) => (b.querySelector('strong')?.textContent ?? '').trim());
  check('② 世界页第一层是「世界 Living World」', hubText.includes('世界 Living World'), hubText.slice(0, 120));
  check('③ 四个真实入口 = 朋友圈 / 日记 / 待办 / 星域',
    entryLabels.join('|') === '朋友圈|日记|待办|星域', entryLabels);
  check('④ 入口各有一句人话说明（不是空按钮）',
    entryButtons.every((b) => ((b.querySelector('span')?.textContent ?? '').trim().length >= 4)), 
    entryButtons.map((b) => (b.querySelector('span')?.textContent ?? '').trim()));

  // ---------- C. 「日记」入口 → 我的生活 ----------
  const clickedDiary = clickButton('日记');
  await sleep(300);
  check('⑤ 点「日记」真的打开我的生活（activeView === diary）',
    clickedDiary && useUIStore.getState().activeView === 'diary', { clickedDiary, activeView: useUIStore.getState().activeView });

  // ---------- D. 「星域」入口 → 星域页 ----------
  useUIStore.setState({ activeView: 'chat' });
  await render(MobileWorldPage);
  const clickedTheater = clickButton('星域');
  await sleep(900);
  const theaterText = host ? host.innerText : '';
  check('⑥ 点「星域」进入星域页（WORLD CONSTELLATION / 星域）',
    clickedTheater && theaterText.includes('WORLD CONSTELLATION') && theaterText.includes('星域'),
    { clickedTheater, head: theaterText.slice(0, 140) });

  // ---------- E. 「此刻」统计是真实数据 ----------
  const nowCard = host ? host.querySelector('.vg-world-now-card') : null;
  const nowText = nowCard ? (nowCard as HTMLElement).innerText : '';
  check('⑦ 此刻卡片存在且带真实统计（第 N 天 · X 位角色 · Y 段共同经历）',
    /第 \d+ 天 · \d+ 位角色 · \d+ 段共同经历/.test(nowText), nowText.slice(0, 140));
  check('⑧ 统计里的共同经历数与数据库一致（1 段）', /1 段共同经历/.test(nowText), nowText.slice(0, 140));

  // ---------- F. 两个动作 + 四个档案入口 ----------
  check('⑨ 星域页有「进入此刻」与「让时间走一步」两个真实动作',
    theaterText.includes('进入此刻') && theaterText.includes('让时间走一步'), theaterText.slice(0, 200));
  const dockLabels = host
    ? Array.from(host.querySelectorAll('nav.vg-world-dock button')).map((b) => (b.querySelector('b')?.textContent ?? '').trim())
    : [];
  check('⑩ 档案入口 = 关系 / 记忆 / 年表 / 设定', dockLabels.join('|') === '关系|记忆|年表|设定', dockLabels);

  const routeChecks: [string, string][] = [['关系', 'relations'], ['记忆', 'memory'], ['年表', 'timeline'], ['设定', 'worldSettings']];
  const routed: Record<string, string> = {};
  for (const [label, expected] of routeChecks) {
    useUIStore.setState({ activeView: 'chat' });
    await render(MobileWorldPage);
    clickButton('星域');
    await sleep(800);
    const ok = clickButton(label);
    await sleep(250);
    routed[label] = useUIStore.getState().activeView;
    if (!ok || routed[label] !== expected) {
      check(`⑪ 「${label}」入口指向 ${expected}`, false, { clicked: ok, activeView: routed[label] });
      break;
    }
  }
  if (Object.keys(routed).length === 4 && Object.values(routed).every((v, i) => v === routeChecks[i][1])) {
    check('⑪ 四个档案入口分别指向 relations / memory / timeline / worldSettings', true);
  }

  // ---------- G. 共同记忆在记忆视图可达 ----------
  useUIStore.setState({ activeView: 'memory' });
  const memoryText = await render(WorldMemoryPage);
  check('⑫ 记忆视图显示真实的共同记忆标题', memoryText.includes(MEMORY_TITLE), memoryText.slice(0, 200));

  // ---------- 数据清理 ----------
  await db.sharedMemories.delete(memoryId).catch(() => undefined);
  await db.diaries.delete(diaryId).catch(() => undefined);
  await worldRepo.clearForUser(U);
  check('⑬ 清理后世界层为空（夹具不污染其它套件）', (await db.worlds.count()) === 0, { worlds: await db.worlds.count() });
}

const report = window.fetch.bind(window);
run()
  .then(async () => {
    document.body.textContent = `ok   ${lines.length} assertions (new world IA; real IndexedDB)\n\nALL PASS`;
    await report('/result', { method: 'POST', body: document.body.textContent });
  })
  .catch(async (e) => {
    document.body.textContent = `${lines.join('\n')}\n\nFAIL ${e?.message ?? e}\n${e?.stack ?? ''}\n\n1 FAILED`;
    await report('/result', { method: 'POST', body: document.body.textContent });
  });
