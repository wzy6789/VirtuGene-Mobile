import { useAuthStore } from '../../store/auth-store';
import { hasStoredSecret } from '../api-key-storage';
import { hasAiGatewayAccess } from './gateway';
import { resolveModel } from './llm';
import { getProviderConfig, providerRequiresKey } from './provider-config';
import { LLM_PROVIDERS, type LLMModel } from './provider-registry';

/** A configured route, not a claim that the platform has validated its credentials. */
export function canUseAi(model: LLMModel = resolveModel()): boolean {
  const config = getProviderConfig(model.provider);
  if (!config.enabled) return false;
  if (!providerRequiresKey(model.provider, config.baseUrl)) return true;
  if (model.provider === 'deepseek') return !!useAuthStore.getState().apiKey?.trim() || hasAiGatewayAccess();
  const storage = LLM_PROVIDERS[model.provider].keyStorage;
  return !!storage && hasStoredSecret(storage);
}
