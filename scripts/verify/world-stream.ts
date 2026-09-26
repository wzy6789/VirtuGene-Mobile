import { llmChatStream } from '../../src/lib/ai/llm';
import { gatewayChatStream } from '../../src/lib/ai/gateway';
import { worldChat } from '../../src/lib/world/world-ai-client';
import { useAuthStore } from '../../src/store/auth-store';
import { extractPartialJsonString } from '../../src/lib/world/world-actor';
import { revealDelayFor } from '../../src/lib/world/world-immersion';

const report = window.fetch.bind(window);
const encoder = new TextEncoder();
const params = { provider: 'deepseek' as const, model: 'deepseek-v4-flash', apiKey: 'test-key', messages: [{ role: 'user', content: '你好' }] };
const frame = (text: string, newline = '\r\n') => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}${newline}${newline}`;
const noBody = (text: string) => ({ ok: true, status: 200, body: null, text: async () => text }) as Response;

async function run() {
  let count = 0;
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); count += 1; };
  check(revealDelayFor({kind:'dialogue', content:'你好'.repeat(80), speakerId:'a'}, 'a') === 0, 'same speaker does not wait again for already-generated text');
  check(revealDelayFor({kind:'action', content:'抬头', speakerId:'a'}, 'a') === 0, 'action and dialogue have no artificial gap');
  check(revealDelayFor({kind:'dialogue', content:'我来了', speakerId:'b'}, 'a') === 180, 'buffered speaker change retains a brief readable pause');
  const chunks = [frame('你').slice(0, -3), frame('你').slice(-3), frame('好'), 'data: [DONE]\r\n\r\n'];
  const sent: RequestInit[] = [];
  window.fetch = ((_: string, init: RequestInit) => {
    sent.push(init);
    return Promise.resolve(new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } }), { status: 200 }));
  }) as typeof fetch;
  const seen: string[] = [];
  const streamed = await llmChatStream({ ...params, onDelta: (all) => seen.push(all) });
  check(JSON.parse(String(sent[0].body)).stream === true, 'world stream uses SSE request');
  check(streamed.content === '你好' && seen.join('|') === '你|你好', 'CRLF and split boundaries update incrementally');

  window.fetch = (() => Promise.resolve(noBody(frame('桥') + frame('接')))) as typeof fetch;
  const bridgeSeen: string[] = [];
  const bridged = await llmChatStream({ ...params, onDelta: (all) => bridgeSeen.push(all) });
  check(bridged.content === '桥接' && bridgeSeen.join('|') === '桥|桥接', 'body-less bridge reads SSE text');

  window.fetch = (() => Promise.resolve(noBody(JSON.stringify({ choices: [{ message: { content: '整读' } }] })))) as typeof fetch;
  check((await llmChatStream({ ...params, onDelta: () => undefined })).content === '整读', 'body-less bridge accepts JSON response');

  useAuthStore.setState({ apiKey: 'test-key' });
  const fallbacks: boolean[] = [];
  window.fetch = ((_: string, init: RequestInit) => {
    const isStream = Boolean(JSON.parse(String(init.body)).stream);
    fallbacks.push(isStream);
    return Promise.resolve(isStream
      ? noBody('data: [DONE]\n\n')
      : new Response(JSON.stringify({ choices: [{ message: { content: '补救成功' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
  check((await worldChat({ messages: params.messages, onDelta: () => undefined })).content === '补救成功' && fallbacks.join(',') === 'true,false', 'empty stream falls back once to normal response');

  let deniedCalls = 0;
  window.fetch = (() => { deniedCalls += 1; return Promise.resolve(new Response('denied', { status: 401 })); }) as typeof fetch;
  let denied = false;
  try { await worldChat({ messages: params.messages, onDelta: () => undefined }); } catch (error) { denied = (error as Error).message === 'auth:invalid_key'; }
  check(denied && deniedCalls === 1, 'invalid credential is not retried');
  check(extractPartialJsonString('{"dialogue":"你\\u4f', 'dialogue') === '你', 'incomplete Unicode escape stays hidden');
  check(extractPartialJsonString('{"dialogue":"你\\u597d"}', 'dialogue') === '你好', 'completed Unicode escape renders once');

  /* ---- 5.2 断线纪律：正文已经开始后中断，保留部分正文，绝不整轮重发 ---- */
  // (a) reader 中途抛错（网络断开）：返回已生成部分 + interrupted，不抛错
  window.fetch = (() => Promise.resolve(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frame('雨', '\n')));
      // 异步 error：fetch 先成功返回，读取途中断开（真实网络中断时序）
      setTimeout(() => controller.error(new Error('network lost')), 0);
    },
  }), { status: 200 }))) as typeof fetch;
  const cutSeen: string[] = [];
  const cut = await llmChatStream({ ...params, onDelta: (all) => cutSeen.push(all) });
  check(cut.content === '雨' && cut.interrupted === true && cut.truncated === true, 'mid-stream disconnect keeps partial content instead of failing the turn');
  check(cutSeen.join('|') === '雨', 'deltas before the disconnect were still delivered');

  // (b) 对端干净关闭但既没有 [DONE] 也没有 finish_reason：同样判为中断（断线可检测）
  window.fetch = (() => Promise.resolve(new Response(encoder.encode(frame('风', '\n') + frame('停了', '\n')), { status: 200 }))) as typeof fetch;
  const noEnd = await llmChatStream({ ...params, onDelta: () => undefined });
  check(noEnd.content === '风停了' && noEnd.interrupted === true, 'stream ending without [DONE]/finish_reason is detected as interrupted');

  // (c) 世界 AI 出口（BYOK）：正文已开始后中断 → 直接返回部分结果，绝不静默重发整轮
  useAuthStore.setState({ apiKey: 'test-key' });
  let worldCalls = 0;
  window.fetch = ((_: string, init: RequestInit) => {
    worldCalls += 1;
    const isStream = Boolean(JSON.parse(String(init.body)).stream);
    if (!isStream) {
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '整段补救' } }] }), { status: 200 }));
    }
    return Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(frame('你')));
        setTimeout(() => controller.error(new Error('gone')), 0);
      },
    }), { status: 200 }));
  }) as typeof fetch;
  const worldCut = await worldChat({ messages: params.messages, onDelta: () => undefined });
  check(worldCut.content === '你' && worldCut.interrupted === true && worldCalls === 1, 'worldChat keeps interrupted partial and never re-sends the whole turn');

  /* ---- 5.2 网关流式：独立端点 /v1/chat/stream，与私聊 /v1/chat 互不影响 ---- */
  let gwUrl = '';
  let gwInit: RequestInit | undefined;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    gwUrl = String(input);
    gwInit = init;
    return Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(frame('星') + frame('域') + 'data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200 }));
  }) as typeof fetch;
  const gw = await gatewayChatStream({
    apiKey: '', systemPrompt: 's', message: 'm', history: [],
    maxTokens: 1200, disableThinking: true,
    onDelta: () => undefined,
  }, { baseUrl: 'http://gateway.test' });
  const gwBody = JSON.parse(String(gwInit?.body));
  check(gwUrl === 'http://gateway.test/v1/chat/stream' && gw.content === '星域', 'gatewayChatStream calls the streaming endpoint and parses forwarded SSE');
  check(gwBody.maxTokens === 1200 && gwBody.disableThinking === true, 'stream endpoint passes world-pipeline budget and thinking flags');
  check(!('stream' in gwBody), 'gateway client speaks its own protocol (no OpenAI stream field)');

  // (e) 流式端点凭据错误：与私聊一致的错误码，不重试
  let gwDeniedCalls = 0;
  window.fetch = ((input: RequestInfo | URL) => {
    gwDeniedCalls += 1;
    void input;
    return Promise.resolve(new Response('denied', { status: 401 }));
  }) as typeof fetch;
  let gwDenied = false;
  try {
    await gatewayChatStream({ apiKey: '', systemPrompt: 's', message: 'm', history: [], onDelta: () => undefined }, { baseUrl: 'http://gateway.test' });
  } catch (error) {
    gwDenied = (error as Error).message === 'auth:invalid_key';
  }
  check(gwDenied && gwDeniedCalls === 1, 'streaming endpoint maps 401 to auth:invalid_key without retry');

  window.fetch = (() => { throw new Error('unexpected network'); }) as typeof fetch;
  await report('/result?suite=world-stream', { method: 'POST', body: `PASS ${count} stream assertions\nALL PASS` });
}
run().catch(async (error) => { await report('/result?suite=world-stream', { method: 'POST', body: `FAIL ${error.stack ?? error}\n1 FAILED` }); });
