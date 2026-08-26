import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { SwipeActionItem } from '../ui/SwipeActionItem';
import type { Character } from '../../db/index';

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
 * - 长按弹操作菜单：置顶/取消置顶、从列表隐藏/恢复（仅影响列表显示，不删角色与消息）
 * - 排序：置顶在前，其余按最后消息时间倒序，没对话的按名字拼音排后
 * - 已隐藏的角色不再出现在列表（可从「我的 → 设置」恢复，或角色页仍可进入聊天）
 */
export function MobileChatListPage({ onSelect }: { onSelect: (c: Character) => void }) {
  const characters = useChatStore((s) => s.characters);
  const charPreviews = useChatStore((s) => s.charPreviews);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const loadCharacters = useChatStore((s) => s.loadCharacters);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  const togglePin = useChatStore((s) => s.togglePin);
  const hideFromChatList = useChatStore((s) => s.hideFromChatList);
  const unhideFromChatList = useChatStore((s) => s.unhideFromChatList);
  const markCharacterRead = useChatStore((s) => s.markCharacterRead);

  /** 长按菜单：目标角色 + 菜单位置 */
  const [menu, setMenu] = useState<{ char: Character; x: number; y: number } | null>(null);
  /** 会话列表搜索（搜角色名） */
  const [search, setSearch] = useState('');

  useEffect(() => {
    void loadCharacters();
    void fetchUnreadCounts();
  }, [loadCharacters, fetchUnreadCounts]);

  /** 过滤隐藏项 + 搜索 + 置顶优先 + 按时间/名字排序 */
  const sorted = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const visible = characters.filter((c) => !c.chatListHidden && (!kw || c.name.toLowerCase().includes(kw)));
    return [...visible].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ta = charPreviews[a.id]?.createdAt ?? 0;
      const tb = charPreviews[b.id]?.createdAt ?? 0;
      if (ta && tb) return tb - ta;
      if (ta) return -1;
      if (tb) return 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [characters, charPreviews, search]);

  /** 长按弹菜单（桌面右键 / 手机长按） */
  const openMenu = (c: Character, x: number, y: number) => {
    setMenu({ char: c, x, y });
  };

  /** 长按计时引用：长按触发后阻止随后的 click（避免长按也进聊天） */
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 本次按压是否已触发长按菜单（独立标记，touchend 清理计时器但不影响抑制点击） */
  const longPressedRef = useRef(false);

  const startLongPress = (c: Character, clientX: number, clientY: number) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressedRef.current = false;
    longPressRef.current = setTimeout(() => {
      longPressedRef.current = true;
      openMenu(c, clientX, clientY);
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleItemClick = (c: Character) => {
    // 长按刚触发 → 抑制本次点击，避免同时进聊天
    if (longPressedRef.current) {
      longPressedRef.current = false;
      cancelLongPress();
      return;
    }
    cancelLongPress();
    onSelect(c);
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-line shrink-0">
        <span className="text-base font-bold bg-gradient-to-r from-gene-purple to-life-cyan bg-clip-text text-transparent">
          聊天
        </span>
        <span className="text-[10px] text-gray-400">{sorted.length} 位灵魂</span>
      </div>

      {/* 会话搜索（微信式） */}
      <div className="px-3 py-2 border-b border-line shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-line focus-within:border-gene-purple/40 transition-all">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 shrink-0">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索聊天"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-gray-500 outline-none min-w-0"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-ink transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500 px-8 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <p className="text-sm">{search ? '没有找到匹配的角色' : '还没有角色，先去「角色」页选一个开始对话吧'}</p>
            {!search && (
              <button
                onClick={() => useUIStore.getState().setMobileTab('characters')}
                className="mt-1 px-4 py-2 rounded-full text-sm bg-gene-purple text-white shadow-[0_2px_12px_rgba(108,92,231,0.35)]"
              >
                去选角色
              </button>
            )}
          </div>
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
                  onClick: () => void hideFromChatList(c.id),
                },
              ];
              return (
                <SwipeActionItem
                  key={c.id}
                  actions={actions}
                  onClick={() => handleItemClick(c)}
                  contentClassName={c.pinned ? 'bg-gene-purple/[0.06]' : ''}
                >
                  <button
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(c, e.clientX, e.clientY);
                    }}
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      startLongPress(c, t?.clientX ?? 0, t?.clientY ?? 0);
                    }}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-2xl bg-transparent transition-colors active:bg-surface-strong"
                  >
                    {c.avatar.startsWith('data:') ? (
                      <img src={c.avatar} alt={c.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                    ) : (
                      <span className="w-12 h-12 rounded-xl bg-panel border border-line flex items-center justify-center text-2xl shrink-0">
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
                        <span className="text-[10px] text-gray-400 shrink-0">
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

      {/* 长按操作菜单 */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 min-w-[150px] py-1.5 glass-card rounded-xl shadow-xl animate-fade-in"
            style={{
              left: Math.min(menu.x, window.innerWidth - 170),
              top: Math.min(menu.y, window.innerHeight - 150),
            }}
          >
            <button
              onClick={() => {
                void togglePin(menu.char.id);
                setMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-sub hover:bg-surface transition-colors"
            >
              {menu.char.pinned ? '取消置顶' : '置顶聊天'}
            </button>
            <button
              onClick={() => {
                void markCharacterRead(menu.char.id);
                setMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-sub hover:bg-surface transition-colors"
            >
              标为已读
            </button>
            <button
              onClick={() => {
                void hideFromChatList(menu.char.id);
                setMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              从聊天列表删除
            </button>
            <p className="px-4 pt-1.5 pb-1 text-[10px] text-gray-400">删除仅隐藏列表项，角色与聊天记录保留</p>
          </div>
        </>
      )}

      {/* 长按「从聊天列表删除」提示：仅隐藏列表项，记录保留（无需确认弹窗） */}
    </div>
  );
}
