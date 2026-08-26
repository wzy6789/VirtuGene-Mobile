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
  const clearSessionsForCharacter = useChatStore((s) => s.clearSessionsForCharacter);
  const markCharacterRead = useChatStore((s) => s.markCharacterRead);

  /** 长按菜单：目标角色 + 菜单位置 */
  const [menu, setMenu] = useState<{ char: Character; x: number; y: number } | null>(null);
  /** 左滑删除确认 */
  const [deleteTarget, setDeleteTarget] = useState<Character | null>(null);

  useEffect(() => {
    void loadCharacters();
    void fetchUnreadCounts();
  }, [loadCharacters, fetchUnreadCounts]);

  /** 过滤隐藏项 + 置顶优先 + 按时间/名字排序 */
  const sorted = useMemo(() => {
    const visible = characters.filter((c) => !c.chatListHidden);
    return [...visible].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ta = charPreviews[a.id]?.createdAt ?? 0;
      const tb = charPreviews[b.id]?.createdAt ?? 0;
      if (ta && tb) return tb - ta;
      if (ta) return -1;
      if (tb) return 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [characters, charPreviews]);

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

  const hiddenCount = characters.length - sorted.length;

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-line shrink-0">
        <span className="text-base font-bold bg-gradient-to-r from-gene-purple to-life-cyan bg-clip-text text-transparent">
          聊天
        </span>
        <span className="text-[10px] text-gray-400">{sorted.length} 位灵魂</span>
        {hiddenCount > 0 && (
          <button
            onClick={() => useUIStore.getState().setMobileTab('me')}
            className="ml-auto text-[11px] text-life-cyan hover:underline"
            title="查看已隐藏的会话"
          >
            已隐藏 {hiddenCount} 个
          </button>
        )}
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500 px-8 text-center">
            <span className="text-4xl">🧬</span>
            <p className="text-sm">还没有角色，先去「角色」页选一个开始对话吧</p>
            <button
              onClick={() => useUIStore.getState().setMobileTab('characters')}
              className="mt-1 px-4 py-2 rounded-full text-sm bg-gene-purple text-white shadow-[0_2px_12px_rgba(108,92,231,0.35)]"
            >
              去选角色
            </button>
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
                  onClick: () => setDeleteTarget(c),
                },
              ];
              return (
                <SwipeActionItem key={c.id} actions={actions} onClick={() => handleItemClick(c)}>
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
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-2xl bg-surface border border-line transition-colors active:bg-surface-strong"
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
                        {c.pinned && <span className="text-[10px] text-gene-purple shrink-0">📌</span>}
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
                setDeleteTarget(menu.char);
                setMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              删除会话
            </button>
            <button
              onClick={() => {
                void hideFromChatList(menu.char.id);
                setMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-sub hover:bg-surface transition-colors"
            >
              从聊天列表移除
            </button>
            <p className="px-4 pt-1.5 pb-1 text-[10px] text-gray-400">移除仅隐藏列表项，角色与聊天记录保留</p>
          </div>
        </>
      )}

      {/* 删除会话确认（微信式） */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setDeleteTarget(null)} />
          <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-panel border-t border-line p-4 pb-[max(env(safe-area-inset-bottom),16px)] animate-fade-in">
            <p className="text-sm font-medium text-ink text-center mb-1">
              删除与「{deleteTarget.name}」的会话？
            </p>
            <p className="text-xs text-gray-500 text-center mb-4">
              将清空与该角色的聊天记录，角色本身保留（可在角色页重新开始）。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 rounded-xl bg-surface border border-line text-sm text-ink transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  void clearSessionsForCharacter(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white text-sm font-medium transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
