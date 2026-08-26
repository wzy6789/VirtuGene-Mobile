import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      partialize: (state) => ({
        userId: state.userId,
        username: state.username,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AuthState>),
        isLoggedIn: false,
        apiKey: null,
      }),
    }
  )
);
