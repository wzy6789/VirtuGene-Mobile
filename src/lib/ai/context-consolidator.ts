import { fetchWithTimeout } from './http';

/**
 * 「对话后结算」合并调用：一次请求同时完成
 * 1) 长期记忆提取（关于用户的关键事实）
 * 2) AI 角色情绪六维分析
 *
 * 相比此前「每 3 条情绪分析 + 每 10 条记忆提取」的两次独立调用，减少约 30% 额外 API 消耗。
 */
const CONTEXT_SETTLE_PROMPT =
  '你是 VirtuGene 的「灵魂状态读取器」。给定一段对话，你需要同时完成两件事，并严格输出一个 JSON 对象：\n' +
  '{\n' +
  '  "memories": string[],\n' +
  '  "valence": number, "arousal": number, "intimacy": number, "engagement": number, "expressiveness": number, "stability": number,\n' +
  '  "dominantEmotion": string,\n' +
  '  "userEmotion": string,\n' +
  '  "summary": string\n' +
  '}\n\n' +
  '规则1（记忆提取）：只提取关于用户的关键事实（偏好、经历、观点、计划、人际关系等），每条一句话，简洁明确；不要提取 AI 角色自身的信息；不要提取寒暄闲聊；没有值得记忆的信息时返回空数组 []。\n\n' +
  '规则2（情绪分析）：分析对话中 AI 角色（role=assistant）消息体现的情绪状态，6 个维度各 1-10 分（允许小数）：valence=愉悦度、arousal=唤醒度、intimacy=亲密度、engagement=投入度、expressiveness=外显度、stability=稳定度。只依据 AI 角色的消息判断，忽略 user 消息。dominantEmotion 用 2-5 字中文短语概括 AI 角色情绪（如"平静满足""焦虑不安""愉悦放松"），summary 用 1-2 句话总结 AI 角色情绪状态。\n\n' +
  '规则3（用户情绪感知）：根据对话中用户（role=user）消息的语气与内容，用 2-5 字中文短语概括用户此刻的情绪（如"开心""低落""焦虑""平静""疲惫""兴奋"）。若对话太短无法判断，返回"平静"。\n\n' +
  '严格按 JSON 输出，不要添加任何解释文字或 Markdown 代码块。';

export interface ContextSettleParams {
  apiKey: string;
  history: { role: string; content: string }[];
  characterName: string;
}

export interface ContextSettleResult {
  memories?: string[];
  dimensions?: {
    valence: number;
    arousal: number;
    intimacy: number;
    engagement: number;
    expressiveness: number;
    stability: number;
  };
  dominantEmotion?: string;
  userEmotion?: string;
  summary?: string;
  error?: string;
}

export async function consolidateContext(params: ContextSettleParams): Promise<ContextSettleResult> {
  const { apiKey, history, characterName } = params;

  const contextNote = characterName
    ? `用户正在与名为"${characterName}"的AI角色对话。`
    : '';

  const messages = [
    { role: 'system', content: CONTEXT_SETTLE_PROMPT },
    {
      role: 'user',
      content:
        `${contextNote}请分析以下对话，输出记忆与情绪 JSON：\n\n` +
        history.map((m) => `${m.role}: ${m.content}`).join('\n'),
    },
  ];

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
          model: 'deepseek-v4-flash',
          messages,
          max_tokens: 1200,
          temperature: 0.3,
        }),
      },
      30_000,
    );

    if (!response.ok) {
      if (response.status === 401) return { error: 'auth:invalid_key' };
      if (response.status === 402) return { error: 'billing:insufficient' };
      if (response.status === 429) return { error: 'rate:limited' };
      return { error: 'server:error' };
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    return parseSettleJSON(text);
  } catch {
    return { error: 'server:error' };
  }
}

function parseSettleJSON(text: string): ContextSettleResult {
  const clean = (s: string) => {
    let t = s.trim();
    if (t.startsWith('```')) {
      t = t.replace(/```json?/i, '').replace(/```/, '').trim();
    }
    return t;
  };

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(clean(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return { error: 'server:error' };
      }
    }
  }
  if (!parsed) return { error: 'server:error' };
  return validateResult(parsed);
}

function validateResult(obj: Record<string, unknown>): ContextSettleResult {
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return isNaN(n) ? fallback : Math.max(1, Math.min(10, n));
  };

  const rawMemories = Array.isArray(obj.memories) ? obj.memories : [];
  const memories = rawMemories
    .filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0)
    .map((m) => m.trim())
    .slice(0, 20);

  return {
    memories,
    dimensions: {
      valence: num(obj.valence, 5),
      arousal: num(obj.arousal, 5),
      intimacy: num(obj.intimacy, 5),
      engagement: num(obj.engagement, 5),
      expressiveness: num(obj.expressiveness, 5),
      stability: num(obj.stability, 5),
    },
    dominantEmotion: typeof obj.dominantEmotion === 'string' ? obj.dominantEmotion : '未知',
    userEmotion: typeof obj.userEmotion === 'string' ? obj.userEmotion : undefined,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}
