import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IS_MOBILE } from '../lib/platform';

export const DEFAULT_USER_AVATAR = '🧬';

interface AuthState {
  userId: string | null;
  username: string | null;
  avatar: string | null;
  apiKey: string | null;
  gatewayAccessToken: string | null;
  gatewayRefreshToken: string | null;
  isLoggedIn: boolean;

  login: (userId: string, username: string, apiKey: string | null, avatar: string, gatewayTokens?: { accessToken: string; refreshToken: string }) => void;
  logout: () => void;
  setApiKey: (apiKey: string) => void;
  setGatewayTokens: (tokens: { accessToken: string; refreshToken: string } | null) => void;
  setAvatar: (avatar: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userId: null,
      username: null,
      avatar: null,
      apiKey: null,
      gatewayAccessToken: null,
      gatewayRefreshToken: null,
      isLoggedIn: false,

      login: (userId, username, apiKey, avatar, gatewayTokens) =>
        set({
          userId,
          username,
          apiKey,
          avatar,
          gatewayAccessToken: gatewayTokens?.accessToken ?? null,
          gatewayRefreshToken: gatewayTokens?.refreshToken ?? null,
          isLoggedIn: true,
        }),

      logout: () =>
        set({ userId: null, username: null, avatar: null, apiKey: null, gatewayAccessToken: null, gatewayRefreshToken: null, isLoggedIn: false }),

      setApiKey: (apiKey) => set({ apiKey }),
      setGatewayTokens: (tokens) => set({ gatewayAccessToken: tokens?.accessToken ?? null, gatewayRefreshToken: tokens?.refreshToken ?? null }),
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
            gatewayRefreshToken: state.gatewayRefreshToken,
            isLoggedIn: state.isLoggedIn,
          };
        }
        return { userId: state.userId, username: state.username, gatewayRefreshToken: state.gatewayRefreshToken, isLoggedIn: state.isLoggedIn };
      },
    }
  )
);
