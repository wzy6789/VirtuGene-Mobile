import { avatarImageSrc } from '../../lib/avatar';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useFeedback } from '../../lib/feedback';
import { useAuthStore } from '../../store/auth-store';
import { registerSoulElement } from '../../lib/soul-handoff';
import { useChatStore } from '../../store/chat-store';
import { useGroupStore } from '../../store/group-store';
import { SwipeActionItem } from '../ui/SwipeActionItem';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { confirm } from '../../lib/haptics';
import { Avatar } from '../ui/Avatar';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { BrandWordmark } from '../ui/BrandWordmark';
import { ConnectionEmptyState } from '../ui/ConnectionEmptyState';
import type { Character } from '../../db/index';
import { SecretaryWorkspaceCard } from '../secretary/SecretaryWorkspaceCard';
import { isStoryCharacter } from '../../lib/character-domain';
import { ElasticTabs, type ElasticTabItem } from '../ui/ElasticTabs';
import { DEFAULT_SCENE_ID } from '../../lib/chat-scene/scene-catalog';
import homeStarfield from '../../assets/chat-scenes/orbital-observatory/poster-841.webp';

// 群聊是次级视图：与手账/角色页/我的同一套按需加载策略，不进首屏主包，打开时才拉取
const GroupChatPage = lazy(() => import('./GroupChatPage').then((m) => ({ default: m.GroupChatPage })));

/** 会话列表时间：今天 HH:MM / 昨天 / 今年 M月D日 / 更早 YYYY/M/D */
function formatListTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86400000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diffDays <= 0) return hm;
  if (diffDays === 1) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 「聊天」tab 的微信式会话列表：每个角色一行（头像 / 名字 / 最近消息预览 / 时间 / 未读红点）。
 * - 点击进入聊天（推入层），返回回到本列表
 * - 左滑操作：置顶/取消置顶、从列表移除（仅影响列表显示，不删角色与消息）
 * - 排序：置顶在前，其余按最后消息时间倒序，没对话的按名字拼音排后
 * - 已隐藏的角色不再出现在列表（可从「我的 → 设置」恢复，或角色页仍可进入聊天）
 */
type ChatChannel = 'dialogue' | 'assistant';
const channels: readonly ElasticTabItem<ChatChannel>[] = [{value:'dialogue',label:'对话'},{value:'assistant',label:'助理'}];
let savedPosition: { owner: string | null; top: number; search: string; channel: ChatChannel; positions: Partial<Record<ChatChannel, number>> } | undefined;

export function MobileChatListPage({ onSelect }: { onSelect: (c: Character, source?: HTMLElement) => void }) {
  const characters = useChatStore((s) => s.characters);
  const charPreviews = useChatStore((s) => s.charPreviews);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const loadCharacters = useChatStore((s) => s.loadCharacters);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  const togglePin = useChatStore((s) => s.togglePin);
  const hideFromChatList = useChatStore((s) => s.hideFromChatList);
  const markCharacterRead = useChatStore((s) => s.markCharacterRead);
  const feedback = useFeedback();
  const hideConversation = (id: string) => hideFromChatList(id).then(() => feedback('已从列表移除，角色与聊天记录保留', { tone: 'success' })).catch(() => feedback('聊天未能移除，请重试', { tone: 'error' }));
  /** 会话列表搜索（搜角色名） */
  const owner = useAuthStore(s=>s.userId);
  const [menu, setMenu] = useState<{ id: string; owner: string | null } | null>(null);
  const menuOwner = useRef(owner);
  if (menu) menuOwner.current = menu.owner;
  const snapshotOwner = menuOwner.current;
  const menuCharacter = menu?.owner === owner ? characters.find(c => c.id === menu.id && c.createdBy === owner && !c.chatListHidden) : undefined;
  const [menuBusy, setMenuBusy] = useState(false);
  const menuLock = useRef(false);
  const hold = useRef<{ timer: number; id: number; x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancelHold = () => { if (hold.current) window.clearTimeout(hold.current.timer); hold.current = null; };
  const openMenu = (id: string) => {
    cancelHold(); held.current = true;
    setMenu({ id, owner }); confirm();
  };
  const startHold = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    cancelHold(); held.current = false;
    if (!event.isPrimary || event.button !== 0) return;
    // A held row stays in place; scrolling or swiping cancels before the menu opens.
    hold.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
      timer: window.setTimeout(() => openMenu(id), 550) };
  };
  useEffect(() => {
    setMenu(null); held.current = false; cancelHold();
    const hidden = () => { if (document.hidden) cancelHold(); };
    window.addEventListener('blur', cancelHold);
    window.addEventListener('resize', cancelHold);
    window.addEventListener('scroll', cancelHold, true);
    document.addEventListener('visibilitychange', hidden);
    return () => { cancelHold(); window.removeEventListener('blur', cancelHold); window.removeEventListener('resize', cancelHold); window.removeEventListener('scroll', cancelHold, true); document.removeEventListener('visibilitychange', hidden); };
  }, [owner]);
  const runMenuAction = async (action: (id: string) => Promise<void>, message?: string) => {
    if (menuLock.current || !menuCharacter || useAuthStore.getState().userId !== owner) return;
    menuLock.current = true; setMenuBusy(true);
    try { await action(menuCharacter.id); if (useAuthStore.getState().userId === owner) { setMenu(null); if (message) feedback(message, { tone: 'success' }); } }
    catch { if (useAuthStore.getState().userId === owner) feedback('操作未能完成，请重试', { tone: 'error' }); }
    finally { menuLock.current = false; setMenuBusy(false); }
  };
  const [charactersLoading, setCharactersLoading] = useState(characters.length === 0);
  const [charactersLoadError, setCharactersLoadError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [search, setSearch] = useState(() => savedPosition?.owner === useAuthStore.getState().userId ? savedPosition.search : '');
  const [searchOpen, setSearchOpen] = useState(() => savedPosition?.owner === useAuthStore.getState().userId && !!savedPosition.search);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);
  const [channel, setChannel] = useState<ChatChannel>(() => savedPosition?.owner === useAuthStore.getState().userId ? savedPosition.channel : 'dialogue');
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelPositions = useRef<Partial<Record<ChatChannel, number>>>({});
  const lastChannel = useRef(channel); lastChannel.current = channel;
  const lastSearch = useRef(search); lastSearch.current = search;
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const previous = savedPosition?.owner === owner ? savedPosition : undefined;
    restoreSearchFocus.current = false;
    setSearch(previous?.search ?? '');
    setSearchOpen(!!previous?.search);
    setChannel(previous?.channel ?? 'dialogue');
    channelPositions.current = previous?.positions ? { ...previous.positions } : {};
    if (container) container.scrollTop = previous?.top ?? 0;
    return () => { if (container) savedPosition = { owner, top: container.scrollTop, search: lastSearch.current,
      channel: lastChannel.current, positions: { ...channelPositions.current, [lastChannel.current]: container.scrollTop } }; };
  },[owner]);
  useLayoutEffect(() => {
    if (searchOpen) searchInput.current?.focus({ preventScroll: true });
    else if (restoreSearchFocus.current) {
      restoreSearchFocus.current = false;
      searchButton.current?.focus({ preventScroll: true });
    }
  }, [searchOpen]);
  const cancelSearch = () => {
    restoreSearchFocus.current = true;
    setSearch('');
    setSearchOpen(false);
  };
  /** 群聊覆盖层 */
  const [showGroups, setShowGroups] = useState(false);
  const [entryGroupId, setEntryGroupId] = useState<string | undefined>(undefined);
  const groups = useGroupStore((s) => s.groups);
  const groupPreviews = useGroupStore((s) => s.groupPreviews);
  const loadGroups = useGroupStore((s) => s.loadGroups);

  useEffect(() => {
    let alive = true;
    setCharactersLoading(true); setCharactersLoadError(false);
    void loadCharacters().catch(() => { if (alive) { setCharactersLoadError(true); feedback('聊天列表读取失败，请重试', { tone: 'error' }); } }).finally(() => { if (alive) setCharactersLoading(false); });
    void fetchUnreadCounts();
    void loadGroups().catch(() => {});
    return () => { alive = false; };
  }, [loadCharacters, fetchUnreadCounts, loadGroups, owner, loadRevision]);

  /** 过滤隐藏项 + 搜索 + 置顶优先 + 按时间/名字排序 */
  const sorted = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const visible = characters.filter((c) => c.createdBy === owner && isStoryCharacter(c) && !c.chatListHidden && (!kw || c.name.toLowerCase().includes(kw)));
    return [...visible].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ta = charPreviews[a.id]?.createdAt ?? 0;
      const tb = charPreviews[b.id]?.createdAt ?? 0;
      if (ta && tb) return tb - ta;
      if (ta) return -1;
      if (tb) return 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [characters, charPreviews, search, owner]);
  const visibleGroups = useMemo(() => groups.filter(group => group.userId === owner && (!search.trim() || group.name.toLowerCase().includes(search.trim().toLowerCase()))), [groups, owner, search]);
  const activeChannel = channel;
  const changeChannel = (next: ChatChannel) => {
    if (scrollRef.current) channelPositions.current[activeChannel] = scrollRef.current.scrollTop;
    setChannel(next);
  };
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = channelPositions.current[activeChannel] ?? 0;
  }, [activeChannel, owner]);
  const dialogueVisible = activeChannel === 'dialogue';
  const groupsVisible = dialogueVisible;
  const assistantMatchesSearch = !search.trim() || characters.some(c => c.createdBy === owner && !isStoryCharacter(c) && c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const assistantVisible = activeChannel === 'assistant' && assistantMatchesSearch;

  return (
    <div className="vg-conversations vg-home-stage-page h-full flex flex-col" data-home-scene={DEFAULT_SCENE_ID}>
      {/* Home has its own static scene. Per-chat modes and legacy chat switches must not remove it. */}
      <div className="vg-home-scene-backdrop" aria-hidden="true"><img src={homeStarfield} width={841} height={1870} alt="" draggable={false} fetchPriority="high" /></div>
      <header className="vg-conversation-brand vg-message-heading shrink-0"><h1>消息</h1><BrandWordmark /></header>

      <div className="vg-message-toolbar shrink-0" data-no-page-swipe data-no-back-swipe>
        {searchOpen ? <>
          <div className="vg-search-field vg-conversation-search vg-message-search" role="search">
            <Icon name="search" size={18} />
            <input ref={searchInput} aria-label="搜索聊天" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索聊天"
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-gray-500 outline-none min-w-0"
              onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); cancelSearch(); } }} />
            {search && <button type="button" aria-label="清空搜索" className="vg-search-clear"
              onClick={() => { setSearch(''); searchInput.current?.focus({ preventScroll: true }); }}><Icon name="close" size={16} /></button>}
          </div>
          <button type="button" className="vg-message-search-cancel" onClick={cancelSearch}>取消</button>
        </> : <>
          {channels.length > 1 && <ElasticTabs items={channels} value={activeChannel} onChange={changeChannel} ariaLabel="聊天频道"
            className="vg-conversation-channels" gestureKey={owner ?? 'signed-out'} contentRef={scrollRef} />}
          <button type="button" ref={searchButton} className="vg-message-search-toggle" aria-label="搜索聊天" onClick={() => setSearchOpen(true)}><Icon name="search" size={21} /></button>
        </>}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto vg-conversation-scroll">
      {charactersLoadError && <div className="vg-home-load-error" role="alert"><span>聊天列表读取失败</span><button type="button" onClick={() => setLoadRevision(value => value + 1)}>重新读取</button></div>}
      {dialogueVisible && <section className="vg-home-conversation-section vg-scene-glass" aria-label={search.trim() ? '搜索结果' : '对话列表'}>
        {charactersLoading && !sorted.length ? <LoadingSkeleton label="正在读取聊天列表" rows={2} /> : sorted.length === 0 ? (search.trim() && !visibleGroups.length ? (
          <ConnectionEmptyState searching
            title="没有找到匹配的角色"
            detail="换个名字试试，或清空搜索看看所有对话。"
            action={<button onClick={() => setSearch('')}>
              清空搜索
            </button>} />
        ) : null) : (
          <div>
            {sorted.map((c) => {
              const preview = charPreviews[c.id];
              const unread = unreadByCharacter[c.id] ?? 0;
              const actions = [
                // 置顶/取消置顶（左滑第 2 个按钮）
                {
                  label: c.pinned ? '取消置顶' : '置顶',
                  color: c.pinned ? 'bg-gray-400' : 'bg-amber-500',
                  onClick: () => void togglePin(c.id),
                },
                // 删除会话（左滑第 1 个按钮，最右）
                {
                  label: '删除',
                  color: 'bg-red-500',
                  // 左滑删除 = 从聊天列表移除（聊天记录保留，可在角色页再进）
                  onClick: () => void hideConversation(c.id),
                },
              ];
              return (
                <SwipeActionItem
                  key={c.id}
                  itemId={c.id}
                  actions={actions}
                  onClick={() => onSelect(c)}
                  contentClassName={c.pinned ? 'vg-conversation-shell is-pinned' : 'vg-conversation-shell'}
                >
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={menuCharacter?.id === c.id}
                    onPointerDown={e => startHold(e, c.id)}
                    onPointerMove={e => { const g = hold.current; if (g && (g.id !== e.pointerId || Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10)) cancelHold(); }}
                    onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
                    onClickCapture={e => { if (held.current && e.detail !== 0) { e.preventDefault(); e.stopPropagation(); held.current = false; } }}
                    onContextMenu={e => { e.preventDefault(); openMenu(c.id); }}
                    onKeyDown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openMenu(c.id); } }}
                    className="vg-conversation-row w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-2xl bg-transparent transition-colors active:bg-surface-strong"
                  >
                    {avatarImageSrc(c.avatar) ? (
                      <img ref={node=>{if(node)return registerSoulElement(node,`avatar:${c.id}`,'list');}} data-soul-key={`avatar:${c.id}`} data-soul-role="list" src={avatarImageSrc(c.avatar)} alt={c.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                    ) : (
                      <span ref={node=>{if(node)return registerSoulElement(node,`avatar:${c.id}`,'list');}} data-soul-key={`avatar:${c.id}`} data-soul-role="list" className="w-12 h-12 rounded-xl bg-panel border border-line flex items-center justify-center text-2xl shrink-0">
                        {c.avatar}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {c.pinned && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gene-purple shrink-0">
                            <path d="M12 17v5" />
                            <path d="M5 3h14v3a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V3z" />
                          </svg>
                        )}
                        <span className="vg-conversation-name font-medium text-ink truncate">{c.name}</span>
                        <span className="ml-auto text-[12px] text-sub shrink-0">
                          {preview ? formatListTime(preview.createdAt) : ''}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {preview ? preview.content : '开始对话吧'}
                      </p>
                    </div>
                    {unread > 0 && (
                      <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </button>
                </SwipeActionItem>
              );
            })}
          </div>
        )}
      </section>}
      {groupsVisible && visibleGroups.length > 0 && (
        <section className="vg-home-group-list shrink-0" aria-label="群聊">
          <h2 className="vg-home-section-title">群聊<small>{visibleGroups.length} 个对话</small></h2>
          <div>
            {visibleGroups.map((g) => {
              const preview = groupPreviews[g.id];
              const members = characters.filter((c) => c.createdBy === owner && g.characterIds.includes(c.id));
              return (
                <button
                  key={g.id}
                  onClick={() => {
                    setEntryGroupId(g.id);
                    setShowGroups(true);
                  }}
                  className="vg-conversation-row is-group w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-2xl bg-surface border border-line hover:border-gene-purple/40 transition-colors"
                >
                  <span className="shrink-0 w-12 h-12 rounded-xl bg-gene-purple/12 flex items-center justify-center relative">
                    <svg className="text-gene-purple" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span className="absolute -bottom-1 -right-1 flex">
                      {members.slice(0, 3).map((m) => (
                        <span key={m.id} className="w-4 h-4 -ml-1 first:ml-0 rounded-full ring-1 ring-app overflow-hidden">
                          <Avatar avatar={m.avatar} size="xs" className="!w-4 !h-4" />
                        </span>
                      ))}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="vg-conversation-name font-medium text-ink truncate">{g.name}</span>
                      <span className="ml-auto text-[12px] text-sub shrink-0">
                        {preview && preview.createdAt > 0 ? formatListTime(preview.createdAt) : ''}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {preview ? preview.content : '群聊已创建，发句话看看他们的反应'}
                    </p>
                  </div>
                  {preview && preview.unread > 0 && (
                    <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center">
                      {preview.unread > 99 ? '99+' : preview.unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {assistantVisible && <div className="vg-home-assistant"><SecretaryWorkspaceCard onOpen={onSelect} /></div>}
      {search.trim() && activeChannel === 'assistant' && !assistantMatchesSearch &&
        <ConnectionEmptyState searching title="没有找到匹配的助理"
          detail="换个名字试试，或清空搜索。" action={<button type="button" onClick={() => setSearch('')}>清空搜索</button>} />}
      </div>

      <Modal presentation="dialog" open={!!menuCharacter} title={menuCharacter?.name} width="max-w-sm"
        onClose={() => { if (!menuLock.current) setMenu(null); }}
        canSnapshotOnExit={() => useAuthStore.getState().userId === snapshotOwner}>
        <div className="vg-dialog-actions p-4 space-y-2" aria-busy={menuBusy}>
          <button type="button" disabled={menuBusy} onClick={() => void runMenuAction(togglePin)} className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl bg-surface text-sm text-ink disabled:opacity-50"><Icon name="flag" />{menuCharacter?.pinned ? '取消置顶' : '置顶聊天'}</button>
          <button type="button" disabled={menuBusy} onClick={() => void runMenuAction(markCharacterRead)} className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl bg-surface text-sm text-ink disabled:opacity-50"><Icon name="check" />标为已读</button>
          <button type="button" disabled={menuBusy} onClick={() => void runMenuAction(hideFromChatList, '已从列表移除，角色与聊天记录保留')} className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl bg-red-500/10 text-sm text-red-400 disabled:opacity-50"><Icon name="trash" />从聊天列表移除</button>
          <p className="px-1 pt-2 text-xs leading-relaxed text-sub">移除后，角色与聊天记录仍会保留。</p>
        </div>
      </Modal>

      {/* 群聊覆盖层（按需加载：与 GroupChatPage 自身的 fixed inset-0 vg-layer-page 布局对齐） */}
      {showGroups && (
        <Suspense
          fallback={
            <div className="fixed inset-0 vg-layer-page bg-app grid place-items-center text-sm text-gray-500" role="status">
              正在打开群聊…
            </div>
          }
        >
          <GroupChatPage onClose={() => { setShowGroups(false); void loadGroups(); }} initialGroupId={entryGroupId} />
        </Suspense>
      )}
    </div>
  );
}
