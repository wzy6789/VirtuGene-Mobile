import { useCallback } from 'react';
import { create } from 'zustand';
import { useAuthStore } from '../store/auth-store';

export type FeedbackTone = 'info' | 'success' | 'error';
export interface Feedback { id: number; owner: string | null; message: string; tone: FeedbackTone; duration: number }
interface FeedbackOptions { tone?: FeedbackTone; duration?: number }
let sequence = 0;
// One transient receipt across pages. A new operation replaces it, including
// repeated identical messages; its predecessor cannot dismiss the new receipt.
export const useFeedbackStore = create<{ current: Feedback | null }>(() => ({ current: null }));
export function dismissFeedback(id?: number) {
  useFeedbackStore.setState(state => id === undefined || state.current?.id === id ? { current: null } : state);
}
export function useFeedback() {
  const owner = useAuthStore(s => s.userId);
  return useCallback((message: string | null, options: FeedbackOptions | number = {}) => {
    if (useAuthStore.getState().userId !== owner) return;
    if (!message) { dismissFeedback(); return; }
    const settings = typeof options === 'number' ? { duration: options } : options;
    useFeedbackStore.setState({ current: { id: ++sequence, owner, message, tone: settings.tone ?? 'info',
      duration: settings.duration ?? (settings.tone === 'error' || message.length > 30 ? 5600 : 3600) } });
  }, [owner]);
}
