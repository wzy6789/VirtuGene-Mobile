/** MiMo call transport. ASR uploads a bounded WAV utterance; only the response is SSE. */
import { callFetch } from './transport';
import { normalizedMimoKey, loadMimoKey } from './key';

export const CALL_MODELS = { asr: 'mimo-v2.5-asr', dialogue: 'mimo-v2.6-flash', tts: 'mimo-v2.5-tts' } as const;
export const CALL_VOICES = ['冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'] as const;
export type CallVoice = typeof CALL_VOICES[number];
export const CALL_PCM_RATE = 24_000;
/** Public protocol boundary, not a provider latency or realtime service guarantee. */
export const CALL_PROVIDER_CAPABILITIES = Object.freeze({
  provider: 'mimo', models: Object.freeze({ ...CALL_MODELS }),
  input: 'complete-wav-per-request', inputSampleRate: 16_000,
  recognitionOutput: 'text-sse', dialogueOutput: 'text-sse',
  synthesisOutput: 'pcm16-sse', synthesisSampleRate: CALL_PCM_RATE,
  continuousAudioUpload: false, realtimeWebRtc: false,
  maxAudioSegmentSeconds: 30, automaticRetries: 0,
} as const);
export type CallApiErrorCode = 'key' | 'key_format' | 'quota' | 'rate' | 'network' | 'timeout' | 'protocol' | 'limit' | 'transport_missing' | 'transport_limit' | 'transport_duplicate' | 'transport_url' | 'stream_closed' | 'dns' | 'tls' | 'forbidden' | 'service';
function serviceErrorCode(status: number): CallApiErrorCode {
  if (status === 401) return 'key';
  if (status === 403) return 'forbidden';
  if (status === 402) return 'quota';
  if (status === 429) return 'rate';
  if (status === 421) return 'limit';
  if (status === 400 || status === 404) return 'protocol';
  if (status >= 500 && status <= 599) return 'service';
  return 'network';
}
export class CallApiError extends Error {
  constructor(public readonly code: CallApiErrorCode, public readonly stage?: 'asr' | 'dialogue' | 'tts', public readonly httpStatus?: number) { super(`voice:${code}`); }
}
type Event = { error?: unknown; choices?: { delta?: { content?: string; audio?: { data?: string } }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
export type CallApiUsage = { inputTokens: number; outputTokens: number };
export type CallMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type StreamOptions = { signal: AbortSignal; onRequest?: () => void; onUsage?: (usage: CallApiUsage) => void };

/** Local consumers are not network failures; preserve their cancellation/source/audio authority. */
class CallConsumerFailure extends Error {
  constructor(readonly original: unknown) { super('voice:consumer_failure'); }
}

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
        if (!event || typeof event !== 'object') throw new CallApiError('protocol');
        if (event.error) {
          const code = (event.error as { code?: unknown }).code;
          // Numeric service errors are interpreted without exposing messages.
          // A streamed code is not proof of the HTTP response status.
          const numeric = typeof code === 'number' ? code : typeof code === 'string' && /^\d{3}$/.test(code) ? Number(code) : undefined;
          throw new CallApiError(numeric !== undefined && numeric >= 400 && numeric <= 599 ? serviceErrorCode(numeric) : 'protocol');
        }
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
  constructor(private readonly key: () => Promise<string | null> = loadMimoKey, private readonly request: typeof fetch = callFetch) {}
  private async stream(body: unknown, options: StreamOptions, consume: (event: Event) => void | Promise<void>): Promise<void> {
    const model = (body as { model?: string }).model;
    const stage = model === CALL_MODELS.asr ? 'asr' : model === CALL_MODELS.tts ? 'tts' : 'dialogue';
    checkAbort(options.signal);
    const stored = await this.key(); checkAbort(options.signal);
    if (!stored?.trim()) throw new CallApiError('key');
    const key = normalizedMimoKey(stored);
    if (!key) throw new CallApiError('key_format');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    try {
      try { options.onRequest?.(); } catch (error) { throw new CallConsumerFailure(error); }
      const response = await this.request('https://api.xiaomimimo.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      checkAbort(controller.signal);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new CallApiError(serviceErrorCode(response.status), stage, response.status);
      }
      await readCallEvents(response, controller.signal, async event => {
        try {
          if (event.usage && Number.isFinite(event.usage.prompt_tokens) && Number.isFinite(event.usage.completion_tokens)) options.onUsage?.({ inputTokens: event.usage.prompt_tokens!, outputTokens: event.usage.completion_tokens! });
          await consume(event);
        } catch (error) { throw new CallConsumerFailure(error); }
      });
    } catch (error) {
      if (options.signal.aborted) throw abortError();
      if (timedOut) throw new CallApiError('timeout', stage);
      if (error instanceof CallConsumerFailure) {
        if (error.original instanceof CallApiError) throw new CallApiError(error.original.code, stage, error.original.httpStatus);
        throw error.original;
      }
      if (error instanceof CallApiError) throw new CallApiError(error.code, stage, error.httpStatus);
      const nativeCode = (error as { message?: unknown })?.message;
      // Local bridge limits/closed streams are not HTTP failures or service
      // quota. Preserve only our fixed codes, without copying native details.
      if (nativeCode === 'voice:transport_missing' || nativeCode === 'voice:transport_limit'
        || nativeCode === 'voice:transport_duplicate' || nativeCode === 'voice:transport_url' || nativeCode === 'voice:stream_closed'
        || nativeCode === 'voice:dns' || nativeCode === 'voice:tls' || nativeCode === 'voice:timeout') {
        throw new CallApiError(nativeCode.slice(6) as CallApiErrorCode, stage);
      }
      throw new CallApiError('network', stage);
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
