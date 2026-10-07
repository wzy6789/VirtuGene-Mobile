import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
const resolveTheme = (preference: ThemePreference): Theme => preference === 'system'
  ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;

interface ThemeState {
  theme: Theme;
  preference: ThemePreference;
  setTheme: (preference: ThemePreference) => void;
  syncSystemTheme: () => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      preference:'dark',
      setTheme: preference => set({preference,theme:resolveTheme(preference)}),
      syncSystemTheme: () => { const theme=resolveTheme(get().preference); if (get().theme !== theme) set({theme}); },
      toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    }),
    {
      name: 'virtugene-theme',
      version:1,
      partialize: state => ({preference:state.preference}),
      migrate: stored => {
        const value=stored as {preference?:unknown;theme?:unknown} | null;
        const preference=value?.preference ?? value?.theme;
        const valid:ThemePreference=preference === 'light' || preference === 'system' ? preference : 'dark';
        return {preference:valid,theme:resolveTheme(valid)};
      },
      onRehydrateStorage: () => state => state?.syncSystemTheme(),
    }
  )
);
