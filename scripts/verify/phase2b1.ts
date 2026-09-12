/**
 * VirtuGene 5.0.0 Phase 2b-1 验收：世界首页接上真实内容
 *
 * 覆盖：
 *  P. 挑选逻辑（纯函数）：逾期 > 临近 > 最近提起；没有就返回 null
 *  A. 「正在等待你的故事」大卡：真实线索 + 参与者 + 类别 + 真实动作
 *  B. 「继续这件事」真的进入与该角色的聊天（selectCharacter + 切到消息 tab + 推入语义）
 *  C. 「未完成的故事」列出其余真实线索；点进去打开 4.x 既有面板
 *  D. 「最近发生」语义化：人话类别 + 相对时间（今天/昨天），且**不出现任何内部数值**
 *  E. 没有等着继续的事时，大卡整块隐藏（不放假内容）
 *  F. 世界页仍不产生任何 AI 调用（全程 0 次）
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { continuityRepo } from '../../src/db/continuity-repo';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { webApi } from '../../src/lib/web-api';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { pickWaitingStory, relativeDay } from '../../src/lib/world/world-picks';
import type { Character, ContinuityThread, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-2b1';
const C1 = 'c-xingyao';
const C2 = 'c-linjian';
const NOW = Date.now();
const DAY = 86_400_000;

const lines: string[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let aiCalls = 0;
function stubAi() {
  (webApi.context as unknown as { settle: () => Promise<never> }).settle = async () => {
    aiCalls += 1;
    throw new Error('harness: 世界页不应该发起任何 AI 调用');
  };
  (webApi.chat as unknown as { send: () => Promise<never> }).send = async () => {
    aiCalls += 1;
    throw new Error('harness: 世界页不应该发起任何 AI 调用');
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
async function render(): Promise<string> {
  if (root) root.unmount();
  if (!host) {
    host = document.createElement('div');
    host.id = 'world-host-2b1';
    document.body.appendChild(host);
  }
  root = createRoot(host);
  root.render(createElement(MobileWorldPage));
  await sleep(750);
  return host.innerText;
}

function threadAt(partial: Partial<ContinuityThread> & { id: string; kind: ContinuityThread['kind']; title: string }): ContinuityThread {
  return {
    characterId: C1, userId: U, status: 'open', createdAt: NOW, updatedAt: NOW, origin: 'user', ...partial,
  };
}

async function run() {
  await Dexie.delete(DB);
  await db.open();

  // ---------- P. 纯函数：挑选规则 ----------
  section('P. 挑选规则（纯函数 pickWaitingStory / relativeDay）');
  check('没有线索 → null', pickWaitingStory([], NOW) === null);
  check('只有已完成的线索 → null', pickWaitingStory([threadAt({ id: 'x', kind: 'plan', title: 'A', status: 'done' })], NOW) === null);
  const overdue = threadAt({ id: 't-over', kind: 'plan', title: '逾期的事', dueAt: NOW - 3 * DAY });
  const soon = threadAt({ id: 't-soon', kind: 'promise', title: '明天的事', dueAt: NOW + DAY });
  const late = threadAt({ id: 't-late', kind: 'topic', title: '下周的事', dueAt: NOW + 7 * DAY });
  const noDue = threadAt({ id: 't-none', kind: 'plan', title: '没有时间的事' });
  check('逾期优先于临近', pickWaitingStory([soon, overdue], NOW)?.id === 't-over');
  check('逾期里最久的优先', pickWaitingStory([threadAt({ id: 't-over2', kind: 'plan', title: 'B', dueAt: NOW - DAY }), overdue], NOW)?.id === 't-over');
  check('没有逾期时，最近到期的优先', pickWaitingStory([late, soon, noDue], NOW)?.id === 't-soon');
  check('都没有约定时间时，最近提起的优先', pickWaitingStory([{ ...noDue, id: 't-old', updatedAt: NOW - 5 * DAY }, noDue], NOW)?.id === 't-none');
  check('相对时间：今天 / 昨天 / N 天前 / 具体日期', relativeDay(NOW, NOW) === '今天' && relativeDay(NOW - DAY, NOW) === '昨天' && relativeDay(NOW - 3 * DAY, NOW) === '3 天前' && relativeDay(NOW - 30 * DAY, NOW).includes('月'), {
    today: relativeDay(NOW, NOW), y: relativeDay(NOW - DAY, NOW), d3: relativeDay(NOW - 3 * DAY, NOW), d30: relativeDay(NOW - 30 * DAY, NOW),
  });

  // ---------- 数据准备 ----------
  await db.users.put({ id: U, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: NOW });
  const chars: Character[] = [C1, C2].map((id, i) => ({
    id, name: i === 0 ? '星遥' : '林间', avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: NOW, proactivity: 0.5, signature: '', greeting: '',
  }));
  for (const c of chars) await characterRepo.create(c);
  const session: Session = { id: 's-2b1', characterId: C1, userId: U, title: '新对话', createdAt: NOW, updatedAt: NOW, unreadCount: 0 };
  await sessionRepo.create(session);

  useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  stubAi();
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');

  // ---------- E. 没有等着继续的事：大卡隐藏 ----------
  section('E. 没有任何未完成事件时，大卡不出现');
  await worldEventRepo.create({
    userId: U, worldId: world.id, type: 'relationship', title: '关系进入「熟悉」阶段', summary: '',
    participants: [`u:${U}`, `c:${C1}`], sourceType: 'test', sourceId: 'ev-rel', importance: 0.7,
  });
  let text = await render();
  check('有事件、没有未完成事 → 不出现「正在等待你的故事」', !text.includes('正在等待你的故事'), text.slice(0, 200));
  check('仍显示世界已经开始', text.includes('你的世界已经开始'));

  // ---------- A/B/C/D. 有线索 ----------
  section('A/B/C/D. 有真实未完成事件时的世界首页');
  await continuityRepo.create({ characterId: C1, userId: U, kind: 'promise', title: '答应陪她去看海', detail: '你们说好等忙完这一阵就去。', dueAt: NOW - 2 * DAY, origin: 'user' });
  await continuityRepo.create({ characterId: C2, userId: U, kind: 'conflict', title: '那次没有说开的争执', origin: 'user' });
  await continuityRepo.create({ characterId: C2, userId: U, kind: 'topic', title: '没聊完的那本书', origin: 'user' });

  text = await render();
  check('出现第一视觉核心「正在等待你的故事」', text.includes('正在等待你的故事'));
  check('大卡显示的是逾期那条（真实挑选结果）', text.includes('答应陪她去看海'), text.slice(0, 260));
  check('大卡显示参与者与类别', text.includes('星遥') && text.includes('· 你') && text.includes('承诺'), text.slice(0, 260));
  check('大卡显示真实细节', text.includes('你们说好等忙完这一阵就去。'));
  check('大卡给出真实动作', text.includes('继续这件事'));
  check('「未完成的故事」区块列出其余线索', text.includes('未完成的故事') && text.includes('那次没有说开的争执') && text.includes('没聊完的那本书'));
  check('大卡那条不在列表里重复出现', text.split('答应陪她去看海').length - 1 === 1, text.split('答应陪她去看海').length - 1);
  check('区块计数是"其余件数"（3 条线索 → 大卡 1 条 + 其余 2 件）', text.includes('2 件'), text.slice(0, 300));
  check('最近发生用相对时间（今天）', text.includes('今天'));
  check('最近发生用人话类别', text.includes('你们之间的关系'));
  check('不暴露任何内部数值字段', !/trust|affinity|conflict|familiarity|\+[0-9]|-[0-9]/.test(text), text.slice(0, 300));

  // ---------- B. 「继续这件事」 ----------
  section('B. 「继续这件事」真的进入与该角色的聊天');
  useUIStore.getState().setMobileTab('me');
  useUIStore.getState().setChatFromList(false);
  const btn = Array.from(host!.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('继续这件事'));
  check('按钮存在', !!btn);
  btn?.click();
  await sleep(120);
  const chat = useChatStore.getState();
  const ui = useUIStore.getState();
  check('选中了该线索所属角色', chat.selectedCharacterId === C1, chat.selectedCharacterId);
  check('切到「消息」tab 且是推入语义（返回回到会话列表）', ui.mobileTab === 'chat' && ui.chatFromList === true, { tab: ui.mobileTab, fromList: ui.chatFromList });

  // ---------- C. 点线索打开 4.x 面板 ----------
  section('C. 点「未完成的故事」条目打开既有面板');
  useUIStore.getState().setMobileTab('world');
  text = await render();
  const row = Array.from(host!.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('没聊完的那本书'));
  check('线索行存在', !!row);
  row?.click();
  await sleep(600);
  // 弹窗通过 portal 挂到 document.body，所以要读 body 而不是 host
  const modalText = document.body.innerText;
  check('打开了该角色的「还没做完的事」面板', modalText.includes('还没做完的事'), modalText.slice(0, 300));
  check('面板里能看到该角色的线索', modalText.includes('没聊完的那本书'), modalText.slice(0, 400));

  // ---------- G. 只有一条线索时：区块整块隐藏（审核发现的展示瑕疵） ----------
  section('G. 只有一条未完成事项时，「未完成的故事」区块不应出现');
  useUIStore.getState().setMobileTab('world');
  const allOpen = await continuityRepo.getOpenByUser(U);
  for (const t of allOpen) {
    if (t.title !== '答应陪她去看海') await continuityRepo.remove(t.id);
  }
  check('现在只剩 1 条线索', (await continuityRepo.getOpenByUser(U)).length === 1);
  text = await render();
  check('大卡仍然展示这条线索', text.includes('正在等待你的故事') && text.includes('答应陪她去看海'), text.slice(0, 200));
  check('不再出现空的「未完成的故事」区块', !text.includes('未完成的故事'), text.slice(0, 300));
  check('不再出现"1 件"这种自相矛盾的计数', !text.includes('1 件'), text.slice(0, 300));

  // ---------- F. 零 AI 调用 ----------
  section('F. 世界页不产生任何 AI 调用');
  check('全程 AI 调用次数 = 0', aiCalls === 0, aiCalls);

  section('清理');
  if (root) root.unmount();
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
    void fetch('/result', { method: 'POST', body: text }).catch(() => undefined);
  });
