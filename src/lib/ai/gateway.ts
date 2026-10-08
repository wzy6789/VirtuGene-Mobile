import type { ChatParams, ChatResult } from './deepseek';
import { readSseResponse, type LLMStreamResult } from './llm';
import {DEEPSEEK_MODEL_ID} from '../../../server/deepseek-policy.mjs';

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

export async function gatewayChat(params: ChatParams, options: { baseUrl?: string } = {}): Promise<ChatResult> {
  const baseUrl = (options.baseUrl ?? GATEWAY_URL).replace(/\/$/, '');
  if (!baseUrl) throw new Error('server:error');
  const controller = new AbortController();
  const cancel = () => controller.abort(params.signal?.reason);
  if (params.signal?.aborted) cancel();
  else params.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), params.timeoutMs ?? 65_000);
  let requested=false,reported=false;
  const report=(usage:ChatResult['usage'],modelId:string=DEEPSEEK_MODEL_ID)=>{reported=true;try{params.onUsage?.({modelId,usage});}catch{/* Observer failure cannot retry a paid request. */}};
  try {
    requested=!params.signal?.aborted;
    const response = await fetch(`${baseUrl}/v1/chat`, {
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
        disableThinking: params.disableThinking,
        ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
        ...(params.structuredOutput ? { disableThinking: true, structuredOutput: true } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {requested=response.status>=500;throw gatewayError(response.status);}
    const data = (await response.json()) as ChatResult;
    report(data?.usage,data?.modelId);
    if (!data || typeof data.content !== 'string') throw new Error('server:error');
    return data;
  } catch (error) {
    if(requested&&!reported)report(undefined);
    if (params.signal?.aborted) throw params.signal.reason ?? new DOMException('Cancelled', 'AbortError');
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error instanceof Error ? error : new Error('server:error');
  } finally {
    window.clearTimeout(timeout);
    params.signal?.removeEventListener('abort', cancel);
  }
}

/**
 * 世界与私聊共用的流式网关端点 `/v1/chat/stream`。
 *
 * - 请求体与 gatewayChat 相同（外加可选 maxTokens/disableThinking，供世界管线控制预算），
 *   网关把 DeepSeek 的 SSE 帧原样转发，因此这里复用 BYOK 的共享 SSE 解析器，
 *   CRLF/分片/断线/空流行为与 BYOK 完全一致；
 * - 正文已开始流出后中断：保留部分正文并标记 interrupted（调用方不得整轮重发）；
 * - 未流出正文就失败：按统一错误码抛出，世界出口按既定规则回退整段网关调用。
 */
export async function gatewayChatStream(
  params: ChatParams & {
    onDelta: (accumulated: string, delta: string) => void;
    maxTokens?: number;
    disableThinking?: boolean;
  },
  options: { baseUrl?: string } = {},
): Promise<LLMStreamResult> {
  const baseUrl = (options.baseUrl ?? GATEWAY_URL).replace(/\/$/, '');
  if (!baseUrl) throw new Error('server:error');
  const controller = new AbortController();
  const cancel = () => controller.abort(params.signal?.reason);
  if (params.signal?.aborted) cancel();
  else params.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), params.timeoutMs ?? 65_000);
  let requested=false,reported=false;
  const report=(usage:ChatResult['usage'])=>{reported=true;try{params.onUsage?.({modelId:DEEPSEEK_MODEL_ID,usage});}catch{/* Observer failure cannot retry a paid request. */}};
  try {
    requested=!params.signal?.aborted;
    const response = await fetch(`${baseUrl}/v1/chat/stream`, {
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
        ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
        ...(params.disableThinking ? { disableThinking: true } : {}),
        ...(params.structuredOutput ? { structuredOutput: true } : {}),
      }),
      signal: controller.signal,
    });
    // A deployed older gateway may expose only the original JSON endpoint.
    // This fallback happens before any text has been received, never after a cut.
    if (response.status === 404 || response.status === 405) {
      // Endpoint discovery is not a model call; JSON fallback reports itself.
      requested=false;
      const result = await gatewayChat(params, { baseUrl });
      if (result.content) params.onDelta(result.content, result.content);
      return result;
    }
    if (!response.ok) {requested=response.status>=500;throw gatewayError(response.status);}
    const outcome = await readSseResponse(response, params.onDelta);
    report(outcome.usage);
    const truncated = outcome.truncated || outcome.interrupted;
    if (!outcome.content.trim()) throw new Error('stream:empty');
    return {
      content: outcome.content,
      ...(truncated ? { truncated, interrupted: outcome.interrupted } : {}),
      ...(outcome.usage ? { usage: outcome.usage } : {}),
    };
  } catch (error) {
    if(requested&&!reported)report(undefined);
    if (params.signal?.aborted) throw params.signal.reason ?? new DOMException('Cancelled', 'AbortError');
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error instanceof Error ? error : new Error('server:error');
  } finally {
    window.clearTimeout(timeout);
    params.signal?.removeEventListener('abort', cancel);
  }
}

/** 网关侧的低频辅助任务统一走 JSON 输出，避免每个功能重复携带供应商密钥。 */
export async function gatewayAux<T>(operation: string, payload: unknown): Promise<T> {  if (!GATEWAY_URL) throw new Error('server:error');
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
