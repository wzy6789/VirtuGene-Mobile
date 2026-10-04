import { llmChat, llmChatStream, resolveModel, findModel, fetchProviderModels, validateProviderConnection, getProviderKey, LLM_PROVIDERS, type ProviderId } from '../../src/lib/ai/llm';
import { getProviderConfig, saveProviderConfig, normalizeProviderBaseUrl, providerRequiresKey, getAvailableModels } from '../../src/lib/ai/provider-config';
import { persistSecret, loadSecret } from '../../src/lib/api-key-storage';
import { useAuthStore } from '../../src/store/auth-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { sendMessage } from '../../src/lib/ai/deepseek';
import { runProviderRoutingChecks } from './provider-routing';
import { runDeepseekFlashChecks } from './deepseek-flash';

const report = window.fetch.bind(window);
const encoder = new TextEncoder();
const image = 'data:image/png;base64,aGVsbG8=';
const messages = [{ role: 'system', content: 'Private system instruction' }, { role: 'user', content: 'Hello' }];
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const openAiResult = { choices: [{ message: { content: 'Ready' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4 } };
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const bodyless = (text: string) => ({ ok: true, status: 200, body: null, text: async () => text }) as Response;
async function run() {
  let count = 0;
  const check = (condition: unknown, name: string) => { if (!condition) throw new Error(name); count += 1; };
  const rejects = async (operation: () => Promise<unknown>, code: string, name: string) => {
    let actual: unknown;
    try { await operation(); } catch (error) { actual = (error as Error).message; }
    check(actual === code, `${name}: got ${String(actual)}`);
  };
  localStorage.clear();
  useAuthStore.setState({ apiKey: 'isolated-deepseek-key', userId: 'protocol-test' });
  useSettingsStore.setState({ defaultModel: null });
  check(Object.keys(LLM_PROVIDERS).length === 15, 'all provider protocol entries exist');
  check(LLM_PROVIDERS.qwen.keyStorage === 'qwen-key' && LLM_PROVIDERS.mimo.keyStorage === 'mimo-key', 'legacy encrypted key names remain valid');
  await persistSecret('qwen-key', 'isolated-qwen-key');
  check(await getProviderKey('qwen') === 'isolated-qwen-key', 'existing Qwen encrypted key remains readable');
  check(await getProviderKey('deepseek') === 'isolated-deepseek-key', 'DeepSeek retains account memory credential');
  await persistSecret('anthropic-key', 'isolated-claude-key');
  check(await loadSecret('anthropic-key') === 'isolated-claude-key', 'new providers use working encrypted key storage');
  check(normalizeProviderBaseUrl('https://proxy.test/v1/chat/completions/', 'custom') === 'https://proxy.test/v1', 'full completion endpoint normalizes without duplicate path');
  check(normalizeProviderBaseUrl('http://192.168.1.2:1234/v1/', 'custom') === 'http://192.168.1.2:1234/v1', 'LAN model server supported');
  check(!providerRequiresKey('custom', 'http://127.0.0.1:11434/v1') && providerRequiresKey('custom', 'https://proxy.test/v1'), 'keyless local and authenticated remote routes differ');
  for (const url of ['http://public.test/v1', 'https://user:secret@public.test/v1', 'https://proxy.test/v1?key=secret', 'file:///tmp/models']) {
    let invalid = false;
    try { normalizeProviderBaseUrl(url, 'custom'); } catch { invalid = true; }
    check(invalid, `unsafe endpoint rejected: ${url}`);
  }
  saveProviderConfig('custom', { baseUrl: 'http://127.0.0.1:11434/v1', models: [{ id: 'same-model', label: 'Local model', vision: true }] });
  saveProviderConfig('doubao', { models: [{ id: 'same-model', label: 'Ark deployment', vision: false }, { id: 'ep-private-exact-id' }] });
  check(findModel('same-model', 'custom')?.label === 'Local model' && findModel('same-model', 'doubao')?.label === 'Ark deployment', 'provider/model identity prevents collisions');
  check(resolveModel(null, { provider: 'doubao', model: 'ep-private-exact-id' }).id === 'ep-private-exact-id', 'Ark endpoint ID resolves exactly');
  check(resolveModel(null, { provider: 'groq', model: 'newly-authorized-exact-id' }).provider === 'groq', 'unlisted exact selected model never falls back to DeepSeek');
  saveProviderConfig('qwen', { baseUrl: 'https://qwen-proxy.test/v1', apiKey: 'must-never-store' } as any);
  check(!localStorage.getItem('virtugene-ai-provider-config-v1')?.includes('must-never-store'), 'nonsecret config whitelists fields');
  check(getAvailableModels('custom').some(model => model.id === 'same-model') && getProviderConfig('custom').models[0].vision === true, 'custom models and explicit image capability are persisted');

  await runDeepseekFlashChecks(check);
  const compatible = Object.values(LLM_PROVIDERS).filter(provider => provider.protocol === 'openai');
  for (const provider of compatible) {
    let url = ''; let init: RequestInit | undefined;
    window.fetch = (async (input, options) => { url = String(input); init = options; return response(openAiResult); }) as typeof fetch;
    const model = provider.id === 'openai' ? 'gpt-6-luna' : provider.id === 'minimax' ? 'MiniMax-M2.7' : 'exact-id';
    const result = await llmChat({ provider: provider.id, model, apiKey: provider.id === 'custom' ? '' : 'isolated-key', messages, jsonMode: true, disableThinking: true });
    const body = JSON.parse(String(init?.body));
    check(result.content === 'Ready' && result.usage?.inputTokens === 12 && body.model === (provider.id === 'deepseek' ? 'deepseek-flash' : model) && url === `${getProviderConfig(provider.id).baseUrl}/chat/completions`, `${provider.id} makes real compatible request and parses response`);
    check(provider.id === 'custom' ? !new Headers(init?.headers).has('Authorization') : new Headers(init?.headers).get('Authorization') === 'Bearer isolated-key', `${provider.id} credentials reach selected endpoint only`);
    if (provider.id === 'openai') check(body.max_completion_tokens === 1000 && !('max_tokens' in body) && !('temperature' in body) && body.reasoning_effort === 'none', 'modern OpenAI reasoning parameters are compatible');
    if (provider.id === 'qwen') check(body.enable_thinking === false && body.response_format.type === 'json_object', 'Qwen structured output disables thinking');
    if (provider.id === 'mimo') check(!('temperature' in body) && body.thinking.type === 'disabled', 'MiMo legacy sampling behavior preserved');
  }
  let sentUrl = ''; let sentInit: RequestInit | undefined;
  window.fetch = (async (input, init) => {
    sentUrl = String(input); sentInit = init;
    return response({ content: [{ type: 'thinking', thinking: 'Never show this' }, { type: 'text', text: '{"status":"ready"}' }], stop_reason: 'end_turn', usage: { input_tokens: 4, cache_read_input_tokens: 10, cache_creation_input_tokens: 3, output_tokens: 5 } });
  }) as typeof fetch;
  const claude = await llmChat({ provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'isolated-key', jsonMode: true, messages: [...messages.slice(0, 1), { role: 'user', content: [{ type: 'text', text: 'Image' }, { type: 'image_url', image_url: { url: image } }] }], visionRequest: true });
  let body = JSON.parse(String(sentInit?.body));
  check(sentUrl === 'https://api.anthropic.com/v1/messages' && body.system.includes('Private system instruction') && body.messages.length === 1 && body.messages[0].role === 'user', 'Claude system instruction and native Messages endpoint');
  check(body.messages[0].content[1].source.type === 'base64' && body.messages[0].content[1].source.media_type === 'image/png', 'Claude image conversion uses native source shape');
  check(new Headers(sentInit?.headers).get('x-api-key') === 'isolated-key' && new Headers(sentInit?.headers).get('anthropic-version') === '2023-06-01', 'Claude native authentication/version headers');
  check(claude.content === '{"status":"ready"}' && claude.usage?.inputTokens === 17, 'Claude JSON remains intact and thinking is hidden; cache tokens counted');
  window.fetch = (async (input, init) => {
    sentUrl = String(input); sentInit = init;
    return response({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: '看到了' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 14, candidatesTokenCount: 2, thoughtsTokenCount: 3 } });
  }) as typeof fetch;
  const gemini = await llmChat({ provider: 'gemini', model: 'gemini-3.8-flash', apiKey: 'isolated-key', jsonMode: true, messages: [{ role: 'system', content: 'System' }, { role: 'assistant', content: 'Hi' }, { role: 'user', content: [{ type: 'text', text: 'Image' }, { type: 'image_url', image_url: { url: image } }] }] });
  body = JSON.parse(String(sentInit?.body));
  check(sentUrl.endsWith('/models/gemini-3.8-flash:generateContent') && !sentUrl.includes('isolated-key') && new Headers(sentInit?.headers).get('x-goog-api-key') === 'isolated-key', 'Gemini native URL and key header avoid credential in URL');
  check(body.systemInstruction.parts[0].text === 'System' && body.contents[0].role === 'model' && body.contents[1].parts[1].inlineData.data === 'aGVsbG8=', 'Gemini system, model role and inline image conversion');
  check(body.generationConfig.responseMimeType === 'application/json' && gemini.content === '看到了' && gemini.truncated === true && gemini.usage?.outputTokens === 5, 'Gemini JSON MIME, visible output, truncation and reasoning token accounting');
  window.fetch = (async () => response({ promptFeedback: { blockReason: 'SAFETY' } })) as typeof fetch;
  await rejects(() => llmChat({ provider: 'gemini', model: 'gemini-3.8-flash', apiKey: 'isolated-key', messages }), 'model:blocked', 'Gemini refusal is a truthful error');
  const nativeStreams: Array<{ provider: ProviderId; model: string; frames: string; input: number; output: number }> = [
    { provider: 'anthropic', model: 'claude-sonnet-5-5', input: 12, output: 2, frames: sse({ type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 7, output_tokens: 0 } } }) + sse({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }) + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }) + sse({ type: 'message_stop' }) },
    { provider: 'gemini', model: 'gemini-3.8-flash', input: 9, output: 4, frames: sse({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: '你' }] } }] }) + sse({ candidates: [{ content: { parts: [{ text: '好' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, thoughtsTokenCount: 2 } }) },
  ];
  for (const fixture of nativeStreams) {
    const deltas: string[] = [];
    window.fetch = (async (input, init) => {
      sentUrl = String(input); sentInit = init;
      const bytes = encoder.encode(fixture.frames);
      return new Response(new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7)); controller.close(); } }));
    }) as typeof fetch;
    const result = await llmChatStream({ provider: fixture.provider, model: fixture.model, apiKey: 'isolated-key', messages, onDelta: all => deltas.push(all) });
    check(result.content === '你好' && !result.interrupted && result.usage?.inputTokens === fixture.input && result.usage?.outputTokens === fixture.output && deltas.at(-1) === '你好', `${fixture.provider} streams fragmented UTF-8 without exposing thinking`);
    check(fixture.provider === 'gemini' ? sentUrl.endsWith(':streamGenerateContent?alt=sse') : JSON.parse(String(sentInit?.body)).stream === true, `${fixture.provider} uses genuine native streaming protocol`);
    window.fetch = (async () => bodyless(fixture.frames)) as typeof fetch;
    check((await llmChatStream({ provider: fixture.provider, model: fixture.model, apiKey: 'isolated-key', messages, onDelta: () => undefined })).content === '你好', `${fixture.provider} handles bodyless mobile HTTP bridge`);
  }
  window.fetch = (async () => response({ choices: [{ message: { content: '<think>hidden reasoning</think>Visible' }, finish_reason: 'stop' }] })) as typeof fetch;
  check((await llmChat({ provider: 'minimax', model: 'MiniMax-M2.7', apiKey: 'isolated-key', messages })).content === 'Visible', 'MiniMax inline reasoning never becomes chat text');
  window.fetch = (async () => bodyless(sse({ choices: [{ delta: { content: '<thi' } }] }) + sse({ choices: [{ delta: { content: 'nk>hidden</think>Visible' }, finish_reason: 'stop' }] }))) as typeof fetch;
  const visible: string[] = [];
  check((await llmChatStream({ provider: 'minimax', model: 'MiniMax-M2.7', apiKey: 'isolated-key', messages, onDelta: all => visible.push(all) })).content === 'Visible' && visible.join('|') === 'Visible', 'split MiniMax thinking tags remain hidden throughout streaming');

  window.fetch = (async () => bodyless(sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial' } }) + sse({ type: 'error', error: { type: 'overloaded_error' } }))) as typeof fetch;
  const partial = await llmChatStream({ provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'isolated-key', messages, onDelta: () => undefined });
  check(partial.content === 'Partial' && partial.interrupted && partial.truncated, 'native SSE failure after output returns real partial text');
  window.fetch = (async () => bodyless(sse({ type: 'error', error: { type: 'authentication_error' } }))) as typeof fetch;
  await rejects(() => llmChatStream({ provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'isolated-key', messages, onDelta: () => undefined }), 'auth:invalid_key', 'native SSE auth error before output is not hidden');
  for (const [status, error] of [[401, 'auth:invalid_key'], [402, 'billing:insufficient'], [429, 'rate:limited'], [404, 'model:unavailable'], [400, 'request:invalid'], [500, 'server:error']] as const) {
    window.fetch = (async () => response({}, status)) as typeof fetch;
    await rejects(() => llmChat({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'isolated-key', messages }), error, `HTTP ${status} normalized`);
  }
  let requestCount = 0;
  window.fetch = (async () => { requestCount += 1; return response(openAiResult); }) as typeof fetch;
  saveProviderConfig('qwen', { enabled: false });
  await rejects(() => llmChat({ provider: 'qwen', model: 'qwen3.7-plus', apiKey: 'isolated-key', messages }), 'provider:disabled', 'disabled provider is rejected by actual transport');
  check(requestCount === 0, 'disabled provider makes zero network requests');
  saveProviderConfig('qwen', { enabled: true });
  await rejects(() => llmChat({ provider: 'doubao', model: 'ep-private-exact-id', apiKey: 'isolated-key', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }] }), 'model:vision_unsupported', 'unknown image capability cannot silently transfer to another provider');
  check(requestCount === 0, 'unsupported image request never sends private image');
  window.fetch = (async (_input, init) => new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true }); } }))) as typeof fetch;
  await rejects(() => llmChatStream({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'isolated-key', messages, timeoutMs: 15, onDelta: () => undefined }), 'timeout', 'timeout includes waiting for response body');
  window.fetch = (async (_input, init) => new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(sse({ choices: [{ delta: { content: 'Started' } }] }))); init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true }); } }))) as typeof fetch;
  const timedPartial = await llmChatStream({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'isolated-key', messages, timeoutMs: 15, onDelta: () => undefined });
  check(timedPartial.content === 'Started' && timedPartial.interrupted, 'timeout after first output preserves partial content');
  const abort = new AbortController();
  window.fetch = (async (_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }); })) as typeof fetch;
  const cancelled = llmChat({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'isolated-key', messages, signal: abort.signal });
  abort.abort(new Error('explicit cancellation'));
  await rejects(() => cancelled, 'explicit cancellation', 'external cancellation reason is preserved');

  let discoveryCalls = 0;
  window.fetch = (async input => {
    discoveryCalls += 1;
    if (String(input).includes('pageToken=')) return response({ models: [{ name: 'models/gemini-3.8-flash', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] }] });
    return response({ models: [{ name: 'models/embed-only', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next-page' });
  }) as typeof fetch;
  const discovered = await fetchProviderModels('gemini', { apiKey: 'isolated-key' });
  check(discoveryCalls === 2 && discovered.length === 1 && discovered[0].id === 'gemini-3.8-flash' && discovered[0].vision === true, 'Gemini discovery paginates, strips native prefix and filters embedding models');
  window.fetch = (async input => {
    discoveryCalls += 1;
    return String(input).includes('after_id=') ? response({ data: [{ id: 'new-exact-claude-id', display_name: 'Claude Example' }], has_more: false }) : response({ data: [{ id: 'claude-sonnet-5-5' }], has_more: true, last_id: 'claude-sonnet-5-5' });
  }) as typeof fetch;
  check((await fetchProviderModels('anthropic', { apiKey: 'isolated-key' })).length === 2, 'Claude native catalog paginates');
  window.fetch = (async input => String(input).endsWith('/key') ? response({}, 401) : response({ data: [{ id: 'provider/model' }] })) as typeof fetch;
  await rejects(() => validateProviderConnection('openrouter', { apiKey: 'invalid-isolated-key' }), 'auth:invalid_key', 'public OpenRouter catalog cannot validate a bad key');
  await rejects(() => fetchProviderModels('doubao', { apiKey: 'isolated-key' }), 'models:unsupported', 'Ark asks for deployment ID instead of pretending to discover');

  // Exercise the real private-chat entry point with encrypted Claude credential.
  let chatCalls = 0;
  window.fetch = (async input => { chatCalls += 1; check(String(input).includes('api.anthropic.com'), 'chat never leaks Claude text to DeepSeek'); return response({ content: [{ type: 'text', text: '{"actions":[]}' }], stop_reason: 'end_turn' }); }) as typeof fetch;
  const chat = await sendMessage({ apiKey: '', systemPrompt: 'Return assistant actions.', message: 'Hello', history: [], sessionModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' }, structuredOutput: true });
  check(chat.content === '{"actions":[]}' && chatCalls === 1, 'assistant structured output flows through chosen native provider');
  saveProviderConfig('anthropic', { enabled: false });
  await rejects(() => sendMessage({ apiKey: '', systemPrompt: 'System', message: 'Hi', history: [], sessionModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' } }), 'provider:disabled', 'private chat respects disabled provider');
  saveProviderConfig('anthropic', { enabled: true });
  chatCalls = 0;
  window.fetch = (async input => { chatCalls += 1; check(String(input).includes('api.anthropic.com'), 'recovery remains on selected provider'); return chatCalls === 1 ? response({}, 500) : response({ content: [{ type: 'text', text: 'Recovered' }], stop_reason: 'end_turn' }); }) as typeof fetch;
  check((await sendMessage({ apiKey: '', systemPrompt: 'System', message: 'Hi', history: [], sessionModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })).content === 'Recovered' && chatCalls === 2, 'bounded chat recovery retains provider and model');
  window.fetch = (async () => response(openAiResult)) as typeof fetch;
  check((await sendMessage({ apiKey: '', systemPrompt: 'System', message: 'Hi', history: [], sessionModel: { provider: 'custom', model: 'same-model' } })).content === 'Ready', 'keyless local model works through real private-chat entry point');
  await runProviderRoutingChecks(check);
  window.fetch = (() => { throw new Error('Unexpected paid network call'); }) as typeof fetch;
  await report('/result', { method: 'POST', body: `PASS ${count} provider protocol assertions\nALL PASS` });
}
run().catch(async error => { await report('/result', { method: 'POST', body: `FAIL ${error.stack ?? error}\n1 FAILED` }); });
