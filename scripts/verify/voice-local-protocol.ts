import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { MimoCallClient, CallApiError, CALL_MODELS, CALL_PROVIDER_CAPABILITIES, type CallMessage } from '../../src/lib/voice-call/mimo';
import { pcmWav } from '../../src/lib/voice-call/utterance';

type Stage = 'asr' | 'dialogue' | 'tts';
type Scenario = 'normal' | 'small-delayed-backpressure' | 'http-failure' | 'stream-failure' | 'cancel-late' | 'short-local-timeout';
type Row = { scenario: Scenario; round: number; stage: Stage; events: string[]; requests: number; uploadWavBytes: number; receivedPcmBytes: number;
  deliveredCallbacks: number; usageCallbacks: number; bodyHash?: string; result?: string; durationMs?: number; lateWriteAttempts: number; backpressure?: boolean };
const dir = '.tmp-preview/voice-local-protocol-20261015';
const stages: Stage[] = ['asr', 'dialogue', 'tts'];
const scenarios: Scenario[] = ['normal', 'small-delayed-backpressure', 'http-failure', 'stream-failure', 'cancel-late', 'short-local-timeout'];
const rows: Row[] = [], currentRows = new Map<string, Row>();
const producerTasks = new Set<Promise<void>>();
const originalFetch = globalThis.fetch;
let checks = 0, blockedExternalRequests = 0, networkRequests = 0, localOrigin = '';
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const pcm = Uint8Array.from({ length: 3200 }, (_, i) => i % 17);
const wav = pcmWav(pcm), expectedAudio = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
const messages: CallMessage[] = [{ role: 'system', content: '本机协议夹具，虚构角色。' }, { role: 'user', content: '这是合成测试。' }];
const textParts: Record<'asr' | 'dialogue', string[]> = { asr: ['听见', '你的', '问题。'], dialogue: ['我在这里，', '你可以', '继续说。'] };
const asEvent = (stage: Stage, index: number) => stage === 'tts'
  ? { choices: [{ delta: { audio: { data: Buffer.from(index === 0 ? [1] : index === 1 ? [2, 3, 4] : index === 2 ? [5] : [6, 7, 8]).toString('base64') } } }] }
  : { choices: [{ delta: { content: textParts[stage][index] } }] };
const frame = (event: unknown) => Buffer.from(`data: ${JSON.stringify(event)}\r\n\r\n`, 'utf8');
const finish = Buffer.from('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":3}}\r\n\r\ndata: [DONE]\r\n\r\n');

async function writeBytes(response: ServerResponse, bytes: Uint8Array, fragment: number, delayed: boolean) {
  for (let offset = 0; offset < bytes.length; offset += fragment) {
    if (response.destroyed || response.writableEnded) return;
    response.write(bytes.subarray(offset, offset + fragment));
    // Separate actual HTTP writes at selected UTF-8 boundaries without claiming TCP packet boundaries.
    if (delayed && offset < 10) await wait(1);
  }
}
async function handle(request: IncomingMessage, response: ServerResponse) {
  const row = currentRows.get(request.url ?? '');
  if (!row) { response.writeHead(404).end(); return; }
  row.events.push('server-request'); row.requests++; networkRequests++;
  const pieces: Buffer[] = [];
  for await (const part of request) pieces.push(Buffer.from(part));
  const body = JSON.parse(Buffer.concat(pieces).toString('utf8')); row.bodyHash = hash(JSON.stringify(body));
  check(body.model === CALL_MODELS[row.stage] && body.stream === true, 'Actual client sends documented model and SSE output request');
  check(request.method === 'POST' && request.headers.authorization === 'Bearer mock-local-protocol-key', 'Only synthetic local credentials are sent');
  if (row.stage === 'asr') {
    const encoded = body.messages[0].content[0].input_audio.data;
    check(typeof encoded === 'string' && encoded.startsWith('data:audio/wav;base64,'), 'ASR uploads a complete WAV in one request');
    const uploaded = Buffer.from(encoded.slice('data:audio/wav;base64,'.length), 'base64'); row.uploadWavBytes = uploaded.length;
    check(hash(uploaded) === hash(wav), 'Complete synthetic WAV contents remain unchanged');
  } else if (row.stage === 'dialogue') {
    check(body.thinking.type === 'disabled' && body.max_completion_tokens === 384, 'Existing dialogue configuration remains unchanged');
    check(hash(JSON.stringify(body.messages)) === hash(JSON.stringify(messages)), 'Dialogue context is unchanged');
  } else check(body.audio.format === 'pcm16' && body.audio.voice === '茉莉', 'TTS uses the actual PCM16 request');

  if (row.scenario === 'http-failure') { response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"synthetic"}'); return; }
  if (row.scenario === 'short-local-timeout' || (row.scenario === 'cancel-late' && row.round % 2 === 0)) {
    await wait(row.scenario === 'short-local-timeout' ? 45 : 20);
    row.lateWriteAttempts++; row.events.push('server-late-attempt');
    if (!response.destroyed) response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' }).end(Buffer.concat([frame(asEvent(row.stage, 0)), finish]));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' }); response.flushHeaders();
  if (row.scenario === 'stream-failure') {
    await writeBytes(response, frame(asEvent(row.stage, row.stage === 'tts' ? 1 : 0)), 2, false);
    await wait(1);
    await writeBytes(response, frame({ error: { code: '503', message: 'synthetic private failure' } }), 3, false);
    response.end(); return;
  }
  if (row.scenario === 'cancel-late') {
    const first = row.stage === 'tts' ? { choices: [{ delta: { audio: { data: 'AQI=' } } }] } : asEvent(row.stage, 0);
    await writeBytes(response, frame(first), 2, false);
    await wait(20); row.lateWriteAttempts++; row.events.push('server-late-attempt');
    if (!response.destroyed) response.end(Buffer.concat([frame(asEvent(row.stage, row.stage === 'tts' ? 3 : 2)), finish]));
    return;
  }
  const delayed = row.scenario === 'small-delayed-backpressure';
  if (delayed) await wait(3);
  await writeBytes(response, Buffer.from(': local fixture\r\n\r\n'), 2, false);
  for (let i = 0; i < (row.stage === 'tts' ? 4 : 3); i++) {
    row.events.push(`server-event-${i}`);
    await writeBytes(response, frame(asEvent(row.stage, i)), delayed ? 1 : 7, delayed);
    if (delayed) await wait(1);
  }
  await writeBytes(response, finish, delayed ? 3 : 11, false); response.end(); row.events.push('server-complete');
}
const server = createServer((request, response) => {
  const task = handle(request, response).catch(error => { response.destroy(error); throw error; });
  producerTasks.add(task); void task.catch(() => {}).finally(() => producerTasks.delete(task));
});
server.on('clientError', (_error, socket) => socket.destroy());

async function run(row: Row) {
  const path = `/mimo/${row.scenario}/${row.round}/${row.stage}`; currentRows.set(path, row);
  const abort = new AbortController(); let attempted = 0, text = '', received: number[] = [], consumerBusy = false;
  let releaseConsumer: (() => void) | undefined, enteredConsumer: (() => void) | undefined;
  const firstConsumer = new Promise<void>(resolve => { enteredConsumer = resolve; });
  const localFetch: typeof fetch = async (url, init) => {
    check(String(url) === 'https://api.xiaomimimo.com/v1/chat/completions', 'Production endpoint is intercepted before any network request');
    const local = new URL(path, localOrigin);
    check(local.hostname === '127.0.0.1' && local.origin === localOrigin, 'Only the explicitly owned local listener is reachable');
    if (row.scenario !== 'short-local-timeout') return globalThis.fetch(local, { ...init, redirect: 'error' });
    // Exercise the client's timeout-code handling using a short transport-owned local budget.
    // This is explicitly not a measurement or test of its production 45 second timer.
    const deadline = new AbortController(), cancel = () => deadline.abort();
    init?.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 15);
    try { return await globalThis.fetch(local, { ...init, signal: deadline.signal, redirect: 'error' }); }
    catch (error) { if (deadline.signal.aborted && !init?.signal?.aborted) throw new Error('voice:timeout'); throw error; }
    finally { clearTimeout(timer); init?.signal?.removeEventListener('abort', cancel); }
  };
  const client = new MimoCallClient(async () => 'mock-local-protocol-key', localFetch);
  const options = { signal: abort.signal, onRequest: () => { attempted++; row.events.push('client-request'); },
    onUsage: () => { row.usageCallbacks++; row.events.push('client-usage'); } };
  const afterDelivery = () => {
    check(!abort.signal.aborted, 'Cancelled stream never delivers a later callback');
    row.deliveredCallbacks++; row.events.push(`client-data-${row.deliveredCallbacks}`);
    if (row.scenario === 'cancel-late') { row.events.push('client-abort'); abort.abort(); }
  };
  const consume = async () => {
    check(!consumerBusy, 'Consumer callbacks remain serial');
    afterDelivery();
    if (row.scenario === 'small-delayed-backpressure' && row.deliveredCallbacks === 1) {
      consumerBusy = true; enteredConsumer?.();
      await new Promise<void>(resolve => { releaseConsumer = resolve; });
      consumerBusy = false; row.events.push('consumer-released');
    }
  };
  const started = performance.now();
  const pending = row.stage === 'asr' ? client.recognize(wav, { ...options, onText: value => { afterDelivery(); text = value; } })
    : row.stage === 'dialogue' ? client.dialogue(messages, { ...options, onText: async value => { text += value; await consume(); } })
    : client.synthesize('我在这里，你可以继续说。', '茉莉', '自然说话', { ...options, onPcm: async bytes => { received.push(...bytes); await consume(); } });
  // Observe rejection immediately, including intentional aborts before the awaited branch below.
  void pending.catch(() => {});
  if (row.scenario === 'small-delayed-backpressure' && row.stage !== 'asr') {
    await firstConsumer;
    await wait(8);
    check(row.deliveredCallbacks === 1 && row.usageCallbacks === 0, 'Actual HTTP stream does not advance delivery or usage while the consumer applies backpressure');
    row.backpressure = true; releaseConsumer!();
  }
  if (row.scenario === 'cancel-late' && row.round % 2 === 0) {
    // Wait for a real accepted request, then cancel while the server has not sent response headers.
    while (!row.bodyHash) await wait(1);
    row.events.push('client-abort'); abort.abort();
  }
  if (row.scenario === 'normal' || row.scenario === 'small-delayed-backpressure') {
    const result = await pending; if (row.stage === 'asr') text = result as string;
    if (row.stage === 'tts') assert.deepEqual(received, [...expectedAudio]); else assert.equal(text, textParts[row.stage].join(''));
    checks++; check(row.usageCallbacks === 1, 'Usage is delivered once on successful completion'); row.result = 'complete';
    check(row.events.indexOf('server-request') > row.events.indexOf('client-request'), 'Request accounting precedes actual HTTP handling');
  } else if (row.scenario === 'cancel-late') {
    await assert.rejects(pending, (error: any) => error.name === 'AbortError'); checks++; row.result = 'AbortError';
    const countAtAbort = row.deliveredCallbacks;
    while (!row.lateWriteAttempts) await wait(1);
    await wait(2);
    check(row.deliveredCallbacks === countAtAbort && row.usageCallbacks === 0, 'Server late-write attempt cannot append callbacks or usage after cancellation');
    check(row.deliveredCallbacks === (row.round % 2 === 0 ? 0 : 1), 'Before-headers and during-stream cancellation both preserve their exact delivered prefix');
  } else {
    const expected = row.scenario === 'short-local-timeout' ? 'timeout' : 'service';
    await assert.rejects(pending, (error: any) => error instanceof CallApiError && error.code === expected && error.stage === row.stage
      && error.httpStatus === (row.scenario === 'http-failure' ? 503 : undefined)); checks++; row.result = expected;
    check(row.usageCallbacks === 0, 'Failure does not fabricate final usage');
    if (row.scenario === 'http-failure' || row.scenario === 'short-local-timeout') check(row.deliveredCallbacks === 0, 'Failure before the first body event delivers no content');
    else check(row.deliveredCallbacks === 1, 'Stream failure preserves only the prefix actually received');
  }
  row.receivedPcmBytes = received.length; row.durationMs = performance.now() - started;
  check(attempted === 1 && row.requests === 1, 'Each operation makes one actual HTTP request and never retries');
}

async function main() {
  mkdirSync(dir, { recursive: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); localOrigin = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = ((url, init) => {
    const parsed = new URL(String(url));
    if (parsed.origin !== localOrigin || parsed.hostname !== '127.0.0.1') { blockedExternalRequests++; throw new Error('External network request blocked by fixture'); }
    return originalFetch(url, { ...init, redirect: 'error' });
  }) as typeof fetch;
  try {
    // Negative guard assertion never opens a socket.
    assert.throws(() => globalThis.fetch('https://example.invalid/'), /External network/); checks++;
    for (const scenario of scenarios) for (let round = 0; round < 30; round++) for (const stage of stages) {
      const row: Row = { scenario, round, stage, events: [], requests: 0, uploadWavBytes: 0, receivedPcmBytes: 0, deliveredCallbacks: 0, usageCallbacks: 0, lateWriteAttempts: 0 };
      rows.push(row); await run(row);
    }
    await Promise.all([...producerTasks]);
    check(rows.every(row => row.requests === 1), 'No automatic retries in the full matrix');
    check(networkRequests === rows.length && blockedExternalRequests === 1, 'Every accepted socket request stayed on the local server, plus exactly one intentionally blocked external-address assertion');
    for (const stage of stages) {
      const successes = rows.filter(row => row.stage === stage && (row.scenario === 'normal' || row.scenario === 'small-delayed-backpressure'));
      check(new Set(successes.map(row => row.bodyHash)).size === 1, 'Normal and delayed requests use identical actual model input and parameters');
    }
    const summary = scenarios.map(scenario => {
      const group = rows.filter(row => row.scenario === scenario);
      return { scenario, rounds: 30, operations: group.length, actualLocalHttpRequests: group.reduce((n, row) => n + row.requests, 0),
        uploadWavBytes: group.reduce((n, row) => n + row.uploadWavBytes, 0), receivedPcmBytes: group.reduce((n, row) => n + row.receivedPcmBytes, 0),
        lateWriteAttempts: group.reduce((n, row) => n + row.lateWriteAttempts, 0), backpressuredOperations: group.filter(row => row.backpressure).length,
        results: [...new Set(group.map(row => row.result))] };
    });
    const report = { date: new Date().toISOString(), workdir: process.cwd(), checks, model: 'GPT-6', reasoningEffort: '未确认',
      scope: 'Actual MimoCallClient using actual fetch and a real HTTP/SSE listener bound only to 127.0.0.1; synthetic WAV, text and PCM.',
      realProviderCalls: 0, actualLocalHttpRequests: networkRequests, realModelTokens: 0, microphone: false, physicalAudio: false,
      roundsPerPrimaryStratum: 30, stages, summary, manifest: CALL_PROVIDER_CAPABILITIES,
      sourceHashes: ['src/lib/voice-call/mimo.ts', 'src/lib/voice-call/transport.ts', 'scripts/verify/voice-local-protocol.ts'].map(path => ({ path, sha256: hash(readFileSync(path)) })),
      limitations: ['Synthetic ASR response does not measure recognition accuracy.', 'Local timing and injected delays do not measure MiMo/network latency.',
        'Short timeout tests transport-owned 15ms failure injection and fixed timeout-code handling; the unchanged production 45s timer is covered separately by core tests.',
        'HTTP application writes are fragmented; no assertion is made that TCP preserves those boundaries.',
        'ASR text callback is synchronous; awaited downstream backpressure is verified for dialogue and TTS.',
        'No controller, native Android transport, append/drain, hardware route, physical playback or acoustic interruption is exercised here.'], rows };
    writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks, realProviderCalls: 0, actualLocalHttpRequests: networkRequests, roundsPerPrimaryStratum: 30, summary, evidence: `${dir}/report.json` }));
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.allSettled([...producerTasks]); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
main().catch(error => {
  mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/failure.json`, JSON.stringify({ checks, realProviderCalls: 0, error: String(error), stack: error?.stack, rows }, null, 2));
  console.error(error); process.exitCode = 1;
});
