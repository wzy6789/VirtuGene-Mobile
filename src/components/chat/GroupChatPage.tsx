import { Modal } from '../ui/Modal';
import { useFeedback } from '../../lib/feedback';
import { useAuthStore } from '../../store/auth-store';
import { SettingsField, SettingsGroup, SettingsSwitch } from '../settings/SettingsUI';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { ImagePreview } from '../ui/ImagePreview';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGroupStore, PROACTIVE_AFTER_MS } from '../../store/group-store';
import { useChatStore } from '../../store/chat-store';
import { useTTS } from '../../lib/tts';
import { ipc } from '../../lib/ipc-client';
import { resolveModel } from '../../lib/ai/llm';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { db, type Character, type Group, type Message } from '../../db/index';
import { IS_MOBILE } from '../../lib/platform';
import { usePageSwipe } from '../ui/usePageSwipe';
import { useLatestMessageScroll } from '../ui/useLatestMessageScroll';

/** 群聊页面：群列表 → 建群 → 群聊窗口 → 群设置（一体，全屏覆盖） */
export function GroupChatPage({ onClose, initialGroupId }: { onClose: () => void; initialGroupId?: string }) {
  const groups = useGroupStore((s) => s.groups);
  const loadGroups = useGroupStore((s) => s.loadGroups);
  const selectGroup = useGroupStore((s) => s.selectGroup);
  const currentGroup = useGroupStore((s) => s.currentGroup);
  const currentSessionId = useGroupStore((s) => s.currentSessionId);
  const userId = useAuthStore((s) => s.userId);
  const owner = useRef(userId).current;
  const [view, setView] = useState<'list' | 'chat'>(initialGroupId ? 'chat' : 'list');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(initialGroupId);
  const [opening, setOpening] = useState(!!initialGroupId);
  const [loading, setLoading] = useState(true);
  const [listIssue, setListIssue] = useState('');
  const [openIssue, setOpenIssue] = useState('');
  const selection = useRef(0), listRequest = useRef(0), alive = useRef(true);
  const belongs = () => alive.current && !!owner && useAuthStore.getState().userId === owner;
  const refreshGroups = async () => {
    const request = ++listRequest.current;
    setLoading(true); setListIssue('');
    try { await loadGroups(); }
    catch { if (belongs() && request === listRequest.current) setListIssue('群聊列表没有读取成功，请重试。'); }
    finally { if (belongs() && request === listRequest.current) setLoading(false); }
  };
  const openGroup = async (id: string) => {
    if (!belongs()) return;
    const request = ++selection.current;
    setSelectedId(id); setView('chat'); setOpening(true); setOpenIssue('');
    try {
      await selectGroup(id);
      if (!belongs() || request !== selection.current) return;
      const state = useGroupStore.getState();
      if (state.currentGroup?.id !== id || state.currentGroup.userId !== owner || !state.currentSessionId) setOpenIssue('这个群聊暂时无法打开，请重试或返回列表。');
    } catch { if (belongs() && request === selection.current) setOpenIssue('群聊没有读取成功，请重试。'); }
    finally { if (belongs() && request === selection.current) setOpening(false); }
  };
  const leaveChat = () => { ++selection.current; setView('list'); setOpening(false); setOpenIssue(''); void refreshGroups(); };
  const goBack = () => { if (creating) setCreating(false); else if (view === 'chat') leaveChat(); else onClose(); };
  const swipeRef = usePageSwipe(IS_MOBILE && !creating, view, dx => dx > 0, goBack, true);
  const backRef = useRef(goBack); backRef.current = goBack;
  useEffect(() => {
    const panel = swipeRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    // Nested menus own their focus and back handling until dismissed.
    const childDialogOpen = () => [...document.querySelectorAll('[aria-modal="true"]')].some(node => node !== panel);
    const targets = () => [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])]
      .filter(node => node.tabIndex >= 0 && !node.closest('[inert],[hidden]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const focusFrame = requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || childDialogOpen()) return;
      if (event.key === 'Escape') { event.preventDefault(); window.dispatchEvent(new Event('vg:back-request', { cancelable: true })); }
      if (event.key !== 'Tab') return;
      const items = targets(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); panel?.focus({ preventScroll: true }); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus({ preventScroll: true }); }
    };
    const onFocus = (event: FocusEvent) => { if (!childDialogOpen() && panel && !panel.contains(event.target as Node)) panel.focus({ preventScroll: true }); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const handleBack = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]:not([data-group-page])')) return;
      event.preventDefault(); backRef.current();
    };
    window.addEventListener('vg:back-request', handleBack);
    return () => window.removeEventListener('vg:back-request', handleBack);
  }, []);

  useEffect(() => {
    alive.current = true;
    void refreshGroups();
    if (initialGroupId) void openGroup(initialGroupId);
    return () => { alive.current = false; ++selection.current; ++listRequest.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ownedGroups = groups.filter(group => group.userId === userId);
  const ready = !opening && !openIssue && currentGroup?.id === selectedId && currentGroup?.userId === userId && !!currentSessionId;
  if (userId !== owner) return null;

  return createPortal(
    <div ref={swipeRef} data-group-page role="dialog" aria-modal="true" aria-label="群聊" tabIndex={-1} className="fixed inset-0 vg-layer-page bg-app flex min-h-0 flex-col overflow-hidden"
      style={{ touchAction: 'pan-y', paddingTop: IS_MOBILE ? 'var(--vg-safe-top)' : 0 }}>
      {(view === 'list' || !ready) && (
        <div data-group-header className="min-h-14 flex items-center gap-2 px-3 py-2 border-b border-line shrink-0">
          <button onClick={goBack} aria-label="返回" className="vg-button vg-button-ghost shrink-0 w-11 h-11" style={{ padding: 0 }}>
            <Icon name="back" size={20} />
          </button>
          <h1 className="text-lg font-medium text-ink flex-1">群聊</h1>
          {view === 'list' && <button onClick={() => setCreating(true)} className="vg-button vg-button-secondary shrink-0"><Icon name="plus" />发起群聊</button>}
        </div>
      )}

      {view === 'list' ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
          {listIssue && <FeedbackNotice message={listIssue} tone="error"><button type="button" onClick={() => void refreshGroups()}>重试</button></FeedbackNotice>}
          {loading && ownedGroups.length === 0 ? <LoadingSkeleton label="正在读取群聊" /> : ownedGroups.length === 0 && !listIssue ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <span className="w-16 h-16 rounded-2xl bg-surface grid place-items-center text-sub mb-4"><Icon name="moment" size={28} /></span>
              <p className="text-lg font-medium text-ink">把大家聚在一起</p>
              <p className="text-sm text-sub leading-relaxed mt-2">选择 2–5 位角色，开启你们的共同聊天。</p>
              <button
                onClick={() => setCreating(true)}
                className="vg-button vg-button-primary mt-6"
              >
                发起群聊
              </button>
            </div>
          ) : (
            ownedGroups.map((g) => <GroupCard key={g.id} group={g} onOpen={() => void openGroup(g.id)} />)
          )}
        </div>
      ) : (
        ready ? <GroupChatWindow key={`${userId}:${selectedId}`} onBack={leaveChat} /> : <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {opening ? <LoadingSkeleton label="正在打开群聊" /> : <FeedbackNotice message={openIssue || '这个群聊已发生变化，请重新打开。'} tone="error">
            <button type="button" onClick={() => selectedId && void openGroup(selectedId)}>重新打开</button>
            <button type="button" onClick={leaveChat}>返回列表</button>
          </FeedbackNotice>}
        </div>
      )}

      {creating && (
        <GroupCreateModal
          onClose={() => setCreating(false)}
          onCreated={(g) => {
            setCreating(false);
            void openGroup(g.id);
          }}
        />
      )}
    </div>, document.body,
  );
}

/** 群卡片 */
function GroupCard({ group, onOpen }: { group: Group; onOpen: () => void }) {
  const members = useChatStore((s) => s.characters).filter((c) => c.agentProfile !== 'secretary' && group.characterIds.includes(c.id));
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl border border-line text-left"
      style={{ background: 'var(--vg-elev-1)', boxShadow: 'inset 0 1px 0 var(--vg-elev-highlight)' }}
    >
      <span className="shrink-0 w-12 h-12 rounded-2xl bg-panel grid place-items-center text-sub">
        <Icon name="moment" size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-ink truncate">{group.name}</span>
        <span className="block text-xs text-sub mt-1 truncate">
          {members.length > 0 ? members.map((m) => m.name).join('、') : '成员已全部移除'}
        </span>
      </span>
      <Icon name="chevron" size={16} className="text-sub shrink-0" />
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
  const currentSessionId = useGroupStore((s) => s.currentSessionId);
  const userId = useAuthStore((s) => s.userId);
  const messages = useGroupStore((s) => s.groupMessages);
  const sending = useGroupStore((s) => s.groupSending);
  const error = useGroupStore((s) => s.groupError);
  const send = useGroupStore((s) => s.sendGroupMessage);
  const deleteGroupMessage = useGroupStore((s) => s.deleteGroupMessage);
  const feedback = useFeedback();
  const rememberGroupMessage = useGroupStore((s) => s.rememberGroupMessage);
  const { speakingKey, busyKey, speak, stop } = useTTS();
  const characters = useChatStore((s) => s.characters);
  const [settings, setSettings] = useState(false);
  const [input, setInput] = useState('');
  /** 长按消息弹出的操作菜单（Android WebView 长按触发 contextmenu，与单聊 MessageBubble 一致） */
  const [menu, setMenu] = useState<{ id: string; userId: string; groupId: string; sessionId: string } | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const menuLock = useRef(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 引用回复的目标消息 */
  const [quote, setQuote] = useState<Message | null>(null);
  /** 待发送图片（压缩 dataURL） */
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  /** 图片大图预览 */
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  /** 群内消息搜索 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const handleBack = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]:not([data-group-page])')) return;
      if (previewImage) setPreviewImage(null);
      else if (menu) { setMenu(null); setConfirmDeleteId(null); }
      else if (settings) setSettings(false);
      else if (searchOpen) { setSearchOpen(false); setQuery(''); }
      else return;
      event.preventDefault();
    };
    window.addEventListener('vg:back-request', handleBack, true);
    return () => window.removeEventListener('vg:back-request', handleBack, true);
  }, [previewImage, menu, settings, searchOpen]);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [followingLatest, setFollowingLatest] = useState(true);
  const scrollToLatest = useLatestMessageScroll(scrollRef, group?.id, setFollowingLatest);
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = Math.min(field.scrollHeight, 160) + 'px';
  }, [input, currentSessionId]);

  const closeMenu = () => { setMenu(null); setConfirmDeleteId(null); };
  // A menu belongs to the account and group that opened it, never the next one.
  useEffect(() => {
    closeMenu();
  }, [userId, group?.id, currentSessionId]);
  const menuIsCurrent = (target: typeof menu) => {
    const state = useGroupStore.getState();
    return !!target && useAuthStore.getState().userId === target.userId
      && state.currentGroup?.userId === target.userId && state.currentGroupId === target.groupId
      && state.currentSessionId === target.sessionId
      && state.groupMessages.some(message => message.id === target.id && message.sessionId === target.sessionId);
  };
  const openMenu = (message: Message) => {
    if (menuLock.current || !userId || group?.userId !== userId || currentSessionId !== message.sessionId) return;
    setConfirmDeleteId(null);
    setMenu({ id: message.id, userId, groupId: group.id, sessionId: message.sessionId });
  };
  const visibleMenu = menuIsCurrent(menu) ? menu : null;
  const focusAfterMenu = (element: HTMLElement | null, target: NonNullable<typeof menu>) => {
    requestAnimationFrame(() => {
      const state = useGroupStore.getState();
      if (element?.isConnected && useAuthStore.getState().userId === target.userId
        && state.currentGroupId === target.groupId && state.currentSessionId === target.sessionId
        && !document.querySelector('[aria-modal="true"]:not([data-group-page])')) element.focus({ preventScroll: true });
    });
  };

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

  const runMenuAction = async (action: 'copy' | 'remember' | 'delete') => {
    const target = menu;
    if (menuLock.current || !target || !menuIsCurrent(target)
      || action !== 'copy' && useGroupStore.getState().groupSending) return;
    menuLock.current = true; setMenuBusy(true);
    try {
      if (action === 'copy') {
        const message = useGroupStore.getState().groupMessages.find(item => item.id === target.id);
        if (!message) return;
        const copied = await ipc.clipboard.writeText(message.content || (message.image ? '[图片]' : ''));
        if (menuIsCurrent(target)) {
          if (!copied) throw new Error('Clipboard unavailable');
          closeMenu(); feedback('已复制', { tone: 'success' });
        }
        return;
      }
      // Check persisted ownership before calling the existing store operation.
      const [session, message] = await Promise.all([db.sessions.get(target.sessionId), db.messages.get(target.id)]);
      if (!menuIsCurrent(target) || useGroupStore.getState().groupSending
        || session?.userId !== target.userId || session.type !== 'group' || session.groupId !== target.groupId
        || message?.sessionId !== target.sessionId) return;
      const row = document.getElementById(`gmsg-${target.id}`);
      const nextMessage = (row?.nextElementSibling?.querySelector<HTMLElement>('[data-group-message]')
        ?? row?.previousElementSibling?.querySelector<HTMLElement>('[data-group-message]') ?? scrollRef.current);
      if (action === 'delete') await deleteGroupMessage(target.id);
      else await rememberGroupMessage(target.id);
      if (useAuthStore.getState().userId === target.userId) {
        closeMenu();
        if (action === 'delete') { feedback('消息已删除', { tone: 'success' }); focusAfterMenu(nextMessage, target); }
      }
    } catch {
      if (useAuthStore.getState().userId === target.userId) feedback(action === 'copy' ? '复制未完成，请重试' : action === 'delete' ? '消息未能删除，请重试' : '未能记住这条消息，请重试', { tone: 'error' });
    } finally { menuLock.current = false; setMenuBusy(false); }
  };

  const members = useMemo(
    () => characters.filter((c) => c.agentProfile !== 'secretary' && group?.characterIds.includes(c.id)),
    [characters, group],
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  /** @ 输入联想：输入框末尾有"正在输入的 @"（@ 后无空格）时弹出成员选择器 */
  const atCandidate = useMemo(() => {
    const m = input.match(/@([^\s@，,。！!？?]*)$/);
    return m ? m[1] : null;
  }, [input]);
  const atPickerMembers = useMemo(() => {
    if (atCandidate === null) return [];
    return members.filter((mem) => !input.includes(`@${mem.name}`));
  }, [atCandidate, input, members]);

  const insertAtName = (name: string) => {
    const idx = input.lastIndexOf('@');
    if (idx < 0) return;
    setInput(input.slice(0, idx) + `@${name} `);
    inputRef.current?.focus();
  };

  // New replies and keyboard/layout changes follow only while the user is at
  // the latest messages. Reading earlier messages remains under their control.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    return scrollToLatest();
  }, [lastMessageId, sending, group?.id, scrollToLatest]);

  const handleInputFocus = () => scrollToLatest();

  const handleSend = () => {
    const t = input.trim();
    if ((!t && !pendingImage) || sending) return;
    const img = pendingImage;
    const q = quote;
    setInput('');
    setPendingImage(null);
    setQuote(null);
    scrollToLatest(true);
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
  const messageActions = (message: Message) => ({
    role: 'article' as const,
    tabIndex: 0,
    'data-group-message': true,
    'aria-label': message.role === 'user' ? '你的群消息' : `${displayName(message.senderId)}的群消息`,
    'aria-haspopup': 'dialog' as const,
    'aria-keyshortcuts': 'Shift+F10',
    onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); openMenu(message);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); openMenu(message);
      }
    },
  });

  /** 长按成员名字/头像 → 直接 @ 该成员（微信式；不弹气泡菜单） */
  const handleLongPressName = (e: React.MouseEvent, senderId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const mem = memberById.get(senderId ?? '');
    if (!mem) return;
    const base = input.replace(/\s+$/, '');
    setInput(base ? `${base} @${mem.name} ` : `@${mem.name} `);
    inputRef.current?.focus();
  };

  return (
    <>
      {/* 头部：群名 + 成员头像 + 搜索 + 设置 */}
      <div data-group-header className="min-h-16 px-3 py-2 border-b border-line shrink-0 flex items-center gap-2">
        <button onClick={onBack} aria-label="返回群聊列表" className="vg-button vg-button-ghost shrink-0 w-11 h-11" style={{ padding: 0 }}>
          <Icon name="back" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-ink truncate">{group?.name ?? '群聊'}</p>
          <div className="flex items-center gap-1 mt-1 h-5" aria-label="群成员头像">
            {members.slice(0, 5).map((m) => (
              <span key={m.id} className="w-5 h-5 shrink-0 rounded-full ring-1 ring-app overflow-hidden">
                <Avatar avatar={m.avatar} size="xs" />
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => setSearchOpen((v) => !v)}
          title="搜索群消息"
          aria-expanded={searchOpen}
          className="vg-button vg-button-ghost shrink-0 w-11 h-11" style={{ padding: 0 }}
        >
          <Icon name="search" size={20} />
        </button>
        <button
          onClick={() => setSettings(true)}
          className="vg-button vg-button-ghost shrink-0 w-11 h-11" style={{ padding: 0 }}
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
              aria-label="搜索群消息"
              placeholder="搜索群消息…"
              className="vg-text-field flex-1 min-w-0 min-h-12 px-3 py-2 text-sm"
            />
            <button onClick={() => { setSearchOpen(false); setQuery(''); }} className="vg-button vg-button-ghost shrink-0">
              取消
            </button>
          </div>
          {query.trim() && (
            <div className="mt-2 max-h-44 overflow-y-auto space-y-1">
              {searchResults.length === 0 && <p className="text-xs text-sub px-1 py-1">没有匹配的消息</p>}
              {searchResults.map((m) => {
                const s = memberById.get(m.senderId ?? '');
                return (
                  <button
                    key={m.id}
                    onClick={() => jumpToMessage(m.id)}
                    className="w-full min-h-12 flex items-center gap-3 px-3 py-3 rounded-xl bg-surface text-left"
                  >
                    <span className="shrink-0 w-5 h-5 rounded-full overflow-hidden">
                      <Avatar avatar={m.role === 'user' ? '🙂' : (s?.avatar ?? '🧬')} size="sm" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-sub truncate">
                        {m.role === 'user' ? '我' : (s?.name ?? '成员')}
                      </span>
                      <span className="block text-sm text-ink truncate">{m.content}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 消息 */}
      <div ref={scrollRef} data-group-thread tabIndex={0} aria-label="群聊消息" className="chat-thread flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div data-group-empty className="min-h-full flex flex-col items-center justify-center px-5 py-8 text-center">
            <div className="flex items-center justify-center mb-6" aria-label={`群成员：${members.map(member => member.name).join('、')}`}>
              {members.slice(0, 5).map((member, index) => <span key={member.id} className="relative shrink-0 rounded-full border-4" style={{ borderColor: 'var(--bg)', marginLeft: index ? -12 : 0, zIndex: 5 - index }}><Avatar avatar={member.avatar} size="lg" /></span>)}
            </div>
            <h2 className="text-xl font-medium text-ink leading-relaxed">从一句问候开始</h2>
            <p className="mt-2 max-w-xs text-sm text-sub leading-relaxed">和大家聊聊今天，也可以输入 @ 选择想聊的角色。</p>
            <button type="button" className="vg-button vg-button-secondary mt-6" onClick={() => {
              setInput(value => value.trim() ? value : '大家好，今天过得怎么样？');
              inputRef.current?.focus();
            }}><Icon name="edit" />写一句开场白</button>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} id={`gmsg-${m.id}`} className="flex justify-end mb-3">
                <div
                  {...messageActions(m)}
                  className="vg-message-bubble is-user-bubble max-w-[75%]" style={{ whiteSpace: 'pre-wrap' }}
                >
                  {m.replyToContent && (
                    <button
                      onClick={() => m.replyToId && jumpToMessage(m.replyToId)}
                      className="min-h-11 w-full text-left text-xs mb-1.5 line-clamp-1 border-l-2 pl-2 border-white/40 text-white"
                    >
                      {m.replyToContent}
                    </button>
                  )}
                  {m.image && (
                    <button type="button" aria-label="查看群聊图片" className="block min-h-11 min-w-11 rounded-xl mb-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewImage(m.image!);
                      }}
                    ><img src={m.image} alt="" className="max-w-full max-h-60 rounded-xl object-cover" /></button>
                  )}
                  {m.content}
                </div>
              </div>
            );
          }
          const sender = memberById.get(m.senderId ?? '');
          return (
            <div key={m.id} id={`gmsg-${m.id}`} className="flex items-start gap-2 mb-3">
              <span
                onContextMenu={(e) => handleLongPressName(e, m.senderId)}
                className="shrink-0 w-8 h-8 rounded-full overflow-hidden"
              >
                <Avatar avatar={sender?.avatar ?? '🧬'} size="sm" />
              </span>
              <div className="max-w-[75%] min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    onContextMenu={(e) => handleLongPressName(e, m.senderId)}
                    className="text-xs text-sub truncate cursor-default"
                  >
                    {displayName(m.senderId)}
                  </span>
                  {sender?.voice && (
                    <button
                      onClick={() => handleSpeak(m)}
                      title={speakingKey === m.id ? '停止' : busyKey === m.id ? '合成中…' : '朗读'}
                      className={`shrink-0 flex items-center justify-center w-11 h-11 rounded-xl transition-colors ${
                        speakingKey === m.id || busyKey === m.id ? 'text-life-cyan' : 'text-sub hover:text-ink'
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
                  {...messageActions(m)}
                  className="vg-message-bubble is-character-bubble" style={{ whiteSpace: 'pre-wrap' }}
                >
                  {m.image && (
                    <button type="button" aria-label="查看群聊图片" className="block min-h-11 min-w-11 rounded-xl mb-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewImage(m.image!);
                      }}
                    ><img src={m.image} alt="" className="max-w-full max-h-60 rounded-xl object-cover" /></button>
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
            <div className="text-xs text-sub py-2">群成员们正在输入…</div>
          </div>
        )}
      </div>
      {messages.length > 0 && <div className="vg-latest-message-anchor" data-visible={!followingLatest} aria-hidden={followingLatest} inert={followingLatest}>
        <button type="button" tabIndex={followingLatest ? -1 : 0} className="vg-latest-message-button" aria-label="回到最新群消息" onClick={event => {
          if (event.detail === 0) scrollRef.current?.focus({ preventScroll: true });
          scrollToLatest(true, 'smooth');
        }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-6-6 6 6 6-6" /></svg>回到最新</button>
      </div>}

      {/* 错误提示 */}
      {error && (
        <FeedbackNotice message={error} tone="error" className="mx-3 mb-2" />
      )}

      <Modal presentation="dialog" open={!!visibleMenu} title={confirmDeleteId ? '删除这条消息？' : '消息操作'} width="max-w-sm"
        onClose={() => { if (!menuLock.current) closeMenu(); }} canSnapshotOnExit={() => false}>
        <div data-group-message-actions className="vg-dialog-actions p-4 space-y-2" aria-busy={menuBusy}>
          {confirmDeleteId === visibleMenu?.id ? <div className="vg-delete-confirmation">
            <p className="text-sm text-sub mb-4">删除后无法恢复这条消息。</p>
            <div className="flex gap-3">
              <button type="button" disabled={menuBusy} onClick={() => setConfirmDeleteId(null)} className="flex-1 min-h-12 rounded-xl border border-line text-sm text-ink disabled:opacity-50">取消</button>
              <button type="button" disabled={menuBusy || sending} onClick={() => void runMenuAction('delete')} className="flex-1 min-h-12 rounded-xl vg-button-danger text-sm disabled:opacity-50">{menuBusy ? '正在删除…' : '确认删除'}</button>
            </div>
          </div> : <>
            <button type="button" disabled={menuBusy} onClick={() => void runMenuAction('copy')} className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl bg-surface text-sm text-ink disabled:opacity-50"><Icon name="copy" />复制</button>
            <button type="button" disabled={menuBusy} onClick={() => {
              if (!visibleMenu || !menuIsCurrent(visibleMenu)) return;
              const message = messages.find(item => item.id === visibleMenu.id);
              if (message) setQuote(message);
              focusAfterMenu(inputRef.current, visibleMenu);
              closeMenu();
            }} className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl bg-surface text-sm text-ink disabled:opacity-50"><Icon name="connection" />引用</button>
            <button type="button" disabled={menuBusy || sending} onClick={() => void runMenuAction('remember')} className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl bg-surface text-sm text-ink disabled:opacity-50"><Icon name="diary" />记住</button>
            <button type="button" disabled={menuBusy || sending} onClick={() => { if (visibleMenu && menuIsCurrent(visibleMenu)) setConfirmDeleteId(visibleMenu.id); }} className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl vg-button-danger text-sm disabled:opacity-50"><Icon name="trash" />删除</button>
            {sending && <p className="px-1 pt-2 text-xs leading-relaxed text-sub">等这一轮回复结束后，再记住或删除消息。</p>}
          </>}
        </div>
      </Modal>

      {/* 输入区：引用条 + 图片预览 + 图片按钮 + 文本框 + 发送 */}
      <div className="relative border-t border-line p-3 shrink-0" data-no-page-swipe data-no-back-swipe style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
        {/* @ 输入联想（微信式：输入 @ 弹出成员选择器） */}
        {atCandidate !== null && atPickerMembers.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 max-h-44 overflow-y-auto rounded-xl glass-card border border-line shadow-xl z-10 py-1">
            {atPickerMembers.map((mem) => (
              <button
                key={mem.id}
                onClick={() => insertAtName(mem.name)}
                className="w-full min-h-12 flex items-center gap-3 px-3 py-2 text-left hover:bg-surface transition-colors"
              >
                <span className="shrink-0 w-6 h-6 rounded-full overflow-hidden">
                  <Avatar avatar={mem.avatar} size="sm" />
                </span>
                <span className="text-sm text-ink">{mem.name}</span>
              </button>
            ))}
          </div>
        )}
        {(quote || pendingImage) && (
          <div data-group-quote className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-panel/60 border border-line">
            {pendingImage && (
              <img src={pendingImage} alt="待发送" className="w-10 h-10 rounded-lg object-cover shrink-0" />
            )}
            {quote && (
              <span className="flex-1 min-w-0 text-xs text-sub truncate border-l-2 pl-2 border-life-cyan">
                {quote.content.slice(0, 40)}
              </span>
            )}
            <button
              type="button"
              aria-label="取消引用或图片"
              onClick={() => { setQuote(null); setPendingImage(null); }}
              className="vg-button vg-button-ghost shrink-0 w-11 h-11"
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handlePickImage(e.target.files)} />
          <button
            onClick={() => fileRef.current?.click()}
            title="发图片"
            className="vg-button vg-button-secondary shrink-0 w-11 h-11" style={{ padding: 0 }}
          >
            <Icon name="image" size={20} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 输入法组合键（中文拼音选字）的 Enter 是"确认候选"，不应发送
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            onFocus={handleInputFocus}
            aria-label="群消息内容"
            placeholder={sending ? '群成员们正在输入…' : '发消息…'}
            rows={1}
            className="vg-text-field chat-composer-input min-w-0 min-h-12 flex-1 resize-none px-4 py-2.5 text-base disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            aria-label="发送群消息"
            disabled={sending || (!input.trim() && !pendingImage)}
            className={`vg-button ${sending || (!input.trim() && !pendingImage) ? 'vg-button-secondary' : 'vg-button-primary'} shrink-0 w-12 h-12 disabled:opacity-40`} style={{ padding: 0 }}
          >
            <Icon name="send" size={20} />
          </button>
        </div>
      </div>

      {/* 群设置 */}
      {settings && group && <GroupSettings key={`${userId}:${group.id}`} group={group} members={members} onClose={() => setSettings(false)} onDissolved={() => { setSettings(false); onBack(); }} />}

      {/* 图片大图预览 */}
      {previewImage && <ImagePreview images={[previewImage]} onClose={() => setPreviewImage(null)} />}
    </>
  );
}

/** 群设置：群信息集中展示，成员操作使用简短弹窗。 */
function GroupSettings({ group, members, onClose, onDissolved }: { group: Group; members: Character[]; onClose: () => void; onDissolved: () => void }) {
  const updateGroup = useGroupStore(state => state.updateGroup);
  const removeMember = useGroupStore(state => state.removeMember);
  const deleteGroup = useGroupStore(state => state.deleteGroup);
  const setMemberNickname = useGroupStore(state => state.setMemberNickname);
  const feedback = useFeedback();
  const userId = useAuthStore(state => state.userId);
  const characters = useChatStore(state => state.characters);
  const [name, setName] = useState(group.name);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const lock = useRef(false);
  const owner = useRef(userId).current;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && !!owner && useAuthStore.getState().userId === owner && group.userId === owner;
  const close = () => { if (!lock.current) onClose(); };
  const run = async (action: () => Promise<void>, done?: () => void, message = '已保存', afterRemoval = false) => {
    if (lock.current || !current()) return;
    lock.current = true; setBusy(true); setIssue('');
    try {
      const persisted = await db.groups.get(group.id);
      if (!current() || persisted?.userId !== owner) return;
      await action();
      // Removing the group unmounts these settings before the store promise settles.
      // Finish its UI navigation only while the same account has no new group selected.
      if (current() || afterRemoval && useAuthStore.getState().userId === owner && !useGroupStore.getState().currentGroupId) {
        done?.(); feedback(message, { tone: 'success' });
      }
    } catch { if (current()) setIssue('操作未完成，请重试。你的输入仍然保留。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const candidates = characters.filter(c => c.agentProfile !== 'secretary' && !group.characterIds.includes(c.id));
  const memberById = new Map(members.map(m => [m.id, m]));
  const activeMember = memberId ? memberById.get(memberId) : undefined;
  if (userId !== owner) return null;

  return <>
    <Modal open onClose={close} title="群设置" width="max-w-lg" canSnapshotOnExit={() => false}>
      <div data-group-dialog className="vg-settings-design" aria-busy={busy}>
        {issue && !showAdd && !memberId && !confirmDelete && <FeedbackNotice message={issue} tone="error" className="mb-4" />}
        <SettingsGroup title="聊天偏好">
          <div className="vg-preference-row"><span className="vg-preference-copy"><strong>群聊模型</strong><small>使用设置中的默认模型</small></span><span className="vg-preference-value">{resolveModel().label}</span></div>
          <SettingsSwitch title="热闹模式" detail="一轮最多回复 5 条，会增加模型用量。" checked={!!group.lively} disabled={busy} onChange={lively => void run(() => updateGroup(group.id, { lively }))} />
        </SettingsGroup>
        <SettingsGroup title="群名称">
          <form className="p-4 space-y-3" onSubmit={event => { event.preventDefault(); void run(() => updateGroup(group.id, { name: name.trim() || group.name })); }}>
            <SettingsField label="名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} />
            <button type="submit" disabled={busy || !name.trim() || name.trim() === group.name} className="vg-button vg-button-secondary w-full disabled:opacity-50">{busy ? '正在保存…' : '保存名称'}</button>
          </form>
        </SettingsGroup>
        <SettingsGroup title="群成员" scope={`${group.characterIds.length} / 5`}>
          {group.characterIds.map(id => {
            const member = memberById.get(id), nick = group.memberNicknames?.[id];
            return <button key={id} type="button" disabled={busy} className="vg-preference-row disabled:opacity-50" onClick={() => { setIssue(''); setMemberId(id); setNickname(nick ?? ''); }} aria-label={`管理${member?.name ?? '已删除角色'}`}>
              <span className="shrink-0"><Avatar avatar={member?.avatar ?? '🧬'} size="sm" /></span>
              <span className="vg-preference-copy"><strong className="truncate">{nick || member?.name || '已删除角色'}</strong><small className="truncate">{nick ? member?.name ?? '原角色已删除' : '设置群内昵称或移除'}</small></span><Icon name="chevron" size={16} />
            </button>;
          })}
          <button type="button" disabled={busy || group.characterIds.length >= 5} onClick={() => { setIssue(''); setShowAdd(true); }} className="vg-preference-row disabled:opacity-50"><Icon name="plus" /><span className="vg-preference-copy"><strong>添加成员</strong><small>{group.characterIds.length >= 5 ? '已达到 5 位成员上限' : '邀请其他角色加入聊天'}</small></span></button>
        </SettingsGroup>
        <button type="button" disabled={busy} onClick={() => { setIssue(''); setConfirmDelete(true); }} className="vg-button vg-button-danger w-full disabled:opacity-50"><Icon name="trash" />解散群聊</button>
      </div>
    </Modal>
    <Modal open={showAdd} presentation="dialog" title="添加成员" width="max-w-sm" onClose={() => { if (!lock.current) { setShowAdd(false); setIssue(''); } }} canSnapshotOnExit={() => false}>
      <div className="p-4 space-y-3" data-group-dialog aria-busy={busy}>
        <p className="text-sm text-sub leading-relaxed">{group.characterIds.length >= 5 ? '成员已满，可以先移除一位再邀请。' : '选择一位角色加入，群聊最多容纳 5 位角色。'}</p>
        {issue && <FeedbackNotice message={issue} tone="error" />}
        {candidates.length === 0 && <p className="text-sm text-sub py-4">暂无可添加的角色。</p>}
        {candidates.map(character => <button key={character.id} type="button" disabled={busy || group.characterIds.length >= 5} onClick={() => void run(() => updateGroup(group.id, { characterIds: [...group.characterIds, character.id] }), () => setShowAdd(false))} className="vg-button vg-button-secondary w-full disabled:opacity-50" style={{ justifyContent: 'flex-start' }}>
          <Avatar avatar={character.avatar} size="sm" /><span className="flex-1 min-w-0 truncate text-left">{character.name}</span><Icon name="plus" />
        </button>)}
      </div>
    </Modal>
    <Modal open={!!memberId} presentation="dialog" title={activeMember ? `${activeMember.name} · 群内设置` : '成员设置'} width="max-w-sm" onClose={() => { if (!lock.current) { setMemberId(null); setIssue(''); } }} canSnapshotOnExit={() => false}>
      <form className="vg-settings-design space-y-4" data-group-dialog aria-busy={busy} onSubmit={event => { event.preventDefault(); if (memberId) void run(() => setMemberNickname(group.id, memberId, nickname), () => setMemberId(null)); }}>
        <SettingsField label="群内昵称" hint="仅在这个群内使用，留空恢复原名。" value={nickname} maxLength={12} disabled={busy} onChange={event => setNickname(event.target.value)} placeholder={activeMember?.name} />
        {issue && <FeedbackNotice message={issue} tone="error" />}
        <button type="submit" disabled={busy} className="vg-button vg-button-primary w-full disabled:opacity-50">{busy ? '正在保存…' : '保存昵称'}</button>
        <button type="button" disabled={busy} className="vg-button vg-button-danger w-full disabled:opacity-50" onClick={() => { if (memberId) void run(() => removeMember(group.id, memberId), () => setMemberId(null), '已移除成员'); }}>从群聊移除</button>
      </form>
    </Modal>
    <Modal open={confirmDelete} presentation="dialog" title="解散这个群聊？" width="max-w-sm" onClose={() => { if (!lock.current) { setConfirmDelete(false); setIssue(''); } }} canSnapshotOnExit={() => false}>
      <div className="p-4 space-y-4" data-group-dialog aria-busy={busy}>
        <p className="text-sm text-sub leading-relaxed">群聊和其中的消息将永久删除，角色和单独聊天会保留。</p>
        {issue && <FeedbackNotice message={issue} tone="error" />}
        <div className="flex gap-3"><button type="button" disabled={busy} className="vg-button vg-button-secondary flex-1 disabled:opacity-50" onClick={() => { setConfirmDelete(false); setIssue(''); }}>取消</button>
          <button type="button" disabled={busy} className="vg-button vg-button-danger flex-1 disabled:opacity-50" onClick={() => void run(() => deleteGroup(group.id), onDissolved, '群聊已解散', true)}>{busy ? '正在解散…' : '解散群聊'}</button></div>
      </div>
    </Modal>
  </>;
}

/** 建群：群名 + 勾选角色（2–5 个），写入失败保留选择。 */
function GroupCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (g: Group) => void }) {
  const userId = useAuthStore(state => state.userId);
  const owner = useRef(userId).current;
  const characters = useChatStore(state => state.characters).filter(character => character.agentProfile !== 'secretary');
  const createGroup = useGroupStore(state => state.createGroup);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selectedIds = selected.filter(id => characters.some(character => character.id === id));
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(item => item !== id) : ids.length >= 5 ? ids : [...ids, id]);
  const create = async () => {
    if (lock.current || !owner || useAuthStore.getState().userId !== owner || selectedIds.length < 2) return;
    lock.current = true; setBusy(true); setIssue('');
    try {
      const group = await createGroup(name, selectedIds);
      if (alive.current && useAuthStore.getState().userId === owner) {
        if (group) onCreated(group);
        else setIssue('请选择 2–5 位角色后重试。');
      }
    } catch { if (alive.current && useAuthStore.getState().userId === owner) setIssue('群聊创建未完成，请重试。名称和成员选择已保留。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  if (userId !== owner) return null;
  return <Modal open onClose={() => { if (!lock.current) onClose(); }} title="发起群聊" width="max-w-lg" canSnapshotOnExit={() => false}
    footer={<div className="p-4"><button type="submit" form="vg-create-group" disabled={busy || selectedIds.length < 2} className="vg-button vg-button-primary w-full disabled:opacity-50">{busy ? '正在创建…' : `创建群聊${selectedIds.length >= 2 ? ` · ${selectedIds.length} 位角色` : ''}`}</button></div>}>
    <form id="vg-create-group" data-group-dialog className="vg-settings-design" aria-busy={busy} onSubmit={event => { event.preventDefault(); void create(); }}>
      {issue && <FeedbackNotice message={issue} tone="error" className="mb-4" />}
      <SettingsGroup title="为共同聊天取个名字"><div className="p-4"><SettingsField label="群名称" hint="可以留空，稍后在群设置里修改。" placeholder="例如：星域日常" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></div></SettingsGroup>
      <SettingsGroup title="选择角色" scope={`${selectedIds.length} / 5`}>
        <p className="px-4 pt-4 pb-2 text-sm text-sub leading-relaxed">至少 2 位，最多 5 位。</p>
        {characters.length < 2 && <p className="px-4 pb-4 text-sm text-sub leading-relaxed">还需要至少 2 位普通角色才能创建群聊。</p>}
        {characters.map(character => <button key={character.id} type="button" disabled={busy || (!selectedIds.includes(character.id) && selectedIds.length >= 5)} aria-pressed={selectedIds.includes(character.id)} onClick={() => toggle(character.id)} className="vg-preference-row disabled:opacity-50">
          <span className="shrink-0"><Avatar avatar={character.avatar} size="sm" /></span><span className="vg-preference-copy"><strong className="truncate">{character.name}</strong>{character.signature && <small className="truncate">{character.signature}</small>}</span>
          <span className="shrink-0 w-6 h-6 rounded-full border border-line grid place-items-center" aria-hidden="true" style={selectedIds.includes(character.id) ? { background: 'var(--vg-action)', color: 'var(--vg-on-action)', borderColor: 'var(--vg-action)' } : undefined}>{selectedIds.includes(character.id) && <Icon name="check" size={16} />}</span>
        </button>)}
      </SettingsGroup>
    </form>
  </Modal>;
}
