import { useEffect, useMemo, useState } from 'react';
import { ChatPage } from '../../pages/ChatPage';
import { DiaryPage } from '../../pages/DiaryPage';
import { MobileChatListPage } from '../chat/MobileChatListPage';
import { MobileCharacterPage } from '../character/MobileCharacterPage';
import { MobileMePage } from './MobileMePage';
import { NotificationCloud } from '../chat/NotificationCloud';
import { useUIStore, type MobileTab } from '../../store/ui-store';
import { useChatStore } from '../../store/chat-store';

/** 未读总数上限显示 99+ */
function formatUnread(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** 底部 tab 线性图标（SVG，替代 emoji，更克制更像微信/QQ） */
function TabIcon({ name, active }: { name: MobileTab; active: boolean }) {
  const stroke = active ? '#6C5CE7' : 'currentColor';
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'chat')
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    );
  if (name === 'characters')
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  if (name === 'diary')
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

/**
 * 手机端外壳：微信式底部四栏导航（聊天 / 角色 / 手账 / 我的）。
 * - tab 状态放 ui-store（聊天页可返回角色页）
 * - 键盘弹出（输入聚焦）时隐藏底部导航，避免四个 tab 被顶到输入框上面
 * - 激活 tab 有胶囊高亮 + 顶部小圆点强调（学习微信/QQ）
 * - tab 切换带淡入动画
 */
export function MobileLayout() {
  const activeView = useUIStore((s) => s.activeView);
  const tab = useUIStore((s) => s.mobileTab);
  const setTab = useUIStore((s) => s.setMobileTab);
  const chatFromCharacters = useUIStore((s) => s.chatFromCharacters);
  const chatFromList = useUIStore((s) => s.chatFromList);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  /** 键盘弹出（输入聚焦）时隐藏底部 tab */
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // 聊天 tab 总未读 = 各角色未读之和（微信式：红点 + 数字）
  const totalUnread = useMemo(
    () => Object.values(unreadByCharacter).reduce((sum, n) => sum + (n || 0), 0),
    [unreadByCharacter],
  );

  // 外部 activeView 变化（如手账内点「返回聊天」）→ 同步底部 tab
  useEffect(() => {
    if (activeView === 'diary' && tab !== 'diary') setTab('diary');
    if (activeView === 'chat' && tab === 'diary') setTab('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  // 定时刷新未读数（主动消息到达时保持 tab 徽标新鲜；角色页也会自行拉取）
  useEffect(() => {
    void fetchUnreadCounts();
    const timer = setInterval(() => void fetchUnreadCounts(), 30_000);
    return () => clearInterval(timer);
  }, [fetchUnreadCounts]);

  // 键盘弹出检测：输入框/文本域聚焦 → 隐藏底部导航（微信式，四个 tab 不顶上来）。
  // 用 visualViewport 高度变化判断键盘真实状态，比 focusin/focusout 更可靠
  // （避免切换 tab 后 ChatInput 卸载导致导航残留隐藏）。
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const detect = () => {
      const ratio = vv.height / window.innerHeight;
      setKeyboardOpen(ratio < 0.85);
    };
    vv.addEventListener('resize', detect);
    vv.addEventListener('scroll', detect);
    // 兜底：focusin/focusout 也跟踪，但以视口高度为准
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) detect();
    };
    const onFocusOut = () => setTimeout(detect, 150);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      vv.removeEventListener('resize', detect);
      vv.removeEventListener('scroll', detect);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const switchTab = (t: MobileTab) => {
    // 切换 tab 时确保导航恢复显示
    setKeyboardOpen(false);
    // 离开聊天/角色 tab 时清掉推入状态，避免残留
    if (t !== 'characters') useUIStore.getState().setChatFromCharacters(false);
    if (t !== 'chat') useUIStore.getState().setChatFromList(false);
    setTab(t);
    if (t === 'chat') useUIStore.getState().setActiveView('chat');
    if (t === 'diary') useUIStore.getState().setActiveView('diary');
  };

  /** 进入聊天：从会话列表或角色页推入（微信式），只保留当前来源的推入标记 */
  const openChat = (from: 'list' | 'characters') => {
    useUIStore.getState().setChatFromList(from === 'list');
    useUIStore.getState().setChatFromCharacters(from === 'characters');
  };

  return (
    <div className="relative h-full w-full flex flex-col bg-app overflow-hidden">
      {/* 沉浸光感：氛围光晕 + DNA 点阵底纹 */}
      <div className="absolute inset-0 aurora pointer-events-none z-0" />
      <div className="absolute inset-0 dna-dots pointer-events-none z-0" />

      {/* 顶部状态栏深色条：品牌深色，覆盖状态栏区域。
          无刘海屏 env(safe-area-inset-top)=0，故叠加固定 24px 兜底，
          任何机型顶部都不透出白色 */}
      <div
        className="absolute top-0 inset-x-0 z-20 pointer-events-none bg-[#0F0F1A]"
        style={{ height: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
      />

      {/* 内容区从深色条下方开始（同样叠加 24px 兜底） */}
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
      >
        <NotificationCloud />

        {/* 内容区：tab 切换带淡入动画 */}
        <main className="flex-1 overflow-hidden">
          <div
            key={tab + (chatFromCharacters || chatFromList ? '-chat' : '')}
            className="h-full animate-tab-in"
          >
            {tab === 'chat' &&
              (chatFromList ? (
                /* 微信式：会话列表推入聊天，返回回到会话列表（底部 tab 仍高亮「聊天」） */
                <ChatPage />
              ) : (
                <MobileChatListPage onSelect={(c) => { void useChatStore.getState().selectCharacter(c.id); openChat('list'); }} />
              ))}
            {tab === 'characters' && (
              chatFromCharacters ? (
                /* 微信式：角色页推入聊天覆盖层，返回后回到角色列表（底部 tab 仍高亮「角色」） */
                <ChatPage />
              ) : (
                <MobileCharacterPage onSelect={() => openChat('characters')} />
              )
            )}
            {tab === 'diary' && <DiaryPage />}
            {tab === 'me' && <MobileMePage />}
          </div>
        </main>

        {/* 底部导航（含手势安全区）；键盘弹出时隐藏，避免被顶到输入框上面 */}
        <nav
          className={`shrink-0 flex items-stretch border-t border-line bg-glass/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] transition-transform duration-300 ${
            keyboardOpen ? 'translate-y-full' : 'translate-y-0'
          }`}
        >
          {(
            [
              { key: 'chat', label: '聊天' },
              { key: 'characters', label: '角色' },
              { key: 'diary', label: '手账' },
              { key: 'me', label: '我的' },
            ] as { key: MobileTab; label: string }[]
          ).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                className={`relative flex-1 h-14 flex flex-col items-center justify-center gap-1 text-[11px] transition-colors active:bg-surface ${
                  active ? 'text-gene-purple' : 'text-gray-400'
                }`}
                onClick={() => switchTab(t.key)}
              >
                {/* 激活态顶部小圆点（微信/QQ 式强调） */}
                {active && (
                  <span className="absolute top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gene-purple shadow-[0_0_6px_rgba(108,92,231,0.8)]" />
                )}
                {/* 聊天 tab 未读徽标（微信式红点 + 数字） */}
                {t.key === 'chat' && totalUnread > 0 && (
                  <span className="absolute top-0.5 right-1/2 translate-x-[14px] min-w-[15px] h-3.5 px-1 rounded-full bg-red-500 text-white text-[9px] font-medium flex items-center justify-center leading-none shadow-[0_1px_4px_rgba(239,68,68,0.45)]">
                    {formatUnread(totalUnread)}
                  </span>
                )}
                {/* 激活态图标胶囊高亮 */}
                <span className={`flex items-center justify-center w-10 h-7 rounded-full transition-all ${active ? 'bg-gene-purple/12' : ''}`}>
                  <TabIcon name={t.key} active={active} />
                </span>
                <span className={`leading-none ${active ? 'font-semibold' : ''}`}>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
