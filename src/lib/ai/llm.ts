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

/** 构建 OpenAI 兼容请求体（普通与流式调用共用，保证参数适配一致） */
function buildChatBody(params: LLMChatParams): Record<string, unknown> {
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
  return body;
}

/** 把非 200 状态码映射成统一错误码（普通与流式调用共用） */
function throwForStatus(status: number): never {
  if (status === 401) throw new Error('auth:invalid_key');
  if (status === 402) throw new Error('billing:insufficient');
  if (status === 429) throw new Error('rate:limited');
  throw new Error('server:error');
}

/** 统一 chat 调用（OpenAI 兼容）；错误码与现有体系一致 */
export async function llmChat(params: LLMChatParams): Promise<LLMChatResult> {
  const provider = LLM_PROVIDERS[params.provider];
  const body = buildChatBody(params);

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

    throwForStatus(response.status);
  } catch (err) {
    if (isTimeoutError(err)) throw new Error('timeout');
    if (err instanceof Error) throw err;
    throw new Error('server:error');
  }
}

/* ------------------------------------------------------------------ *
 * 流式调用（仅星域使用；聊天界面保持非流式，不改动 llmChat）
 *
 * - SSE（stream: true）逐段解析，onDelta 收到**累计正文**与本次增量；
 * - 环境不支持 ReadableStream（如被 CapacitorHttp 接管的 fetch）时自动回退整读；
 * - 错误码与 llmChat 完全一致，调用方无需区分。
 * - 断线纪律：**正文已经开始流出后中断，绝不整轮重发**——把已生成的部分
 *   原样交还给调用方并标记 truncated/interrupted；只有在**还没收到任何正文**
 *   时失败才抛错，交给上层按既定规则回退（世界出口回退非流式重发一次）。
 * ------------------------------------------------------------------ */
export interface LLMStreamParams extends LLMChatParams {
  /** 每收到一段增量回调一次：accumulated 为截至目前全文，delta 为本段新增 */
  onDelta: (accumulated: string, delta: string) => void;
}

export interface LLMStreamResult extends LLMChatResult {
  /**
   * 流在正文流出后被掐断（网络断开/超时/对端未发结束帧）。
   * 与 truncated（max_tokens 截断）并列：都表示"内容不完整，但已有的部分是真实的"。
   */
  interrupted?: boolean;
}

export interface SseReadOutcome {
  content: string;
  truncated: boolean;
  /** 未看到 [DONE] / finish_reason 就结束（断线或坏流） */
  interrupted: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * 共享 SSE 解析器（BYOK 直连与网关流式复用，保证分片/断线行为完全一致）。
 *
 * 健壮性约定（验收逐条断言）：
 * - CRLF 与跨网络分片：在累计 buffer 上统一换行后再按空行切事件；
 * - 事件内多行 data: 先拼接再 JSON.parse（OpenAI 实现是单行，但按规范兼容）；
 * - 无可读流（CapacitorHttp 桥接）：整读文本，自动区分 SSE 文本与 JSON 整读体；
 * - 流尾无空行残留的半截事件：冲刷 decoder 后补消费；
 * - **断线检测**：只有见过 [DONE] 或任意 finish_reason 才算干净结束，
 *   否则 interrupted=true；
 * - 已经流出正文后的读取错误**不抛出**，保留部分正文 + interrupted；
 *   首段正文之前的错误原样抛出（调用方决定是否回退）。
 */
export async function readSseResponse(
  response: Response,
  onDelta: (accumulated: string, delta: string) => void,
): Promise<SseReadOutcome> {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let sawFinish = false;
  let sawDone = false;
  let truncatedFlag = false;
  let usage: SseReadOutcome['usage'];

  const consumeEvent = (rawEvent: string) => {
    const dataLines: string[] = [];
    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5);
      dataLines.push(payload.startsWith(' ') ? payload.slice(1) : payload);
    }
    const payload = dataLines.join('\n').trim();
    if (!payload) return;
    if (payload === '[DONE]') { sawDone = true; return; }
    let json: {
      choices?: { delta?: { content?: unknown }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try { json = JSON.parse(payload); }
    catch { return; }
    const delta = json.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      content += delta;
      onDelta(content, delta);
    }
    const finishReason = json.choices?.[0]?.finish_reason;
    if (typeof finishReason === 'string' && finishReason) {
      sawFinish = true;
      if (finishReason === 'length') truncatedFlag = true;
    }
    if (json.usage) {
      usage = {
        inputTokens: Number(json.usage.prompt_tokens ?? 0),
        outputTokens: Number(json.usage.completion_tokens ?? 0),
      };
    }
  };

  const consumeBuffer = () => {
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      consumeEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  };

  // 有些 WebView/网络桥接只提供完整文本，没有 ReadableStream；正文仍可能是 SSE。
  if (!response.body) {
    const raw = await response.text();
    if (raw.trimStart().startsWith('{')) {
      const data = JSON.parse(raw);
      const value = data.choices?.[0]?.message?.content;
      content = typeof value === 'string' ? value : Array.isArray(value)
        ? value.map((part: string | { text?: string }) => typeof part === 'string' ? part : part?.text ?? '').join('') : '';
      truncatedFlag = data.choices?.[0]?.finish_reason === 'length';
      sawFinish = typeof data.choices?.[0]?.finish_reason === 'string';
      if (content) onDelta(content, content);
    } else {
      buffer = raw;
      consumeBuffer();
      if (buffer.trim()) consumeEvent(buffer);
    }
  } else {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        consumeBuffer();
      }
    } catch (error) {
      // 正文已开始流出后断线：不抛出、不重发，把已生成的部分交还给调用方。
      if (!content) throw error;
      console.warn('[llm] 流式中断，保留已生成内容', (error as Error)?.message ?? error);
    }
    buffer += decoder.decode();
    consumeBuffer();
    if (buffer.trim()) consumeEvent(buffer);
  }

  const interrupted = content.length > 0 && !sawDone && !sawFinish;
  return { content, truncated: truncatedFlag, interrupted, usage };
}

export async function llmChatStream(params: LLMStreamParams): Promise<LLMStreamResult> {
  const provider = LLM_PROVIDERS[params.provider];
  const body = {
    ...buildChatBody(params),
    stream: true,
    // DeepSeek 只有在 stream_options 里显式要求才在流内回传 usage（费用统计依赖它）
    ...(params.provider === 'deepseek' ? { stream_options: { include_usage: true } } : {}),
  };

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

    if (!response.ok) throwForStatus(response.status);

    const outcome = await readSseResponse(response, params.onDelta);
    const { content, usage } = outcome;
    const truncated = outcome.truncated || outcome.interrupted;

    if (!content.trim() || truncated) {
      const note = `stream=true, truncated=${outcome.truncated}, interrupted=${outcome.interrupted}`;
      console.warn(`[llm] 流式响应(空/截断/中断)`, note);
      // 空流不能作为成功响应返回：让世界 AI 出口改用非流式请求补救。
      if (!content.trim()) throw new Error('stream:empty');
      return { content, truncated, interrupted: outcome.interrupted, usage, rawNote: note };
    }
    return { content, usage };
  } catch (err) {
    if (isTimeoutError(err)) throw new Error('timeout');
    if (err instanceof Error) throw err;
    throw new Error('server:error');
  }
}
