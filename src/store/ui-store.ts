import { create } from 'zustand';

/**
 * 桌面端主内容区（聊天 / 手账）。手机端手账已下沉为「世界 → 日记」覆盖页，仍复用 activeView。
 *
 * 5.0.0 Living World 的视图语义（重要）：
 * - `canvas` 是**沉浸式**的：进入世界空间后底部一级导航隐藏（§67），返回键先收键盘再退出。
 * - `diary` / `relations` / `memory` / `timeline` / `worldSettings` / `stage` 都是「世界」下的
 *   **内容页**：底部导航保持可见，点任意一级导航即退出（不会出现"进去了出不来"）。
 */
export type ActiveView = 'chat' | 'diary' | 'todo' | 'moments' | 'relations' | 'stage' | 'canvas' | 'memory' | 'timeline' | 'worldSettings';
/** 手机端底部一级导航（5.0：消息｜世界｜角色｜我的） */
export type MobileTab = 'chat' | 'world' | 'characters' | 'me';

/**
 * 底部一级导航的唯一来源（外壳与验收脚本共用，避免"两处各写一份"）。
 * 手账不再是 tab：它从「世界 → 日记」进入（5.0 起 世界 是核心一级入口）。
 */
export const MOBILE_TABS: { key: MobileTab; label: string }[] = [
  { key: 'chat', label: '消息' },
  { key: 'world', label: '世界' },
  { key: 'characters', label: '角色' },
  { key: 'me', label: '我的' },
];

/** 哪些视图是"世界"下的内容页（底部导航保持可见） */
export const WORLD_OVERLAY_VIEWS: ActiveView[] = ['diary', 'todo', 'moments', 'relations', 'stage', 'memory', 'timeline', 'worldSettings'];
/** 沉浸式视图（隐藏底部导航） */
export const IMMERSIVE_VIEWS: ActiveView[] = ['canvas'];

interface UIState {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  /** 手机端底部 tab */
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  /** 世界首页的星域入口是否已打开；纳入手机返回栈，保证星域可自然返回世界。 */
  worldTheaterOpen: boolean;
  setWorldTheaterOpen: (open: boolean) => void;
  /** 从星图点「新的世界」时置位：星域资料页据此直接展开创建表单（一次性消费）。 */
  worldCreateIntent: boolean;
  setWorldCreateIntent: (value: boolean) => void;
  /** 微信式推入：从角色页进入聊天时，聊天作为角色 tab 之上的覆盖层 */
  chatFromCharacters: boolean;
  setChatFromCharacters: (v: boolean) => void;
  /** 微信式推入：从「聊天」tab 的会话列表进入聊天（返回回到会话列表，不跳角色页） */
  chatFromList: boolean;
  setChatFromList: (v: boolean) => void;
  /**
   * 世界空间当前展示的片段 id（空 = 进去时自动取/建"此刻"）。
   * 放在这里而不是组件内部：从世界主页"继续"、从记忆页点开某一段，都走同一条路径。
   */
  canvasSceneId: string | null;
  setCanvasSceneId: (id: string | null) => void;
  /** 世界画布底部控制面板是否打开；返回键先收起它，再离开画布 */
  canvasSheetOpen: boolean;
  setCanvasSheetOpen: (open: boolean) => void;
  /** 进入世界空间（可指定继续哪一段） */
  openCanvas: (sceneId?: string | null) => void;
}

/** 主内容区视图切换 + 手机端底部 tab + 世界空间入口 */
export const useUIStore = create<UIState>((set) => ({
  activeView: 'chat',
  setActiveView: (activeView) => set({ activeView }),
  mobileTab: 'chat',
  setMobileTab: (mobileTab) => set({ mobileTab }),
  worldTheaterOpen: false,
  setWorldTheaterOpen: (worldTheaterOpen) => set({ worldTheaterOpen }),
  worldCreateIntent: false,
  setWorldCreateIntent: (worldCreateIntent) => set({ worldCreateIntent }),
  chatFromCharacters: false,
  setChatFromCharacters: (chatFromCharacters) => set({ chatFromCharacters }),
  chatFromList: false,
  setChatFromList: (chatFromList) => set({ chatFromList }),
  canvasSceneId: null,
  setCanvasSceneId: (canvasSceneId) => set({ canvasSceneId }),
  canvasSheetOpen: false,
  setCanvasSheetOpen: (canvasSheetOpen) => set({ canvasSheetOpen }),
  openCanvas: (sceneId) => set({ activeView: 'canvas', canvasSceneId: sceneId ?? null, canvasSheetOpen: false }),
}));

export function isWorldOverlay(view: ActiveView): boolean {
  return WORLD_OVERLAY_VIEWS.includes(view);
}
