/** Unified BYOK client. Native Claude/Gemini protocols and OpenAI-compatible providers. */
import { isTimeoutError } from './http';
import { useAuthStore } from '../../store/auth-store';
import { useSettingsStore } from '../../store/settings-store';
import { loadSecret } from '../api-key-storage';
import { DEFAULT_MODEL_ID, isProviderId, LLM_MODELS, LLM_PROVIDERS, type LLMModel, type ProviderId } from './provider-registry';
import { getAvailableModels, getProviderConfig, normalizeProviderBaseUrl, providerRequiresKey } from './provider-config';
import { buildProviderRequest, parseProviderResponse, providerHeaders, readProviderSseResponse, throwForProviderStatus } from './provider-protocols';
export * from './provider-registry';
export * from './provider-config';

/** Provider and model together identify a selection; exact custom IDs remain usable. */
export function findModel(id?: string, provider?: string): LLMModel | undefined {
  if (!id) return undefined;
  if (provider && !isProviderId(provider)) return undefined;
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
export async function getProviderKey(provider: ProviderId): Promise<string | null> {
  if (provider === 'deepseek') return useAuthStore.getState().apiKey;
  const name = LLM_PROVIDERS[provider]?.keyStorage;
  return name ? loadSecret(name) : null;
}
export interface LLMChatParams {
  provider: ProviderId;
  model: string;
  apiKey: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  visionRequest?: boolean;
  disableThinking?: boolean;
  jsonMode?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  /** A draft endpoint for explicit connection tests; does not save configuration. */
  baseUrl?: string;
  signal?: AbortSignal;
}
export interface LLMChatResult {
  content: string;
  truncated?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  rawNote?: string;
}
export interface LLMStreamParams extends LLMChatParams {
  onDelta: (accumulated: string, delta: string) => void;
}
export interface LLMStreamResult extends LLMChatResult { interrupted?: boolean; }
export interface SseReadOutcome {
  content: string;
  truncated: boolean;
  interrupted: boolean;
  usage?: LLMChatResult['usage'];
}
/** Gateway remains OpenAI SSE and keeps its public parser API unchanged. */
export const readSseResponse = readProviderSseResponse;

function prepare(params: LLMChatParams, stream = false) {
  if (!isProviderId(params.provider)) throw new Error('config:invalid_provider');
  if (!params.model.trim() || /[\r\n\u0000-\u001f]/.test(params.model) || params.model.length > 240) throw new Error('config:invalid_model');
  if (params.maxTokens !== undefined && (!Number.isFinite(params.maxTokens) || params.maxTokens < 1)) throw new Error('request:invalid');
  const config = getProviderConfig(params.provider);
  if (!config.enabled && params.baseUrl === undefined) throw new Error('provider:disabled');
  const baseUrl = normalizeProviderBaseUrl(params.baseUrl ?? config.baseUrl, params.provider);
  if (providerRequiresKey(params.provider, baseUrl) && !params.apiKey.trim()) throw new Error('auth:invalid_key');
  const hasImage = params.messages.some(message => Array.isArray(message.content) && message.content.some(part => part?.type === 'image_url'));
  if (hasImage && findModel(params.model, params.provider)?.vision !== true) throw new Error('model:vision_unsupported');
  const protocol = LLM_PROVIDERS[params.provider].protocol;
  return { ...buildProviderRequest(params, protocol, baseUrl, stream), protocol };
}
/** Keep the timeout alive while reading the body, not just until response headers arrive. */
async function request(url: string, init: RequestInit, timeoutMs = 60_000, signal?: AbortSignal): Promise<{ response: Response; cleanup: () => void }> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
  try { return { response: await fetch(url, { ...init, signal: controller.signal }), cleanup }; }
  catch (error) { cleanup(); throw error; }
}
function normalizeError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
  if (isTimeoutError(error)) throw new Error('timeout');
  if (error instanceof Error) throw error;
  throw new Error('server:error');
}
export async function llmChat(params: LLMChatParams): Promise<LLMChatResult> {
  const prepared = prepare(params);
  let cleanup: (() => void) | undefined;
  try {
    const fetched = await request(prepared.url, prepared.init, params.timeoutMs, params.signal);
    cleanup = fetched.cleanup;
    if (!fetched.response.ok) throwForProviderStatus(fetched.response.status);
    return parseProviderResponse(await fetched.response.json(), prepared.protocol, params.provider);
  } catch (error) { return normalizeError(error, params.signal); }
  finally { cleanup?.(); }
}
export async function llmChatStream(params: LLMStreamParams): Promise<LLMStreamResult> {
  const prepared = prepare(params, true);
  let cleanup: (() => void) | undefined;
  try {
    const fetched = await request(prepared.url, prepared.init, params.timeoutMs, params.signal);
    cleanup = fetched.cleanup;
    if (!fetched.response.ok) throwForProviderStatus(fetched.response.status);
    const outcome = await readProviderSseResponse(fetched.response, params.onDelta, prepared.protocol, params.provider);
    if (!outcome.content.trim()) throw new Error('stream:empty');
    const truncated = outcome.truncated || outcome.interrupted;
    return { content: outcome.content, usage: outcome.usage, ...(truncated ? { truncated: true, interrupted: outcome.interrupted, rawNote: `stream=true, truncated=${outcome.truncated}, interrupted=${outcome.interrupted}` } : {}) };
  } catch (error) { return normalizeError(error, params.signal); }
  finally { cleanup?.(); }
}

export interface ProviderConnectionParams { apiKey?: string; baseUrl?: string; model?: string; signal?: AbortSignal; }
/** Model catalogs are fetched only on the user's explicit action; no background API calls. */
export async function fetchProviderModels(provider: ProviderId, options: ProviderConnectionParams = {}): Promise<LLMModel[]> {
  const meta = LLM_PROVIDERS[provider];
  if (!meta?.modelDiscovery) throw new Error('models:unsupported');
  const baseUrl = normalizeProviderBaseUrl(options.baseUrl ?? getProviderConfig(provider).baseUrl, provider);
  const key = options.apiKey ?? await getProviderKey(provider) ?? '';
  if (providerRequiresKey(provider, baseUrl) && !key.trim()) throw new Error('auth:invalid_key');
  const models = new Map<string, LLMModel>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const query = cursor ? meta.protocol === 'gemini' ? `?pageToken=${encodeURIComponent(cursor)}` : `?after_id=${encodeURIComponent(cursor)}` : '';
    let cleanup: (() => void) | undefined;
    try {
      const fetched = await request(`${baseUrl}/models${query}`, { method: 'GET', headers: providerHeaders(meta.protocol, key) }, 15_000, options.signal);
      cleanup = fetched.cleanup;
      if (!fetched.response.ok) throwForProviderStatus(fetched.response.status);
      const data = await fetched.response.json();
      if (data.error) throw new Error('server:error');
      const list = meta.protocol === 'gemini' ? data.models : data.data;
      if (!Array.isArray(list)) throw new Error('models:invalid_response');
      for (const entry of list) {
        if (meta.protocol === 'gemini' && !entry.supportedGenerationMethods?.includes('generateContent')) continue;
        const id = meta.protocol === 'gemini' ? String(entry.name ?? '').replace(/^models\//, '') : entry.id;
        if (typeof id !== 'string' || !id || id.length > 240 || /[\r\n\u0000-\u001f]/.test(id)) continue;
        const known = findModel(id, provider);
        const modalities = entry.architecture?.input_modalities ?? entry.input_modalities;
        models.set(id, { id, label: entry.displayName ?? entry.display_name ?? entry.name ?? id, provider, vision: known?.vision === true || meta.protocol === 'anthropic' || (Array.isArray(modalities) && modalities.includes('image')) });
      }
      const next = meta.protocol === 'gemini' ? data.nextPageToken : meta.protocol === 'anthropic' && data.has_more ? data.last_id : undefined;
      if (typeof next !== 'string' || !next || next === cursor) break;
      cursor = next;
    } catch (error) { return normalizeError(error, options.signal); }
    finally { cleanup?.(); }
  }
  return [...models.values()];
}
export async function validateProviderConnection(provider: ProviderId, options: ProviderConnectionParams = {}): Promise<void> {
  if (LLM_PROVIDERS[provider].modelDiscovery) {
    const models = await fetchProviderModels(provider, options);
    const selectedModel = options.model?.replace(/^models\//, '');
    if (selectedModel && !models.some(model => model.id === selectedModel)) throw new Error('model:unavailable');
    // OpenRouter exposes a public catalog; its authenticated key endpoint verifies credentials.
    if (provider === 'openrouter') {
      const baseUrl = normalizeProviderBaseUrl(options.baseUrl ?? getProviderConfig(provider).baseUrl, provider);
      const key = options.apiKey ?? await getProviderKey(provider) ?? '';
      const fetched = await request(`${baseUrl}/key`, { method: 'GET', headers: providerHeaders('openai', key) }, 15_000, options.signal);
      try { if (!fetched.response.ok) throwForProviderStatus(fetched.response.status); }
      finally { fetched.cleanup(); }
    }
    return;
  }
  if (!options.model?.trim()) throw new Error('config:model_required');
  await llmChat({ provider, model: options.model, apiKey: options.apiKey ?? await getProviderKey(provider) ?? '', baseUrl: options.baseUrl, signal: options.signal, messages: [{ role: 'user', content: 'Reply OK.' }], disableThinking: true, maxTokens: 16, timeoutMs: 15_000 });
}
