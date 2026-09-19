import { fetchWithTimeout } from './http';
import { boundAuxiliaryHistory } from './history-window';
import { gatewayAux, hasAiGatewayAccess } from './gateway';

/**
 * 长会话滚动摘要：把「超出保留窗口」的早期对话压缩成一段摘要，
 * 让角色在不逐条回忆的情况下仍能"记得"几天前的话题。
 */
const SUMMARY_PROMPT =
  'Merge any previous compressed summary with the new dialogue. Preserve explicit user requests to remember, confirmed facts, promises, and unfinished items; do not invent or repeat stale details.\n' +
  '你是 VirtuGene 的对话档案管理员。请将以下一段早期对话压缩成一段 3-6 句的中文摘要。\n' +
  '保留要点：\n' +
  '- 用户的关键偏好与事实（喜欢什么、做什么工作、有什么经历）\n' +
  '- 你们之间发生过的重要事件与对话主题\n' +
  '- 尚未完成的约定或承诺（用户答应过什么、你想追问什么）\n' +
  '- 关系进展与氛围变化\n' +
  '不要添加摘要之外的新信息，不要用列表，直接输出一段连贯的话。';

export interface SummarizeParams {
  apiKey: string;
  history: { role: string; content: string }[];
  previousSummary?: string;
}

export interface SummarizeResult {
  summary?: string;
  error?: string;
}

/**
 * 临时离线兜底：模型或网关不可用时也保留一份可读的短记录。
 * 原始消息不会删除，下一次成功压缩时会再把它们合并进模型摘要。
 */
function buildLocalFallbackSummary(history: { role: string; content: string }[], previousSummary: string): string {
  const recent = history
    .filter((item) => item.content.trim())
    .slice(-6)
    .map((item) => `${item.role === 'user' ? '用户' : '角色'}：${item.content.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
    .join('；');
  const merged = previousSummary
    ? `${previousSummary}${recent ? `；近期对话：${recent}` : ''}`
    : recent;
  return merged.slice(0, 900);
}

export async function summarizeContext(params: SummarizeParams): Promise<SummarizeResult> {
  const { apiKey } = params;
  const history = boundAuxiliaryHistory(params.history);
  const previousSummary = params.previousSummary?.trim().slice(0, 2_500) ?? '';
  const previousBlock = previousSummary
    ? `\n\nPrevious compressed summary (keep valid facts):\n${previousSummary}`
    : '';

  const messages = [
    { role: 'system', content: SUMMARY_PROMPT },
    {
      role: 'user',
      content: '请压缩以下早期对话，并与之前的压缩摘要合并：\n\n' + history.map((m) => `${m.role}: ${m.content}`).join('\n') + previousBlock,
    },
  ];

  if (!apiKey.trim()) {
    if (!hasAiGatewayAccess()) return { summary: buildLocalFallbackSummary(history, previousSummary) };
    return summarizeViaGateway(history, previousSummary);
  }

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
          max_tokens: 700,
          temperature: 0.3,
        }),
      },
      30_000,
    );

    if (!response.ok) {
      if (response.status === 401) return { error: 'auth:invalid_key' };
      if (response.status === 402) return { error: 'billing:insufficient' };
      if (response.status === 429) return { error: 'rate:limited' };
      if (hasAiGatewayAccess()) return summarizeViaGateway(history, previousSummary);
      return { error: 'server:error' };
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const summary = text.trim().slice(0, 900);
    if (summary.length > 0) return { summary };
    if (hasAiGatewayAccess()) return summarizeViaGateway(history, previousSummary);
    return { summary: buildLocalFallbackSummary(history, previousSummary) };
  } catch {
    if (hasAiGatewayAccess()) return summarizeViaGateway(history, previousSummary);
    return { summary: buildLocalFallbackSummary(history, previousSummary) };
  }
}

async function summarizeViaGateway(history: { role: string; content: string }[], previousSummary = ''): Promise<SummarizeResult> {
  try {
    const result = await gatewayAux<{ summary?: unknown }>('context-summary', { history, previousSummary });
    const summary = typeof result?.summary === 'string' ? result.summary.trim().slice(0, 900) : '';
    return summary ? { summary } : { summary: buildLocalFallbackSummary(history, previousSummary) };
  } catch {
    // Compression is background work. If the auxiliary provider is unavailable,
    // keep a local extractive record instead of blocking the chat or replacing a
    // valid previous summary with an error.
    return { summary: buildLocalFallbackSummary(history, previousSummary) };
  }
}
