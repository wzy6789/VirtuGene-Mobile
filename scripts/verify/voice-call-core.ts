import assert from 'node:assert/strict';
import { MimoCallClient, CallApiError, readCallEvents, CALL_MODELS } from '../../src/lib/voice-call/mimo';
import { SpokenSentenceBuffer, UtteranceGate, pcmWav } from '../../src/lib/voice-call/utterance';
import { CallLifecycle } from '../../src/lib/voice-call/lifecycle';
let checks = 0;
const check = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
function sse(events: unknown[], fragment = 7) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += fragment) controller.enqueue(bytes.slice(i, i + fragment)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
async function main() {
  const lifecycle = new CallLifecycle('mock-call', () => 1000);
  lifecycle.transition('connecting'); lifecycle.transition('listening');
  const turn = lifecycle.beginTurn(); lifecycle.transition('generating');
  const first = lifecycle.recordGenerated(turn, '完整播放。')!;
  const partial = lifecycle.recordGenerated(turn, '只听到一点。')!;
  check(lifecycle.heardText() === '', 'generation is not a listening fact');
  lifecycle.transition('playing');
  lifecycle.acknowledgePlayback(turn, first.id, 24000, true);
  lifecycle.acknowledgePlayback(turn, partial.id, 120, false);
  lifecycle.interrupt();
  check(turn.signal.aborted && !lifecycle.isCurrent(turn), 'interrupt invalidates all old turn work');
  check(!lifecycle.acknowledgePlayback(turn, partial.id, 24000, true), 'late native acknowledgement cannot certify an interrupted sentence');
  check(lifecycle.heardText() === '完整播放。' && lifecycle.receipt()[1].playedFrames === 120 && lifecycle.receipt()[1].interrupted, 'partial playback kept in receipt but excluded from memory context');
  check(lifecycle.recordStoppedPlayback(turn, partial.id, 240, 24000) && lifecycle.receipt()[1].playedFrames === 240, 'stopped partial frame receipt remains auditable after cancellation');
  check(lifecycle.heardText() === '完整播放。' && lifecycle.receipt()[1].playedAt === undefined, 'stop receipt cannot certify the whole interrupted sentence');
  check(!lifecycle.recordStoppedPlayback(turn, partial.id, 10) && !lifecycle.recordStoppedPlayback(turn, first.id, 25000), 'stop audit rejects backwards progress and changes to complete speech');
  lifecycle.transition('listening'); const next = lifecycle.beginTurn();
  check(next.id !== turn.id && lifecycle.recordGenerated(turn, '过期') === null, 'new turn cannot accept old generated text');
  lifecycle.pause(); check(next.signal.aborted, 'pause cancels active recognition');
  lifecycle.end(); assert.throws(() => lifecycle.transition('listening')); checks++;
  const gate = new UtteranceGate();
  check(Array.from({ length: 100 }, () => gate.push(0.005)).every(x => x === 'none'), 'silence does not create billable utterances');
  let events: string[] = [];
  for (let i = 0; i < 20; i++) events.push(gate.push(0.08));
  for (let i = 0; i < 20; i++) events.push(gate.push(0.005));
  check(!events.includes('end') && events.includes('start'), 'short pause keeps one utterance');
  for (let i = 0; i < 10; i++) gate.push(0.08);
  for (let i = 0; i < 35; i++) events.push(gate.push(0.005));
  check(events.filter(e => e === 'end').length === 1, 'continuation ends after 700ms silence');
  const noise = new UtteranceGate(); let end = '';
  for (let i = 0; i < 4; i++) noise.push(0.08);
  for (let i = 0; i < 35; i++) end = noise.push(0.001);
  check(end === 'discard', 'very short noise is discarded');
  const bounded = new UtteranceGate(700, 1000); const boundedEvents = Array.from({ length: 50 }, () => bounded.push(0.08));
  check(boundedEvents.includes('end'), 'continuous speech is bounded');
  const speech = new SpokenSentenceBuffer();
  check(speech.push('（轻声').length === 0, 'partial stage directions remain hidden');
  assert.deepEqual(speech.push('）你好。**微笑**今天好吗？<think>不能播报</think>我在。'), ['你好。', '今天好吗？', '我在。']); checks++;
  speech.push('旧轮未完成'); speech.reset(); assert.deepEqual(speech.push('新一轮。'), ['新一轮。']); checks++;
  const nested = new SpokenSentenceBuffer();
  assert.deepEqual(nested.push('<analysis><style>轻声</style>内部思考不能播报。</analysis>你好。'), ['你好。']); checks++;
  const fragmented = new SpokenSentenceBuffer(); let fragments: string[] = [];
  for (const char of '<instruction mode="voice"><style>低声</style>内部指令。</instruction>听见了。') fragments.push(...fragmented.push(char));
  assert.deepEqual(fragments, ['听见了。']); checks++;
  const malformed = new SpokenSentenceBuffer();
  assert.deepEqual(malformed.push('<think>秘密</style>仍是秘密。', true), []); checks++;
  malformed.reset(); assert.deepEqual(malformed.push('新的台词。', true), ['新的台词。']); checks++;
  const wav = pcmWav(new Uint8Array([1, 2, 3, 4]));
  check(new DataView(wav.buffer).getUint32(24, true) === 16000 && wav.length === 48, 'PCM WAV metadata matches capture');
  let requests: any[] = [];
  const client = new MimoCallClient(async () => 'mock-key-not-a-real-secret', (async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (body.model === CALL_MODELS.tts) return sse([{ choices: [{ delta: { audio: { data: btoa(String.fromCharCode(1)) } } }] }, { choices: [{ delta: { audio: { data: btoa(String.fromCharCode(2, 3, 4)) } } }] }]);
    return sse([{ choices: [{ delta: { content: '你好' } }] }, { choices: [{ delta: { content: '。' }, finish_reason: 'stop' }] }, { usage: { prompt_tokens: 12, completion_tokens: 2 } }], 1);
  }) as typeof fetch);
  const signal = new AbortController().signal;
  check(await client.recognize(wav, { signal }) === '你好。', 'fragmented UTF8 ASR result decoded');
  check(requests[0].messages[0].content[0].input_audio.data.startsWith('data:audio/wav;base64,'), 'ASR sends one WAV file, not raw PCM streaming');
  let text = '', usage: any;
  await client.dialogue([{ role: 'user', content: '你好' }], { signal, onText: delta => { text += delta; }, onUsage: u => { usage = u; } });
  check(text === '你好。' && usage.inputTokens === 12 && requests[1].thinking.type === 'disabled', 'Flash non-thinking stream preserves real usage');
  let audio: number[] = [];
  await client.synthesize('你好。', '茉莉', '自然说话', { signal, onPcm: pcm => { audio.push(...pcm); } });
  assert.deepEqual(audio, [1, 2, 3, 4]); checks++;
  check(requests[2].audio.format === 'pcm16' && requests[2].messages[1].role === 'assistant', 'TTS separates style from spoken text and preserves PCM alignment');
  check(requests[1].max_completion_tokens === 384 && !('max_tokens' in requests[1]), 'Flash uses the documented completion-token cap with a 384-token default');
  await client.dialogue([{ role: 'user', content: '总结' }], { signal, maxTokens: 5000, onText: () => {} });
  check(requests.at(-1).max_completion_tokens === 1000, 'larger caller budgets remain capped at 1000 completion tokens');
  await client.dialogue([{ role: 'user', content: '你好' }], { signal, maxTokens: -1, onText: () => {} });
  check(requests.at(-1).max_completion_tokens === 1, 'minimum completion budget remains a valid positive integer');
  const requestCount = requests.length;
  for (const maxTokens of [NaN, Infinity]) {
    await assert.rejects(client.dialogue([{ role: 'user', content: '你好' }], { signal, maxTokens, onText: () => {} }), (error: any) => error.code === 'limit'); checks++;
  }
  check(requests.length === requestCount, 'non-finite token budgets never become null or send an uncapped request');
  const cancelled = new AbortController(); let seen = 0;
  await assert.rejects(readCallEvents(sse([{ choices: [{ delta: { content: 'a' } }] }, { choices: [{ delta: { content: 'late' } }] }]), cancelled.signal, () => { seen++; cancelled.abort(); }), (e: any) => e.name === 'AbortError');
  check(seen === 1, 'cancelled turn suppresses late stream events');
  await assert.rejects(readCallEvents(new Response('data: {bad}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), signal, () => {}), (e: any) => e.code === 'protocol'); checks++;
  const brokenUtf8 = new Uint8Array([...new TextEncoder().encode('data: {"choices":[{"delta":{"content":"'), 0xff, ...new TextEncoder().encode('"}}]}\n\ndata: [DONE]\n\n')]);
  await assert.rejects(readCallEvents(new Response(brokenUtf8, { headers: { 'Content-Type': 'text/event-stream' } }), signal, () => { throw new Error('corrupt text reached consumer'); }), (e: any) => e.code === 'protocol'); checks++;
  let oversizedDelivered = false;
  await assert.rejects(readCallEvents(new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(2 * 1024 * 1024) } }] }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), signal, () => { oversizedDelivered = true; }), (e: any) => e.code === 'limit'); checks++;
  check(!oversizedDelivered, 'oversized complete SSE frames are rejected before downstream delivery');
  await assert.rejects(readCallEvents(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), signal, () => {}), (e: any) => e.code === 'protocol'); checks++;
  for (const [status, code] of [[401, 'key'], [402, 'quota'], [429, 'rate'], [503, 'network'], [400, 'protocol'], [404, 'protocol'], [421, 'limit']] as const) {
    let calls = 0;
    const failing = new MimoCallClient(async () => 'mock-key', (async () => { calls++; return new Response('', { status }); }) as typeof fetch);
    await assert.rejects(failing.recognize(wav, { signal }), (e: any) => e instanceof CallApiError && e.code === code);
    check(calls === 1, `${code} is not automatically retried`);
  }
  for (const [finish, code] of [['length', 'limit'], ['content_filter', 'limit'], ['repetition_truncation', 'limit'], ['tool_calls', 'protocol'], ['unexpected', 'protocol']] as const) {
    let deliveredTail = false;
    await assert.rejects(readCallEvents(sse([{ choices: [{ delta: { content: '不能作为正常完成播出的尾句。' }, finish_reason: finish }] }]), signal, () => { deliveredTail = true; }), (error: any) => error.code === code);
    check(!deliveredTail, `${finish} cannot deliver its final partial content or masquerade as normal completion`);
  }
  const before = new AbortController(); before.abort();
  await assert.rejects(client.recognize(wav, { signal: before.signal }), (e: any) => e.name === 'AbortError'); checks++;
  const emptyAudio = new MimoCallClient(async () => 'mock-key', (async () => sse([])) as typeof fetch);
  await assert.rejects(emptyAudio.synthesize('你好。', '茉莉', '', { signal, onPcm: () => {} }), (e: any) => e.code === 'protocol'); checks++;
  let abortedFetch = 0, requestAttempts = 0;
  const originalTimer = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: any, delay?: number, ...args: any[]) => originalTimer(callback, delay === 45000 ? 0 : delay, ...args)) as typeof setTimeout;
  try {
    const stalled = new MimoCallClient(async () => 'mock-key', (async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { abortedFetch++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    })) as typeof fetch);
    await assert.rejects(stalled.recognize(wav, { signal, onRequest: () => { requestAttempts++; } }), (e: any) => e.code === 'timeout'); checks++;
    check(abortedFetch === 1 && requestAttempts === 1, 'deadline aborts stalled transport without retrying');
  } finally { globalThis.setTimeout = originalTimer; }
  let releaseConsumer: (() => void) | undefined, ordered: string[] = [];
  const controlled = readCallEvents(sse([{ choices: [{ delta: { content: 'first' } }] }, { choices: [{ delta: { content: 'second' } }] }]), signal, async event => {
    const text = event.choices?.[0]?.delta?.content; if (!text) return;
    ordered.push(text); if (text === 'first') await new Promise<void>(resolve => { releaseConsumer = resolve; });
  });
  while (!releaseConsumer) await new Promise(resolve => originalTimer(resolve, 0));
  check(ordered.join(',') === 'first', 'SSE waits for downstream PCM backpressure');
  releaseConsumer(); await controlled; check(ordered.join(',') === 'first,second', 'backpressure release preserves event order');
  const waitingAbort = new AbortController(); let rejectWaiting!: (error: Error) => void, waitingEvents = 0;
  const waitingResponse = sse([{ choices: [{ delta: { content: 'first' } }] }, { choices: [{ delta: { content: 'late' } }] }]);
  const waitingStream = readCallEvents(waitingResponse, waitingAbort.signal, () => {
    waitingEvents++; return new Promise<void>((_, reject) => { rejectWaiting = reject; });
  });
  while (!rejectWaiting) await new Promise(resolve => originalTimer(resolve, 0));
  waitingAbort.abort();
  await assert.rejects(waitingStream, (error: any) => error.name === 'AbortError'); checks++;
  rejectWaiting(new Error('late downstream failure')); await new Promise(resolve => originalTimer(resolve, 0));
  check(waitingEvents === 1 && !waitingResponse.body!.locked, 'aborted backpressure releases the reader and observes late rejection without consuming another event');
  let unblockCancel!: () => void;
  const cancelledSource = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')); },
    cancel() { return new Promise<void>(resolve => { unblockCancel = resolve; }); },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  const sourceAbort = new AbortController();
  const cancelledRead = readCallEvents(cancelledSource, sourceAbort.signal, () => { sourceAbort.abort(); });
  await assert.rejects(cancelledRead, (error: any) => error.name === 'AbortError'); checks++;
  check(!cancelledSource.body!.locked && !!unblockCancel, 'delayed network cancellation acknowledgement cannot retain the stream reader or block call recovery');
  unblockCancel();
  globalThis.setTimeout = ((callback: any, delay?: number, ...args: any[]) => originalTimer(callback, delay === 45000 ? 0 : delay, ...args)) as typeof setTimeout;
  let finishBlockedPcm!: () => void, blockedRequests = 0;
  try {
    const blockedTts = new MimoCallClient(async () => 'mock-key', (async () => sse([{ choices: [{ delta: { audio: { data: 'AAA=' } } }] }])) as typeof fetch);
    await assert.rejects(blockedTts.synthesize('你好。', '茉莉', '', { signal,
      onRequest: () => { blockedRequests++; }, onPcm: () => new Promise<void>(resolve => { finishBlockedPcm = resolve; }),
    }), (error: any) => error.code === 'timeout'); checks++;
    check(blockedRequests === 1 && !!finishBlockedPcm, 'transport deadline terminates a TTS stream waiting on playback activation without automatic retry');
  } finally { globalThis.setTimeout = originalTimer; finishBlockedPcm?.(); }
  console.log(JSON.stringify({ checks, realApiCalls: 0, modelTokens: 0, mode: 'mock-protocol-and-pure-logic', completeCallImplemented: false }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
