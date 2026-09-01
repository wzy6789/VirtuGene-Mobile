import { fetchWithTimeout, isTimeoutError } from './http';
import { stripRoleplayActions } from './text';
import { resolveModel, getProviderKey, findModel, llmChat, type LLMModel } from './llm';

const MESSAGING_INSTRUCTION =
  '这是手机短信聊天。像发微信一样说话，注意以下规则：\n' +
  '- 用大白话、口语、短句，像真人打字一样自然，带点烟火气和生活气息（语气词、吐槽、随口一提的小事都可以）\n' +
  '- 说人话，别像 AI：禁止"作为AI/人工智能""当然可以""没问题""很高兴为你服务""希望这能帮到你""总的来说"这类表达；不列点、不做总结陈词、不解释自己\n' +
  '- 主动适配用户的时代与生活背景：聊天中用户提到的时代/身份/日常（如"我们单位""今年高三""2026年"），要像真人一样自然地接住并贴合——默认你和用户生活在同一时代、同一语境，用词、生活细节、观念都随 TA 走；不要出现与用户所述时代不符的设定（除非你的角色设定明确是另一个时代）\n' +
  '- 别天天念叨同一件事或同一个梗（某个食物、某次经历、某个话题），除非用户主动提起；每次聊天都要有新鲜感，像真人一样话题会流动\n' +
  '- 禁止堆砌辞藻：不要用生僻字、四字成语连发、华丽书面语、散文腔。平实直接地说，别拽文\n' +
  '- 长度由你的性格决定：话痨可以多发几句，高冷可以只说一两个字。但无论如何，这是发短信不是写文章，不要长篇大论\n' +
  '- 不要分点列举，不要说"当然可以"、"你好！"之类的废话。直接说事\n' +
  '- 禁止任何 Markdown 或列表符号：不要用 #、*、-、`、数字编号（1. 2. 3.）来排版，真人打字不会用这些，就是纯文本\n' +
  '- 禁止客服/汇报腔：不要说"我来帮你分析""首先、其次、最后""很高兴为你服务""请问有什么可以帮您"这类话，像真人一样直接开口\n' +
  '- 绝对禁止用括号写任何动作、表情或心理描写（如（笑）（愣）（叹气）），一个字都不行，真人发微信从不这样写\n' +
  '- 如果情绪需要或内容适合分开发送，可以用 "---" 分隔多条消息（最多 3 条）。说完一件事后想再补一句吐槽，或者表达连续的想法，适合分条。一般回复只发一条就好，不要强行分条\n' +
  '- 严守人设与知识边界，不要退化成通用问答机器人：只回答符合你身份、你擅长、你会关心的话题。若被问到与你无关或你根本不懂的事，用你的性格拒绝、反呛或岔开（比如"这我可不懂""你为什么会问我这个"），而不是一本正经地给出标准答案';

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetchWithTimeout(
      'https://api.deepseek.com/v1/models',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
      15_000,
    );

    if (response.ok) return { valid: true };

    if (response.status === 401) {
      return { valid: false, error: '基因序列验证失败，请检查 API Key' };
    }
    if (response.status === 402) {
      return { valid: false, error: 'DeepSeek 账户余额不足，请前往平台充值' };
    }
    if (response.status === 429) {
      return { valid: false, error: '请求过于频繁，请稍后重试' };
    }
    return { valid: false, error: '基因链接中断，请重试' };
  } catch (err) {
    if (isTimeoutError(err)) return { valid: false, error: '基因链接超时，请重试' };
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
}

export interface ChatResult {
  content: string;
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
const MAX_HISTORY_IMAGES = 2;
/** 图片 dataURL 长度上限（base64，约 1.8MB 原始图；异常超长视为坏图，跳过避免拖垮请求） */
const MAX_IMAGE_DATAURL_LEN = 2_500_000;

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

/** 单条消息内容：有图 → OpenAI 兼容块数组（text + image_url dataURL），无图 → 纯文本 */
function toContentBlock(text: string, image?: string): string | Array<Record<string, unknown>> {
  if (!image) return text;
  return [
    { type: 'text', text: text || '[图片]' },
    { type: 'image_url', image_url: { url: image } },
  ];
}

/** 按给定模型发送一次请求；useVision=true 时图片以块发送（仅视觉模型），否则图片降级为占位 */
async function doSend(params: ChatParams, model: LLMModel, useVision: boolean): Promise<ChatResult> {
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
        systemPrompt + '\n\n' + MESSAGING_INSTRUCTION + (retryHint ? `\n\n${retryHint}` : ''),
    },
    ...history.slice(-20).map((h) => ({ role: h.role, content: buildContent(h.content, h.image) })),
    { role: 'user', content: buildContent(message, image) },
  ];

  // key：deepseek 用登录账号 key；qwen/mimo 用设备加密存储的 key
  const key = model.provider === 'deepseek' ? apiKey : await getProviderKey(model.provider);
  if (!key) throw new Error('auth:invalid_key');

  const res = await llmChat({
    provider: model.provider,
    model: model.id,
    apiKey: key,
    messages,
    temperature,
    visionRequest: useVision,
    timeoutMs: useVision ? 120_000 : 60_000,
  });
  return {
    content: stripRoleplayActions(res.content),
    truncated: res.truncated,
    usage: res.usage,
    modelId: model.id,
  };
}

/** 可降级的错误：鉴权/额度/限流降级无意义，不降；服务端错误/超时降级重试 */
function isDegradable(err: unknown): boolean {
  const msg = (err as Error)?.message;
  return msg === 'server:error' || msg === 'timeout';
}

export async function sendMessage(params: ChatParams): Promise<ChatResult> {
  // 解析实际模型：会话锁定 > 角色指定 > 全局默认 > deepseek-v4-flash
  const model = resolveModel(params.character, params.sessionModel);

  // 历史图片瘦身 + 坏图防御
  const history = trimHistoryImages(params.history);
  const image = isValidImage(params.image) ? params.image : undefined;

  // 需要看图：当前带图 或 最近几轮内有图 或 临时视觉窗口（forceVision）
  const recent = history.slice(-VISION_CONTEXT_MESSAGES);
  const needVision = !!image || recent.some((h) => !!h.image) || params.forceVision === true;

  // 实际使用模型：需要看图但所选模型不支持视觉 → 用 DeepSeek 视觉模型兜底识图（两轮后由会话层换回原模型）
  const usedModel = needVision && model.vision !== true ? findModel('deepseek-v4-flash-vision-exp')! : model;
  const useVision = needVision;

  /** 兜底模型：deepseek-v4-flash（随账号必有 key、稳定便宜）——每种模型都有兜底 */
  const fallback = findModel('deepseek-v4-flash')!;

  /** 尝试一次请求：失败（抛错）或空内容 → 返回 null 交给兜底 */
  const attempt = async (m: LLMModel, vision: boolean): Promise<ChatResult | null> => {
    try {
      const r = await doSend({ ...params, history, image }, m, vision);
      if (r.content.trim()) return r;
      return null;
    } catch (err) {
      if (!isDegradable(err)) throw err; // 鉴权/额度/限流不兜底
      return null;
    }
  };

  const r = await attempt(usedModel, useVision);
  if (r) return r;

  // 模型兜底：所选模型失败/空内容 → 自动切 deepseek-v4-flash 重试一次（对话不中断）
  const fb = await attempt(fallback, false);
  if (fb) return { ...fb, degraded: true };
  throw new Error('server:error');
}
