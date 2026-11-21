/** @deprecated Legacy verifier compatibility only. Live chat reads chat-background-store;
 * historical JSON is consumed once by chat-background-repo, never as a render fallback. */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CHAT_ATMOSPHERE_THEMES, type ChatAtmosphereThemeId, type ChatAtmosphereMode, type ChatAtmosphereMotion } from '../lib/chat-atmosphere';
import { useAuthStore } from './auth-store';

export type { ChatAtmosphereMotion } from '../lib/chat-atmosphere';
export interface ChatAppearancePreference {
  mode: ChatAtmosphereMode;
  theme: ChatAtmosphereThemeId;
  motion: ChatAtmosphereMotion;
}
export const DEFAULT_CHAT_APPEARANCE: Readonly<ChatAppearancePreference> = Object.freeze({ mode: 'character', theme: 'neutral', motion: 'gentle' });
export const chatAppearanceKey = (userId: string, characterId: string) => JSON.stringify([userId, characterId]);

function validPreference(value: unknown): value is ChatAppearancePreference {
  if (!value || typeof value !== 'object') return false;
  const p = value as ChatAppearancePreference;
  return (p.mode === 'character' || p.mode === 'manual') && CHAT_ATMOSPHERE_THEMES.some(t => t.id === p.theme) && ['off', 'gentle', 'vivid'].includes(p.motion);
}
interface ChatAppearanceState {
  byRole: Record<string, ChatAppearancePreference>;
  setPreference: (userId: string, characterId: string, preference: ChatAppearancePreference) => void;
  reset: (userId: string, characterId: string) => void;
}

/** Local visual preferences only. No persona, history, authorization or model input is stored here. */
export const useChatAppearanceStore = create<ChatAppearanceState>()(persist((set) => ({
  byRole: {},
  setPreference: (userId, characterId, preference) => {
    if (!userId || !characterId || useAuthStore.getState().userId !== userId || !validPreference(preference)) return;
    set(state => ({ byRole: { ...state.byRole, [chatAppearanceKey(userId, characterId)]: { mode: preference.mode, theme: preference.theme, motion: preference.motion } } }));
  },
  reset: (userId, characterId) => {
    if (!userId || !characterId || useAuthStore.getState().userId !== userId) return;
    set(state => {
      const byRole = { ...state.byRole };
      delete byRole[chatAppearanceKey(userId, characterId)];
      return { byRole };
    });
  },
}), {
  name: 'virtugene-chat-appearance',
  partialize: state => ({ byRole: state.byRole }),
  merge: (saved, current) => {
    const records = (saved as Partial<ChatAppearanceState> | undefined)?.byRole;
    const byRole: ChatAppearanceState['byRole'] = {};
    if (records && typeof records === 'object') for (const [key, value] of Object.entries(records)) {
      try {
        const pair = JSON.parse(key);
        if (Array.isArray(pair) && pair.length === 2 && pair.every(id => typeof id === 'string' && id.length > 0) && validPreference(value)) byRole[key] = { mode: value.mode, theme: value.theme, motion: value.motion };
      } catch { /* Invalid saved visual preference falls back to the character theme. */ }
    }
    return { ...current, byRole };
  },
}));
