import { fetchWithTimeout } from './http';

/**
 * 长会话滚动摘要：把「超出保留窗口」的早期对话压缩成一段摘要，
 * 让角色在不逐条回忆的情况下仍能"记得"几天前的话题。
 */
const SUMMARY_PROMPT =
  '你是 VirtuGene 的对话档案管理员。请将以下一段早期对话压缩成一段 2-3 句话的中文摘要。\n' +
  '保留要点：\n' +
  '- 用户的关键偏好与事实（喜欢什么、做什么工作、有什么经历）\n' +
  '- 你们之间发生过的重要事件与对话主题\n' +
  '- 尚未完成的约定或承诺（用户答应过什么、你想追问什么）\n' +
  '- 关系进展与氛围变化\n' +
  '不要添加摘要之外的新信息，不要用列表，直接输出一段连贯的话。';

export interface SummarizeParams {
  apiKey: string;
  history: { role: string; content: string }[];
}

export interface SummarizeResult {
  summary?: string;
  error?: string;
}

export async function summarizeContext(params: SummarizeParams): Promise<SummarizeResult> {
  const { apiKey, history } = params;

  const messages = [
    { role: 'system', content: SUMMARY_PROMPT },
    {
      role: 'user',
      content: '请压缩以下早期对话：\n\n' + history.map((m) => `${m.role}: ${m.content}`).join('\n'),
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
          max_tokens: 500,
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
    const summary = text.trim().slice(0, 400);
    return summary.length > 0 ? { summary } : { error: 'server:error' };
  } catch {
    return { error: 'server:error' };
  }
}
