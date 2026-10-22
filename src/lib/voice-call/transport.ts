import { Capacitor, registerPlugin } from '@capacitor/core';

export interface MimoStreamPort {
  open(options: { id: string; key: string; body: string }): Promise<{ status: number; contentType?: string }>;
  read(options: { id: string }): Promise<{ done: boolean; data?: string }>;
  cancel(options: { id: string }): Promise<void>;
}
const native = registerPlugin<MimoStreamPort>('MimoStream');

/** Android avoids WebView CORS without buffering the whole SSE response. */
export const callFetch: typeof fetch = async (url, init) => {
  if (Capacitor.getPlatform() !== 'android') return fetch(url, init);
  if (!Capacitor.isPluginAvailable('MimoStream')) throw new Error('voice:transport_missing');
  return nativeCallFetch(native, url, init);
};

export async function nativeCallFetch(native: MimoStreamPort, url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(url) !== 'https://api.xiaomimimo.com/v1/chat/completions') throw new Error('voice:transport_url');
  const id = crypto.randomUUID(), signal = init?.signal;
  const abortError = () => new DOMException('Aborted', 'AbortError');
  const cancel = () => { void native.cancel({ id }).catch(() => {}); };
  const wait = <T>(pending: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => { cancel(); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal?.removeEventListener('abort', abort); resolve(value); }, error => {
      signal?.removeEventListener('abort', abort); reject(error);
    });
    if (signal?.aborted) abort();
  });
  if (signal?.aborted) throw abortError();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const authorization = new Headers(init?.headers).get('Authorization') ?? '';
    const response = await wait(native.open({ id, key: authorization.replace(/^Bearer /, ''), body: String(init?.body ?? '') }));
    if (signal?.aborted) { cancel(); throw abortError(); }
    if (response.status < 200 || response.status >= 300) {
      signal?.removeEventListener('abort', cancel);
      return new Response(null, { status: response.status });
    }
    const cleanup = () => { signal?.removeEventListener('abort', cancel); cancel(); };
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (signal?.aborted) throw abortError();
          const part = await wait(native.read({ id }));
          if (signal?.aborted) throw abortError();
          if (part.done) { cleanup(); controller.close(); }
          else if (part.data) controller.enqueue(Uint8Array.from(atob(part.data), char => char.charCodeAt(0)));
        } catch (error) { cleanup(); controller.error(error); }
      }, cancel: cleanup,
    }, { highWaterMark: 0 }), { status: response.status, headers: { 'Content-Type': response.contentType ?? '' } });
  } catch (error) { signal?.removeEventListener('abort', cancel); cancel(); throw error; }
}
