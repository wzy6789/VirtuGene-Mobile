/** Provider protocols and examples verified against official documentation, 2026-10-02.
 * Account availability is discovered at runtime; presets are never a promise of access. */
export type ProviderId = 'deepseek' | 'qwen' | 'mimo' | 'openai' | 'anthropic' | 'gemini'
  | 'moonshot' | 'zhipu' | 'doubao' | 'minimax' | 'xai' | 'siliconflow' | 'groq' | 'openrouter' | 'custom';
export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini';
export interface LLMModel {
  id: string;
  label: string;
  provider: ProviderId;
  /** Only enable when the selected model actually accepts image input. */
  vision?: boolean;
  pricing?: { in: number; out: number };
}
export interface LLMProvider {
  id: ProviderId;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  keyStorage?: string;
  docsUrl: string;
  requiresKey: boolean;
  modelDiscovery: boolean;
  modelPlaceholder: string;
}
const compatible = (id: ProviderId, name: string, baseUrl: string, docsUrl: string, modelPlaceholder = '填写平台提供的模型 ID', modelDiscovery = true): LLMProvider =>
  ({ id, name, baseUrl, docsUrl, modelPlaceholder, modelDiscovery, protocol: 'openai', keyStorage: `${id}-key`, requiresKey: true });
export const LLM_PROVIDERS: Record<ProviderId, LLMProvider> = {
  deepseek: { ...compatible('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'https://api-docs.deepseek.com/', 'deepseek-v4-flash'), keyStorage: undefined },
  qwen: compatible('qwen', '千问 Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope', '填写百炼模型 ID'),
  mimo: compatible('mimo', '小米 MiMo', 'https://api.xiaomimimo.com/v1', 'https://platform.xiaomimimo.com/docs', 'mimo-v2.5'),
  openai: compatible('openai', 'OpenAI', 'https://api.openai.com/v1', 'https://developers.openai.com/api/docs/models', 'gpt-6-luna'),
  anthropic: { ...compatible('anthropic', 'Anthropic Claude', 'https://api.anthropic.com/v1', 'https://platform.claude.com/docs/en/api/messages/create', 'claude-sonnet-5-5'), protocol: 'anthropic' },
  gemini: { ...compatible('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'https://ai.google.dev/api/generate-content', 'gemini-3.8-flash'), protocol: 'gemini' },
  moonshot: compatible('moonshot', 'Kimi · 月之暗面', 'https://api.moonshot.cn/v1', 'https://platform.moonshot.cn/docs/api/chat', 'kimi-k3'),
  zhipu: compatible('zhipu', '智谱 GLM', 'https://open.bigmodel.cn/api/paas/v4', 'https://docs.bigmodel.cn/', '填写智谱模型 ID', false),
  doubao: compatible('doubao', '豆包 · 火山方舟', 'https://ark.cn-beijing.volces.com/api/v3', 'https://www.volcengine.com/docs/82379/1298454', '模型 ID 或 ep- 开头的推理接入点', false),
  minimax: compatible('minimax', 'MiniMax', 'https://api.minimax.io/v1', 'https://platform.minimax.io/docs/api-reference/text-openai-api', 'MiniMax-M2.7', false),
  xai: compatible('xai', 'xAI · Grok', 'https://api.x.ai/v1', 'https://docs.x.ai/developers/rest-api-reference/inference/chat', '填写 Grok 模型 ID'),
  siliconflow: compatible('siliconflow', '硅基流动 SiliconFlow', 'https://api.siliconflow.cn/v1', 'https://docs.siliconflow.cn/docs/userguide/quickstart', '平台完整模型 ID，含组织名称'),
  groq: compatible('groq', 'Groq', 'https://api.groq.com/openai/v1', 'https://console.groq.com/docs/openai'),
  openrouter: compatible('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion', '组织/模型 ID'),
  custom: { ...compatible('custom', '自定义 · OpenAI 兼容', 'http://127.0.0.1:11434/v1', 'https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions', '服务器上的完整模型 ID'), requiresKey: false },
};
export const DEFAULT_MODEL_ID = 'deepseek-v4-flash';
export const LLM_MODELS: LLMModel[] = [
  // Preserve existing selections and estimates; provider bills remain authoritative.
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（日常）', provider: 'deepseek', pricing: { in: 2, out: 8 } },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（强推理）', provider: 'deepseek', pricing: { in: 9, out: 30 } },
  { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek 识图（视觉）', provider: 'deepseek', vision: true, pricing: { in: 2, out: 8 } },
  { id: 'qwen3.7-plus', label: '千问 3.7 Plus', provider: 'qwen', pricing: { in: 4, out: 16 } },
  { id: 'mimo-v2.5', label: '小米 MiMo V2.5', provider: 'mimo', pricing: { in: 2, out: 8 } },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'openai', vision: true },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', provider: 'openai', vision: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', vision: true },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini', vision: true },
  { id: 'kimi-k3', label: 'Kimi K3', provider: 'moonshot', vision: true },
  { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', provider: 'minimax' },
];
export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(LLM_PROVIDERS, value);
}
