import { fetchWithTimeout, isTimeoutError } from './http';
import { stripRoleplayActions } from './text';

const MESSAGING_INSTRUCTION =
  '这是手机短信聊天。像发微信一样说话，注意以下规则：\n' +
  '- 用大白话、口语、短句，像真人打字一样自然，带点烟火气和生活气息（语气词、吐槽、随口一提的小事都可以）\n' +
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
  /** 当前消息附带的图片（压缩后 dataURL；有值则本条请求走视觉模型） */
  image?: string;
  /** 回复自检未通过时的修正提示（重试时附加到 system 侧，引导模型修正） */
  retryHint?: string;
  /** 采样温度：按角色主动倾向微调（高冷低、活泼高），缺省 0.8 */
  temperature?: number;
}

export interface ChatResult {
  content: string;
  /** 是否因超出 max_tokens 被截断（前端据此补「…」） */
  truncated?: boolean;
}

/** 视觉模型（支持图片，按文本价计费） */
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';
/** 文本模型（老模型，日常对话） */
const TEXT_MODEL = 'deepseek-v4-flash';
/** 最近 N 条消息内出现过图片 → 保持视觉模型（约 4 轮对话），之后自动切回文本模型 */
const VISION_CONTEXT_MESSAGES = 8;

/** 单条消息内容：有图 → OpenAI 兼容块数组（text + image_url dataURL），无图 → 纯文本 */
function toContentBlock(text: string, image?: string): string | Array<Record<string, unknown>> {
  if (!image) return text;
  return [
    { type: 'text', text: text || '[图片]' },
    { type: 'image_url', image_url: { url: image } },
  ];
}

export async function sendMessage(params: ChatParams): Promise<ChatResult> {
  const { apiKey, systemPrompt, message, history, retryHint, temperature, image } = params;

  const messages = [
    {
      role: 'system',
      content:
        systemPrompt + '\n\n' + MESSAGING_INSTRUCTION + (retryHint ? `\n\n${retryHint}` : ''),
    },
    ...history.slice(-20).map((h) => ({ role: h.role, content: toContentBlock(h.content, h.image) })),
    { role: 'user', content: toContentBlock(message, image) },
  ];

  // 模型切换：当前带图，或最近几轮内有图 → 视觉模型（AI 持续看图理解）；否则老文本模型
  const recent = history.slice(-VISION_CONTEXT_MESSAGES);
  const useVision = !!image || recent.some((h) => !!h.image);
  const model = useVision ? VISION_MODEL : TEXT_MODEL;

  try {
    const response = await fetchWithTimeout(
      'https://api.deepseek.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 1000,
          temperature: temperature ?? 0.8,
        }),
      },
      60_000,
    );

    if (response.ok) {
      const data = await response.json();
      const choice = data.choices?.[0];
      const content: string = choice?.message?.content ?? '';
      const truncated = choice?.finish_reason === 'length';
      return { content: stripRoleplayActions(content), truncated };
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
