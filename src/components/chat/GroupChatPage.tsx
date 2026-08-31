import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGroupStore, PROACTIVE_AFTER_MS } from '../../store/group-store';
import { useChatStore } from '../../store/chat-store';
import { useTTS } from '../../lib/tts';
import { ipc } from '../../lib/ipc-client';
import { resolveModel } from '../../lib/ai/llm';
import { Avatar } from '../ui/Avatar';
import type { Character, Group, Message } from '../../db/index';

/** 群聊页面：群列表 → 建群 → 群聊窗口 → 群设置（一体，全屏覆盖） */
export function GroupChatPage({ onClose, initialGroupId }: { onClose: () => void; initialGroupId?: string }) {
  const groups = useGroupStore((s) => s.groups);
  const loadGroups = useGroupStore((s) => s.loadGroups);
  const selectGroup = useGroupStore((s) => s.selectGroup);
  const [view, setView] = useState<'list' | 'chat'>(initialGroupId ? 'chat' : 'list');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadGroups();
    if (initialGroupId) {
      void selectGroup(initialGroupId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-app flex flex-col">
      {/* 顶部状态栏深色条（与主界面一致：安全区 + 24px 兜底，任何机型标题都不被状态栏/黑条盖住） */}
      <div className="shrink-0 bg-[#0F0F1A]" style={{ height: 'calc(env(safe-area-inset-top, 0px) + 24px)' }} />
      {/* 头部 */}
      <div className="h-12 flex items-center gap-2 px-3 border-b border-line shrink-0">
        <button
          onClick={() => {
            if (view === 'chat') {
              setView('list');
              void loadGroups();
            } else onClose();
          }}
          className="shrink-0 w-8 h-8 -ml-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-surface transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="text-sm font-medium text-ink flex-1">{view === 'chat' ? '' : '群聊'}</span>
        {view === 'list' && (
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs text-gene-purple hover:bg-gene-purple/10 transition-colors"
          >
            发起群聊
          </button>
        )}
      </div>

      {view === 'list' ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {groups.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <p className="text-sm text-gray-500">还没有群聊</p>
              <p className="text-xs text-gray-400 mt-1">把 2~5 个数字灵魂拉进一个群，看他们互相拌嘴</p>
              <button
                onClick={() => setCreating(true)}
                className="mt-4 px-4 py-2 rounded-xl bg-gene-purple text-white text-sm hover:bg-[#5B4BD4] transition-colors"
              >
                发起群聊
              </button>
            </div>
          ) : (
            groups.map((g) => <GroupCard key={g.id} group={g} onOpen={() => { void selectGroup(g.id); setView('chat'); }} />)
          )}
        </div>
      ) : (
        <GroupChatWindow onBack={() => setView('list')} />
      )}

      {creating && (
        <GroupCreateModal
          onClose={() => setCreating(false)}
          onCreated={(g) => {
            setCreating(false);
            void selectGroup(g.id);
            setView('chat');
          }}
        />
      )}
    </div>
  );
}

/** 群卡片 */
function GroupCard({ group, onOpen }: { group: Group; onOpen: () => void }) {
  const members = useChatStore((s) => s.characters).filter((c) => group.characterIds.includes(c.id));
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-line hover:border-gene-purple/40 transition-colors text-left"
    >
      <span className="shrink-0 w-10 h-10 rounded-xl bg-gene-purple/12 flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6C5CE7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink truncate">{group.name}</span>
        <span className="block text-[11px] text-gray-500 mt-0.5 truncate">
          {members.length > 0 ? members.map((m) => m.name).join('、') : '成员已全部移除'}
        </span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 shrink-0">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

/** 图片压缩：dataURL → canvas 缩放（最大边 1280）+ JPEG 0.82（与单聊 ChatInput 一致） */
function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_EDGE = 1280;
          const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(dataUrl); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

/** 群聊窗口 */
function GroupChatWindow({ onBack }: { onBack: () => void }) {
  const group = useGroupStore((s) => s.currentGroup);
  const messages = useGroupStore((s) => s.groupMessages);
  const sending = useGroupStore((s) => s.groupSending);
  const error = useGroupStore((s) => s.groupError);
  const send = useGroupStore((s) => s.sendGroupMessage);
  const deleteGroupMessage = useGroupStore((s) => s.deleteGroupMessage);
  const { speakingKey, busyKey, speak, stop } = useTTS();
  const characters = useChatStore((s) => s.characters);
  const [settings, setSettings] = useState(false);
  const [input, setInput] = useState('');
  /** 长按消息弹出的操作菜单（Android WebView 长按触发 contextmenu，与单聊 MessageBubble 一致） */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 引用回复的目标消息 */
  const [quote, setQuote] = useState<Message | null>(null);
  /** 待发送图片（压缩 dataURL） */
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  /** 群内消息搜索 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 点击别处关闭长按菜单
  useEffect(() => {
    if (!menu) return;
    const handler = () => {
      setMenu(null);
      setConfirmDeleteId(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menu]);

  /** AI 主动发言：用户停留在群聊页且长时间没说话时，成员主动开口（每 60s 检查一次） */
  useEffect(() => {
    const t = setInterval(() => {
      const s = useGroupStore.getState();
      const msgs = s.groupMessages;
      if (msgs.length === 0 || s.groupSending) return;
      const lastAt = msgs[msgs.length - 1].createdAt;
      if (Date.now() - lastAt >= PROACTIVE_AFTER_MS) {
        void s.proactiveGroupTurn();
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const handleCopy = async (id: string) => {
    if (copiedId === id) return;
    const m = messages.find((x) => x.id === id);
    if (!m) return;
    await ipc.clipboard.writeText(m.content);
    setCopiedId(id);
    setMenu(null);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const members = useMemo(
    () => characters.filter((c) => group?.characterIds.includes(c.id)),
    [characters, group],
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // 滚底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  const handleSend = () => {
    const t = input.trim();
    if ((!t && !pendingImage) || sending) return;
    const img = pendingImage;
    const q = quote;
    setInput('');
    setPendingImage(null);
    setQuote(null);
    void send(t, {
      image: img ?? undefined,
      quoteId: q?.id,
      quoteContent: q ? q.content.slice(0, 60) : undefined,
    });
  };

  /** 选择图片 → 压缩 → 待发送预览 */
  const handlePickImage = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setPendingImage(await compressImage(reader.result as string));
    };
    reader.readAsDataURL(f);
    if (fileRef.current) fileRef.current.value = '';
  };

  /** 搜索结果：按关键词过滤（最新在前） */
  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return messages
      .filter((m) => m.content.includes(q))
      .slice(-50)
      .reverse();
  }, [query, messages]);

  const jumpToMessage = (id: string) => {
    setSearchOpen(false);
    setQuery('');
    setTimeout(() => {
      document.getElementById(`gmsg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  /** 🔊 群消息朗读（按发言人声线） */
  const handleSpeak = (m: { id: string; senderId?: string; content: string }) => {
    if (!m.senderId) return;
    const voice = memberById.get(m.senderId)?.voice;
    if (!voice || !m.content.trim()) return;
    if (speakingKey === m.id) {
      stop();
      return;
    }
    void speak(m.id, m.content.trim().slice(0, 800), voice.voice, voice.rate, voice.pitch);
  };

  const displayName = (senderId?: string) => {
    if (!senderId) return '成员';
    return group?.memberNicknames?.[senderId] || memberById.get(senderId)?.name || '成员';
  };

  return (
    <>
      {/* 头部：群名 + 成员头像 + 搜索 + 设置 */}
      <div className="h-14 px-3 border-b border-line shrink-0 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink truncate">{group?.name ?? '群聊'}</p>
          <div className="flex items-center gap-1 mt-1">
            {members.slice(0, 5).map((m) => (
              <span key={m.id} className="w-5 h-5 -ml-1 first:ml-0 rounded-full ring-1 ring-app overflow-hidden">
                <Avatar avatar={m.avatar} size="sm" />
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => setSearchOpen((v) => !v)}
          title="搜索群消息"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-surface transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          onClick={() => setSettings(true)}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-surface transition-colors"
          title="群设置"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* 群内消息搜索 */}
      {searchOpen && (
        <div className="border-b border-line bg-app px-3 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索群消息…"
              className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-3 py-1.5 text-xs text-ink placeholder-gray-500 outline-none focus:border-gene-purple"
            />
            <button onClick={() => { setSearchOpen(false); setQuery(''); }} className="shrink-0 text-xs text-gray-400 hover:text-ink px-1">
              取消
            </button>
          </div>
          {query.trim() && (
            <div className="mt-2 max-h-44 overflow-y-auto space-y-1">
              {searchResults.length === 0 && <p className="text-[11px] text-gray-500 px-1 py-1">没有匹配的消息</p>}
              {searchResults.map((m) => {
                const s = memberById.get(m.senderId ?? '');
                return (
                  <button
                    key={m.id}
                    onClick={() => jumpToMessage(m.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-panel/60 border border-line text-left hover:border-gene-purple/40"
                  >
                    <span className="shrink-0 w-5 h-5 rounded-full overflow-hidden">
                      <Avatar avatar={m.role === 'user' ? '🙂' : (s?.avatar ?? '🧬')} size="sm" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-gray-500 truncate">
                        {m.role === 'user' ? '我' : (s?.name ?? '成员')}
                      </span>
                      <span className="block text-xs text-ink truncate">{m.content}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 消息 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-gray-600">在群里发句话，看看他们会怎么接</p>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} id={`gmsg-${m.id}`} className="flex justify-end mb-3">
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ id: m.id, x: e.clientX, y: e.clientY });
                  }}
                  className="max-w-[75%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-gene-purple text-white text-sm leading-relaxed whitespace-pre-wrap break-words"
                >
                  {m.replyToContent && (
                    <div className="text-xs mb-1.5 line-clamp-1 border-l-2 pl-2 border-white/40 text-white/70">
                      {m.replyToContent}
                    </div>
                  )}
                  {m.image && (
                    <img src={m.image} alt="图片" className="max-w-[200px] max-h-[240px] rounded-xl object-cover mb-1.5" />
                  )}
                  {m.content}
                </div>
              </div>
            );
          }
          const sender = memberById.get(m.senderId ?? '');
          return (
            <div key={m.id} id={`gmsg-${m.id}`} className="flex items-start gap-2 mb-3">
              <span className="shrink-0 w-8 h-8 rounded-full overflow-hidden">
                <Avatar avatar={sender?.avatar ?? '🧬'} size="sm" />
              </span>
              <div className="max-w-[75%] min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] text-gray-500 truncate">{displayName(m.senderId)}</span>
                  {sender?.voice && (
                    <button
                      onClick={() => handleSpeak(m)}
                      title={speakingKey === m.id ? '停止' : busyKey === m.id ? '合成中…' : '朗读'}
                      className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-md transition-colors ${
                        speakingKey === m.id || busyKey === m.id ? 'text-life-cyan' : 'text-gray-300 hover:text-ink'
                      }`}
                    >
                      {speakingKey === m.id ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ id: m.id, x: e.clientX, y: e.clientY });
                  }}
                  className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-msgai border-l-2 border-life-cyan text-sm text-msgaitxt leading-relaxed whitespace-pre-wrap break-words"
                >
                  {m.image && (
                    <img src={m.image} alt="图片" className="max-w-[200px] max-h-[240px] rounded-xl object-cover mb-1.5" />
                  )}
                  {m.content}
                </div>
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex items-start gap-2 mb-3">
            <span className="shrink-0 w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center">
              <span className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-life-cyan animate-spin" />
            </span>
            <div className="text-xs text-gray-400 py-2">群成员们正在输入…</div>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-t border-red-500/20">
          <span className="text-xs text-red-400 flex-1">{error}</span>
        </div>
      )}

      {/* 长按消息 → 操作菜单（portal 到 body，z 高于群聊覆盖层 z-[70]） */}
      {menu &&
        createPortal(
          <div
            className="fixed z-[90] min-w-[150px] py-1.5 glass-card rounded-xl shadow-2xl"
            style={{ left: menu.x + 4, top: menu.y + 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            {confirmDeleteId === menu.id ? (
              <div className="px-4 py-2">
                <p className="text-sm text-sub mb-1">删除这条消息？</p>
                <p className="text-xs text-gray-500 mb-3">这段基因序列将被永久抹除</p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-surface transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      void deleteGroupMessage(menu.id);
                      setConfirmDeleteId(null);
                      setMenu(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => void handleCopy(menu.id)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-sub hover:bg-surface transition-colors"
                >
                  {copiedId === menu.id ? '✅ 已复制' : '📋 复制'}
                </button>
                <button
                  onClick={() => {
                    const q = messages.find((x) => x.id === menu.id);
                    if (q) setQuote(q);
                    setMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-sub hover:bg-surface transition-colors"
                >
                  💬 引用
                </button>
                <button
                  onClick={() => setConfirmDeleteId(menu.id)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  🗑 删除
                </button>
              </>
            )}
          </div>,
          document.body,
        )}

      {/* 输入区：引用条 + 图片预览 + 图片按钮 + 文本框 + 发送 */}
      <div className="border-t border-line p-3 shrink-0">
        {(quote || pendingImage) && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-panel/60 border border-line">
            {pendingImage && (
              <img src={pendingImage} alt="待发送" className="w-10 h-10 rounded-lg object-cover shrink-0" />
            )}
            {quote && (
              <span className="flex-1 min-w-0 text-xs text-gray-500 truncate border-l-2 pl-2 border-life-cyan">
                {quote.content.slice(0, 40)}
              </span>
            )}
            <button
              onClick={() => { setQuote(null); setPendingImage(null); }}
              className="shrink-0 text-gray-400 hover:text-ink text-sm leading-none"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handlePickImage(e.target.files)} />
          <button
            onClick={() => fileRef.current?.click()}
            title="发图片"
            className="shrink-0 w-10 h-10 rounded-xl bg-surface border border-line-strong text-gray-500 flex items-center justify-center hover:text-gene-purple transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={sending ? '群成员们正在输入…' : '发消息…'}
            rows={1}
            className="flex-1 resize-none bg-surface border border-line-strong rounded-xl px-4 py-2.5 text-sm text-ink placeholder-gray-500 outline-none focus:border-gene-purple transition-all disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            disabled={sending || (!input.trim() && !pendingImage)}
            className="shrink-0 w-10 h-10 rounded-xl bg-gene-purple text-white flex items-center justify-center hover:bg-[#5B4BD4] shadow-[0_2px_12px_rgba(108,92,231,0.35)] transition-all disabled:opacity-30 disabled:shadow-none"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* 群设置 */}
      {settings && group && <GroupSettings group={group} members={members} onClose={() => setSettings(false)} />}
    </>
  );
}

/** 群设置：改名 / 加人 / 踢人 / 群内昵称 / 解散 */
function GroupSettings({ group, members, onClose }: { group: Group; members: Character[]; onClose: () => void }) {
  const updateGroup = useGroupStore((s) => s.updateGroup);
  const removeMember = useGroupStore((s) => s.removeMember);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);
  const setMemberNickname = useGroupStore((s) => s.setMemberNickname);
  const characters = useChatStore((s) => s.characters);
  const [name, setName] = useState(group.name);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nickEditingId, setNickEditingId] = useState<string | null>(null);

  const candidates = characters.filter((c) => !group.characterIds.includes(c.id));
  const memberById = new Map(members.map((m) => [m.id, m]));

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm glass-card rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <span className="text-sm font-medium text-ink">群设置</span>
          <button onClick={onClose} className="text-gray-400 hover:text-ink text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-4">
          {/* 群聊模型（透明：群聊生成使用全局默认模型，成员各自模型 P1） */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink">群聊模型</span>
            <span className="text-[11px] text-gene-purple">{resolveModel().label}</span>
          </div>

          {/* 群名 */}
          <div>
            <p className="text-xs text-gray-500 mb-1.5">群名称</p>
            <div className="flex items-center gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-gene-purple"
              />
              <button
                onClick={() => void updateGroup(group.id, { name: name.trim() || group.name })}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] bg-gene-purple/15 text-gene-purple hover:bg-gene-purple/25"
              >
                保存
              </button>
            </div>
          </div>

          {/* 成员（含群内昵称备注） */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-gray-500">成员（{group.characterIds.length}）</p>
              <button onClick={() => setShowAdd(true)} className="text-[11px] text-life-cyan hover:underline">
                添加成员
              </button>
            </div>
            <div className="space-y-1.5">
              {group.characterIds.map((id) => {
                const m = memberById.get(id);
                const nick = group.memberNicknames?.[id];
                return (
                  <div key={id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-panel/60 border border-line">
                    <span className="w-6 h-6 rounded-full overflow-hidden shrink-0">
                      <Avatar avatar={m?.avatar ?? '🧬'} size="sm" />
                    </span>
                    {nickEditingId === id ? (
                      <input
                        autoFocus
                        defaultValue={nick ?? m?.name ?? ''}
                        onBlur={(e) => {
                          void setMemberNickname(group.id, id, e.target.value);
                          setNickEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="flex-1 min-w-0 bg-surface border border-gene-purple/40 rounded-md px-2 py-0.5 text-xs text-ink outline-none"
                      />
                    ) : (
                      <span className="flex-1 min-w-0 text-xs text-ink truncate">
                        {nick ? `${m?.name ?? '角色'}（${nick}）` : (m?.name ?? '已删除角色')}
                      </span>
                    )}
                    <button
                      onClick={() => setNickEditingId(nickEditingId === id ? null : id)}
                      title="群内昵称"
                      className="text-[11px] text-gray-400 hover:text-life-cyan"
                    >
                      备注
                    </button>
                    <button
                      onClick={() => void removeMember(group.id, id)}
                      className="text-[11px] text-gray-400 hover:text-red-400"
                    >
                      移除
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 加人 */}
          {showAdd && candidates.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">选择要添加的角色</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    disabled={group.characterIds.length >= 5}
                    onClick={() => void updateGroup(group.id, { characterIds: [...group.characterIds, c.id] })}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-panel/60 border border-line hover:border-gene-purple/40 text-left disabled:opacity-40"
                  >
                    <span className="w-6 h-6 rounded-full overflow-hidden shrink-0">
                      <Avatar avatar={c.avatar} size="sm" />
                    </span>
                    <span className="flex-1 text-xs text-ink truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 解散 */}
          {confirmDelete ? (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-xs text-red-400 mb-2">解散后群聊记录将永久删除，确定？</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg text-[11px] text-gray-400 hover:bg-surface">
                  取消
                </button>
                <button
                  onClick={() => {
                    void deleteGroup(group.id);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg text-[11px] bg-red-500/20 text-red-400 hover:bg-red-500/30"
                >
                  解散群
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="w-full px-3 py-2 rounded-lg text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors">
              解散群聊
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 建群：群名 + 勾选角色（2~5 个） */
function GroupCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (g: Group) => void }) {
  const characters = useChatStore((s) => s.characters);
  const createGroup = useGroupStore((s) => s.createGroup);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm glass-card rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <span className="text-sm font-medium text-ink">发起群聊</span>
          <button onClick={onClose} className="text-gray-400 hover:text-ink text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="群名称（可选）"
            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-500 outline-none focus:border-gene-purple"
          />
          <p className="text-[11px] text-gray-500">选择角色（{selected.length}/5，至少 2 个）</p>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {characters.map((c) => (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors ${
                  selected.includes(c.id)
                    ? 'bg-gene-purple/10 border-gene-purple/40'
                    : 'bg-panel/60 border-line hover:border-gene-purple/30'
                }`}
              >
                <span className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                  <Avatar avatar={c.avatar} size="sm" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink truncate">{c.name}</span>
                  {c.signature && <span className="block text-[10px] text-gray-500 truncate">{c.signature}</span>}
                </span>
                <span className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${
                  selected.includes(c.id) ? 'bg-gene-purple border-gene-purple text-white' : 'border-gray-300 text-transparent'
                }`}>
                  ✓
                </span>
              </button>
            ))}
          </div>
          <button
            disabled={selected.length < 2}
            onClick={() => {
              void createGroup(name, selected).then((g) => g && onCreated(g));
            }}
            className="w-full py-2.5 rounded-xl bg-gene-purple text-white text-sm font-medium hover:bg-[#5B4BD4] transition-colors disabled:opacity-30"
          >
            创建群聊
          </button>
        </div>
      </div>
    </div>
  );
}
