import { useEffect, useMemo } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
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
 * 「聊天」tab 的微信式会话列表：每个角色一行（头像 / 名字 / 最近消息预览 / 时间 / 未读红点），
 * 点击进入聊天（推入层），返回时回到本列表——绝不跳「角色」页。
 * 排序：有对话的按最后消息时间倒序在前，没对话的按名字拼音排后。
 */
export function MobileChatListPage({ onSelect }: { onSelect: (c: Character) => void }) {
  const characters = useChatStore((s) => s.characters);
  const charPreviews = useChatStore((s) => s.charPreviews);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const loadCharacters = useChatStore((s) => s.loadCharacters);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);

  useEffect(() => {
    void loadCharacters();
    void fetchUnreadCounts();
  }, [loadCharacters, fetchUnreadCounts]);

  const sorted = useMemo(() => {
    return [...characters].sort((a, b) => {
      const ta = charPreviews[a.id]?.createdAt ?? 0;
      const tb = charPreviews[b.id]?.createdAt ?? 0;
      if (ta && tb) return tb - ta;
      if (ta) return -1;
      if (tb) return 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [characters, charPreviews]);

  const hasAnyPreview = characters.some((c) => charPreviews[c.id]);

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-line shrink-0">
        <span className="text-base font-bold bg-gradient-to-r from-gene-purple to-life-cyan bg-clip-text text-transparent">
          聊天
        </span>
        <span className="text-[10px] text-gray-400">{characters.length} 位灵魂</span>
      </div>

      {/* 会话列表（微信式：每行圆角卡片，带间距） */}
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
            {!hasAnyPreview && (
              <div className="px-2 py-2 text-[11px] text-gray-500">
                还没有聊天记录，点一个角色开始对话吧
              </div>
            )}
            {sorted.map((c) => {
              const preview = charPreviews[c.id];
              const unread = unreadByCharacter[c.id] ?? 0;
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
