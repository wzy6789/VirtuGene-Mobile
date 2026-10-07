import { avatarImageSrc } from '../../lib/avatar';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFeedback } from '../../lib/feedback';
import { useAuthStore } from '../../store/auth-store';
import { registerSoulElement } from '../../lib/soul-handoff';
import { useChatStore } from '../../store/chat-store';
import { useGroupStore } from '../../store/group-store';
import { useUIStore } from '../../store/ui-store';
import { SwipeActionItem } from '../ui/SwipeActionItem';
import { Avatar } from '../ui/Avatar';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { BrandWordmark } from '../ui/BrandWordmark';
import { ConnectionEmptyState } from '../ui/ConnectionEmptyState';
import type { Character } from '../../db/index';
import { SecretaryWorkspaceCard } from '../secretary/SecretaryWorkspaceCard';
import { isStoryCharacter } from '../../lib/character-domain';

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
let savedPosition: { owner: string | null; top: number; search: string } | undefined;

export function MobileChatListPage({ onSelect }: { onSelect: (c: Character) => void }) {
  const characters = useChatStore((s) => s.characters);
  const charPreviews = useChatStore((s) => s.charPreviews);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const loadCharacters = useChatStore((s) => s.loadCharacters);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  const togglePin = useChatStore((s) => s.togglePin);
  const hideFromChatList = useChatStore((s) => s.hideFromChatList);
  const feedback = useFeedback();
  const hideConversation = (id: string) => hideFromChatList(id).then(() => feedback('已从列表移除，角色与聊天记录保留', { tone: 'success' })).catch(() => feedback('聊天未能移除，请重试', { tone: 'error' }));
  /** 会话列表搜索（搜角色名） */
  const owner = useAuthStore(s=>s.userId);
  const [charactersLoading, setCharactersLoading] = useState(characters.length === 0);
  const [search, setSearch] = useState(() => savedPosition?.owner === useAuthStore.getState().userId ? savedPosition.search : '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSearch = useRef(search); lastSearch.current = search;
  useLayoutEffect(() => {
    if (scrollRef.current && savedPosition?.owner === owner) scrollRef.current.scrollTop = savedPosition.top;
    return () => { if (scrollRef.current) savedPosition = {owner,top:scrollRef.current.scrollTop,search:lastSearch.current}; };
  },[owner]);
  /** 群聊覆盖层 */
  const [showGroups, setShowGroups] = useState(false);
  const [entryGroupId, setEntryGroupId] = useState<string | undefined>(undefined);
  const groups = useGroupStore((s) => s.groups);
  const groupPreviews = useGroupStore((s) => s.groupPreviews);
  const loadGroups = useGroupStore((s) => s.loadGroups);

  useEffect(() => {
    let alive = true;
    setCharactersLoading(true);
    void loadCharacters().catch(() => { if (alive) feedback('聊天列表读取失败，请重新打开', { tone: 'error' }); }).finally(() => { if (alive) setCharactersLoading(false); });
    void fetchUnreadCounts();
    void loadGroups();
    return () => { alive = false; };
  }, [loadCharacters, fetchUnreadCounts, loadGroups]);

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

  return (
    <div className="vg-conversations h-full flex flex-col">
      <header className="vg-conversation-brand shrink-0"><BrandWordmark prominent /></header>

      {/* 会话搜索（微信式） */}
      <div className="px-4 pt-2 pb-3 shrink-0">
        <div className="vg-search-field vg-conversation-search flex items-center gap-2 px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 shrink-0">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            aria-label="搜索聊天"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索聊天"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-gray-500 outline-none min-w-0"
          />
          {search && (
            <button aria-label="清空搜索" onClick={() => setSearch('')} className="vg-search-clear text-gray-400 hover:text-ink transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto vg-conversation-scroll">
      <div className="px-3 pb-2"><SecretaryWorkspaceCard onOpen={onSelect} /></div>
      {/* 群聊和私聊共享滚动容器，群聊较多时不会挤走私聊。 */}
      {groups.length > 0 && (
        <div className="px-3 pt-2 shrink-0">
          <p className="text-[10px] text-gray-400 mb-1 px-1">群聊（{groups.length}）</p>
          <div className="space-y-1.5">
            {groups.map((g) => {
              const preview = groupPreviews[g.id];
              const members = characters.filter((c) => g.characterIds.includes(c.id));
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C5CE7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
                      <span className="text-sm font-medium text-ink truncate">{g.name}</span>
                      <span className="ml-auto text-[12px] text-gray-400 shrink-0">
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
        </div>
      )}

      {/* 会话列表 */}
      <div className="py-1">
        {charactersLoading && !sorted.length ? <LoadingSkeleton label="正在读取聊天列表" rows={4} /> : sorted.length === 0 ? (
          <ConnectionEmptyState searching={!!search}
            title={search ? '没有找到匹配的角色' : '从一句话，开始一段连接'}
            detail={search ? '换个名字试试，或清空搜索看看所有对话。' : '去认识一个新的灵魂，让今天的故事有个听众。'}
            action={<button onClick={() => search ? setSearch('') : useUIStore.getState().setMobileTab('characters')}>
              {search ? '清空搜索' : '去选角色'}
            </button>} />
        ) : (
          <div className="px-3 py-1 space-y-2">
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
                    onContextMenu={(e) => e.preventDefault()}
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
                        <span className="text-sm font-medium text-ink truncate">{c.name}</span>
                        <span className="ml-auto text-[12px] text-gray-400 shrink-0">
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
      </div>
      </div>

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
