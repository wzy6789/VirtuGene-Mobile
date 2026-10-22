import { useAuthStore } from '../../store/auth-store';
import { getProviderKey } from './llm';
import { getProviderConfig, normalizeProviderBaseUrl, providerRequiresKey } from './provider-config';
import { GATEWAY_URL, hasAiGatewayAccess } from './gateway-session';
import { DEEPSEEK_MODEL_ID, LLM_MODELS, LLM_PROVIDERS, type ProviderId } from './provider-registry';

const STORAGE = 'virtugene-connection-checks-v1';
const SALT = 'virtugene-connection-check-salt-v1';
export const CONNECTION_CHECK_TTL = 24 * 60 * 60 * 1000;
export const CONNECTION_CHECK_EVENT = 'vg:connection-check-change';
type CheckScope = 'catalog' | 'model' | 'gateway';
interface Identity { key: string; connection: string; model: string; configured: boolean; scope: CheckScope }
interface CheckRecord { connection: string; model: string; scope: CheckScope; outcome: 'success' | 'failure'; at: number }
interface Pending { identity: Identity; token: symbol }
export interface ConnectionCheckView { status: 'unconfigured' | 'untested' | 'changed' | 'checking' | 'success' | 'failure' | 'expired'; at?: number; scope?: CheckScope }
const pending = new Map<string, Pending>();
const changed = () => window.dispatchEvent(new Event(CONNECTION_CHECK_EVENT));

/** Only salted, device-local HMACs leave this function. Never persist keys, URLs or response bodies. */
async function fingerprint(parts: unknown[]): Promise<string> {
  let salt = localStorage.getItem(SALT);
  if (!salt || !/^[a-f0-9]{64}$/.test(salt)) {
    salt = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(SALT, salt);
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('');
}
function records(): Record<string, CheckRecord> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).flatMap(([key, item]) => /^[a-f0-9]{64}$/.test(key) && item &&
      /^[a-f0-9]{64}$/.test(item.connection) && /^[a-f0-9]{64}$/.test(item.model) &&
      ['catalog', 'model', 'gateway'].includes(item.scope) && ['success', 'failure'].includes(item.outcome) &&
      typeof item.at === 'number' && Number.isFinite(item.at) && Number.isFinite(new Date(item.at).getTime())
      ? [[key, { connection: item.connection, model: item.model, scope: item.scope, outcome: item.outcome, at: item.at }]] : []));
  } catch { return {}; }
}
export async function savedConnectionIdentity(owner: string, provider: ProviderId, model: string): Promise<Identity> {
  const config = getProviderConfig(provider), key = await getProviderKey(provider) ?? '';
  const auth = useAuthStore.getState();
  const gateway = provider === 'deepseek' && !key && hasAiGatewayAccess();
  const scope: CheckScope = gateway ? 'gateway' : LLM_PROVIDERS[provider].modelDiscovery && provider !== 'deepseek' ? 'catalog' : 'model';
  const configured = config.enabled && (gateway || !providerRequiresKey(provider, config.baseUrl) || !!key) && !!model &&
    (provider === 'deepseek' || getSavedModels(provider).includes(model));
  const identity = await Promise.all([
    fingerprint([owner, provider]),
    fingerprint([provider, config.enabled, gateway ? GATEWAY_URL : config.baseUrl, gateway ? auth.gatewayRefreshToken ?? auth.gatewayAccessToken ?? 'managed-device-session' : key, scope]),
    fingerprint([provider === 'deepseek' ? DEEPSEEK_MODEL_ID : model]),
  ]);
  return { key: identity[0], connection: identity[1], model: identity[2], configured, scope };
}
export async function readConnectionCheck(owner: string, provider: ProviderId, model: string, now = Date.now()): Promise<ConnectionCheckView> {
  const identity = await savedConnectionIdentity(owner, provider, model);
  if (!identity.configured) return { status: 'unconfigured' };
  const active = pending.get(identity.key);
  if (active?.identity.connection === identity.connection && active.identity.model === identity.model) return { status: 'checking', scope: identity.scope };
  const record = records()[identity.key];
  if (!record) return { status: 'untested' };
  if (record.connection !== identity.connection) return { status: 'changed', at: record.at };
  if (record.model !== identity.model) return { status: 'untested' };
  if (now < record.at || now - record.at >= CONNECTION_CHECK_TTL) return { status: 'expired', at: record.at, scope: record.scope };
  return { status: record.outcome, at: record.at, scope: record.scope };
}
export interface ConnectionCheckTicket { owner: string; provider: ProviderId; model: string; identity: Identity; token: symbol }
/** Called only by an explicit test click, after draft values have been compared with saved values. */
export async function beginConnectionCheck(owner: string, provider: ProviderId, model: string, request: { baseUrl: string; key: string; enabled: boolean; gateway?: boolean }): Promise<ConnectionCheckTicket | null> {
  try {
    const config = getProviderConfig(provider), savedKey = await getProviderKey(provider) ?? '';
    if (useAuthStore.getState().userId !== owner || request.enabled !== config.enabled || !config.enabled) return null;
    if (!request.gateway && (normalizeProviderBaseUrl(request.baseUrl, provider) !== config.baseUrl || request.key !== savedKey)) return null;
    if (provider !== 'deepseek' && !getSavedModels(provider).includes(model)) return null;
    const identity = await savedConnectionIdentity(owner, provider, model);
    if (!identity.configured || useAuthStore.getState().userId !== owner || !!request.gateway !== (identity.scope === 'gateway')) return null;
    if (!request.gateway && identity.connection !== await fingerprint([provider, request.enabled, normalizeProviderBaseUrl(request.baseUrl, provider), request.key, identity.scope])) return null;
    const token = Symbol('connection-check');
    pending.set(identity.key, { identity, token }); changed();
    return { owner, provider, model, identity, token };
  } catch { return null; } // Failure to store local metadata must not prevent the requested test.
}
function getSavedModels(provider: ProviderId): string[] {
  // This catalogue reads local configuration only and never contacts a provider.
  return [...LLM_MODELS.filter(item => item.provider === provider), ...getProviderConfig(provider).models].map(item => item.id);
}
export function cancelConnectionCheck(ticket: ConnectionCheckTicket | null): void {
  if (ticket && pending.get(ticket.identity.key)?.token === ticket.token) { pending.delete(ticket.identity.key); changed(); }
}
export async function finishConnectionCheck(ticket: ConnectionCheckTicket | null, outcome: 'success' | 'failure'): Promise<boolean> {
  if (!ticket) return false;
  try {
    if (useAuthStore.getState().userId !== ticket.owner || pending.get(ticket.identity.key)?.token !== ticket.token) return false;
    const current = await savedConnectionIdentity(ticket.owner, ticket.provider, ticket.model);
    if (useAuthStore.getState().userId !== ticket.owner || pending.get(ticket.identity.key)?.token !== ticket.token) return false;
    if (!current.configured || current.connection !== ticket.identity.connection || current.model !== ticket.identity.model) return false;
    const next = { ...records(), [current.key]: { connection: current.connection, model: current.model, scope: current.scope, outcome, at: Date.now() } };
    localStorage.setItem(STORAGE, JSON.stringify(Object.fromEntries(Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, 64))));
    return true;
  } catch {
    return false;
  } finally { cancelConnectionCheck(ticket); }
}
