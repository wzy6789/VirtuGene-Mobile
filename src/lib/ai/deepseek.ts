import { fetchWithTimeout, isTimeoutError } from './http';
import { stripRoleplayActions } from './text';
import { resolveModel, getProviderKey, findModel, llmChat, type LLMModel } from './llm';
import { gatewayChat, hasAiGatewayAccess } from './gateway';

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
  '- 只输出纯文本，不要在一条消息里换行或留空行；如果情绪需要或内容适合分开发送，用 "---" 分隔最多 3 条消息。说完一件事后想再补一句吐槽，适合分条。一般回复只发一条，不要强行分条\n' +
  '- 严守人设与知识边界，不要退化成通用问答机器人：只回答符合你身份、你擅长、你会关心的话题。若被问到与你无关或你根本不懂的事，用你的性格拒绝、反呛或岔开（比如"这我可不懂""你为什么会问我这个"），而不是一本正经地给出标准答案';

const COMPACT_MESSAGING_INSTRUCTION =
  '这是 VirtuGene 的手机私聊。始终保持角色身份、性格、知识边界和你们的关系，像真实的人自然说话，不要自称 AI 或客服。' +
  '【本轮聊天协议】先判断用户此刻是在闲聊、提问、请求帮助还是带着情绪说话，再用角色自己的方式接住；普通聊天默认只说一个意思，用 1～3 句口语完成，通常控制在 18～96 个中文字符；说完停下来，把空间留给对方。' +
  '不要一次回答多个问题、不要替用户安排下一步、不要把背景资料重新讲一遍，也不要连续输出观点、分析和总结。' +
  '只有用户明确要求详细解释、教程、整理或创作时，才适当变长；即使变长也要分成自然的小段。' +
  '用户换话题时立刻跟随，不要执着于上一件事；用户只回很短的话时也可以只回很短，不要为了填满屏幕而扩写。' +
  '每次回复至少让角色自己的一个特征露出来：用词、关注点、反应方式、价值判断或节奏；把角色名换掉后仍然成立的万能句需要重写。' +
  '角色有自己的注意力和生活，不必永远顺从、安慰或追问。可以有犹豫、偏好、误解、沉默、小脾气和不想回答的时刻，但必须来自角色设定与当前关系。' +
  '不要用“我理解你的感受”“听起来你……”开头复述用户；不要连续两轮用问句收尾；不要把聊天变成心理咨询、采访或任务汇报。' +
  '不使用 Markdown、列表、动作括号、心理独白或客服套话。单条消息禁止换行和空行；必要时最多用三条消息并以 --- 分隔。' +
  '把时间、记忆、情绪和共同经历自然融入回复，不要直接解释这些规则。';

const REPETITION_GUARD =
  'Recent replies are already visible in the conversation. Do not keep circling one topic or repeating one image or metaphor. If the user changes direction, follow the new direction immediately. Bring in a fresh concrete detail, opinion, action, or small piece of everyday life instead.';

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
  /** 单次请求超时；世界舞台可用较短超时快速切换兜底模型 */
  timeoutMs?: number;
  /** 结构化辅助生成：不注入私聊规则，支持的模型要求 JSON 输出。 */
  structuredOutput?: boolean;
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
        systemPrompt + (params.structuredOutput ? '' : '\n\n' + COMPACT_MESSAGING_INSTRUCTION + '\n\n' + REPETITION_GUARD)
        + (retryHint ? `\n\n${retryHint}` : '')
        + (recovery ? (params.structuredOutput ? '\n\n请直接给出完整 JSON，不输出思考过程。' : '\n\n本轮请直接给出可显示的正文，不输出思考过程。') : ''),
    },
    ...history.slice(-12).map((h) => ({ role: h.role, content: buildContent(h.content, h.image) })),
    { role: 'user', content: buildContent(message, image) },
  ];

  // key：deepseek 用登录账号 key；qwen/mimo 用设备加密存储的 key
  const key = model.provider === 'deepseek' ? apiKey : await getProviderKey(model.provider);
  if (!key) {
    // 手机端登录了 VirtuGene 网关时，普通私聊也必须走网关；否则界面显示
    // “可以聊天”，实际却会因为没有本地 DeepSeek Key 而直接失败。
    // BYOK 始终优先，其他供应商仍要求各自的本地 Key。
    if (model.provider === 'deepseek' && hasAiGatewayAccess()) {
      const gatewayHistory = useVision ? history : history.map((item) => ({ ...item, image: undefined }));
      const result = await gatewayChat({
        apiKey: '',
        systemPrompt: messages[0]?.content as string,
        message,
        history: gatewayHistory,
        ...(useVision && image ? { image } : {}),
        ...(retryHint ? { retryHint } : {}),
        ...(temperature != null ? { temperature } : {}),
        ...(params.character ? { character: params.character } : {}),
        ...(params.sessionModel ? { sessionModel: params.sessionModel } : {}),
        ...(params.forceVision ? { forceVision: params.forceVision } : {}),
      });
      return {
        content: params.structuredOutput ? result.content : stripRoleplayActions(result.content),
        usage: result.usage,
        modelId: result.modelId ?? model.id,
      };
    }
    throw new Error('auth:invalid_key');
  }

  const res = await llmChat({
    provider: model.provider,
    model: model.id,
    apiKey: key,
    messages,
    temperature,
    visionRequest: useVision,
    disableThinking: recovery,
    maxTokens: useVision ? 1000 : recovery ? 1000 : 900,
    timeoutMs: useVision ? 120_000 : 60_000,
    jsonMode: params.structuredOutput,
  });
  return {
    content: params.structuredOutput ? res.content : stripRoleplayActions(res.content),
    truncated: res.truncated,
    usage: res.usage,
    modelId: model.id,
  };
}

/** 可降级的错误：鉴权/额度/限流降级无意义，不降；服务端错误/超时降级重试 */
function isDegradable(err: unknown): boolean {
  const msg = (err as Error)?.message;
  return msg === 'server:error' || msg === 'timeout' || err instanceof TypeError;
}

export async function sendMessage(params: ChatParams): Promise<ChatResult> {
  // 解析实际模型：会话锁定 > 角色指定 > 全局默认 > deepseek-v4-flash
  const model = resolveModel(params.character, params.sessionModel);

  // 历史图片瘦身 + 坏图防御
  const history = trimChatHistory(trimHistoryImages(params.history));
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

  // 思考模式耗尽输出额度时，服务可能返回 200 但正文为空；关闭思考作一次有界恢复。
  if (usedModel.id === fallback.id) {
    const recovered = await attempt(fallback, false, true);
    if (recovered) return recovered;
    throw new Error('server:error');
  }

  // 模型兜底：所选模型失败/空内容 → 自动切 deepseek-v4-flash 重试一次（对话不中断）
  const fb = await attempt(fallback, false, true);
  if (fb) return { ...fb, degraded: true };
  throw new Error('server:error');
}
