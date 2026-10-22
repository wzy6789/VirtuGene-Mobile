import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import { MimoCallClient, CALL_MODELS, type CallApiUsage } from '../../src/lib/voice-call/mimo';
import { pcmWav } from '../../src/lib/voice-call/utterance';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';

const args = process.argv.slice(2);
const arg = (name: string) => args[args.indexOf(name) + 1];
const live = args.includes('--live');
if (live && (process.env.VOICE_LATENCY_ALLOW_PAID !== '1' || !process.env.MIMO_API_KEY?.trim())) throw new Error('Live test is not explicitly enabled.');
const variant = arg('--variant'), round = Number(arg('--round')), output = arg('--output');
if (!['before', 'after'].includes(variant) || ![1, 2, 3, 4].includes(round) || !output || !args.includes('--input')) throw new Error('Use the provider-latency.mjs runner.');
const input = readFileSync(arg('--input'));
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function readPcmWav(wav: Buffer): Uint8Array {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected WAV fixture.');
  let format = false, pcm: Uint8Array | undefined;
  for (let at = 12; at + 8 <= wav.length;) {
    const id = wav.toString('ascii', at, at + 4), size = wav.readUInt32LE(at + 4), start = at + 8;
    if (start + size > wav.length) throw new Error('Truncated WAV fixture.');
    if (id === 'fmt ') format = size >= 16 && wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 && wav.readUInt32LE(start + 4) === 16000 && wav.readUInt16LE(start + 14) === 16;
    if (id === 'data') pcm = new Uint8Array(wav.subarray(start, start + size));
    at = start + size + (size % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2 || pcm.length > 32000 * 15) throw new Error('Fixture must be mono PCM16 16kHz, no longer than fifteen seconds.');
  return pcm;
}
const pcm = readPcmWav(input);
const startedAt = performance.now(), now = () => performance.now() - startedAt;
const abortError = () => new DOMException('Aborted', 'AbortError');
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.max(0, ms));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
type Stage = 'asr' | 'dialogue' | 'tts';
type Request = { id: number; stage: Stage; model: string; startedAt: number; requestAt?: number; headersAt?: number; completedAt?: number; firstOutputAt?: number; requestBodySha256?: string;
  inputAudioMs?: number; outcome?: string; usage: { state: '未返回' | '已返回'; source: 'provider' | 'simulation'; receipts: (CallApiUsage & { at: number })[] }; error?: string };
const requests: Request[] = [], outputPcm: Uint8Array[] = [];
let actualProviderRequests = 0, firstPcmAt: number | undefined, firstSinkPcmAt: number | undefined;
let requestCounter = 0, mockAsrCounter = 0, callback!: (event: NativeAudioEvent) => void, view: CallView | undefined;
let writtenFrames = 0, contextAt = 0, contextCompleteAt = 0, contextText = '', messagesSha256 = '';
const nativeFetch = globalThis.fetch.bind(globalThis);
// Deny accidental fetches outside the one explicit, bounded transport path.
globalThis.fetch = async () => { throw new Error('Unscoped network access is disabled in this fixture.'); };
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return /^voice:[a-z_:-]{1,80}$/.test(message) ? message : error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'verification_failed';
};
async function transport(record: Request, url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(url) !== 'https://api.xiaomimimo.com/v1/chat/completions' || init?.method !== 'POST') throw new Error('voice:transport_url');
  if (++requestCounter > 5) throw new Error('voice:request_budget');
  record.requestAt = now(); record.requestBodySha256 = sha256(String(init.body));
  if (live) {
    if (process.env.VOICE_LATENCY_ALLOW_PAID !== '1') throw new Error('voice:live_disabled');
    actualProviderRequests++;
    const response = await nativeFetch(url, { ...init, redirect: 'error' }); record.headersAt = now(); return response;
  }
  const signal = init.signal ?? undefined;
  await wait(record.stage === 'asr' ? 420 : record.stage === 'dialogue' ? 180 : 220, signal);
  const content = record.stage === 'asr' ? (++mockAsrCounter === 1 ? '今天有点累，想听你说句话。' : '') : '我在，先歇一会儿，我陪你聊。';
  const delta = record.stage === 'tts' ? { audio: { data: Buffer.alloc(4800).toString('base64') } } : { content };
  // Intentionally omit TTS usage to verify that missing usage is never filled with zero.
  const usage = record.stage === 'tts' ? {} : { usage: { prompt_tokens: 7, completion_tokens: 3 } };
  record.headersAt = now();
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }], ...usage })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}
function tracked<T>(stage: Stage, run: (client: MimoCallClient, record: Request) => Promise<T>): Promise<T> {
  if (requests.length >= 5) return Promise.reject(new Error('voice:request_budget'));
  const record: Request = { id: requests.length + 1, stage, model: CALL_MODELS[stage], startedAt: now(), usage: { state: '未返回', source: live ? 'provider' : 'simulation', receipts: [] } };
  requests.push(record);
  const client = new MimoCallClient(async () => live ? process.env.MIMO_API_KEY! : 'isolated-test-key', (url, init) => transport(record, url, init));
  return run(client, record).then(value => { record.outcome = 'completed'; return value; }, error => { record.outcome = 'failed'; record.error = safeError(error); throw error; }).finally(() => { record.completedAt = now(); });
}
function usage(record: Request, value: CallApiUsage) {
  record.usage.state = '已返回'; record.usage.receipts.push({ ...value, at: now() });
}
const caps = { sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true, routes: [{ id: 1, type: 2, label: '隔离静音 sink', selected: true }] };
const controller = new VoiceCallController(`provider-latency-${variant}-${round}`, { voice: '茉莉', style: '自然、平静地说话。', now, onView: value => { view = value; },
  audio: { start: async cb => { callback = cb; return caps; },
    beginPlayback: async (_turn, signal) => { await wait(120, signal); },
    append: async (_turn, bytes, signal) => { if (signal.aborted) throw abortError(); if (firstSinkPcmAt === undefined) firstSinkPcmAt = now(); outputPcm.push(bytes.slice()); writtenFrames += bytes.length / 2; return { writtenFrames, playedFrames: writtenFrames, sampleRate: 24000 }; },
    drain: async () => ({ writtenFrames, playedFrames: writtenFrames, complete: true, sampleRate: 24000 }),
    interrupt: async () => ({ writtenFrames, playedFrames: writtenFrames }), mute: async () => {}, close: async () => {}, pause: async () => {}, resume: async () => ({ routes: caps.routes }) },
  context: async text => {
    contextAt = now(); contextText = text;
    const messages = [{ role: 'system' as const, content: '你是虚构的测试人物小舟。这是一段合成语音测试，没有真人隐私或历史记忆。温和平静地回应当前一句话。只说一句不超过24个汉字的完整台词，不输出旁白、换行、分号或分析。' }, { role: 'user' as const, content: text }];
    messagesSha256 = sha256(JSON.stringify(messages)); contextCompleteAt = now(); return messages;
  }, api: {
    recognize: (wav, options) => tracked('asr', (client, record) => {
      record.inputAudioMs = (wav.length - 44) / 32;
      return client.recognize(wav, { ...options, onUsage: value => usage(record, value), onText: text => { record.firstOutputAt ??= now(); options.onText?.(text); } });
    }),
    dialogue: (messages, options) => tracked('dialogue', (client, record) => client.dialogue(messages, { ...options, maxTokens: 64, onUsage: value => usage(record, value), onText: text => { record.firstOutputAt ??= now(); return options.onText(text); } })),
    synthesize: (text, voice, style, options) => tracked('tts', (client, record) => client.synthesize(text, voice, style, { ...options, onUsage: value => usage(record, value), onPcm: async bytes => { record.firstOutputAt ??= now(); firstPcmAt ??= now(); await options.onPcm(bytes); } })),
  } });
async function main() {
let outcome = 'failed', failure: string | undefined;
try {
  await controller.start();
  const feedStart = now(), feedLength = Math.ceil(pcm.length / 3200) * 3200 + 32000;
  for (let offset = 0, sequence = 0; offset < feedLength; offset += 3200, sequence++) {
    await wait(feedStart + (sequence + 1) * 100 - now());
    const chunk = new Uint8Array(3200); chunk.set(pcm.subarray(offset, Math.min(pcm.length, offset + 3200)));
    callback({ callId: controller.callId, type: 'capture', pcm: Buffer.from(chunk).toString('base64'), sampleRate: 16000, sequence, at: now() });
    if (view?.phase === 'error' || controller.getRecords().length) break;
  }
  const deadline = now() + 65_000;
  while (!controller.getRecords().length && view?.phase !== 'error' && now() < deadline) await wait(20);
  if (view?.phase === 'error') throw new Error(`voice:${String(view.error ?? 'failed').replace(/^voice:/, '')}`);
  if (controller.getRecords().length !== 1 || firstPcmAt === undefined) throw new Error('voice:fixture_incomplete');
  outcome = 'completed';
} catch (error) { failure = safeError(error); process.exitCode = 1; }
finally {
  await controller.end();
  const exchange = controller.getRecords()[0], metrics = exchange?.metrics;
  const controllerMetrics = metrics ? { ...metrics } : undefined;
  // Sink acknowledgements drive the controller only. Never publish them as audible playback timing.
  if (controllerMetrics) { delete controllerMetrics.firstPlaybackMs; delete controllerMetrics.firstPlaybackFromSpeechMs; }
  let outputAudio: string | undefined;
  if (outputPcm.length) {
    const bytes = Buffer.concat(outputPcm.map(part => Buffer.from(part)));
    if (bytes.length <= 24000 * 2 * 30) { outputAudio = output.replace(/\.json$/, '-output.wav'); writeFileSync(outputAudio, pcmWav(bytes, 24000)); }
  }
  const result = { variant, round, mode: live ? 'live-provider-with-isolated-sink' : 'dry-run', outcome, failure, models: CALL_MODELS,
    input: { sha256: sha256(input), durationMs: pcm.length / 32, microphoneUsed: false }, actualProviderRequests, requests,
    context: { startedAt: contextAt, completedAt: contextCompleteAt, text: contextText, messagesSha256, source: 'fictional fixed context; no private database reads' },
    timing: { clock: 'monotonic desktop wall clock; microphone frames replayed at 100ms cadence', firstPcmAt,
      firstPcmMeaning: live ? 'first actual MiMo TTS PCM returned by transport; not physical sound' : 'first simulated SSE PCM; not provider or physical sound',
      firstPcmAfterSpeechMs: firstPcmAt !== undefined && metrics?.speechEndedAt !== undefined ? firstPcmAt - metrics.speechEndedAt : undefined,
      firstSinkPcmAt, physicalPlaybackMeasured: false, controllerMetrics },
    text: { recognized: exchange?.userText, generated: exchange?.generatedText }, outputAudio,
    sink: { kind: 'isolated silent sink with synthetic receipts', setupMs: 120, setupBasis: 'artificial delay in both dry-run and live; not a physical device measurement', writtenFrames, emittedPhysicalSound: false },
    limitations: ['Only two rounds per variant; no latency guarantee.', 'ASR/provider output can vary; inspect actual dialogue input hashes before comparison.', 'Dry-run ASR text and token receipts are predefined, not recognition or billing evidence.', 'First network PCM timing includes controller scheduling around an artificial 120ms sink setup delay; this is not pure MiMo service latency.', 'No Android, Bluetooth, private memory preparation, real microphone or naturalness validation.'] };
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ variant, round, outcome, actualProviderRequests, requests: requests.length }));
}
}
void main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
