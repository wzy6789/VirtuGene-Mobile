import { getProviderKey, llmChat, resolveModel, type LLMChatParams, type LLMChatResult } from './llm';
import { gatewayChat, hasAiGatewayAccess } from './gateway';
import { getProviderConfig, providerRequiresKey } from './provider-config';
import type { LLMModel } from './provider-registry';

export function taskUsesGateway(apiKey: string): boolean {
  return resolveModel().provider === 'deepseek' && getProviderConfig('deepseek').enabled && !apiKey.trim() && hasAiGatewayAccess();
}

function textAndImage(content: unknown): { content: string; image?: string } {
  if (typeof content === 'string') return { content };
  if (!Array.isArray(content)) return { content: '' };
  return {
    content: content.filter(block => block?.type === 'text').map(block => String(block.text ?? '')).join('\n'),
    image: content.find(block => block?.type === 'image_url')?.image_url?.url,
  };
}

/** All auxiliary text tasks honor the default provider and exact configured model ID. */
export async function taskChat(params: Omit<LLMChatParams, 'provider' | 'model'>, selected: LLMModel = resolveModel()): Promise<LLMChatResult> {
  if (!getProviderConfig(selected.provider).enabled) throw new Error('provider:disabled');
  const apiKey = selected.provider === 'deepseek' ? params.apiKey || await getProviderKey('deepseek') || '' : await getProviderKey(selected.provider) || '';
  if (!apiKey && selected.provider === 'deepseek' && hasAiGatewayAccess()) {
    const systemPrompt = params.messages.filter(message => message.role === 'system').map(message => textAndImage(message.content).content).join('\n\n');
    const turns = params.messages.filter(message => message.role !== 'system');
    const last = turns[turns.length - 1];
    const input = textAndImage(last?.content);
    const result = await gatewayChat({
      apiKey: '', systemPrompt, message: input.content, image: input.image,
      history: turns.slice(0, -1).map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', ...textAndImage(message.content) })),
      sessionModel: { provider: selected.provider, model: selected.id },
      temperature: params.temperature, timeoutMs: params.timeoutMs,
    });
    return { ...result, content: result.content };
  }
  if (!apiKey && providerRequiresKey(selected.provider)) throw new Error('auth:invalid_key');
  return llmChat({ ...params, apiKey, provider: selected.provider, model: selected.id });
}
