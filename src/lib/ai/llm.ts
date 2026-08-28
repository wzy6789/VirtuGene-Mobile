/**
 * 统一 LLM 客户端（多模型支持，3.1.0）：
 * - Provider 注册表：DeepSeek / 千问 Qwen / 小米 MiMo（均 OpenAI 兼容，端点已查证）
 * - 统一 chat 调用 + 各 provider 参数适配：
 *   · DeepSeek：思考模式按场景（视觉轮次 disabled / 文字轮次 enabled，用户拍板）；支持 temperature
 *   · 千问：OpenAI 兼容，传 temperature
 *   · MiMo：思考模式默认开启、不支持自定义 temperature/top_p → 不传
 * - Key：deepseek 用登录账号内存 key（auth-store）；qwen/mimo 用设备加密存储（persistSecret）
 * - 模型选择：角色指定 > 全局默认 > deepseek-v4-flash
 */
import { fetchWithTimeout, isTimeoutError } from './http';
import { useAuthStore } from '../../store/auth-store';
import { useSettingsStore } from '../../store/settings-store';
import { loadSecret } from '../api-key-storage';

export type ProviderId = 'deepseek' | 'qwen' | 'mimo';

export interface LLMModel {
  id: string;
  label: string;
  provider: ProviderId;
  /** 支持图片输入（第一版仅 deepseek 视觉模型启用图片块；MiMo 多模态留待后续） */
  vision?: boolean;
}

export const LLM_PROVIDERS: Record<ProviderId, { id: ProviderId; name: string; baseUrl: string; keyStorage?: string }> = {
  deepseek: { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  qwen: { id: 'qwen', name: '千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyStorage: 'qwen-key' },
  mimo: { id: 'mimo', name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', keyStorage: 'mimo-key' },
};

export const LLM_MODELS: LLMModel[] = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（日常）', provider: 'deepseek' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（强推理）', provider: 'deepseek' },
  { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek 识图（视觉）', provider: 'deepseek', vision: true },
  { id: 'qwen3.7-plus', label: '千问 3.7 Plus', provider: 'qwen' },
  { id: 'mimo-v2.5', label: '小米 MiMo V2.5', provider: 'mimo' },
];

export const DEFAULT_MODEL_ID = 'deepseek-v4-flash';

export function findModel(id?: string): LLMModel | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

/** 解析实际使用的模型：角色指定 > 全局默认 > deepseek-v4-flash */
export function resolveModel(character?: { model?: { provider: string; model: string } } | null): LLMModel {
  if (character?.model) {
    const m = findModel(character.model.model);
    if (m) return m;
  }
  const def = useSettingsStore.getState().defaultModel;
  const m = def ? findModel(def.model) : undefined;
  return m ?? findModel(DEFAULT_MODEL_ID)!;
}

/** 获取 provider 的 API key（deepseek=登录账号内存 key；qwen/mimo=设备加密存储） */
export async function getProviderKey(provider: ProviderId): Promise<string | null> {
  if (provider === 'deepseek') return useAuthStore.getState().apiKey;
  const name = LLM_PROVIDERS[provider].keyStorage;
  return name ? loadSecret(name) : null;
}

export interface LLMChatParams {
  provider: ProviderId;
  model: string;
  apiKey: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  /** DeepSeek 视觉轮次关闭思考（识图快）；文字轮次保持思考（质量优先） */
  visionRequest?: boolean;
  timeoutMs?: number;
}

export interface LLMChatResult {
  content: string;
  truncated?: boolean;
}

/** 统一 chat 调用（OpenAI 兼容）；错误码与现有体系一致 */
export async function llmChat(params: LLMChatParams): Promise<LLMChatResult> {
  const provider = LLM_PROVIDERS[params.provider];
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    max_tokens: 1000,
  };
  if (params.provider === 'deepseek') {
    body.temperature = params.temperature ?? 0.8;
    body.thinking = params.visionRequest ? { type: 'disabled' } : { type: 'enabled' };
  } else if (params.provider === 'qwen') {
    body.temperature = params.temperature ?? 0.8;
  }
  // mimo：思考模式默认开启，不支持自定义 temperature/top_p → 不传任何采样参数

  try {
    const response = await fetchWithTimeout(
      `${provider.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      params.timeoutMs ?? 60_000,
    );

    if (response.ok) {
      const data = await response.json();
      const choice = data.choices?.[0];
      const content: string = choice?.message?.content ?? '';
      const truncated = choice?.finish_reason === 'length';
      return { content, truncated };
    }

    if (response.status === 401) {
      throw new Error('auth:invalid_key');
    }
    if (response.status === 402) {
      throw new Error('billing:insufficient');
    }
    if (response.status === 429) {
      throw new Error('rate:limited');
    }
    throw new Error('server:error');
  } catch (err) {
    if (isTimeoutError(err)) throw new Error('timeout');
    if (err instanceof Error) throw err;
    throw new Error('server:error');
  }
}
