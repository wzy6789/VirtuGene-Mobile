import { useSettingsStore } from '../../store/settings-store';
import { DEFAULT_MODEL_ID, DEEPSEEK_MODEL_ID, LEGACY_DEEPSEEK_MODEL_IDS, isProviderId, LLM_MODELS, type LLMModel, type ProviderId } from './provider-registry';
import { getAvailableModels } from './provider-config';

/** Provider and model together identify a selection; exact custom IDs remain usable. */
export function findModel(id?: string, provider?: string): LLMModel | undefined {
  if (!id) return undefined;
  if (provider && !isProviderId(provider)) return undefined;
  if (provider === 'deepseek' || (!provider && LEGACY_DEEPSEEK_MODEL_IDS.includes(id))) {
    return getAvailableModels(provider as 'deepseek' | undefined).find(model => model.provider === 'deepseek' && model.id === DEEPSEEK_MODEL_ID);
  }
  return getAvailableModels(provider as ProviderId | undefined).find(model => model.id === id && (!provider || model.provider === provider));
}
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number, provider?: ProviderId): number {
  const price = findModel(modelId, provider)?.pricing;
  return price ? (inputTokens * price.in + outputTokens * price.out) / 1_000_000 : 0;
}
type ModelSelection = { provider: string; model: string };
export function resolveModel(character?: { model?: ModelSelection } | null, sessionModel?: ModelSelection | null): LLMModel {
  const selected = sessionModel?.model ? sessionModel : character?.model?.model ? character.model : useSettingsStore.getState().defaultModel;
  if (selected?.model) {
    if (!isProviderId(selected.provider)) throw new Error('config:invalid_provider');
    const id = selected.model.trim();
    if (!id || id.length > 240 || /[\r\n\u0000-\u001f]/.test(id)) throw new Error('config:invalid_model');
    return findModel(id, selected.provider) ?? { id, label: id, provider: selected.provider };
  }
  return findModel(DEFAULT_MODEL_ID, 'deepseek') ?? LLM_MODELS[0];
}
