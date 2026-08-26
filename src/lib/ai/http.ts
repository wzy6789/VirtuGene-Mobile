/**
 * 带超时的 fetch 封装。
 * 超时后抛出 DOMException（name = 'TimeoutError'），调用方按需映射为业务错误码。
 */
const DEFAULT_TIMEOUT_MS = 60_000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}
