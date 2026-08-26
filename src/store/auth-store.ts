import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IS_MOBILE } from '../lib/platform';

export const DEFAULT_USER_AVATAR = '🧬';

interface AuthState {
  userId: string | null;
  username: string | null;
  avatar: string | null;
  apiKey: string | null;
  isLoggedIn: boolean;

  login: (userId: string, username: string, apiKey: string, avatar: string) => void;
  logout: () => void;
  setApiKey: (apiKey: string) => void;
  setAvatar: (avatar: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userId: null,
      username: null,
      avatar: null,
      apiKey: null,
      isLoggedIn: false,

      login: (userId, username, apiKey, avatar) =>
        set({ userId, username, apiKey, avatar, isLoggedIn: true }),

      logout: () =>
        set({ userId: null, username: null, avatar: null, apiKey: null, isLoggedIn: false }),

      setApiKey: (apiKey) => set({ apiKey }),
      setAvatar: (avatar) => set({ avatar }),
    }),
    {
      name: 'virtugene-auth',
      partialize: (state) => {
        // 手机端：记住登录态（同一台手机不重复登录）
        // 桌面端：仅记住用户名（每次仍需输密码解密 Key，保持原安全设计）
        if (IS_MOBILE) {
          return {
            userId: state.userId,
            username: state.username,
            avatar: state.avatar,
            isLoggedIn: state.isLoggedIn,
          };
        }
        return { userId: state.userId, username: state.username };
      },
    }
  )
);
