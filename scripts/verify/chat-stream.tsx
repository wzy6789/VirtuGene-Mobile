import { createRoot, type Root } from 'react-dom/client';
import { ChatWindow } from '../../src/components/chat/ChatWindow';
import { db, type Message } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useUIStore } from '../../src/store/ui-store';
import { webApi } from '../../src/lib/web-api';
import { fakeCharacter, typeInto, pressEnter } from './world-harness';
import { ChatReplyStream, streamedReplyParts } from '../../src/lib/chat-stream';
import { sendMessage } from '../../src/lib/ai/deepseek';
import { readSseResponse } from '../../src/lib/ai/llm';
import { gatewayChatStream } from '../../src/lib/ai/gateway';

const encoder = new TextEncoder();
const realFetch = window.fetch.bind(window);
const uid = 'stream-test-user';
const requests: { init: RequestInit; controller: ReadableStreamDefaultController<Uint8Array>; raw: string; aborted: boolean }[] = [];
let root: Root | undefined;
let id = 0;
let extraNetwork = 0;
let nextStatus = 200;
let storeChanges = 0;
let completeResponses: string[] | undefined;
let completeRequests: unknown[] = [];
useChatStore.subscribe(() => { storeChanges++; });
const frame = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
window.fetch = (async (url, init) => {
  if (!String(url).includes('/chat/completions')) { extraNetwork++; throw new Error('unexpected network'); }
  const payload = JSON.parse(String(init?.body));
  if (payload.stream===true && completeResponses) {
    completeRequests.push(payload);
    const content=completeResponses.shift();
    if(content===undefined)throw Error('Complete-response fixture exhausted its retry budget');
    return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8}}),{headers:{'Content-Type':'application/json'}});
  }
  // Deferred memory workers can outlive a fixture reset. They use the task
  // client directly, so mocking webApi.memory alone does not isolate them.
  if (payload.stream !== true) {
    if (!String(payload.messages?.[0]?.content).includes('记忆提取系统')) throw new Error('unexpected non-stream task');
    return new Response(JSON.stringify({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  }
  const item = { init: init!, controller: undefined as unknown as ReadableStreamDefaultController<Uint8Array>, raw: '', aborted: false };
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    item.controller = controller;
    const abort = () => { item.aborted = true; try { controller.error(new DOMException('Stopped', 'AbortError')); } catch { /* Already done. */ } };
    if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort', abort, { once: true });
  } });
  requests.push(item);
  if (nextStatus !== 200) { const status = nextStatus; nextStatus = 200; item.controller.close(); return new Response('denied', { status }); }
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}) as typeof fetch;
webApi.context.summarize = async () => ({ error: 'server:error' });
webApi.context.settle = async () => ({ error: 'server:error' });
webApi.memory.extract = async () => ({ memories: [] });

async function setup(history = 0) {
  root?.unmount(); root = undefined;
  await db.delete(); await db.open();
  requests.length = 0; extraNetwork = 0; nextStatus = 200;
  completeResponses=undefined; completeRequests=[];
  useAuthStore.getState().login(uid, 'stream tester', 'sk-fake', '');
  useSettingsStore.setState({ aiVoiceMode: false, ttsEnabled: true, defaultModel: { provider: 'deepseek', model: 'deepseek-v4-flash' } });
  useUIStore.setState({ mobileTab: 'chat', activeView: 'chat' });
  // Stream-only fixtures already have reviewed examples; legacy generation is covered separately.
  const chars = ['a', 'b'].map(key => fakeCharacter(key, key === 'a' ? '星遥' : '林霜', uid, { systemPrompt: '你有自己的说话方式。\n对话样本：用户说你好 → 你说来啦。' }));
  await db.characters.bulkAdd(chars);
  const now = Date.now();
  await db.sessions.bulkAdd(chars.map(char => ({ id: char.id, characterId: char.id, userId: uid, title: char.name, createdAt: now, updatedAt: now, modelAsked: true, model: { provider: 'deepseek', model: 'deepseek-v4-flash' } })));
  if (history) await db.messages.bulkAdd(Array.from({ length: history }, (_, index): Message => ({ id: `history-${index}`, sessionId: 'a', role: 'assistant', content: `过去的消息${index}。` + '这是一段已经保存的聊天内容。'.repeat(12), createdAt: now - (history - index) * 1000, isProactive: false })));
  useChatStore.setState({ characters: chars, currentSessionId: 'a', selectedCharacterId: 'a', messages: await db.messages.where('sessionId').equals('a').sortBy('createdAt'), hasMoreMessages: false });
  const host = document.getElementById('app')!;
  root = createRoot(host); root.render(<ChatWindow />);
}
async function switchTo(key: string) {
  useChatStore.setState({ currentSessionId: key, selectedCharacterId: key, messages: await db.messages.where('sessionId').equals(key).sortBy('createdAt'), hasMoreMessages: false });
}
function submit(text = `你好${++id}`, twice = false) {
  const input = document.querySelector<HTMLTextAreaElement>('[aria-label="消息内容"]')!;
  typeInto(input, text);
  // React commits the controlled value before the following input event.
  setTimeout(() => { pressEnter(input); if (twice) pressEnter(input); }, 20);
}
function push(index: number, text: string) { const req = requests[index]; req.raw += text; req.controller.enqueue(encoder.encode(frame(text))); }
function finish(index: number) {
  const req = requests[index];
  req.controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8}}\r\n\r\ndata: [DONE]\r\n\r\n'));
  req.controller.close();
}
async function unitChecks() {
  let checks = 0;
  const check = (ok: unknown, name: string) => { if (!ok) throw new Error(name); checks++; };
  const snapshot = (raw: string) => streamedReplyParts(raw).join('|');
  check(snapshot('你好-') === '你好' && snapshot('你好--') === '你好' && snapshot('你好---再见') === '你好|再见', 'fragmented separators');
  check(snapshot('（笑') === '' && snapshot('（笑）你好') === '你好', 'no transient roleplay actions');
  check(snapshot('{"messages":["你好"') === '' && snapshot('{"messages":["你好","再见"]}') === '你好|再见', 'no partial JSON syntax');
  check(streamedReplyParts('一---二---三---四', true).join('|') === '一|二|三|四', 'four independent parts retained');
  check(streamedReplyParts('长长的第一条---嗯---啊---长长的第四条---最后', true).join('|') === '长长的第一条|嗯啊|长长的第四条|最后', 'buffered fifth part merges shortest adjacent pair');
  check(streamedReplyParts('长长的第一条---嗯---啊---長長的第四条---最后', true, true).join('|') === '长长的第一条|嗯|啊|長長的第四条最后', 'published stream never rewrites earlier bubbles when fifth part arrives');
  let starts = 0, publishes = 0;
  const stream = new ChatReplyStream('unit', () => starts++);
  stream.subscribe(() => publishes++);
  stream.push('你'); for (let index = 0; index < 100; index++) stream.push('你' + '好'.repeat(index + 1));
  await new Promise(resolve => setTimeout(resolve, 45));
  check(starts === 1 && publishes === 2 && stream.getSnapshot()[0].length === 101, 'burst coalescing without text loss');
  stream.finish('终稿'); check(stream.getSnapshot()[0] === '终稿', 'completion flush'); stream.dispose();
  const four = new ChatReplyStream('four', () => undefined);
  four.push('长长的第一条---嗯---啊---长长的第四条');
  const originalIds = [...four.ids];
  four.finish('长长的第一条---嗯---啊---长长的第四条---最后');
  check(four.getSnapshot().join('|') === '长长的第一条|嗯|啊|长长的第四条最后' && four.ids.length === 4 && four.ids.every((id, i) => id === originalIds[i]), 'real stream class preserves four published row identities through overflow');
  four.dispose();
  const bytes = encoder.encode(frame('你好🌙') + 'data: [DONE]\r\n\r\n');
  const seen: string[] = [];
  const parsed = await readSseResponse(new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } })), all => seen.push(all));
  check(parsed.content === '你好🌙' && !parsed.interrupted && seen[0] === '你好🌙', 'UTF-8 byte boundaries');
  const savedFetch = window.fetch;
  let calls = 0;
  window.fetch = (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '兼容回复' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  let completeDeltas = 0;
  const json = await sendMessage({ apiKey: 'sk-fake', systemPrompt: '', message: '你好', history: [], onDelta: () => completeDeltas++ });
  check(json.content === '兼容回复' && calls === 1, 'JSON-only endpoint is not sent twice');
  check(completeDeltas===0,'a complete JSON reply reaches result checks without marking a streaming preview as published');
  calls = 0;
  window.fetch = (async () => { calls++; return new Response('denied', { status: 401 }); }) as typeof fetch;
  let denied = false;
  try { await sendMessage({ apiKey: 'sk-fake', systemPrompt: '', message: '你好', history: [], onDelta: () => undefined }); } catch (error) { denied = (error as Error).message === 'auth:invalid_key'; }
  check(denied && calls === 1, 'auth errors are not retried');
  let forwardedSignal: AbortSignal | undefined;
  window.fetch = (async (_url, init) => { forwardedSignal = init?.signal as AbortSignal; return new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(frame('网关正文'))); init?.signal?.addEventListener('abort', () => c.error(new DOMException('Stopped', 'AbortError'))); } }), { headers: { 'Content-Type': 'text/event-stream' } }); }) as typeof fetch;
  const controller = new AbortController();
  const gate = await gatewayChatStream({ apiKey: '', systemPrompt: '', message: '', history: [], signal: controller.signal, onDelta: () => controller.abort() }, { baseUrl: 'http://fake' });
  check(forwardedSignal?.aborted && gate.interrupted && gate.content === '网关正文', 'gateway stop retains partial text');
  const routes: string[] = [];
  window.fetch = (async (url) => { routes.push(String(url)); return String(url).endsWith('/stream') ? new Response('', { status: 404 }) : new Response(JSON.stringify({ content: '旧网关回复' }), { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  const oldGateway = await gatewayChatStream({ apiKey: '', systemPrompt: '', message: '', history: [], onDelta: () => completeDeltas++ }, { baseUrl: 'http://fake' });
  check(oldGateway.content === '旧网关回复' && routes.length === 2 && routes[1].endsWith('/v1/chat'), 'older gateway falls back before any text');
  check(completeDeltas===0,'old gateway JSON fallback also preserves the unpublished quality path');
  const intervention = await readSseResponse(new Response('data: {"content":"现实安全引导","safetyIntervention":true}\n\ndata: [DONE]\n\n'), () => undefined);
  check(intervention.content === '现实安全引导' && !intervention.interrupted, 'gateway intervention stays visible through SSE');
  window.fetch = savedFetch;
  return checks;
}

(window as any).chatStreamTest = { setup, switchTo, submit, push, finish, unitChecks,
  useCompleteResponses: (values:string[]) => {completeResponses=[...values];},
  completeRequests: () => completeRequests,
  fail: (index: number) => requests[index].controller.error(new TypeError('connection lost')),
  records: (session = 'a') => db.messages.where('sessionId').equals(session).sortBy('createdAt'),
  requests: () => requests.map(req => ({ body: JSON.parse(String(req.init.body)), aborted: req.aborted, raw: req.raw })),
  extraNetwork: () => extraNetwork, unmount: () => { root?.unmount(); root = undefined; },
  denyNext: () => { nextStatus = 401; },
  storeChanges: () => storeChanges,
  logout: () => useAuthStore.setState({ userId: 'different-account', apiKey: 'sk-other' }),
};
