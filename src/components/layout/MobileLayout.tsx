import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ChatPage } from '../../pages/ChatPage';
import { MobileChatListPage } from '../chat/MobileChatListPage';
import { NotificationCloud } from '../chat/NotificationCloud';
import { useUIStore, MOBILE_TABS, IMMERSIVE_VIEWS, isWorldOverlay, type MobileTab } from '../../store/ui-store';
import { useChatStore } from '../../store/chat-store';
import { MobileWorldPage } from '../world/MobileWorldPage';
import { MobileRelationsPage } from '../world/MobileRelationsPage';
import { MobileStagePage } from '../world/MobileStagePage';
import { WorldCanvas } from '../world/WorldCanvas';
import { WorldMemoryPage } from '../world/WorldMemoryPage';
import { WorldTimelinePage } from '../world/WorldTimelinePage';
import { WorldSettingsPage } from '../world/WorldSettingsPage';
import { MomentsPage } from '../moments/MomentsPage';
import { MobileTabSwipe } from '../ui/MobileTabSwipe';
import { SwipeBackView } from '../ui/SwipeBackView';
import type { ActiveView } from '../../store/ui-store';

// 手账包含日历、导出和多种 AI 辅助；仅在用户从「世界 → 日记」进入时下载。
const DiaryPage = lazy(() => import('../../pages/DiaryPage').then((m) => ({ default: m.DiaryPage })));
const TodoPage = lazy(() => import('../todo/TodoPage').then((m) => ({ default: m.TodoPage })));
const MobileCharacterPage = lazy(() => import('../character/MobileCharacterPage').then((m) => ({ default: m.MobileCharacterPage })));
const MobileMePage = lazy(() => import('./MobileMePage').then((m) => ({ default: m.MobileMePage })));

/** 未读总数上限显示 99+ */
function formatUnread(n: number): string {
  return n > 99 ? '99+' : String(n);
}

type MobileNavSnapshot = {
  activeView: ActiveView;
  mobileTab: MobileTab;
  worldTheaterOpen: boolean;
  chatFromCharacters: boolean;
  chatFromList: boolean;
  canvasSceneId: string | null;
};

function readMobileNavSnapshot(): MobileNavSnapshot {
  const state = useUIStore.getState();
  return {
    activeView: state.activeView,
    mobileTab: state.mobileTab,
    worldTheaterOpen: state.worldTheaterOpen,
    chatFromCharacters: state.chatFromCharacters,
    chatFromList: state.chatFromList,
    canvasSceneId: state.canvasSceneId,
  };
}

function mobileNavSignature(snapshot: MobileNavSnapshot): string {
  return [
    snapshot.activeView,
    snapshot.mobileTab,
    snapshot.worldTheaterOpen ? 'theater' : '',
    snapshot.chatFromCharacters ? 'characters-chat' : '',
    snapshot.chatFromList ? 'list-chat' : '',
    snapshot.canvasSceneId ?? '',
  ].join('|');
}

/** 底部 tab 线性图标（SVG，替代 emoji，更克制更像微信/QQ） */
function TabIcon({ name, active }: { name: MobileTab; active: boolean }) {
  const stroke = 'currentColor';
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
  if (name === 'world')
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
        {/* 世界：一颗星球 + 运行轨迹（Living World） */}
        <circle cx="12" cy="12" r="7.2" />
        <path d="M3.6 10.4c3.4-1.7 7.9-2.4 12-1.6 2.6.5 4.6 1.4 5.4 2.4" />
        <path d="M20.4 15.2c-3.4 1.5-7.6 2.1-11.5 1.4-2.7-.5-4.7-1.5-5.5-2.5" />
      </svg>
    );
  // 手账已下沉为「世界 → 我的生活」内容页，不再是底部 tab，因此这里没有 diary 图标
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

/**
 * 手机端外壳：微信式底部四栏一级导航（5.0：消息 / 世界 / 角色 / 我的）。
 * - 手账不是 tab：从「世界 → 我的生活」进入，进入后底部导航保持可见（点任意一级导航即退出）
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
  const canvasSceneId = useUIStore((s) => s.canvasSceneId);
  const worldTheaterOpen = useUIStore((s) => s.worldTheaterOpen);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  /** 键盘弹出（输入聚焦）时隐藏底部 tab */
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const navigationRef = useRef<{
    stack: MobileNavSnapshot[];
    lastSignature: string;
    suppressNextCommit: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);

  // 聊天 tab 总未读 = 各角色未读之和（微信式：红点 + 数字）
  const totalUnread = useMemo(
    () => Object.values(unreadByCharacter).reduce((sum, n) => sum + (n || 0), 0),
    [unreadByCharacter],
  );

  // 沉浸式视图（世界空间）：隐藏底部一级导航，进入真正的"世界"（§67）
  const immersive = IMMERSIVE_VIEWS.includes(activeView);

  // 5.0：手账不再是底部 tab，而是「世界 → 日记」打开的内容（复用 activeView === 'diary'）。
  // 它**不隐藏底部导航**，所以手机端不会出现"进去了出不来"；此时高亮「世界」。
  // 同一条规则适用于关系网络 / 记忆 / 时间线 / 世界设定（以及保留的旧剧场页）。
  const diaryOpen = activeView === 'diary';
  const todoOpen = activeView === 'todo';
  const momentsOpen = activeView === 'moments';
  const relationsOpen = activeView === 'relations';
  const stageOpen = activeView === 'stage';
  const memoryOpen = activeView === 'memory';
  const timelineOpen = activeView === 'timeline';
  const settingsOpen = activeView === 'worldSettings';
  const overlayOpen = isWorldOverlay(activeView);
  const activeTab: MobileTab = overlayOpen ? 'world' : tab;

  /** 受保护的移动端 history 栈：详情先返回，最后才允许离开应用。 */
  useEffect(() => {
    const initial = readMobileNavSnapshot();
    window.history.replaceState({ ...(window.history.state ?? {}), vgMobileNav: 'root' }, '');
    window.history.pushState({ vgMobileNav: 'guard' }, '');
    navigationRef.current = {
      stack: [initial],
      lastSignature: mobileNavSignature(initial),
      suppressNextCommit: false,
    };

    const onPopState = () => {
      const navigation = navigationRef.current;
      if (!navigation) return;
      if (!window.dispatchEvent(new Event('vg:back-request', { cancelable: true }))) {
        window.history.pushState({ vgMobileNav: 'view', depth: navigation.stack.length }, '');
        return;
      }
      if (useUIStore.getState().canvasSheetOpen) {
        useUIStore.getState().setCanvasSheetOpen(false);
        window.dispatchEvent(new Event('vg-close-canvas-sheet'));
        // popstate 已经把浏览器退到上一项；补回当前项，让下一次返回仍有层级可退。
        window.history.pushState({ vgMobileNav: 'view', depth: navigation.stack.length }, '');
        return;
      }
      if (navigation.stack.length > 1) {
        navigation.stack.pop();
        const previous = navigation.stack[navigation.stack.length - 1];
        navigation.suppressNextCommit = true;
        navigation.lastSignature = mobileNavSignature(previous);
        useUIStore.setState(previous);
        return;
      }
      window.history.pushState({ vgMobileNav: 'guard' }, '');
    };
    window.addEventListener('popstate', onPopState);

    // Capacitor 版本若提供全局 App 插件，硬件返回键也走同一条 history 栈。
    const capacitor = (window as unknown as {
      Capacitor?: { Plugins?: { App?: { addListener?: (name: string, callback: () => void) => unknown } } };
    }).Capacitor;
    let disposed = false;
    let backListener: { remove?: () => void } | undefined;
    const subscription = capacitor?.Plugins?.App?.addListener?.('backButton', () => window.history.back());
    if (subscription) Promise.resolve(subscription).then(handle => { backListener = handle as typeof backListener; if (disposed) backListener?.remove?.(); }).catch(() => {});
    return () => { disposed = true; backListener?.remove?.(); window.removeEventListener('popstate', onPopState); };
  }, []);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const signature = mobileNavSignature(readMobileNavSnapshot());
    if (navigation.suppressNextCommit) {
      navigation.suppressNextCommit = false;
      navigation.lastSignature = signature;
      return;
    }
    if (signature === navigation.lastSignature) return;
    if (navigation.timer) clearTimeout(navigation.timer);
    navigation.timer = setTimeout(() => {
      const latest = readMobileNavSnapshot();
      const latestSignature = mobileNavSignature(latest);
      if (latestSignature === navigation.lastSignature) return;
      navigation.stack.push(latest);
      navigation.lastSignature = latestSignature;
      window.history.pushState({ vgMobileNav: 'view', depth: navigation.stack.length }, '');
    }, 0);
    return () => {
      if (navigation.timer) clearTimeout(navigation.timer);
    };
  }, [activeView, tab, chatFromCharacters, chatFromList, canvasSceneId, worldTheaterOpen]);

  // 定时刷新未读数（主动消息到达时保持 tab 徽标新鲜；角色页也会自行拉取）
  useEffect(() => {
    void fetchUnreadCounts();
    const timer = setInterval(() => void fetchUnreadCounts(), 30_000);
    return () => clearInterval(timer);
  }, [fetchUnreadCounts]);

  // 键盘/输入状态检测：输入框/文本域聚焦 → 立即隐藏底部导航（微信式，四个 tab 不顶上来）；
  // 失焦延迟恢复（键盘收起动画期间保持隐藏）。
  // 注意：Android WebView 默认 adjustResize 模式下 window 与 visualViewport 同比例缩小，
  // ratio 始终 ≈1 —— 因此 visualViewport 事件只负责「确认弹起」，绝不反向置 false，
  // 恢复一律由 focusout 延迟检测完成，避免误把「键盘开着」覆盖回 false（tab 又顶上来）。
  useEffect(() => {
    const vv = window.visualViewport;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const confirmOpen = () => {
      const ratio = vv ? vv.height / window.innerHeight : 1;
      if (ratio < 0.85) setKeyboardOpen(true);
    };
    if (vv) {
      vv.addEventListener('resize', confirmOpen);
      vv.addEventListener('scroll', confirmOpen);
    }
    const onFocusIn = (e: FocusEvent) => {
      clearTimeout(focusTimer);
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        setKeyboardOpen(true);
      }
    };
    const onFocusOut = () => {
      // 延迟恢复：等键盘收起动画结束再显示导航；键盘仍开着（ratio 未恢复）则不恢复
      focusTimer = setTimeout(() => {
        const ratio = vv ? vv.height / window.innerHeight : 1;
        const focused = document.activeElement;
        if (ratio >= 0.85 && !focused?.matches('input, textarea')) setKeyboardOpen(false);
      }, 250);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      clearTimeout(focusTimer);
      if (vv) {
        vv.removeEventListener('resize', confirmOpen);
        vv.removeEventListener('scroll', confirmOpen);
      }
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
    useUIStore.getState().setWorldTheaterOpen(false);
    setTab(t);
    // 手账/关系网络是覆盖页：点任何一级导航都退出它（含点「世界」本身）
    useUIStore.getState().setActiveView('chat');
  };

  /** 进入聊天：从会话列表或角色页推入（微信式），只保留当前来源的推入标记 */
  const openChat = (from: 'list' | 'characters') => {
    useUIStore.getState().setChatFromList(from === 'list');
    useUIStore.getState().setChatFromCharacters(from === 'characters');
  };

  return (
    <div className="mobile-layout relative h-full w-full flex flex-col bg-app overflow-hidden">
      {/* 沉浸光感：氛围光晕 + DNA 点阵底纹 */}
      <div className="vg-atmosphere absolute inset-0 pointer-events-none z-0" />

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
        <main className="flex-1 min-h-0 overflow-hidden">
          <Suspense fallback={<div className="vg-loading" role="status">正在打开你的空间…</div>}>
          <MobileTabSwipe
            activeTab={tab}
            enabled={activeView === 'chat' && !chatFromCharacters && !chatFromList && !keyboardOpen && !worldTheaterOpen}
            onTabSwipe={switchTab}
          >
          <SwipeBackView enabled={overlayOpen || (worldTheaterOpen && !immersive)} onBack={() => window.history.back()}>
          <div
            key={activeView + tab + (chatFromCharacters || chatFromList ? '-chat' : '')}
            className={`h-full animate-tab-in ${diaryOpen ? 'vg-world-diary-view' : todoOpen ? 'vg-world-todo-view' : momentsOpen ? 'vg-world-moments-view' : ''}`}
          >
            {immersive ? (
              /* 世界空间：沉浸式全屏（§67：进入后隐藏底部一级导航） */
              <WorldCanvas />
            ) : stageOpen ? (
              /* 旧剧场页（§77：不再是主 UI 的一级入口，但场景列表/回看能力保留） */
              <MobileStagePage />
            ) : relationsOpen ? (
              /* 关系网络：从「世界」进入的内容页；底部导航保持可见，点任意一级导航即退出 */
              <MobileRelationsPage />
            ) : memoryOpen ? (
              /* 我们经历过的事（§45：用户 UI 里不出现 SharedMemory 这种内部词汇） */
              <WorldMemoryPage />
            ) : timelineOpen ? (
              /* 时间线（§46：一段生活史，不显示数据库类型） */
              <WorldTimelinePage />
            ) : settingsOpen ? (
              /* 世界设定（§32：自然语言卡片，不做表单） */
              <WorldSettingsPage />
            ) : diaryOpen ? (
              /* 我的生活（手账）：从「世界」进入的内容页；底部导航保持可见，点任意一级导航即退出 */
              <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-gray-500">正在打开我的生活…</div>}>
                <DiaryPage />
              </Suspense>
            ) : todoOpen ? (
              <TodoPage />
            ) : momentsOpen ? (
              <MomentsPage />
            ) : (
              <>
                {tab === 'chat' &&
                  (chatFromList ? (
                    /* 微信式：会话列表推入聊天，返回回到会话列表（底部 tab 仍高亮「消息」） */
                    <ChatPage />
                  ) : (
                    <MobileChatListPage onSelect={(c) => { void useChatStore.getState().selectCharacter(c.id); openChat('list'); }} />
                  ))}
                {tab === 'world' && <MobileWorldPage />}
                {tab === 'characters' && (
                  chatFromCharacters ? (
                    /* 微信式：角色页推入聊天覆盖层，返回后回到角色列表（底部 tab 仍高亮「角色」） */
                    <ChatPage />
                  ) : (
                    <MobileCharacterPage onSelect={() => openChat('characters')} />
                  )
                )}
                {tab === 'me' && <MobileMePage />}
              </>
            )}
          </div>
          </SwipeBackView>
          </MobileTabSwipe>
          </Suspense>
        </main>

        {/* 底部导航（含手势安全区）。输入框聚焦后直接从布局移除：
            键盘出现时四个导航不会经历“向上浮起”的动画，也不会占据输入框下方空间。 */}
        <nav
          className={`mobile-bottom-nav shrink-0 ${
            immersive || keyboardOpen || (tab === 'chat' && chatFromList) || (tab === 'characters' && chatFromCharacters)
              ? 'hidden'
              : 'vg-navigation flex items-stretch pb-[env(safe-area-inset-bottom)]'
          }`}
        >
          {MOBILE_TABS.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                aria-current={active ? 'page' : undefined}
                className={`relative flex-1 h-14 flex flex-col items-center justify-center gap-1 text-[11px] transition-colors active:bg-surface ${
                  active ? 'text-life-cyan' : 'text-gray-400'
                }`}
                onClick={() => switchTab(t.key)}
              >
                {/* 激活态顶部小圆点（微信/QQ 式强调） */}
                {active && (
                  <span className="absolute top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-life-cyan shadow-[0_0_8px_rgba(0,206,201,0.9)]" />
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
