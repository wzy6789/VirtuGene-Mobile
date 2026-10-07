import { DEEPSEEK_MODEL_ID, isProviderId, LLM_MODELS, LLM_PROVIDERS, type LLMModel, type ProviderId } from './provider-registry';

export interface ProviderConfig {
  baseUrl: string;
  enabled: boolean;
  /** Additional or explicitly overridden model metadata, never credentials. */
  models: LLMModel[];
}
export interface ProviderConfigInput {
  baseUrl?: string;
  enabled?: boolean;
  models?: Array<{ id: string; label?: string; vision?: boolean }>;
}
const STORAGE_KEY = 'virtugene-ai-provider-config-v1';
const listeners = new Set<() => void>();
export function subscribeProviderConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyProviderConfigChanged(): void {
  for (const listener of listeners) listener();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('virtugene-ai-config-change'));
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key?.startsWith('virtugene-secret-')) notifyProviderConfigChanged();
});
function readStored(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  } catch { return {}; }
}
export function isLocalProviderUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '::1'
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^\[f[cd][\da-f:]+\]$/.test(host);
  } catch { return false; }
}
/** Public keys must not travel over plaintext HTTP; local model servers may use HTTP. */
export function normalizeProviderBaseUrl(value: string, provider: ProviderId): string {
  const fallback = LLM_PROVIDERS[provider].baseUrl;
  let url: URL;
  try { url = new URL(value.trim() || fallback); } catch { throw new Error('config:invalid_url'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('config:invalid_url');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalProviderUrl(url.href))) throw new Error('config:invalid_url');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|messages|models)$/, '');
  return url.href.replace(/\/$/, '');
}
function cleanModels(provider: ProviderId, value: unknown): LLMModel[] {
  if (!Array.isArray(value)) return [];
  // DeepSeek has one managed model. Old catalog overrides cannot remove vision
  // support or restore a retired/Pro option on rehydration.
  if (provider === 'deepseek') return [];
  const unique = new Map<string, LLMModel>();
  for (const item of value.slice(0, 300)) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
    const id = item.id.trim();
    if (!id || id.length > 240 || /[\r\n\u0000-\u001f]/.test(id)) continue;
    unique.set(id, { id, provider, label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 120) : id, vision: item.vision === true });
  }
  return [...unique.values()];
}
export function getProviderConfig(provider: ProviderId): ProviderConfig {
  const raw = readStored()[provider];
  const config = raw && typeof raw === 'object' ? raw as ProviderConfigInput : {};
  let baseUrl = LLM_PROVIDERS[provider].baseUrl;
  try { baseUrl = normalizeProviderBaseUrl(typeof config.baseUrl === 'string' ? config.baseUrl : '', provider); } catch { /* Ignore invalid persisted addresses. */ }
  return { baseUrl, enabled: config.enabled !== false, models: cleanModels(provider, config.models) };
}
export function saveProviderConfig(provider: ProviderId, update: ProviderConfigInput): void {
  if (!isProviderId(provider)) throw new Error('config:invalid_provider');
  const current = getProviderConfig(provider);
  const next: ProviderConfig = {
    baseUrl: update.baseUrl === undefined ? current.baseUrl : normalizeProviderBaseUrl(update.baseUrl, provider),
    enabled: update.enabled ?? current.enabled,
    models: update.models === undefined ? current.models : cleanModels(provider, update.models),
  };
  // Whitelist fields; even an accidentally supplied apiKey is never persisted here.
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), [provider]: next }));
  notifyProviderConfigChanged();
}
export function getAvailableModels(provider?: ProviderId): LLMModel[] {
  const providers = provider ? [provider] : Object.keys(LLM_PROVIDERS) as ProviderId[];
  return providers.flatMap(id => {
    const config = getProviderConfig(id);
    if (!provider && !config.enabled) return [];
    const models = new Map(LLM_MODELS.filter(model => model.provider === id).map(model => [model.id, model]));
    for (const model of config.models) models.set(model.id, { ...models.get(model.id), ...model });
    return [...models.values()];
  });
}
export function normalizeModelId(id: string, provider: string): string {
  return provider === 'deepseek' ? DEEPSEEK_MODEL_ID : id;
}
export function providerRequiresKey(provider: ProviderId, baseUrl?: string): boolean {
  return provider !== 'custom' || !isLocalProviderUrl(baseUrl ?? getProviderConfig(provider).baseUrl);
}
