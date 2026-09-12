import { create } from 'zustand';

/**
 * 桌面端主内容区（聊天 / 手账）。手机端手账已下沉为「世界 → 我的生活」覆盖页，仍复用 activeView。
 * 5.0 Phase 2b-5：「关系网络」同样从「世界」进入，也是覆盖页（保持底部导航可见）。
 * 5.0 Phase 3：「世界剧场」同理（打开/离开舞台不消耗模型调用）。
 */
export type ActiveView = 'chat' | 'diary' | 'relations' | 'stage';
/** 手机端底部一级导航（5.0：消息｜世界｜角色｜我的） */
export type MobileTab = 'chat' | 'world' | 'characters' | 'me';

/**
 * 底部一级导航的唯一来源（外壳与验收脚本共用，避免"两处各写一份"）。
 * 手账不再是 tab：它从「世界 → 我的生活」进入（5.0 起 世界 是核心一级入口）。
 */
export const MOBILE_TABS: { key: MobileTab; label: string }[] = [
  { key: 'chat', label: '消息' },
  { key: 'world', label: '世界' },
  { key: 'characters', label: '角色' },
  { key: 'me', label: '我的' },
];

interface UIState {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  /** 手机端底部 tab */
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  /** 微信式推入：从角色页进入聊天时，聊天作为角色 tab 之上的覆盖层 */
  chatFromCharacters: boolean;
  setChatFromCharacters: (v: boolean) => void;
  /** 微信式推入：从「聊天」tab 的会话列表进入聊天（返回回到会话列表，不跳角色页） */
  chatFromList: boolean;
  setChatFromList: (v: boolean) => void;
}

/** 主内容区视图切换（聊天 / 日记）+ 手机端底部 tab */
export const useUIStore = create<UIState>((set) => ({
  activeView: 'chat',
  setActiveView: (activeView) => set({ activeView }),
  mobileTab: 'chat',
  setMobileTab: (mobileTab) => set({ mobileTab }),
  chatFromCharacters: false,
  setChatFromCharacters: (chatFromCharacters) => set({ chatFromCharacters }),
  chatFromList: false,
  setChatFromList: (chatFromList) => set({ chatFromList }),
}));
