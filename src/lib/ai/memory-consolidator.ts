import { fetchWithTimeout } from './http';

const MEMORY_EXTRACTION_PROMPT =
  '你是一个记忆提取系统。从以下对话中提取关于用户的**关键事实**和**重要信息**。\n\n' +
  '规则：\n' +
  '- 只提取用户相关的信息（偏好、经历、观点、计划、人际关系等）\n' +
  '- 每条记忆一句话概括，简洁明确\n' +
  '- 不要提取 AI 角色自身的信息\n' +
  '- 不要提取闲聊、寒暄等无意义内容\n' +
  '- 如果对话中没有值得记忆的信息，返回空数组 []\n' +
  '- 用 JSON 数组格式返回，每个元素是一条字符串\n\n' +
  '示例输出：["用户喜欢喝咖啡，尤其是拿铁", "用户在学日语，目前 N3 水平", "用户下个月要去东京旅行"]';

export interface ConsolidateParams {
  apiKey: string;
  history: { role: string; content: string }[];
}

export interface ConsolidateResult {
  memories?: string[];
  error?: string;
}

export async function extractMemories(params: ConsolidateParams): Promise<ConsolidateResult> {
  const { apiKey, history } = params;

  const messages = [
    { role: 'system', content: MEMORY_EXTRACTION_PROMPT },
    { role: 'user', content: '请从以下对话中提取用户的关键信息：\n\n' + history.map((m) => `${m.role}: ${m.content}`).join('\n') },
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
          max_tokens: 1000,
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
    const choice = data.choices?.[0];
    const text: string = choice?.message?.content ?? '';

    // Parse JSON from response
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed.memories ?? []);
      // Filter to valid strings, max ~20 to avoid bloat
      const memories = arr.filter((m: unknown) => typeof m === 'string' && m.length > 0).slice(0, 20);
      return { memories };
    } catch {
      // Try to extract array from text if JSON parse failed
      const match = text.match(/\[([\s\S]*?)\]/);
      if (match) {
        try {
          const memories = JSON.parse(match[0]).filter((m: unknown) => typeof m === 'string' && m.length > 0).slice(0, 20);
          return { memories };
        } catch {}
      }
      console.warn('[memory-consolidator] JSON parse failed');
      return { memories: [] };
    }
  } catch {
    return { error: 'server:error' };
  }
}
