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
  /**
   * 单价（元 / 百万 token，输入/输出）。**预估参考值**——服务商价格随时可能调整
   * （DeepSeek 2026-08 涨价并引入峰谷定价），仅用于 App 内费用估算，以服务商账单为准。
   */
  pricing?: { in: number; out: number };
}

export const LLM_PROVIDERS: Record<ProviderId, { id: ProviderId; name: string; baseUrl: string; keyStorage?: string }> = {
  deepseek: { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  qwen: { id: 'qwen', name: '千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyStorage: 'qwen-key' },
  mimo: { id: 'mimo', name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', keyStorage: 'mimo-key' },
};

export const LLM_MODELS: LLMModel[] = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（日常）', provider: 'deepseek', pricing: { in: 2, out: 8 } },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（强推理）', provider: 'deepseek', pricing: { in: 9, out: 30 } },
  { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek 识图（视觉）', provider: 'deepseek', vision: true, pricing: { in: 2, out: 8 } },
  { id: 'qwen3.7-plus', label: '千问 3.7 Plus', provider: 'qwen', pricing: { in: 4, out: 16 } },
  { id: 'mimo-v2.5', label: '小米 MiMo V2.5', provider: 'mimo', pricing: { in: 2, out: 8 } },
];

export const DEFAULT_MODEL_ID = 'deepseek-v4-flash';

export function findModel(id?: string): LLMModel | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

/** 估算一次调用的费用（元）：输入/输出 token × 单价 ÷ 1e6 */
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const p = findModel(modelId)?.pricing ?? { in: 0, out: 0 };
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/** 解析实际使用的模型：会话锁定 > 角色指定 > 全局默认 > deepseek-v4-flash */
export function resolveModel(
  character?: { model?: { provider: string; model: string } } | null,
  sessionModel?: { provider: string; model: string } | null,
): LLMModel {
  if (sessionModel?.model) {
    const m = findModel(sessionModel.model);
    if (m) return m;
  }
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
  /** 显式关闭思考（群聊结构化输出等场景：防 JSON 被思维链截断 + 提速） */
  disableThinking?: boolean;
  /** 强制 JSON 输出（DeepSeek/Qwen 用 response_format: json_object；群聊等结构化场景） */
  jsonMode?: boolean;
  /** 输出 token 上限（默认 1000；群聊等大输出场景可调大防截断） */
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMChatResult {
  content: string;
  truncated?: boolean;
  /** token 用量（服务商返回；用于费用统计） */
  usage?: { inputTokens: number; outputTokens: number };
  /** 响应结构摘要（仅空内容/截断时带；用于把服务商实际返回带进报错，不依赖 logcat 定位） */
  rawNote?: string;
}

/** 统一 chat 调用（OpenAI 兼容）；错误码与现有体系一致 */
export async function llmChat(params: LLMChatParams): Promise<LLMChatResult> {
  const provider = LLM_PROVIDERS[params.provider];
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens ?? 1000,
  };
  if (params.provider === 'deepseek') {
    body.temperature = params.temperature ?? 0.8;
    body.thinking = params.visionRequest || params.disableThinking ? { type: 'disabled' } : { type: 'enabled' };
  } else if (params.provider === 'qwen') {
    body.temperature = params.temperature ?? 0.8;
  } else if (params.provider === 'mimo') {
    // MiMo 思考模式默认开启、不支持自定义 temperature/top_p → 不传采样参数；
    // 用户要求关思考提速（2026-08-30）：显式 thinking disabled
    body.thinking = { type: 'disabled' };
  }
  // 强制 JSON 输出（DeepSeek/Qwen 支持 response_format；群聊等结构化场景防散文本）
  if (params.jsonMode && (params.provider === 'deepseek' || params.provider === 'qwen')) {
    body.response_format = { type: 'json_object' };
  }

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
      // 兼容 content 为字符串 / 多段数组 / null 三种形态，避免"看起来像空内容"掩盖真实输出
      let content = '';
      const c = choice?.message?.content;
      if (typeof c === 'string') content = c;
      else if (Array.isArray(c)) content = c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
      const truncated = choice?.finish_reason === 'length';
      const usage = data.usage
        ? {
            inputTokens: Number(data.usage.prompt_tokens ?? 0),
            outputTokens: Number(data.usage.completion_tokens ?? 0),
          }
        : undefined;

      // 关键诊断：服务商返回空内容或截断时，把原始响应打到 console（adb logcat 可查），
      // 用于区分"模型真没输出" vs "内容在别的字段(reasoning_content/多段数组)" vs "200 错误体"。
      if (!content.trim() || truncated) {
        const errorField = data.error ? JSON.stringify(data.error).slice(0, 160) : '无';
        const note = `choices=${data.choices?.length ?? 0}, finish=${choice?.finish_reason ?? '?'}, reasoning=${choice?.message?.reasoning_content ? '有' : '无'}, error=${errorField}`;
        console.warn(`[llm] 原始响应(空/截断:${truncated}): ${note}`, JSON.stringify(data).slice(0, 800));
        return { content, truncated, usage, rawNote: note };
      }
      return { content, truncated, usage };
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
