/** MiMo call transport. ASR uploads a bounded WAV utterance; only the response is SSE. */
import { loadSecret } from '../api-key-storage';

export const CALL_MODELS = { asr: 'mimo-v2.5-asr', dialogue: 'mimo-v2.6-flash', tts: 'mimo-v2.5-tts' } as const;
export const CALL_VOICES = ['冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'] as const;
export type CallVoice = typeof CALL_VOICES[number];
export const CALL_PCM_RATE = 24_000;
export type CallApiErrorCode = 'key' | 'quota' | 'rate' | 'network' | 'timeout' | 'protocol' | 'limit';
export class CallApiError extends Error {
  constructor(public readonly code: CallApiErrorCode) { super(`voice:${code}`); }
}
type Event = { error?: unknown; choices?: { delta?: { content?: string; audio?: { data?: string } }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
export type CallApiUsage = { inputTokens: number; outputTokens: number };
export type CallMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type StreamOptions = { signal: AbortSignal; onRequest?: () => void; onUsage?: (usage: CallApiUsage) => void };

function abortError(): DOMException { return new DOMException('Aborted', 'AbortError'); }
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw abortError(); }
/** Backpressure waits must release on transport timeout as well as turn cancellation. */
function consumeCallEvent(event: Event, signal: AbortSignal, consume: (event: Event) => void | Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown, failed = false) => {
      signal.removeEventListener('abort', abort);
      if (failed) reject(error); else resolve();
    };
    const abort = () => finish(abortError(), true);
    signal.addEventListener('abort', abort, { once: true });
    // Observe late completion/rejection even after abort wins this wait.
    Promise.resolve().then(() => { checkAbort(signal); return consume(event); }).then(() => finish(), error => finish(error, true));
    if (signal.aborted) abort();
  });
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Strict bounded framing: fragmented UTF-8/CRLF and multiline data are supported. */
export async function readCallEvents(response: Response, signal: AbortSignal, onEvent: (event: Event) => void | Promise<void>): Promise<void> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new CallApiError('protocol');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', done = false, finished = false, total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    checkAbort(signal);
    for (;;) {
      const part = await reader.read(); checkAbort(signal);
      try { buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true }); }
      catch { throw new CallApiError('protocol'); }
      total += part.value?.byteLength ?? 0;
      if (total > 16 * 1024 * 1024) throw new CallApiError('limit');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        if (match.index > 2 * 1024 * 1024) throw new CallApiError('limit');
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { done = true; break; }
        let event: Event;
        try { event = JSON.parse(data); } catch { throw new CallApiError('protocol'); }
        if (!event || typeof event !== 'object' || event.error) throw new CallApiError('protocol');
        const finish = event.choices?.[0]?.finish_reason;
        if (finish === 'length' || finish === 'content_filter' || finish === 'repetition_truncation') throw new CallApiError('limit');
        if (finish != null && finish !== 'stop') throw new CallApiError('protocol');
        if (finish === 'stop') finished = true;
        checkAbort(signal); await consumeCallEvent(event, signal, onEvent); checkAbort(signal);
      }
      if (buffer.length > 2 * 1024 * 1024) throw new CallApiError('limit');
      if (done) return;
      if (part.done) {
        if (buffer.trim() || !finished) throw new CallApiError('protocol');
        return;
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    // A network source's asynchronous cancel acknowledgement must not hold
    // the call state machine hostage after cancellation/timeout.
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** No automatic retry: billing and transcript replay remain controlled by the call state machine. */
export class MimoCallClient {
  constructor(private readonly key: () => Promise<string | null> = () => loadSecret('mimo-key'), private readonly request: typeof fetch = fetch) {}
  private async stream(body: unknown, options: StreamOptions, consume: (event: Event) => void | Promise<void>): Promise<void> {
    checkAbort(options.signal);
    const key = await this.key(); checkAbort(options.signal);
    if (!key) throw new CallApiError('key');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    try {
      options.onRequest?.();
      const response = await this.request('https://api.xiaomimimo.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      checkAbort(controller.signal);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new CallApiError(response.status === 401 || response.status === 403 ? 'key' : response.status === 402 ? 'quota' : response.status === 429 ? 'rate' : response.status === 421 ? 'limit' : response.status === 400 || response.status === 404 ? 'protocol' : 'network');
      }
      await readCallEvents(response, controller.signal, async event => {
        if (event.usage && Number.isFinite(event.usage.prompt_tokens) && Number.isFinite(event.usage.completion_tokens)) options.onUsage?.({ inputTokens: event.usage.prompt_tokens!, outputTokens: event.usage.completion_tokens! });
        await consume(event);
      });
    } catch (error) {
      if (options.signal.aborted) throw abortError();
      if (timedOut) throw new CallApiError('timeout');
      if (error instanceof CallApiError) throw error;
      throw new CallApiError('network');
    } finally { clearTimeout(timer); options.signal.removeEventListener('abort', cancel); }
  }
  async recognize(wav: Uint8Array, options: StreamOptions & { onText?: (text: string) => void }): Promise<string> {
    // Call capture uses PCM WAV, bounded to 30 seconds; network failure cannot create an unbounded upload.
    if (wav.length < 44 || wav.length > 2_000_000 || String.fromCharCode(...wav.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...wav.subarray(8, 12)) !== 'WAVE') throw new CallApiError('limit');
    let text = '';
    await this.stream({ model: CALL_MODELS.asr, stream: true, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${base64(wav)}` } }] }], asr_options: { language: 'auto' } }, options, event => {
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') { text += delta; if (text.length > 4096) throw new CallApiError('limit'); options.onText?.(text); }
    });
    return text.trim();
  }
  async dialogue(messages: CallMessage[], options: StreamOptions & { onText: (delta: string) => void | Promise<void>; maxTokens?: number }): Promise<void> {
    if (!messages.length || messages.reduce((n, m) => n + m.content.length, 0) > 40_000) throw new CallApiError('limit');
    if (options.maxTokens !== undefined && !Number.isFinite(options.maxTokens)) throw new CallApiError('limit');
    const maxTokens = Math.max(1, Math.min(1000, Math.floor(options.maxTokens ?? 384)));
    await this.stream({ model: CALL_MODELS.dialogue, messages, stream: true, thinking: { type: 'disabled' }, max_completion_tokens: maxTokens }, options, async event => {
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') await options.onText(delta);
    });
  }
  async synthesize(text: string, voice: CallVoice, style: string, options: StreamOptions & { onPcm: (pcm: Uint8Array) => void | Promise<void> }): Promise<void> {
    if (!CALL_VOICES.includes(voice) || !text.trim() || text.length > 600 || style.length > 400) throw new CallApiError('limit');
    let carry: number | undefined, emitted = 0;
    await this.stream({ model: CALL_MODELS.tts, stream: true, messages: [{ role: 'user', content: style }, { role: 'assistant', content: text }], audio: { format: 'pcm16', voice } }, options, async event => {
      const data = event.choices?.[0]?.delta?.audio?.data;
      if (!data) return;
      let raw: string;
      try { raw = atob(data); } catch { throw new CallApiError('protocol'); }
      const bytes = new Uint8Array(raw.length + (carry === undefined ? 0 : 1));
      let offset = 0;
      if (carry !== undefined) bytes[offset++] = carry;
      for (let i = 0; i < raw.length; i++) bytes[offset + i] = raw.charCodeAt(i);
      carry = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
      const aligned = bytes.subarray(0, bytes.length - bytes.length % 2);
      if (aligned.length) { emitted += aligned.length; await options.onPcm(aligned); }
    });
    if (carry !== undefined || emitted === 0) throw new CallApiError('protocol');
  }
}
