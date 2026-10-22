import { lazyFeature } from '../ui/lazyFeature';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MobileChatListPage } from '../chat/MobileChatListPage';
import { NotificationCloud } from '../chat/NotificationCloud';
import { useUIStore, MOBILE_TABS, IMMERSIVE_VIEWS, CHAT_DETAIL_VIEWS, isWorldOverlay, type MobileTab } from '../../store/ui-store';
import { useChatStore } from '../../store/chat-store';
import { MobileTabSwipe } from '../ui/MobileTabSwipe';
import { SwipeBackView } from '../ui/SwipeBackView';
import type { ActiveView } from '../../store/ui-store';
import { SoulAtmosphere } from '../ui/SoulAtmosphere';
import { useAuthStore } from '../../store/auth-store';
import { breathe } from '../../lib/haptics';
import { beginSoulHandoff, cancelSoulHandoff, soulElement, soulHandoffTo } from '../../lib/soul-handoff';
import { useMobilePageMotion } from '../ui/useMobilePageMotion';
import { openAssistantWorkspace } from '../../lib/secretary/navigation';
import { ElasticTabs } from '../ui/ElasticTabs';

const ChatPage = lazyFeature(() => import('../../pages/ChatPage').then(m => ({ default: m.ChatPage })));
const MobileWorldPage = lazyFeature(() => import('../world/MobileWorldPage').then(m => ({ default: m.MobileWorldPage })));
const MobileCharacterPage = lazyFeature(() => import('../character/MobileCharacterPage').then(m => ({ default: m.MobileCharacterPage })));
const MobileMePage = lazyFeature(() => import('./MobileMePage').then(m => ({ default: m.MobileMePage })));
const MobileRelationsPage = lazyFeature(() => import('../world/MobileRelationsPage').then(m => ({ default: m.MobileRelationsPage })));
const MobileStagePage = lazyFeature(() => import('../world/MobileStagePage').then(m => ({ default: m.MobileStagePage })));
const WorldCanvas = lazyFeature(() => import('../world/WorldCanvas').then(m => ({ default: m.WorldCanvas })));
const WorldMemoryPage = lazyFeature(() => import('../world/WorldMemoryPage').then(m => ({ default: m.WorldMemoryPage })));
const WorldTimelinePage = lazyFeature(() => import('../world/WorldTimelinePage').then(m => ({ default: m.WorldTimelinePage })));
const WorldSettingsPage = lazyFeature(() => import('../world/WorldSettingsPage').then(m => ({ default: m.WorldSettingsPage })));
const MomentsPage = lazyFeature(() => import('../moments/MomentsPage').then(m => ({ default: m.MomentsPage })));

// 手账包含日历、导出和多种 AI 辅助；仅在用户从「世界 → 日记」进入时下载。
const DiaryPage = lazy(() => import('../../pages/DiaryPage').then((m) => ({ default: m.DiaryPage })));
const ActionCabinPage = lazyFeature(() => import('../secretary/SecretaryHubPage').then(m => ({ default: m.SecretaryHubPage })));
const TodoPage = lazy(() => import('../todo/TodoPage').then((m) => ({ default: m.TodoPage })));
// Keep the navigation and transition surface mounted while a feature loads.

function preloadTab(tab: MobileTab) {
  if (tab === 'world') MobileWorldPage.preload();
  else if (tab === 'characters') MobileCharacterPage.preload();
  else if (tab === 'me') MobileMePage.preload();
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
    strokeWidth: active ? 1.9 : 1.65,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    focusable: false,
  };
  const tint = { fill: active ? 'currentColor' : 'none', fillOpacity: active ? .14 : 0 };
  if (name === 'chat')
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
        <path {...tint} d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    );
  if (name === 'characters')
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle {...tint} cx="12" cy="7" r="4" />
      </svg>
    );
  if (name === 'world')
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
        {/* 世界：一颗星球 + 运行轨迹（Living World） */}
        <circle {...tint} cx="12" cy="12" r="7.2" />
        <path d="M3.6 10.4c3.4-1.7 7.9-2.4 12-1.6 2.6.5 4.6 1.4 5.4 2.4" />
        <path d="M20.4 15.2c-3.4 1.5-7.6 2.1-11.5 1.4-2.7-.5-4.7-1.5-5.5-2.5" />
      </svg>
    );
  // 手账已下沉为「世界 → 我的生活」内容页，不再是底部 tab，因此这里没有 diary 图标
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...common}>
      <rect {...tint} x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="M5.5 16a3.5 3.5 0 0 1 7 0 M15 9h3 M15 13h3" />
    </svg>
  );
}

/**
 * 手机端外壳：微信式底部四栏一级导航（5.0：消息 / 世界 / 角色 / 我的）。
 * - 手账不是 tab：从「世界 → 我的生活」进入，进入后底部导航保持可见（点任意一级导航即退出）
 * - tab 状态放 ui-store（聊天页可返回角色页）
 * - 键盘弹出（输入聚焦）时隐藏底部导航，避免四个 tab 被顶到输入框上面
 * - 激活 tab 使用同一块哑光底片与图标填充，不显示提醒圆点
 * - 页面进入方向跟随导航，手势退场由各自的手势层负责
 */
export function MobileLayout() {
  const activeView = useUIStore((s) => s.activeView);
  const tab = useUIStore((s) => s.mobileTab);
  const setTab = useUIStore((s) => s.setMobileTab);
  const chatFromCharacters = useUIStore((s) => s.chatFromCharacters);
  const chatFromList = useUIStore((s) => s.chatFromList);
  const canvasSceneId = useUIStore((s) => s.canvasSceneId);
  const worldTheaterOpen = useUIStore((s) => s.worldTheaterOpen);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  const owner = useAuthStore((s) => s.userId);
  const navContentRef = useRef<HTMLElement>(null);
  /** 键盘弹出（输入聚焦）时隐藏底部 tab */
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const navigationRef = useRef<{
    stack: MobileNavSnapshot[];
    lastSignature: string;
    suppressNextCommit: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);

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
  const chatDetailOpen = CHAT_DETAIL_VIEWS.includes(activeView);
  const activeTab: MobileTab = chatDetailOpen ? (tab === 'world' ? 'world' : 'chat') : overlayOpen ? 'world' : tab;

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

  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state, before) => {
      if(before.activeView==='canvas'&&state.activeView==='chat'&&state.mobileTab==='world'&&before.canvasSceneId){
        const key=JSON.stringify([useAuthStore.getState().userId,before.canvasSceneId]);
        chatEntry.current++;
        beginSoulHandoff(key,soulElement(key,'world-scene'),'world-entry');
        return;
      }
      if (state.mobileTab !== before.mobileTab || state.activeView !== before.activeView && state.activeView !== 'chat' && !(state.activeView === 'actionCabin' && soulHandoffTo('cabin')) && !(state.activeView === 'canvas' && soulHandoffTo('world-scene'))) { cancelSoulHandoff(); chatEntry.current++; return; }
      if ((before.chatFromList && !state.chatFromList || before.chatFromCharacters && !state.chatFromCharacters) && state.mobileTab === before.mobileTab && state.activeView === 'chat' && !soulHandoffTo('list')) {
        const id = useChatStore.getState().selectedCharacterId;
        if (id) beginSoulHandoff(`avatar:${id}`,soulElement(`avatar:${id}`,'chat'),'list');
      }
    });
    return () => { unsubscribe(); cancelSoulHandoff(); };
  },[]);

  // 定时刷新未读数（主动消息到达时保持 tab 徽标新鲜；角色页也会自行拉取）
  useEffect(() => {
    void fetchUnreadCounts();
    const timer = setInterval(() => void fetchUnreadCounts(), 30_000);
    return () => clearInterval(timer);
  }, [fetchUnreadCounts]);

  // Text entry hides navigation immediately. Restore after focus has settled and
  // the viewport has recovered; adjustResize can keep its ratio near one even
  // while the keyboard is open, so a focused text field always takes priority.
  useEffect(() => {
    const vv = window.visualViewport;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const textEntry = (node: EventTarget | null) => {
      if (!(node instanceof HTMLElement) || node.closest('[inert]')) return false;
      if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly;
      if (node instanceof HTMLInputElement) return !node.disabled && !node.readOnly && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'hidden', 'color', 'date', 'time', 'month', 'week', 'datetime-local'].includes(node.type);
      return node.isContentEditable;
    };
    const restore = () => {
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        const ratio = vv ? vv.height / window.innerHeight : 1;
        if (ratio >= 0.85 && !textEntry(document.activeElement)) setKeyboardOpen(false);
      }, 250);
    };
    const confirmOpen = () => {
      const ratio = vv ? vv.height / window.innerHeight : 1;
      if (ratio < 0.85) setKeyboardOpen(true);
      else if (!textEntry(document.activeElement)) restore();
    };
    if (vv) {
      vv.addEventListener('resize', confirmOpen);
      vv.addEventListener('scroll', confirmOpen);
    }
    const onFocusIn = (e: FocusEvent) => {
      if (textEntry(e.target)) {
        clearTimeout(focusTimer);
        setKeyboardOpen(true);
      } else restore();
    };
    // Removing a focused field need not fire focusout. Reconcile after the
    // dismissal action too, without observing every mutation during streaming.
    const onPointerUp = (e: PointerEvent) => { if (!textEntry(e.target)) restore(); };
    const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') restore(); };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', restore);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('keydown', onEscape, true);
    window.addEventListener('vg:back-request', restore);
    return () => {
      clearTimeout(focusTimer);
      if (vv) {
        vv.removeEventListener('resize', confirmOpen);
        vv.removeEventListener('scroll', confirmOpen);
      }
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', restore);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('vg:back-request', restore);
    };
  }, []);

  const chatEntry = useRef(0);

  // Start the chat chunk on an actual selection, alongside the indexed session read.
  // Merely opening Messages must not pull in the entire send/appearance pipeline.

  const switchTab = (t: MobileTab, clicked = false) => {
    chatEntry.current++; cancelSoulHandoff();
    if (clicked && t !== activeTab) breathe();
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
    const chat = useChatStore.getState();
    if (chat.characters.find(c => c.id === chat.selectedCharacterId)?.agentProfile === 'secretary') {
      useUIStore.setState({ chatFromList: false, chatFromCharacters: false });
      openAssistantWorkspace('chat');
      return;
    }
    useUIStore.getState().setChatFromList(from === 'list');
    useUIStore.getState().setChatFromCharacters(from === 'characters');
  };

  const pageKey = activeView + tab + (chatFromCharacters || chatFromList ? '-chat' : '');
  const pageMotionRef = useMobilePageMotion({
    key: pageKey, tab: activeTab,
    depth: immersive ? 2 : overlayOpen || chatDetailOpen || chatFromCharacters || chatFromList ? 1 : 0,
  });
  const navigationHidden = immersive || keyboardOpen || (tab === 'chat' && chatFromList) || (tab === 'characters' && chatFromCharacters);
  const floatingNavigation = !navigationHidden && activeView === 'chat' && !worldTheaterOpen;

  return (
    <div className="mobile-layout relative h-full w-full flex flex-col bg-app overflow-hidden" data-floating-navigation={floatingNavigation || undefined}>
      {/* 固定氛围层：光晕、轨道与少量信号点，不随列表滚动 */}
      <SoulAtmosphere />

      {/* 只避让尚未由原生处理的安全区，不再额外叠加固定状态栏高度。 */}
      <div
        className="mobile-statusbar absolute top-0 inset-x-0 z-20 pointer-events-none"
        style={{ height: 'var(--vg-safe-top)' }}
      />

      {/* 背景铺满顶部，内容仅避让真实系统图标/摄像头区域。 */}
      <div
        data-soul-host
        className="relative z-10 flex flex-col h-full"
        style={{ paddingTop: 'var(--vg-safe-top)' }}
      >
        <NotificationCloud />

        {/* 内容区：单一页面入场动画，避免重复位移 */}
        <main ref={navContentRef} className="flex-1 min-h-0 overflow-hidden">
          <Suspense fallback={<div className="vg-loading" role="status">正在打开你的空间…</div>}>
          <MobileTabSwipe
            activeTab={tab}
            enabled={activeView === 'chat' && !chatFromCharacters && !chatFromList && !keyboardOpen && !worldTheaterOpen}
            onTabSwipe={switchTab}
          >
          <SwipeBackView enabled={overlayOpen || chatDetailOpen || (worldTheaterOpen && !immersive)} onBack={() => window.history.back()}>
          <div
            ref={pageMotionRef}
            key={pageKey}
            className={`vg-page-transition h-full ${diaryOpen ? 'vg-world-diary-view' : todoOpen ? 'vg-world-todo-view' : momentsOpen ? 'vg-world-moments-view' : ''}`}
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
            ) : activeView === 'actionCabin' ? (
              <ActionCabinPage />
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
                    <MobileChatListPage onSelect={(c, source) => { void ChatPage.preload(); const entry = ++chatEntry.current, owner = useAuthStore.getState().userId; void useChatStore.getState().selectCharacter(c.id).then(() => { if (entry !== chatEntry.current || owner !== useAuthStore.getState().userId || useChatStore.getState().selectedCharacterId !== c.id) return; beginSoulHandoff(`avatar:${c.id}`,source ?? soulElement(`avatar:${c.id}`,'list'),'chat'); openChat('list'); }).catch(() => cancelSoulHandoff()); }} />
                  ))}
                {tab === 'world' && <MobileWorldPage onCanvasIntent={()=>void WorldCanvas.preload()}/>}
                {tab === 'characters' && (
                  chatFromCharacters ? (
                    /* 微信式：角色页推入聊天覆盖层，返回后回到角色列表（底部 tab 仍高亮「角色」） */
                    <ChatPage />
                  ) : (
                    <MobileCharacterPage onChatIntent={() => { void ChatPage.preload(); }} onSelect={() => openChat('characters')} />
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
        <ElasticTabs
          ariaLabel="主导航"
          role="navigation"
          className={`mobile-bottom-nav shrink-0 ${
            navigationHidden
              ? 'hidden'
              : 'vg-navigation flex items-stretch'
          }`}
          value={activeTab}
          enabled={!navigationHidden}
          gestureKey={`${owner}|${activeView}|${chatFromList}|${chatFromCharacters}|${keyboardOpen}`}
          contentRef={activeView === 'chat' ? navContentRef : undefined}
          itemClassName="vg-nav-tab"
          onItemIntent={preloadTab}
          onChange={t => switchTab(t, true)}
          onReselect={t => switchTab(t, true)}
          items={MOBILE_TABS.map((t) => {
            const active = activeTab === t.key;
            return { value: t.key, ariaLabel: t.label, label: <>
                <span className="vg-nav-icon">
                  <TabIcon name={t.key} active={active} />
                </span>
                <span>{t.label}</span>
              </> };
          })}
        />
      </div>
    </div>
  );
}
