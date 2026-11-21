import { useAuthStore } from '../store/auth-store';

// Text only, held for this app run. Never written to storage, prompts or sync.
const drafts = new Map<string, string>();
const listeners = new Set<(ownerId: string, sessionId: string) => void>();
export function onChatComposerInput(listener: (ownerId: string, sessionId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const key = (ownerId: string, sessionId: string) => JSON.stringify([ownerId, sessionId]);
export function clearChatComposerDrafts() { drafts.clear(); }
export function readChatComposerDraft(ownerId?: string, sessionId?: string) {
  return ownerId && sessionId && useAuthStore.getState().userId === ownerId
    ? drafts.get(key(ownerId, sessionId)) ?? '' : '';
}
export function writeChatComposerDraft(ownerId: string | undefined, sessionId: string | undefined, text: string) {
  if (!ownerId || !sessionId || useAuthStore.getState().userId !== ownerId) return;
  const id = key(ownerId, sessionId);
  if (text) drafts.set(id, text); else drafts.delete(id);
  for (const listener of listeners) listener(ownerId, sessionId);
}
const unsubscribe = useAuthStore.subscribe((state, previous) => {
  if (state.userId !== previous.userId) clearChatComposerDrafts();
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
