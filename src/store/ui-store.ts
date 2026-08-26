import { create } from 'zustand';

export type ActiveView = 'chat' | 'diary';
export type MobileTab = 'chat' | 'characters' | 'diary' | 'me';

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
