import { create } from 'zustand';
import type { Character } from '../db';
import { useAuthStore } from './auth-store';

export interface VoiceCallTarget { character: Character; sessionId: string; userId: string }
/** Presentation belongs to the app, independently of the page that placed the call. */
export const useVoiceCallUIStore = create<{
  target?: VoiceCallTarget; minimized: boolean; blocksChat: boolean;
  open(target: VoiceCallTarget): void; minimize(): void; restore(): void; close(): void;
  setChatBlocked(sessionId: string, userId: string, blocked: boolean): void;
}>((set, get) => ({
  minimized: false, blocksChat: false,
  open(target) {
    if (target.userId !== useAuthStore.getState().userId) return;
    // An existing call must be restored, never silently replaced by another role.
    set({ target: get().target ?? target, minimized: false, blocksChat: get().target ? get().blocksChat : true });
  },
  minimize: () => set({ minimized: true }), restore: () => set({ minimized: false }),
  close: () => set({ target: undefined, minimized: false, blocksChat: false }),
  setChatBlocked(sessionId, userId, blocked) {
    const current = get();
    if (current.target?.sessionId === sessionId && current.target.userId === userId && current.blocksChat !== blocked) set({ blocksChat: blocked });
  },
}));
useAuthStore.subscribe(state => {
  const call = useVoiceCallUIStore.getState();
  if (call.target && call.target.userId !== state.userId) call.close();
});
