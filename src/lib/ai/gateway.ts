import type { ChatParams, ChatResult } from './deepseek';

const GATEWAY_URL = (import.meta.env.VITE_AI_GATEWAY_URL ?? '').trim().replace(/\/$/, '');
const GATEWAY_TOKEN = (import.meta.env.VITE_AI_GATEWAY_TOKEN ?? '').trim();
let accessToken = '';

export type GatewayHealth = 'connected' | 'offline' | 'unconfigured';

export async function checkGatewayHealth(): Promise<GatewayHealth> {
  if (!GATEWAY_URL) return 'unconfigured';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(`${GATEWAY_URL}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return 'offline';
    const data = await response.json().catch(() => null) as { ok?: boolean } | null;
    return data?.ok === true ? 'connected' : 'offline';
  } catch {
    return 'offline';
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface GatewayAuthSession {
  user: { id: string; username: string };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function isAiGatewayConfigured(): boolean {
  return Boolean(GATEWAY_URL);
}

/** A configured address is not enough: the current user also needs a session. */
export function hasAiGatewayAccess(): boolean {
  return Boolean(GATEWAY_URL && (accessToken || GATEWAY_TOKEN));
}

/** Access token 只留在运行时内存；刷新令牌由登录态恢复流程使用。 */
export function setGatewayAccessToken(token: string | null | undefined): void {
  accessToken = token?.trim() ?? '';
}

function authorization(token?: string): Record<string, string> {
  const value = token || accessToken || GATEWAY_TOKEN;
  return value ? { Authorization: `Bearer ${value}` } : {};
}

function gatewayError(status: number): Error {
  if (status === 401 || status === 403) return new Error('auth:invalid_key');
  if (status === 402) return new Error('billing:insufficient');
  if (status === 429) return new Error('rate:limited');
  if (status >= 500) return new Error('server:error');
  return new Error('server:error');
}

async function authRequest(path: string, body?: unknown, token?: string): Promise<GatewayAuthSession> {
  if (!GATEWAY_URL) throw new Error('server:error');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${GATEWAY_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authorization(token) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error || gatewayError(response.status).message);
    }
    const data = await response.json() as GatewayAuthSession;
    if (!data?.user?.id || !data.accessToken || !data.refreshToken) throw new Error('server:error');
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error instanceof Error ? error : new Error('server:error');
  } finally {
    window.clearTimeout(timeout);
  }
}

export function registerGatewayAccount(username: string, password: string, adultConfirmed = false): Promise<GatewayAuthSession> {
  return authRequest('/v1/auth/register', { username, password, adultConfirmed });
}

export function loginGatewayAccount(username: string, password: string, adultConfirmed = false): Promise<GatewayAuthSession> {
  return authRequest('/v1/auth/login', { username, password, adultConfirmed });
}

export function refreshGatewaySession(refreshToken: string): Promise<GatewayAuthSession> {
  return authRequest('/v1/auth/refresh', undefined, refreshToken);
}

export async function deleteGatewayAccount(): Promise<void> {
  if (!GATEWAY_URL) return;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/auth/account`, {
      method: 'DELETE',
      headers: authorization(),
      signal: controller.signal,
    });
    if (!response.ok) throw gatewayError(response.status);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error instanceof Error ? error : new Error('server:error');
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function gatewayChat(params: ChatParams): Promise<ChatResult> {
  if (!GATEWAY_URL) throw new Error('server:error');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), params.timeoutMs ?? 65_000);
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authorization(),
      },
      body: JSON.stringify({
        systemPrompt: params.systemPrompt,
        message: params.message,
        image: params.image,
        history: params.history,
        retryHint: params.retryHint,
        temperature: params.temperature,
        character: params.character,
        sessionModel: params.sessionModel,
        forceVision: params.forceVision,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw gatewayError(response.status);
    const data = (await response.json()) as ChatResult;
    if (!data || typeof data.content !== 'string') throw new Error('server:error');
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error instanceof Error ? error : new Error('server:error');
  } finally {
    window.clearTimeout(timeout);
  }
}

/** 网关侧的低频辅助任务统一走 JSON 输出，避免每个功能重复携带供应商密钥。 */
export async function gatewayAux<T>(operation: string, payload: unknown): Promise<T> {
  if (!GATEWAY_URL) throw new Error('server:error');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/aux`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authorization(),
      },
      body: JSON.stringify({ operation, payload }),
      signal: controller.signal,
    });
    if (!response.ok) throw gatewayError(response.status);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error instanceof Error ? error : new Error('server:error');
  } finally {
    window.clearTimeout(timeout);
  }
}
