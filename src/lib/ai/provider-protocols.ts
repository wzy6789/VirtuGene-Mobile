import type { LLMChatParams, LLMChatResult, SseReadOutcome } from './llm';
import type { ProviderId, ProviderProtocol } from './provider-registry';
import { DEEPSEEK_MODEL_ID, deepseekGenerationOptions } from '../../../server/deepseek-policy.mjs';

type JsonObject = Record<string, any>;
const textContent = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(part => typeof part === 'string' ? part : typeof part?.text === 'string' && part?.type !== 'thinking' && !part?.thought ? part.text : '').join('') : '';
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const knownCount=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function throwForProviderStatus(status: number): never {
  if (status === 401) throw new Error('auth:invalid_key');
  if (status === 403) throw new Error('auth:forbidden');
  if (status === 402) throw new Error('billing:insufficient');
  if (status === 429) throw new Error('rate:limited');
  if (status === 404) throw new Error('model:unavailable');
  if (status === 400 || status === 422) throw new Error('request:invalid');
  throw new Error('server:error');
}
function throwResponseError(data: JsonObject): void {
  if (data.base_resp && data.base_resp.status_code !== 0) {
    if (data.base_resp.status_code === 1004) throw new Error('auth:invalid_key');
    if (data.base_resp.status_code === 1008) throw new Error('billing:insufficient');
    throw new Error('server:error');
  }
  if (!data.error) return;
  const error = data.error;
  if (typeof error.code === 'number') throwForProviderStatus(error.code);
  if (error.type === 'authentication_error' || error.code === 'invalid_api_key') throw new Error('auth:invalid_key');
  if (error.type === 'rate_limit_error' || error.code === 'rate_limit_exceeded') throw new Error('rate:limited');
  if (error.type === 'permission_error') throw new Error('auth:forbidden');
  if (error.type === 'invalid_request_error') throw new Error('request:invalid');
  throw new Error('server:error');
}
/** MiniMax M2.x returns reasoning tags inside content; those are not chat text. */
function visibleText(content: string, provider?: ProviderId): string {
  if (provider !== 'minimax') return content;
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '').replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, '');
}
export function parseProviderResponse(data: JsonObject, protocol: ProviderProtocol, provider?: ProviderId): LLMChatResult {
  throwResponseError(data);
  let content = '';
  let truncated = false;
  let usage: LLMChatResult['usage'];
  let finish: unknown;
  if (protocol === 'anthropic') {
    content = textContent(data.content);
    finish = data.stop_reason;
    truncated = finish === 'max_tokens';
    if (knownCount(data.usage?.input_tokens)&&knownCount(data.usage?.output_tokens)) usage = { inputTokens: count(data.usage.input_tokens) + count(data.usage.cache_creation_input_tokens) + count(data.usage.cache_read_input_tokens), outputTokens: count(data.usage.output_tokens) };
  } else if (protocol === 'gemini') {
    const candidate = data.candidates?.[0];
    finish = candidate?.finishReason;
    if (data.promptFeedback?.blockReason || ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'RECITATION'].includes(String(finish))) throw new Error('model:blocked');
    content = (candidate?.content?.parts ?? []).filter((part: JsonObject) => !part.thought && typeof part.text === 'string').map((part: JsonObject) => part.text).join('');
    truncated = finish === 'MAX_TOKENS';
    if (knownCount(data.usageMetadata?.promptTokenCount)&&knownCount(data.usageMetadata?.candidatesTokenCount)) usage = { inputTokens: count(data.usageMetadata.promptTokenCount), outputTokens: count(data.usageMetadata.candidatesTokenCount) + count(data.usageMetadata.thoughtsTokenCount) };
  } else {
    const choice = data.choices?.[0];
    content = visibleText(textContent(choice?.message?.content), provider);
    finish = choice?.finish_reason;
    truncated = finish === 'length';
    if (knownCount(data.usage?.prompt_tokens)&&knownCount(data.usage?.completion_tokens)) usage = { inputTokens: count(data.usage.prompt_tokens), outputTokens: count(data.usage.completion_tokens) };
  }
  // Only metadata is retained for diagnostics; never log prompts, reasoning or credentials.
  return { content, truncated, usage, ...(!content.trim() || truncated ? { rawNote: `protocol=${protocol}, finish=${String(finish ?? '?')}, empty=${!content.trim()}` } : {}) };
}
function imageSource(value: unknown): { mime: string; data: string } | { url: string } {
  const image = value && typeof value === 'object' ? (value as JsonObject).url : value;
  if (typeof image !== 'string') throw new Error('image:invalid');
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z\d+/=\s]+)$/.exec(image);
  if (match) return { mime: match[1], data: match[2].replace(/\s/g, '') };
  try { if (new URL(image).protocol === 'https:') return { url: image }; } catch { /* Fall through. */ }
  throw new Error('image:invalid');
}
function nativeParts(content: unknown, protocol: 'anthropic' | 'gemini'): JsonObject[] {
  if (typeof content === 'string') return [{ ...(protocol === 'anthropic' ? { type: 'text' } : {}), text: content || ' ' }];
  if (!Array.isArray(content)) throw new Error('request:invalid');
  return content.map(part => {
    if (typeof part === 'string' || part?.type === 'text') return { ...(protocol === 'anthropic' ? { type: 'text' } : {}), text: typeof part === 'string' ? part : part.text || ' ' };
    if (part?.type !== 'image_url') throw new Error('request:invalid');
    const image = imageSource(part.image_url);
    if (protocol === 'anthropic') {
      if ('url' in image) return { type: 'image', source: { type: 'url', url: image.url } };
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(image.mime)) throw new Error('image:invalid');
      return { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } };
    }
    // Gemini's arbitrary HTTPS image URLs are not uploaded File API resources.
    if ('url' in image) throw new Error('image:invalid');
    return { inlineData: { mimeType: image.mime, data: image.data } };
  });
}
const JSON_INSTRUCTION = 'Return only one complete valid JSON object. Do not include Markdown fences, explanation, or thinking text.';
export function providerHeaders(protocol: ProviderProtocol, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (protocol === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    // Browser BYOK is explicit in settings; matches Anthropic's SDK opt-in header.
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (protocol === 'gemini') headers['x-goog-api-key'] = apiKey;
  else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}
export function buildProviderRequest(params: LLMChatParams, protocol: ProviderProtocol, baseUrl: string, stream = false): { url: string; init: RequestInit } {
  const limit = Math.max(1, Math.floor(params.maxTokens ?? 1000));
  let body: JsonObject;
  let url: string;
  if (protocol === 'openai') {
    const isOpenAiReasoner = params.provider === 'openai' && /^(?:o\d|gpt-[5-9])/.test(params.model);
    const isModernMiniMax = params.provider === 'minimax';
    body = { model: params.model, messages: params.messages, [isOpenAiReasoner || isModernMiniMax ? 'max_completion_tokens' : 'max_tokens']: limit };
    if (params.provider === 'deepseek') {
      body.model = DEEPSEEK_MODEL_ID;
      Object.assign(body, deepseekGenerationOptions(params));
    } else if (params.provider === 'mimo') body.thinking = { type: 'disabled' };
    else if (isOpenAiReasoner) {
      body.reasoning_effort = /^gpt-6-luna/.test(params.model) && params.disableThinking ? 'none' : 'low';
    } else if (params.provider !== 'moonshot' || !/^kimi-k[23]/.test(params.model)) {
      body.temperature = params.temperature ?? 0.8;
    }
    if (params.provider === 'qwen' && params.disableThinking) body.enable_thinking = false;
    if (params.provider === 'zhipu' && params.disableThinking && /^(?:glm-[45])/.test(params.model)) body.thinking = { type: 'disabled' };
    if (params.provider === 'doubao' && params.disableThinking) body.thinking = { type: 'disabled' };
    if (params.provider === 'minimax' && /^MiniMax-M3$/.test(params.model) && params.disableThinking) body.thinking = { type: 'disabled' };
    if (params.jsonMode && !['mimo', 'minimax'].includes(params.provider)) body.response_format = { type: 'json_object' };
    else if (params.jsonMode) body.messages = [{ role: 'system', content: JSON_INSTRUCTION }, ...params.messages];
    if (stream) {
      body.stream = true;
      if (['deepseek', 'openai', 'minimax', 'openrouter', 'groq', 'xai'].includes(params.provider)) body.stream_options = { include_usage: true };
    }
    url = `${baseUrl}/chat/completions`;
  } else {
    const system = params.messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => textContent(message.content)).join('\n\n');
    const messages = params.messages.filter(message => message.role !== 'system' && message.role !== 'developer');
    if (messages.some(message => message.role !== 'user' && message.role !== 'assistant')) throw new Error('request:invalid');
    if (protocol === 'anthropic') {
      body = { model: params.model, max_tokens: limit, messages: messages.map(message => ({ role: message.role, content: nativeParts(message.content, 'anthropic') })) };
      if (system || params.jsonMode) body.system = [system, params.jsonMode ? JSON_INSTRUCTION : ''].filter(Boolean).join('\n\n');
      // Modern adaptive-thinking Claude models reject temperature; omit it for portability.
      if (stream) body.stream = true;
      url = `${baseUrl}/messages`;
    } else {
      body = { contents: messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: nativeParts(message.content, 'gemini') })), generationConfig: { maxOutputTokens: limit, temperature: params.temperature ?? 0.8 } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (params.jsonMode) body.generationConfig.responseMimeType = 'application/json';
      if (params.disableThinking && /^gemini-2\.5-flash(?:-|$)/.test(params.model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const model = params.model.replace(/^models\//, '');
      if (!model || /[?#]/.test(model)) throw new Error('config:invalid_model');
      url = `${baseUrl}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    }
  }
  return { url, init: { method: 'POST', headers: providerHeaders(protocol, params.apiKey), body: JSON.stringify(body) } };
}

/** Shared framing handles native Claude/Gemini and OpenAI SSE, including fragmented UTF-8. */
export async function readProviderSseResponse(response: Response, onDelta: (accumulated: string, delta: string) => void, protocol: ProviderProtocol = 'openai', provider?: ProviderId): Promise<SseReadOutcome> {
  // Some compatible servers ignore stream=true and send one normal JSON body.
  // Parse it once rather than retrying a request the provider already completed.
  if (response.headers?.get('content-type')?.includes('application/json')) {
    const result = parseProviderResponse(await response.json(), protocol, provider);
    if (result.content) onDelta(result.content, result.content);
    return { content: result.content, truncated: result.truncated === true, interrupted: false, usage: result.usage };
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let rawContent = '';
  let nativeInputTokens:number|undefined;
  let completed = false;
  let failed = false;
  let truncated = false;
  let usage: SseReadOutcome['usage'];
  const emit = (delta: string) => {
    if (!delta) return;
    rawContent += delta;
    const next = visibleText(rawContent, provider);
    const visibleDelta = next.slice(content.length);
    content = next;
    if (visibleDelta) onDelta(content, visibleDelta);
  };
  const consume = (event: string) => {
    const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n').trim();
    if (!payload) return;
    if (payload === '[DONE]') { completed = true; return; }
    let data: JsonObject;
    try { data = JSON.parse(payload); } catch { return; }
    throwResponseError(data);
    if (protocol === 'anthropic') {
      if (data.type === 'content_block_start' && data.content_block?.type === 'text') emit(data.content_block.text ?? '');
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') emit(data.delta.text ?? '');
      if (data.type === 'message_start' && data.message?.usage) {
        const counts = data.message.usage;
        if(knownCount(counts.input_tokens))nativeInputTokens=count(counts.input_tokens)+count(counts.cache_creation_input_tokens)+count(counts.cache_read_input_tokens);
        if(nativeInputTokens!==undefined&&knownCount(counts.output_tokens))usage={inputTokens:nativeInputTokens,outputTokens:count(counts.output_tokens)};
      }
      if (data.type === 'message_delta') {
        if(nativeInputTokens!==undefined&&knownCount(data.usage?.output_tokens))usage={inputTokens:nativeInputTokens,outputTokens:count(data.usage.output_tokens)};
        if (data.delta?.stop_reason) completed = true;
        if (data.delta?.stop_reason === 'max_tokens') truncated = true;
      }
      if (data.type === 'message_stop') completed = true;
    } else if (protocol === 'gemini') {
      const result = parseProviderResponse(data, protocol, provider);
      emit(result.content);
      if (result.usage) usage = result.usage;
      if (data.candidates?.[0]?.finishReason) completed = true;
      if (result.truncated) truncated = true;
    } else {
      emit(textContent(data.choices?.[0]?.delta?.content ?? (data.safetyIntervention === true ? data.content : undefined)));
      const finish = data.choices?.[0]?.finish_reason;
      if (finish) completed = true;
      if (finish === 'length') truncated = true;
      if (knownCount(data.usage?.prompt_tokens)&&knownCount(data.usage?.completion_tokens)) usage = { inputTokens: count(data.usage.prompt_tokens), outputTokens: count(data.usage.completion_tokens) };
    }
  };
  const flush = () => {
    buffer = buffer.replace(/\r\n/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2); index = buffer.indexOf('\n\n'); }
  };
  if (!response.body) {
    try {
      const raw = await response.text();
      if (raw.trimStart().startsWith('{')) {
        const result = parseProviderResponse(JSON.parse(raw), protocol, provider);
        emit(result.content);
        truncated = result.truncated === true;
        usage = result.usage;
        completed = true;
      } else { buffer = raw; flush(); if (buffer.trim()) consume(buffer); }
    } catch (error) {
      failed = true;
      if (!content) throw error;
    }
  } else {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        flush();
      }
      buffer += decoder.decode();
      flush();
      if (buffer.trim()) consume(buffer);
    } catch (error) {
      failed = true;
      try { await reader.cancel(); } catch { /* A failed stream may already be closed. */ }
      if (!content) throw error;
    } finally { reader.releaseLock(); }
  }
  return { content, truncated, interrupted: content.length > 0 && (failed || !completed), usage };
}
