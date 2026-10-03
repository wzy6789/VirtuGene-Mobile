import { useSyncExternalStore } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useSettingsStore } from '../../store/settings-store';
import { canUseAi } from '../../lib/ai/availability';
import { subscribeProviderConfig } from '../../lib/ai/provider-config';
import type { LLMModel } from '../../lib/ai/provider-registry';

function subscribe(listener: () => void) {
  const remove = [useAuthStore.subscribe(listener), useSettingsStore.subscribe(listener), subscribeProviderConfig(listener)];
  return () => remove.forEach(unsubscribe => unsubscribe());
}
export function useAiAvailability(model?: LLMModel): boolean {
  return useSyncExternalStore(subscribe, () => canUseAi(model), () => false);
}
