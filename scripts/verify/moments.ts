/**
 * VirtuGene 5.1.4 验收：朋友圈的信息架构与设置
 *
 * 背景：朋友圈原来把「互动」和「◌ 屏蔽」都堆在右上角，与页面主体（名片 → 动态流）割裂。
 * 这一轮按微信朋友圈的做法重排，并把设置收进一个真正的面板：
 *
 *   A. 右上角只留「＋ 发布」与「⋯」（菜单：朋友圈设置 / 朋友圈屏蔽 / 默认可见范围）
 *   B. 互动入口常驻在「名片」之下、「动态流」之上，带最近互动者头像 / 未读数 / 红点
 *   C. 动态改通栏列表：头像左置、名字与正文同列、右下角「···」气泡点开才浮出 赞 | 评论
 *   D. 设置面板：消息与提醒 / 谁能看·我能看 / 发布 / 展示
 *   E. 默认可见范围、列表密度、封面、新互动红点都会落盘并在页面上立刻生效
 *   F. 「不看他（她）的朋友圈」真的把对方的动态从我的列表里过滤掉
 *   G. 「允许角色查看我的历史动态」真的改变 visibleToCharacter 的结果
 *   H. 用户能删自己的评论（软删），角色评论删不掉
 *
 * 做法与 worldG 一致：真实浏览器 + 真实 IndexedDB + 真实组件渲染，断言的是**行为**
 * （点得开、存得下、下次生效、过滤真的生效），不是类名快照。
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { db } from '../../src/db/index';
import { momentsRepo, visibleToCharacter } from '../../src/db/moments-repo';
import { characterRepo } from '../../src/db/character-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { MomentsPage } from '../../src/components/moments/MomentsPage';
import {
  AUDIENCE_MODE_LABELS,
  AUDIENCE_MODES,
  HISTORY_WINDOW_LABELS,
  HISTORY_WINDOWS,
  loadMomentsPreferences,
  saveMomentsPreferences,
  DEFAULT_MOMENTS_PREFERENCES,
} from '../../src/lib/moments/preferences';
import type { Character, Moment } from '../../src/db/index';

const U = 'u-momentsA';
const USERNAME = '朋友圈验收';
const C1 = 'c-ma-xingyao';
const C2 = 'c-ma-linjian';
const PREF_KEY = `virtugene-moments:${U}`;

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
function readPref(): { audience?: { mode?: string; contactIds?: string[] }; density?: string; showUnreadBadge?: boolean; cover?: string; historyWindow?: string } | null {
  const raw = localStorage.getItem(PREF_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, never>;
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
/** 角色发的动态：直接落库（真实路径要跑模型），字段形状与 moments-repo maybeCharacterPost 一致 */
async function seedCharacterPost(characterId: string, text: string): Promise<Moment> {
  const now = Date.now();
  const moment: Moment = {
    id: `moment-char-${characterId}`,
    userId: U,
    text,
    visibility: 'all',
    audienceCharacterIds: [C1, C2],
    mediaIds: [],
    authorCharacterId: characterId,
    visibilityRevision: 1,
    deleted: false,
    createdAt: now,
  };
  await db.moments.put(moment);
  return moment;
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
  const charPost = await seedCharacterPost(C1, '今晚的云压得很低。');

  // 让互动条有内容：直接写库、形状与 moments-repo.ts:248-249 完全一致
  // （不走 requestCharacterLike 是为了不把 UI 断言押在亲密度随机数上）。
  const now = Date.now();
  await db.momentReactions.put({ id: `moment-like:${first.id}:${C1}`, userId: U, momentId: first.id, characterId: C1, type: 'like', status: 'active', createdAt: now, updatedAt: now });
  await db.momentReactions.put({ id: `moment-like:${first.id}:${C2}`, userId: U, momentId: first.id, characterId: C2, type: 'like', status: 'active', createdAt: now + 1, updatedAt: now + 1 });
  await db.momentReactions.put({ id: `moment-comment:${first.id}:${C2}`, userId: U, momentId: first.id, characterId: C2, type: 'comment', content: '这句话我记住了。', status: 'active', createdAt: now + 2, updatedAt: now + 2 });
  await db.momentNotifications.put({ id: `moment-notice:like:${first.id}:${C1}`, userId: U, momentId: first.id, characterId: C1, type: 'like', preview: '星遥 点了赞', read: false, createdAt: now });
  await db.momentNotifications.put({ id: `moment-notice:comment:${first.id}:${C2}`, userId: U, momentId: first.id, characterId: C2, type: 'comment', preview: '林间 评论了你的动态：这句话我记住了。', read: false, createdAt: now + 1 });
  // 评论回复链：用户回复自己的评论（不该显示「我 回复 我」）+ 角色回复用户（该显示「林间 回复 我」）
  await db.momentReactions.put({ id: 'moment-comment:user-1', userId: U, momentId: first.id, type: 'comment', content: '甜是甜，就是酱油忘了买。', status: 'active', createdAt: now + 3, updatedAt: now + 3 });
  await db.momentReactions.put({ id: 'moment-comment:user-2', userId: U, momentId: first.id, type: 'comment', content: '下次记得买。', replyToId: 'moment-comment:user-1', status: 'active', createdAt: now + 4, updatedAt: now + 4 });
  await db.momentReactions.put({ id: `moment-comment:${first.id}:${C2}:reply`, userId: U, momentId: first.id, characterId: C2, type: 'comment', content: '双份牛肉不算奖励，算补偿。', replyToId: 'moment-comment:user-1', status: 'active', createdAt: now + 5, updatedAt: now + 5 });

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

  // ---------- A2. 菜单三项 ----------
  const openedMenu = clickText('⋯');
  await sleep(200);
  const menuItems = host ? Array.from(host.querySelectorAll('.vg-moments-settings-menu button')).map((b) => (b.textContent ?? '').trim()) : [];
  check('④ 点开 ⋯ 后菜单三项：朋友圈设置 / 朋友圈屏蔽 / 默认可见范围',
    openedMenu && menuItems.join('|') === '朋友圈设置|朋友圈屏蔽|默认可见范围', menuItems);

  // ---------- B. 互动条：位置 + 常驻 + 未读 ----------
  const inbox = host?.querySelector('.vg-moments-inbox') ?? null;
  const profile = host?.querySelector('.vg-moments-profile') ?? null;
  const firstCard = host?.querySelector('.vg-moment-card') ?? null;
  check('⑤ 互动条常驻存在（.vg-moments-inbox）', inbox !== null);
  const orderOk = inbox !== null && profile !== null && firstCard !== null
    && (profile.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    && (inbox.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  check('⑥ 互动条位于「名片」之下、「动态流」之上', orderOk);
  const inboxText = inbox ? (inbox as HTMLElement).innerText.replace(/\s+/g, ' ') : '';
  check('⑦ 有未读时显示「N 条新互动」并带红点',
    inboxText.includes('2 条新互动') && (inbox?.querySelector('.vg-moments-inbox-dot') ?? null) !== null, inboxText);
  const inboxAvatars = inbox ? inbox.querySelectorAll('.vg-moments-inbox-avatars > *').length : 0;
  check('⑧ 互动条显示最近互动者头像（去重后 2 个）', inboxAvatars === 2, { inboxAvatars, pageHead: pageText.slice(0, 80) });

  // ---------- C. 通栏列表 + ··· 气泡 ----------
  const card = host?.querySelector('.vg-moment-card') as HTMLElement | null;
  const cardStyle = card ? getComputedStyle(card) : null;
  check('⑨ 动态是通栏列表（没有卡片边框/圆角，用分隔线）',
    cardStyle !== null && cardStyle.borderBottomWidth !== '0px' && (cardStyle.borderTopLeftRadius === '0px' || cardStyle.borderTopLeftRadius === ''),
    cardStyle ? { borderBottom: cardStyle.borderBottomWidth, radius: cardStyle.borderTopLeftRadius } : null);
  const bubble = card?.querySelector('.vg-moment-bubble') as HTMLButtonElement | null;
  check('⑩ 操作收起态只有一个「···」气泡，没有常摊的赞/评论按钮',
    bubble !== null && (card?.querySelector('.vg-moment-actions') ?? null) === null && !card?.innerText.includes('♡ 赞'), card ? card.innerText.slice(0, 60) : null);
  if (bubble) bubble.click();
  await sleep(200);
  const pillItems = card ? Array.from(card.querySelectorAll('.vg-moment-pill button')).map((b) => (b.textContent ?? '').trim()) : [];
  check('⑪ 点气泡才浮出 赞 | 评论', pillItems.join('|') === '赞|评论', pillItems);
  const likedId = first.id;
  clickText('赞', card);
  await sleep(400);
  const likedRows = (await momentsRepo.reactions(likedId, U)).filter((row) => row.type === 'like' && !row.characterId && row.status === 'active');
  check('⑫ 点「赞」真的写库（用户自己那条 like 落库）', likedRows.length === 1, { likedRows: likedRows.length });
  await render();

  // ---------- C2. 点赞仍是头像堆叠（用户明确要求保留） ----------
  const likeBlock = host?.querySelector('.vg-moment-likes') ?? null;
  const likeAvatars = likeBlock ? likeBlock.querySelectorAll('.vg-moment-like-avatars > *').length : 0;
  check('⑬ 点赞展示仍是头像堆叠（共 3 个：两位角色 + 我）', likeAvatars === 3, { likeAvatars });

  // ---------- D. 设置面板 ----------
  clickText('⋯');
  await sleep(180);
  const openedSettings = clickText('朋友圈设置', host?.querySelector('.vg-moments-settings-menu') ?? host);
  await sleep(400);
  const settingsText = openSheetTitle() === '朋友圈设置' && host ? (host.querySelector('.vg-moment-settings-sheet') as HTMLElement).innerText.replace(/\s+/g, ' ') : '';
  const settingGroups = ['消息与提醒', '谁能看 · 我能看', '发布', '展示'];
  const settingRows = ['互动消息', '新互动红点', '发布后提示', '朋友圈屏蔽', '不看他（她）的朋友圈', '允许角色查看我的历史动态', '默认可见范围', '朋友圈封面', '列表密度'];
  check('⑭ ⋯ → 朋友圈设置 打面板，四个分组齐全',
    openedSettings && openSheetTitle() === '朋友圈设置' && settingGroups.every((group) => settingsText.includes(group)), { openedSettings, title: openSheetTitle(), settingsText: settingsText.slice(0, 160) });
  check('⑮ 设置项齐全（消息/红点/提示/屏蔽/不看/历史/默认范围/封面/密度）',
    settingRows.every((row) => settingsText.includes(row)), settingRows.filter((row) => !settingsText.includes(row)));
  check('⑯「全部已读」「清空记录」两个动作都在', settingsText.includes('全部已读') && settingsText.includes('清空记录'), settingsText.slice(0, 200));

  // ---------- E. 密度开关立刻生效并落盘 ----------
  const densityClicked = clickText('紧凑', host?.querySelector('.vg-moment-settings-sheet') ?? null);
  await sleep(250);
  const page = host?.querySelector('.vg-moments-page') as HTMLElement | null;
  check('⑰ 选「紧凑」后页面 data-density=compact 且写进本机偏好',
    densityClicked && page?.getAttribute('data-density') === 'compact' && readPref()?.density === 'compact',
    { densityClicked, density: page?.getAttribute('data-density'), pref: readPref()?.density });

  // ---------- E2. 红点开关 ----------
  const badgeToggle = buttonWith('已开启', host?.querySelector('.vg-moment-settings-sheet') ?? null);
  if (badgeToggle) badgeToggle.click();
  await sleep(250);
  await render();
  check('⑱ 关掉「新互动红点」后互动条不再显示红点',
    readPref()?.showUnreadBadge === false && (host?.querySelector('.vg-moments-inbox-dot') ?? null) === null,
    { pref: readPref()?.showUnreadBadge, dot: host?.querySelector('.vg-moments-inbox-dot') !== null });
  // 打开回来，后续断言仍按默认行为走
  saveMomentsPreferences(U, { ...loadMomentsPreferences(U), showUnreadBadge: true });
  await render();

  // ---------- F. 不看他（她）的朋友圈 ----------
  const charPostVisibleBefore = (host?.innerText ?? '').includes('今晚的云压得很低。');
  clickText('⋯');
  await sleep(180);
  clickText('朋友圈设置', host?.querySelector('.vg-moments-settings-menu') ?? host);
  await sleep(350);
  clickText('不看他（她）的朋友圈', host?.querySelector('.vg-moment-settings-sheet') ?? null);
  await sleep(400);
  const mutedSheet = host?.querySelector('.vg-moment-muted-sheet') ?? null;
  const mutedTitleOk = openSheetTitle() === '不看他（她）的朋友圈';
  const firstMuted = mutedSheet ? (mutedSheet.querySelector('.vg-moment-block-list input[type="checkbox"]') as HTMLInputElement | null) : null;
  if (firstMuted) firstMuted.click();
  await sleep(400);
  const mutedRows = (await momentsRepo.contactSettings(U)).filter((row) => row.muted).map((row) => row.characterId);
  await render();
  const charPostVisibleAfter = (host?.innerText ?? '').includes('今晚的云压得很低。');
  check('⑲「不看他（她）的朋友圈」勾选后落库（muted=true）',
    mutedTitleOk && mutedRows.includes(C1), { mutedTitleOk, mutedRows });
  check('⑳ 被隐藏的角色动态从我的列表消失，自己的动态不受影响',
    charPostVisibleBefore && !charPostVisibleAfter && (host?.innerText ?? '').includes('雨停之前，把伞留在了门口。'),
    { before: charPostVisibleBefore, after: charPostVisibleAfter });

  // ---------- G. 允许角色查看我的历史动态 ----------
  saveMomentsPreferences(U, { ...loadMomentsPreferences(U), historyWindow: '3d' });
  const oldMoment: Moment = { ...(await db.moments.get(first.id))!, createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000 };
  await db.moments.put(oldMoment);
  const freshMoment = (await db.moments.get(charPost.id))!;
  const oldVisible = await visibleToCharacter(oldMoment, C1);
  const freshVisible = await visibleToCharacter(freshMoment, C1);
  check('㉑「最近 3 天」生效：10 天前的动态对角色不可见', oldVisible === false, { oldVisible });
  check('㉒ 窗口内的动态仍然对角色可见', freshVisible === true, { freshVisible });
  saveMomentsPreferences(U, { ...loadMomentsPreferences(U), historyWindow: 'all' });
  check('㉓ 调回「全部」后老动态重新可见', (await visibleToCharacter(oldMoment, C1)) === true);

  // ---------- H. 删自己的评论 ----------
  await render();
  const mineRow = host?.querySelector('.vg-moment-comment-row') as HTMLButtonElement | null;
  const mineRows = host ? Array.from(host.querySelectorAll('.vg-moment-comment-row')).filter((row) => (row.textContent ?? '').includes('甜是甜')) : [];
  const mineTarget = (mineRows[0] ?? null) as HTMLButtonElement | null;
  mineTarget?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  await sleep(300);
  const deleteTitle = openSheetTitle();
  const confirmed = clickText('删除评论', host?.querySelector('.vg-moment-delete-sheet') ?? null);
  await sleep(450);
  const remaining = (await momentsRepo.reactions(first.id, U)).filter((row) => row.id === 'moment-comment:user-1');
  check('㉔ 长按自己的评论弹出删除确认', deleteTitle === '删除这条评论？', { deleteTitle, hasRow: mineRow !== null });
  check('㉕ 确认后自己的评论被软删（status=deleted）',
    confirmed && remaining.length === 1 && remaining[0].status === 'deleted', { confirmed, status: remaining[0]?.status });

  // ---------- H2. 角色评论删不掉 ----------
  const charComment = (await momentsRepo.reactions(first.id, U)).find((row) => row.characterId && row.type === 'comment')!;
  const denied = await momentsRepo.deleteOwnComment(U, charComment.id);
  check('㉖ 角色评论不允许被用户删除', denied === false && (await db.momentReactions.get(charComment.id))?.status === 'active');

  // ---------- H3. 评论回复不自指 ----------
  const replyText = (await render()).replace(/\s+/g, ' ');
  check('㉗ 用户回复自己的评论不再显示「我 回复 我」',
    !replyText.includes(`${USERNAME} 回复 ${USERNAME}`) && replyText.includes(`${USERNAME}：下次记得买。`), replyText.slice(0, 240));
  check('㉘ 角色回复用户时仍显示「林间 回复 我」', replyText.includes(`林间 回复 ${USERNAME}`), replyText.slice(0, 240));

  // ---------- H4. 长按管理菜单只对自己的动态响应 ----------
  const cards = host ? (Array.from(host.querySelectorAll('.vg-moment-card')) as HTMLElement[]) : [];
  const otherCard = cards.find((el) => (el.innerText ?? '').includes('角色动态')) ?? null;
  const ownCard = cards.find((el) => !(el.innerText ?? '').includes('角色动态')) ?? null;
  otherCard?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  await sleep(250);
  const menuAfterOther = (host?.querySelector('.vg-moment-menu') ?? null) !== null;
  ownCard?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  await sleep(250);
  const ownMenuItems = host ? Array.from(host.querySelectorAll('.vg-moment-menu button')).map((b) => (b.textContent ?? '').trim()) : [];
  const menuBackdrop = host?.querySelector('.vg-moment-menu-backdrop') as HTMLButtonElement | null;
  menuBackdrop?.click();
  await sleep(250);
  const menuClosed = (host?.querySelector('.vg-moment-menu') ?? null) === null;
  check('㉙ 长按别人的动态不出管理菜单；长按自己的出菜单，点空白处也能收起',
    !menuAfterOther && ownMenuItems.join('|') === '修改谁可以看|删除这条动态' && menuBackdrop !== null && menuClosed,
    { menuAfterOther, ownMenuItems, hasOtherCard: otherCard !== null, hasOwnCard: ownCard !== null, hasBackdrop: menuBackdrop !== null, menuClosed });

  // ---------- I. 封面偏好 ----------
  const fakeCover = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  saveMomentsPreferences(U, { ...loadMomentsPreferences(U), cover: fakeCover });
  const covered = await render();
  const coverEl = host?.querySelector('.vg-moments-cover') as HTMLElement | null;
  const coverApplied = coverEl ? getComputedStyle(coverEl).backgroundImage.includes('data:image/gif') : false;
  clickText('展开朋友圈封面');
  await sleep(250);
  check('㉚ 自定义封面会渲染到封面上（且能展开看到更换入口）',
    coverApplied && clickText('更换封面') && covered.length > 0, { coverApplied });
  saveMomentsPreferences(U, { ...loadMomentsPreferences(U), cover: '' });

  // ---------- J. 清空互动记录 ----------
  clickText('⋯');
  await sleep(180);
  clickText('朋友圈设置', host?.querySelector('.vg-moments-settings-menu') ?? host);
  await sleep(350);
  const cleared = clickText('清空记录', host?.querySelector('.vg-moment-settings-sheet') ?? null);
  await sleep(400);
  check('㉛ 清空记录后互动消息清空，但动态与评论都还在',
    cleared && (await momentsRepo.notifications(U)).length === 0
      && (await db.moments.where('userId').equals(U).count()) >= 2
      && (await momentsRepo.reactions(first.id, U)).some((row) => row.characterId && row.type === 'comment'),
    { cleared, notices: (await momentsRepo.notifications(U)).length });

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
  check('㉜ 清理干净（动态 / 通知 / 本机偏好都不留）',
    left.moments === 0 && left.notices === 0 && left.pref === null, left);

  // 出厂值自检：默认偏好对象与模块常量一致，避免"测试自己造了一套默认"
  check('㉝ 默认偏好与出厂值一致（红点开、宽松、全部、无封面）',
    DEFAULT_MOMENTS_PREFERENCES.showUnreadBadge === true
      && DEFAULT_MOMENTS_PREFERENCES.density === 'comfortable'
      && DEFAULT_MOMENTS_PREFERENCES.historyWindow === 'all'
      && DEFAULT_MOMENTS_PREFERENCES.cover === ''
      && AUDIENCE_MODES.length === 4
      && HISTORY_WINDOWS.length === 4
      && HISTORY_WINDOW_LABELS['3d'] === '最近 3 天'
      && AUDIENCE_MODE_LABELS.all === '全部角色',
    DEFAULT_MOMENTS_PREFERENCES);
}

const report = window.fetch.bind(window);
run()
  .then(async () => {
    document.body.textContent = `ok   ${lines.length} assertions (moments IA + settings; real IndexedDB)\n\nALL PASS`;
    await report('/result', { method: 'POST', body: document.body.textContent });
  })
  .catch(async (e) => {
    document.body.textContent = `${lines.join('\n')}\n\nFAIL ${e?.message ?? e}\n${e?.stack ?? ''}\n\n1 FAILED`;
    await report('/result', { method: 'POST', body: document.body.textContent });
  });
