import assert from 'node:assert/strict';
import { nativeCallFetch, type MimoStreamPort } from '../../src/lib/voice-call/transport';
import { MimoCallClient, CallApiError, CALL_MODELS } from '../../src/lib/voice-call/mimo';
import { pcmWav } from '../../src/lib/voice-call/utterance';
let checks = 0, reads = 0, cancellations = 0;
const port: MimoStreamPort = {
  open: async options => { assert.equal(options.key, 'mock-key'); checks++; return { status: 200, contentType: 'text/event-stream' }; },
  read: async () => ++reads === 1 ? { done: false, data: btoa('data: [DONE]\n\n') } : { done: true },
  cancel: async () => { cancellations++; },
};
async function main() {
  const url = 'https://api.xiaomimimo.com/v1/chat/completions';
  const init = { method: 'POST', body: '{}', headers: { Authorization: 'Bearer mock-key' } };
  const response = await nativeCallFetch(port, url, init);
  assert.equal(reads, 0); checks++;
  assert.equal(await response.text(), 'data: [DONE]\n\n'); checks++;
  assert.equal(cancellations, 1); checks++;
  const denied = await nativeCallFetch({ ...port, open: async () => ({ status: 401 }) }, url, init);
  assert.equal(denied.status, 401); assert.equal(reads, 2); checks++;
  const abort = new AbortController(); let finishOpen!: () => void;
  const pending = nativeCallFetch({ ...port, open: async () => { await new Promise<void>(resolve => { finishOpen = resolve; }); return { status: 200 }; } }, url, { ...init, signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, (error: any) => error.name === 'AbortError'); checks++;
  finishOpen();
  assert.ok(cancellations >= 2); checks++;
  await assert.rejects(nativeCallFetch(port, 'https://example.com', init), /transport_url/); checks++;
  const readAbort = new AbortController(); let rejectLate!: (error: Error) => void;
  const held = await nativeCallFetch({ ...port, read: async () => new Promise((_, reject) => { rejectLate = reject; }) }, url, { ...init, signal: readAbort.signal });
  const reading = held.body!.getReader().read();
  while (!rejectLate) await new Promise(resolve => setTimeout(resolve, 0));
  readAbort.abort();
  await assert.rejects(reading, (error: any) => error.name === 'AbortError'); checks++;
  rejectLate(new Error('late native failure')); await new Promise(resolve => setTimeout(resolve, 0));
  checks++; // A late rejection is observed rather than escaping as unhandled.
  const streams = new Map<string, Uint8Array[]>(); let opens = 0, closes = 0;
  const modelPort: MimoStreamPort = {
    open: async options => {
      opens++; assert.equal(options.key, 'mock-key');
      const body = JSON.parse(options.body);
      let delta: object;
      if (body.model === CALL_MODELS.asr) {
        assert.ok(body.messages[0].content[0].input_audio.data.startsWith('data:audio/wav;base64,'));
        delta = { content: '你好，听到了。' };
      } else if (body.model === CALL_MODELS.dialogue) {
        assert.equal(body.thinking.type, 'disabled'); assert.equal(body.stream, true);
        delta = { content: '我在，继续说。' };
      } else {
        assert.equal(body.model, CALL_MODELS.tts); assert.equal(body.audio.format, 'pcm16'); assert.equal(body.audio.voice, '茉莉');
        delta = { audio: { data: 'AQIDBA==' } };
      }
      checks++;
      const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
      // Split every byte, including Chinese UTF-8, at the native bridge boundary.
      streams.set(options.id, Array.from(bytes, byte => new Uint8Array([byte])));
      return { status: 200, contentType: 'text/event-stream; charset=utf-8' };
    },
    read: async options => { const next = streams.get(options.id)?.shift(); return next ? { done: false, data: btoa(String.fromCharCode(...next)) } : { done: true }; },
    cancel: async options => { if (streams.delete(options.id)) closes++; },
  };
  const client = new MimoCallClient(async () => 'mock-key', (url, init) => nativeCallFetch(modelPort, url, init));
  const signal = new AbortController().signal;
  assert.equal(await client.recognize(pcmWav(new Uint8Array(3200)), { signal }), '你好，听到了。'); checks++;
  let answer = ''; await client.dialogue([{ role: 'user', content: '你好' }], { signal, onText: text => { answer += text; } });
  assert.equal(answer, '我在，继续说。'); checks++;
  const pcm: number[] = []; await client.synthesize(answer, '茉莉', '自然说话', { signal, onPcm: bytes => { pcm.push(...bytes); } });
  assert.deepEqual(pcm, [1, 2, 3, 4]); checks++;
  assert.equal(opens, 3); assert.equal(closes, 3); assert.equal(streams.size, 0); checks++;
  for (const [status, code] of [[401, 'key'], [403, 'forbidden'], [402, 'quota'], [429, 'rate'], [500, 'service']] as const) {
    let attempts = 0;
    const rejected = new MimoCallClient(async () => 'mock-key', (url, init) => nativeCallFetch({
      ...modelPort, open: async () => { attempts++; return { status }; },
    }, url, init));
    await assert.rejects(rejected.dialogue([{ role: 'user', content: '你好' }], { signal, onText: () => {} }),
      (error: any) => error instanceof CallApiError && error.code === code && error.stage === 'dialogue' && error.httpStatus === status); checks++;
    assert.equal(attempts, 1); checks++;
  }
  let partialReads = 0, partialCleanup = 0, partialText = '';
  const rejectedAsr = new MimoCallClient(async () => 'mock-key', (url, init) => nativeCallFetch({
    ...modelPort, open: async () => ({ status: 401 }),
  }, url, init));
  await assert.rejects(rejectedAsr.recognize(pcmWav(new Uint8Array(3200)), { signal }),
    (error: any) => error instanceof CallApiError && error.code === 'key' && error.stage === 'asr' && error.httpStatus === 401); checks++;
  const disconnected = new MimoCallClient(async () => 'mock-key', (url, init) => nativeCallFetch({
    open: async () => ({ status: 200, contentType: 'text/event-stream' }),
    read: async () => {
      if (++partialReads === 1) return { done: false, data: btoa('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n') };
      throw { message: 'voice:dns' };
    },
    cancel: async () => { partialCleanup++; },
  }, url, init));
  await assert.rejects(disconnected.dialogue([{ role: 'user', content: '你好' }], { signal, onText: text => { partialText += text; } }),
    (error: any) => error instanceof CallApiError && error.code === 'dns'); checks++;
  assert.equal(partialText, 'partial'); assert.equal(partialReads, 2); assert.ok(partialCleanup > 0); checks++;
  for (const code of ['transport_limit', 'transport_duplicate', 'transport_url', 'stream_closed'] as const) {
    for (const stage of ['asr', 'dialogue', 'tts'] as const) {
      let attempts = 0, readAttempts = 0, cleanups = 0;
      const localFailure = new MimoCallClient(async () => 'mock-key', (url, init) => nativeCallFetch({
        open: async () => {
          attempts++;
          if (code !== 'stream_closed') throw { message: `voice:${code}` };
          return { status: 200, contentType: 'text/event-stream' };
        },
        read: async () => { readAttempts++; throw { message: 'voice:stream_closed' }; },
        cancel: async () => { cleanups++; },
      }, url, init));
      const request = stage === 'asr' ? localFailure.recognize(pcmWav(new Uint8Array(3200)), { signal })
        : stage === 'tts' ? localFailure.synthesize('你好。', '茉莉', '', { signal, onPcm: () => {} })
        : localFailure.dialogue([{ role: 'user', content: '你好' }], { signal, onText: () => {} });
      await assert.rejects(request, (error: any) => error instanceof CallApiError && error.code === code
        && error.stage === stage && error.httpStatus === undefined); checks++;
      assert.equal(attempts, 1); assert.equal(readAttempts, code === 'stream_closed' ? 1 : 0); assert.ok(cleanups > 0); checks++;
    }
  }
  console.log(JSON.stringify({ checks, realApiCalls: 0, modelTokens: 0, deviceTested: false }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
