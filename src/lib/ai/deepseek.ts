import { stripRoleplayActions } from './text';
import { withChatMessagingPolicy } from '../../../server/chat-messaging-policy.mjs';
import { resolveModel, getProviderKey, llmChat, llmChatStream, getProviderConfig, providerRequiresKey, validateProviderConnection, type LLMModel, type LLMStreamResult } from './llm';
import { gatewayChat, gatewayChatStream, hasAiGatewayAccess } from './gateway';

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    await validateProviderConnection('deepseek', { apiKey: apiKey.trim() });
    return { valid: true };
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'auth:invalid_key') return { valid: false, error: '基因序列验证失败，请检查 API Key' };
    if (code === 'billing:insufficient') return { valid: false, error: 'DeepSeek 账户余额不足，请前往平台充值' };
    if (code === 'rate:limited') return { valid: false, error: '请求过于频繁，请稍后重试' };
    if (code === 'timeout') return { valid: false, error: '基因链接超时，请重试' };
    return { valid: false, error: '基因链接中断，请重试' };
  }
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  /** 图片消息（压缩后 dataURL；有值则该条以图片块发送，AI 真正看图） */
  image?: string;
}

export interface ChatParams {
  apiKey: string;
  systemPrompt: string;
  message: string;
  history: ChatHistoryItem[];
  /** 当前消息附带的图片（压缩后 dataURL；有值且模型支持视觉时以图片块发送） */
  image?: string;
  /** 回复自检未通过时的修正提示（重试时附加到 system 侧，引导模型修正） */
  retryHint?: string;
  /** 采样温度：按角色主动倾向微调（高冷低、活泼高），缺省 0.8 */
  temperature?: number;
  /** 当前角色（用于解析角色指定模型；不传则用全局默认） */
  character?: { model?: { provider: string; model: string } } | null;
  /** 会话锁定的模型（首次进入聊天时选定，优先级最高，聊天中不可改） */
  sessionModel?: { provider: string; model: string } | null;
  /** 临时视觉窗口（发图后几轮内强制用视觉模型识图，之后换回原模型） */
  forceVision?: boolean;
  /** 单次请求超时；世界舞台可用较短超时快速切换兜底模型 */
  timeoutMs?: number;
  /** 结构化辅助生成：不注入私聊规则，支持的模型要求 JSON 输出。 */
  structuredOutput?: boolean;
  /** Budget for structured agent plans; normal chat keeps its existing limit. */
  maxTokens?: number;
  /** Recovery and explicitly direct replies must behave identically through the gateway. */
  disableThinking?: boolean;
  signal?: AbortSignal;
  /** Visible response text only; structured agent plans stay buffered. */
  onDelta?: (accumulated: string, delta: string) => void;
  /** Ephemeral diagnostics before display cleanup; never stored as message text. */
  onRawResponse?: (raw: string) => void;
}

export interface ChatResult {
  content: string;
  interrupted?: boolean;
  /** 是否因超出 max_tokens 被截断（前端据此补「…」） */
  truncated?: boolean;
  /** 本次发生了兜底切换（视觉降级 / 模型兜底），UI 应提示用户 */
  degraded?: boolean;
  /** token 用量（服务商返回；用于费用统计） */
  usage?: { inputTokens: number; outputTokens: number };
  /** 实际使用的模型 id（兜底后可能与所选模型不同） */
  modelId?: string;
}

/** 最近 N 条消息内出现过图片 → 保持视觉模型（约 4 轮对话），之后自动切回文本模型 */
const VISION_CONTEXT_MESSAGES = 8;
/** 历史消息最多携带的图片数（防请求体过大导致超时失败；更早的图片降级为"[图片]"占位） */
const MAX_HISTORY_IMAGES = 1;
/** 图片 dataURL 长度上限（base64，约 1.8MB 原始图；异常超长视为坏图，跳过避免拖垮请求） */
const MAX_IMAGE_DATAURL_LEN = 650_000;
const MAX_CHAT_HISTORY_CHARS = 14_000;

/** 图片是否可用（格式正确且体积正常） */
function isValidImage(image?: string): boolean {
  if (!image) return false;
  if (!image.startsWith('data:image/')) return false;
  if (image.length > MAX_IMAGE_DATAURL_LEN) return false;
  return true;
}

/** 历史图片瘦身 + 坏图防御：只保留最近 MAX_HISTORY_IMAGES 张合法图片，其余降级为占位 */
function trimHistoryImages(history: ChatHistoryItem[]): ChatHistoryItem[] {
  const imgIdx = history
    .map((h, i) => (isValidImage(h.image) ? i : -1))
    .filter((i) => i >= 0);
  if (imgIdx.length <= MAX_HISTORY_IMAGES) {
    // 即使数量没超，也要清掉非法图片
    return history.map((h) => (h.image && !isValidImage(h.image) ? { ...h, image: undefined } : h));
  }
  const keep = new Set(imgIdx.slice(-MAX_HISTORY_IMAGES));
  return history.map((h, i) => (h.image && !keep.has(i) ? { ...h, image: undefined } : h));
}

/** Bound the text payload too; the gateway rejects oversized JSON bodies. */
function trimChatHistory(history: ChatHistoryItem[]): ChatHistoryItem[] {
  const tail = history.slice(-12);
  const kept: ChatHistoryItem[] = [];
  let remaining = MAX_CHAT_HISTORY_CHARS;
  for (let index = tail.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const item = tail[index];
    const content = typeof item.content === 'string' ? item.content : '';
    const take = Math.min(1_200, remaining);
    kept.push({ ...item, content: content.slice(0, take) });
    remaining -= Math.min(content.length, take);
  }
  return kept.reverse();
}

/** 单条消息内容：有图 → OpenAI 兼容块数组（text + image_url dataURL），无图 → 纯文本 */
function toContentBlock(text: string, image?: string): string | Array<Record<string, unknown>> {
  if (!image) return text;
  return [
    { type: 'text', text: text || '[图片]' },
    { type: 'image_url', image_url: { url: image } },
  ];
}

/** 按给定模型发送一次请求；useVision=true 时图片以块发送（仅视觉模型），否则图片降级为占位 */
async function doSend(params: ChatParams, model: LLMModel, useVision: boolean, recovery = false): Promise<ChatResult> {
  const { systemPrompt, message, history, retryHint, temperature, image, apiKey } = params;

  const buildContent = (text: string, img?: string) => {
    if (img && useVision) return toContentBlock(text, img);
    if (img) return text || '[图片]';
    return text;
  };

  const messages = [
    {
      role: 'system',
      content:
        (params.structuredOutput ? systemPrompt : withChatMessagingPolicy(systemPrompt))
        + (retryHint ? `\n\n${retryHint}` : '')
        + (recovery ? (params.structuredOutput ? '\n\n请直接给出完整 JSON，不输出思考过程。' : '\n\n本轮请直接给出可显示的正文，不输出思考过程。') : ''),
    },
    ...history.slice(-12).map((h) => ({ role: h.role, content: buildContent(h.content, h.image) })),
    { role: 'user', content: buildContent(message, image) },
  ];

  // key：deepseek 用登录账号 key；qwen/mimo 用设备加密存储的 key
  if (!getProviderConfig(model.provider).enabled) throw new Error('provider:disabled');
  const key = model.provider === 'deepseek' ? apiKey : await getProviderKey(model.provider);
  if (!key && providerRequiresKey(model.provider)) {
    // 手机端登录了 VirtuGene 网关时，普通私聊也必须走网关；否则界面显示
    // “可以聊天”，实际却会因为没有本地 DeepSeek Key 而直接失败。
    // BYOK 始终优先，其他供应商仍要求各自的本地 Key。
    if (model.provider === 'deepseek' && hasAiGatewayAccess()) {
      const gatewayHistory = useVision ? history : history.map((item) => ({ ...item, image: undefined }));
      const gatewayParams = {
        apiKey: '',
        systemPrompt: messages[0]?.content as string,
        message,
        history: gatewayHistory,
        ...(useVision && image ? { image } : {}),
        ...(temperature != null ? { temperature } : {}),
        ...(params.character ? { character: params.character } : {}),
        ...(params.sessionModel ? { sessionModel: params.sessionModel } : {}),
        ...(params.forceVision ? { forceVision: params.forceVision } : {}),
        ...(params.structuredOutput ? { structuredOutput: true } : {}),
        ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
        disableThinking: recovery || params.disableThinking,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
      };
      const result: ChatResult = params.onDelta && !params.structuredOutput
        ? await gatewayChatStream({ ...gatewayParams, onDelta: params.onDelta })
        : await gatewayChat(gatewayParams);
      if (!params.structuredOutput) params.onRawResponse?.(result.content);
      return {
        content: params.structuredOutput ? result.content : stripRoleplayActions(result.content),
        truncated: result.truncated,
        interrupted: result.interrupted,
        usage: result.usage,
        modelId: result.modelId ?? model.id,
      };
    }
    throw new Error('auth:invalid_key');
  }

  const request = {
    provider: model.provider,
    model: model.id,
    apiKey: key ?? '',
    messages,
    temperature,
    visionRequest: useVision,
    disableThinking: recovery || params.disableThinking || params.structuredOutput,
    maxTokens: params.maxTokens ?? (useVision ? 1000 : recovery ? 1000 : 900),
    timeoutMs: params.timeoutMs ?? (useVision ? 120_000 : 60_000),
    signal: params.signal,
    jsonMode: params.structuredOutput,
  };
  const res: LLMStreamResult = params.onDelta && !params.structuredOutput
    ? await llmChatStream({ ...request, onDelta: params.onDelta })
    : await llmChat(request);
  if (!params.structuredOutput) params.onRawResponse?.(res.content);
  return {
    content: params.structuredOutput ? res.content : stripRoleplayActions(res.content),
    truncated: res.truncated,
    interrupted: res.interrupted,
    usage: res.usage,
    modelId: model.id,
  };
}

/** 可降级的错误：鉴权/额度/限流降级无意义，不降；服务端错误/超时降级重试 */
function isDegradable(err: unknown): boolean {
  const msg = (err as Error)?.message;
  return msg === 'server:error' || msg === 'timeout' || msg === 'stream:empty' || err instanceof TypeError;
}

export async function sendMessage(params: ChatParams): Promise<ChatResult> {
  // 解析实际模型：会话锁定 > 角色指定 > 全局默认 > DeepSeek Flash
  const model = resolveModel(params.character, params.sessionModel);

  // 历史图片瘦身 + 坏图防御
  const history = trimChatHistory(trimHistoryImages(params.history));
  const image = isValidImage(params.image) ? params.image : undefined;

  // 需要看图：当前带图 或 最近几轮内有图 或 临时视觉窗口（forceVision）
  const recent = history.slice(-VISION_CONTEXT_MESSAGES);
  const needVision = !!image || recent.some((h) => !!h.image) || params.forceVision === true;

  // Flash natively accepts images; every provider must declare image support.
  if (needVision && model.vision !== true) throw new Error('model:vision_unsupported');
  const usedModel = model;
  const useVision = needVision;

  /** 尝试一次请求：失败（抛错）或空内容 → 返回 null 交给兜底 */
  const attempt = async (m: LLMModel, vision: boolean, recovery = false): Promise<ChatResult | null> => {
    try {
      const r = await doSend({ ...params, history, image }, m, vision, recovery);
      if (r.content.trim()) return r;
      return null;
    } catch (err) {
      if (!isDegradable(err)) throw err; // 鉴权/额度/限流不兜底
      return null;
    }
  };

  const r = await attempt(usedModel, useVision);
  if (r) return r;

  // One bounded recovery on the same model, without discarding image context.
  const recovered = await attempt(usedModel, useVision, true);
  if (recovered) return recovered;
  throw new Error('server:error');
}
