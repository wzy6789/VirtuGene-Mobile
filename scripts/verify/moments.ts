/**
 * VirtuGene 5.1.4 验收：朋友圈的信息架构改动
 *
 * 背景：朋友圈原来把「互动」和「◌ 屏蔽」都堆在右上角，与页面主体（名片 → 动态流）割裂。
 * 这一轮改成微信朋友圈的做法：
 *
 *   A. 右上角只留「＋ 发布」与「⋯ 朋友圈设置」
 *   B. 「⋯」里的两项 = 朋友圈屏蔽 / 默认可见范围（屏蔽从右上角独立图标搬进设置）
 *   C. 互动入口常驻在「名片」之下、「动态流」之上，带最近互动者头像 / 未读数 / 红点
 *   D. 默认可见范围真的持久化，并且下一次打开发布面板时默认选中它
 *   E. 屏蔽仍然可用，只是入口换了地方
 *
 * 做法与 worldG 一致：真实浏览器 + 真实 IndexedDB + 真实组件渲染，断言的是**行为**（点得开、
 * 存得下、下次生效），不是类名快照。
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { db } from '../../src/db/index';
import { momentsRepo } from '../../src/db/moments-repo';
import { characterRepo } from '../../src/db/character-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { MomentsPage } from '../../src/components/moments/MomentsPage';
import { AUDIENCE_MODE_LABELS, AUDIENCE_MODES } from '../../src/lib/moments/preferences';
import type { Character } from '../../src/db/index';

const U = 'u-momentsA';
const USERNAME = '朋友圈验收';
const C1 = 'c-ma-xingyao';
const C2 = 'c-ma-linjian';
const PREF_KEY = `virtugene-moments-audience:${U}`;

const lines: string[] = [];
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(): Promise<string> {
  if (root) root.unmount();
  if (!host) {
    host = document.createElement('div');
    host.id = 'momentsA-host';
    document.body.appendChild(host);
  }
  root = createRoot(host);
  root.render(createElement(MomentsPage));
  await sleep(900);
  return host.innerText;
}

function buttons(): HTMLButtonElement[] {
  return host ? (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[]) : [];
}
function buttonWith(text: string, scope?: ParentNode | null): HTMLButtonElement | undefined {
  const list = scope ? Array.from((scope as HTMLElement).querySelectorAll('button')) : buttons();
  return (list as HTMLButtonElement[]).find((b) => (b.textContent ?? '').trim().includes(text));
}
function clickText(text: string, scope?: ParentNode | null): boolean {
  const target = buttonWith(text, scope);
  if (!target) return false;
  target.click();
  return true;
}
function readPref(): { mode?: string; contactIds?: string[] } | null {
  const raw = localStorage.getItem(PREF_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { mode?: string; contactIds?: string[] };
  } catch {
    return null;
  }
}
function makeCharacter(id: string, name: string): Character {
  return {
    id, name, avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
  };
}
/** 当前打开的面板（sheet）标题，没有面板时返回空串 */
function openSheetTitle(): string {
  const sheet = host?.querySelector('.vg-moment-sheet');
  if (!sheet) return '';
  return (sheet.querySelector('header strong')?.textContent ?? '').trim();
}

async function run(): Promise<void> {
  await db.delete();
  await db.open();
  localStorage.removeItem(PREF_KEY);
  useAuthStore.getState().login(U, USERNAME, 'sk-fake', '');

  const char1 = makeCharacter(C1, '星遥');
  const char2 = makeCharacter(C2, '林间');
  await characterRepo.create(char1);
  await characterRepo.create(char2);
  const first = await momentsRepo.create(U, '雨停之前，把伞留在了门口。', { visibility: 'all', characterIds: [C1, C2] });
  await momentsRepo.create(U, '今天的风很轻。', { visibility: 'all', characterIds: [C1, C2] });

  // 让互动条有内容：直接写库、形状与 moments-repo.ts:248-249 完全一致
  // （不走 requestCharacterLike 是为了不把 UI 断言押在亲密度随机数上）。
  const now = Date.now();
  await db.momentReactions.put({ id: `moment-like:${first.id}:${C1}`, userId: U, momentId: first.id, characterId: C1, type: 'like', status: 'active', createdAt: now, updatedAt: now });
  await db.momentReactions.put({ id: `moment-comment:${first.id}:${C2}`, userId: U, momentId: first.id, characterId: C2, type: 'comment', content: '这句话我记住了。', status: 'active', createdAt: now, updatedAt: now });
  await db.momentNotifications.put({ id: `moment-notice:like:${first.id}:${C1}`, userId: U, momentId: first.id, characterId: C1, type: 'like', preview: '星遥 点了赞', read: false, createdAt: now });
  await db.momentNotifications.put({ id: `moment-notice:comment:${first.id}:${C2}`, userId: U, momentId: first.id, characterId: C2, type: 'comment', preview: '林间 评论了你的动态：这句话我记住了。', read: false, createdAt: now + 1 });
  // 评论回复链：用户回复自己的评论（不该显示「我 回复 我」）+ 角色回复用户（该显示「林间 回复 我」）
  await db.momentReactions.put({ id: 'moment-comment:user-1', userId: U, momentId: first.id, type: 'comment', content: '甜是甜，就是酱油忘了买。', status: 'active', createdAt: now + 2, updatedAt: now + 2 });
  await db.momentReactions.put({ id: 'moment-comment:user-2', userId: U, momentId: first.id, type: 'comment', content: '下次记得买。', replyToId: 'moment-comment:user-1', status: 'active', createdAt: now + 3, updatedAt: now + 3 });
  await db.momentReactions.put({ id: `moment-comment:${first.id}:${C2}:reply`, userId: U, momentId: first.id, characterId: C2, type: 'comment', content: '双份牛肉不算奖励，算补偿。', replyToId: 'moment-comment:user-1', status: 'active', createdAt: now + 4, updatedAt: now + 4 });

  const pageText = await render();

  // ---------- A. 右上角只剩 ＋ 与 ⋯ ----------
  const headerActions = host?.querySelector('.vg-moments-header-actions') ?? null;
  const headerButtons = headerActions ? Array.from(headerActions.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()) : [];
  check('① 右上角只剩两个按钮（＋ 发布 与 ⋯ 设置）', headerButtons.length === 2 && headerButtons.includes('＋') && headerButtons.includes('⋯'), headerButtons);
  check('② 旧的「互动」「◌」按钮已从右上角移除',
    headerActions !== null && headerActions.querySelector('.vg-moments-unread') === null && headerActions.querySelector('.vg-moments-privacy') === null,
    headerActions ? headerActions.innerHTML.slice(0, 160) : null);
  const settingsButton = host?.querySelector('.vg-moments-settings') as HTMLButtonElement | null;
  check('③ ⋯ 按钮声明了菜单语义（aria-haspopup=menu、aria-label=朋友圈设置）',
    settingsButton?.getAttribute('aria-haspopup') === 'menu' && settingsButton?.getAttribute('aria-label') === '朋友圈设置',
    { haspopup: settingsButton?.getAttribute('aria-haspopup'), label: settingsButton?.getAttribute('aria-label') });

  // ---------- B. 菜单两项 ----------
  const openedMenu = clickText('⋯');
  await sleep(200);
  const menuItems = host ? Array.from(host.querySelectorAll('.vg-moments-settings-menu button')).map((b) => (b.textContent ?? '').trim()) : [];
  check('④ 点开 ⋯ 后菜单恰好两项：朋友圈屏蔽 / 默认可见范围',
    openedMenu && menuItems.join('|') === '朋友圈屏蔽|默认可见范围', menuItems);

  // ---------- C. 互动条：位置 + 常驻 + 未读 ----------
  const inbox = host?.querySelector('.vg-moments-inbox') ?? null;
  const profile = host?.querySelector('.vg-moments-profile') ?? null;
  const firstCard = host?.querySelector('.vg-moment-card') ?? null;
  check('⑤ 互动条常驻存在（.vg-moments-inbox）', inbox !== null);
  const orderOk = inbox !== null && profile !== null && firstCard !== null
    && (profile.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    && (inbox.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  check('⑥ 互动条位于「名片」之下、「动态流」之上', orderOk, {
    profileBeforeInbox: profile && inbox ? (profile.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : null,
    inboxBeforeCard: inbox && firstCard ? (inbox.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : null,
  });
  const inboxText = inbox ? (inbox as HTMLElement).innerText.replace(/\s+/g, ' ') : '';
  check('⑦ 有未读时显示「N 条新互动」并带红点',
    inboxText.includes('2 条新互动') && (inbox?.querySelector('.vg-moments-inbox-dot') ?? null) !== null, inboxText);
  const inboxAvatars = inbox ? inbox.querySelectorAll('.vg-moments-inbox-avatars > *').length : 0;
  check('⑧ 互动条显示最近互动者头像（去重后 2 个）', inboxAvatars === 2, { inboxAvatars, pageHead: pageText.slice(0, 80) });

  // ---------- C2. 点互动条 → 互动面板 + 未读清零 ----------
  if (inbox) (inbox as HTMLButtonElement).click();
  await sleep(500);
  check('⑨ 点互动条打开「互动消息」面板', openSheetTitle() === '互动消息', openSheetTitle());
  const unreadAfter = (await momentsRepo.unreadNotifications(U)).length;
  check('⑩ 打开后未读清零并落库', unreadAfter === 0, { unreadAfter });
  await render();

  // ---------- D. 默认可见范围 ----------
  clickText('⋯');
  await sleep(180);
  const openedAudience = clickText('默认可见范围', host?.querySelector('.vg-moments-settings-menu') ?? host);
  await sleep(400);
  const modeLabels = host ? Array.from(host.querySelectorAll('.vg-moment-audience-sheet .vg-moment-audience > div button')).map((b) => (b.textContent ?? '').trim()) : [];
  check('⑪ 打开「默认可见范围」面板，四个范围文案与发布面板一致',
    openedAudience && openSheetTitle() === '默认可见范围' && modeLabels.join('|') === AUDIENCE_MODES.map((m) => AUDIENCE_MODE_LABELS[m]).join('|'),
    { openedAudience, title: openSheetTitle(), modeLabels });

  const audienceSheet = host?.querySelector('.vg-moment-audience-sheet') ?? null;
  const pickedPrivate = clickText('仅自己', audienceSheet);
  await sleep(150);
  const saved = clickText('保存默认范围', audienceSheet);
  await sleep(400);
  const pref = readPref();
  check('⑫ 选「仅自己」保存后写进本机偏好（mode=private）', pickedPrivate && saved && pref?.mode === 'private', { pickedPrivate, saved, pref });
  check('⑬ 保存后面板自动关闭', openSheetTitle() === '', openSheetTitle());

  // ---------- D2. 下一次发布默认就是它 ----------
  const openedComposer = clickText('＋');
  await sleep(450);
  const composerSelected = host
    ? Array.from(host.querySelectorAll('.vg-moment-sheet .vg-moment-audience > div button.is-selected')).map((b) => (b.textContent ?? '').trim())
    : [];
  check('⑭ 新打开发布面板时默认选中「仅自己」',
    openedComposer && composerSelected.join('|') === '仅自己', { openedComposer, composerSelected });
  // 关掉发布面板，避免影响后面的断言
  clickText('关闭');
  await sleep(300);

  // ---------- D3. 无效默认被拒绝 ----------
  clickText('⋯');
  await sleep(180);
  clickText('默认可见范围', host?.querySelector('.vg-moments-settings-menu') ?? host);
  await sleep(400);
  const sheet2 = host?.querySelector('.vg-moment-audience-sheet') ?? null;
  clickText('部分可见', sheet2);
  await sleep(150);
  clickText('保存默认范围', sheet2);
  await sleep(350);
  check('⑮「部分可见」没选人时保存被拒绝，偏好不变、面板留着',
    readPref()?.mode === 'private' && openSheetTitle() === '默认可见范围', { pref: readPref(), title: openSheetTitle() });
  clickText('取消', sheet2);
  await sleep(250);

  // ---------- E. 屏蔽换了入口但还在 ----------
  clickText('⋯');
  await sleep(180);
  const openedBlock = clickText('朋友圈屏蔽', host?.querySelector('.vg-moments-settings-menu') ?? host);
  await sleep(400);
  const blockSheet = host?.querySelector('.vg-moment-privacy-sheet') ?? null;
  check('⑯「⋯ → 朋友圈屏蔽」打开屏蔽面板', openedBlock && openSheetTitle() === '朋友圈屏蔽', { openedBlock, title: openSheetTitle() });
  const firstCheckbox = blockSheet ? (blockSheet.querySelector('.vg-moment-block-list input[type="checkbox"]') as HTMLInputElement | null) : null;
  if (firstCheckbox) firstCheckbox.click();
  await sleep(400);
  const blocked = (await momentsRepo.contactSettings(U)).filter((item) => item.blocked).map((item) => item.characterId);
  check('⑰ 勾选后真正落库（blocked 名单里有这个角色）', blocked.length === 1, { blocked });

  // ---------- F. 评论行的「回复 X」不自指 ----------
  const replyText = (await render()).replace(/\s+/g, ' ');
  check('⑱ 用户回复自己的评论不再显示「我 回复 我」',
    !replyText.includes(`${USERNAME} 回复 ${USERNAME}`) && replyText.includes(`${USERNAME}：下次记得买。`),
    replyText.slice(0, 240));
  check('⑲ 角色回复用户时仍显示「林间 回复 我」', replyText.includes(`林间 回复 ${USERNAME}`), replyText.slice(0, 240));

  // ---------- 清理 ----------
  await db.momentNotifications.where('userId').equals(U).delete();
  await db.momentReactions.where('userId').equals(U).delete();
  await db.momentContacts.where('userId').equals(U).delete();
  await db.momentMedia.where('userId').equals(U).delete();
  await db.moments.where('userId').equals(U).delete();
  await characterRepo.deleteById(C1);
  await characterRepo.deleteById(C2);
  localStorage.removeItem(PREF_KEY);
  const left = { moments: await db.moments.where('userId').equals(U).count(), notices: await db.momentNotifications.where('userId').equals(U).count(), pref: localStorage.getItem(PREF_KEY) };
  check('⑳ 清理干净（动态 / 通知 / 本机偏好都不留）',
    left.moments === 0 && left.notices === 0 && left.pref === null, left);
}

const report = window.fetch.bind(window);
run()
  .then(async () => {
    document.body.textContent = `ok   ${lines.length} assertions (moments IA; real IndexedDB)\n\nALL PASS`;
    await report('/result', { method: 'POST', body: document.body.textContent });
  })
  .catch(async (e) => {
    document.body.textContent = `${lines.join('\n')}\n\nFAIL ${e?.message ?? e}\n${e?.stack ?? ''}\n\n1 FAILED`;
    await report('/result', { method: 'POST', body: document.body.textContent });
  });
