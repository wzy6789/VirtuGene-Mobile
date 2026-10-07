import { useUIStore } from '../../store/ui-store';
import { useAuthStore } from '../../store/auth-store';
import { beginSoulHandoff, soulElement } from '../soul-handoff';

/** This only opens the user's workspace; opening it never starts an AI request. */
export function openAssistantWorkspace(tab: 'today' | 'chat' | 'pending' = 'today', from: 'list' | 'chat' = 'list') {
  const userId = useAuthStore.getState().userId;
  if (!userId) return;
  const key = `action-cabin:${userId}`;
  beginSoulHandoff(key, soulElement(key, from), 'cabin');
  useUIStore.setState({ activeView: 'actionCabin', mobileTab: 'chat', assistantTab: tab });
}
