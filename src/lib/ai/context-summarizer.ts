import { fetchWithTimeout } from './http';
import { boundAuxiliaryHistory } from './history-window';
import { gatewayAux, hasAiGatewayAccess } from './gateway';

/**
 * 长会话滚动摘要：把「超出保留窗口」的早期对话压缩成一段摘要，
 * 让角色在不逐条回忆的情况下仍能"记得"几天前的话题。
 */
const SUMMARY_PROMPT =
  'Merge any previous compressed summary with the new dialogue. Preserve explicit user requests to remember, confirmed facts, promises, and unfinished items; do not invent or repeat stale details.\n' +
  '你是 VirtuGene 的对话档案管理员。请把早期对话整理成精简但可检索的中文连续性记录，最多 8 行、约 1800 字。\n' +
  '保留要点：\n' +
  '- 用户明确要求记住的事实、稳定偏好、重要经历与更正（更正覆盖旧说法）\n' +
  '- 共同经历的关键事情、具体细节与结论，不要只写泛泛主题\n' +
  '- 尚未完成的约定、计划、悬而未决的话题及由谁提出\n' +
  '- 角色明确说过的自身近况或承诺（只记录原对话有依据的内容）\n' +
  '- 关系变化与最近的话题落点，避免把已解决的旧话题写成仍未解决\n' +
  '按类别用短行记录；没有内容的类别省略。保留姓名、时间、对象、结果等细节。不要猜测，不要重复已被更正的旧事实。';

export interface SummarizeParams {
  apiKey: string;
  history: { role: string; content: string }[];
  previousSummary?: string;
  /** 用户明确要求长期保留的事实；压缩时必须带上，不能被旧对话截断丢掉。 */
  protectedMemories?: string[];
}

export interface SummarizeResult {
  summary?: string;
  error?: string;
  /** false 表示本地摘录兜底，不能据此推进会话摘要的覆盖游标。 */
  complete?: boolean;
}

/**
 * 临时离线兜底：模型或网关不可用时也保留一份可读的短记录。
 * 原始消息不会删除，下一次成功压缩时会再把它们合并进模型摘要。
 */
function buildLocalFallbackSummary(history: { role: string; content: string }[], previousSummary: string, protectedMemories: string[] = []): string {
  const recent = history
    .filter((item) => item.content.trim())
    .slice(-6)
    .map((item) => `${item.role === 'user' ? '用户' : '角色'}：${item.content.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
    .join('；');
  const protectedBlock = protectedMemories.length > 0
    ? `长期记住：${protectedMemories.slice(0, 8).map((item) => item.trim().slice(0, 160)).filter(Boolean).join('；')}`
    : '';
  const merged = protectedBlock
    ? `${protectedBlock}${previousSummary ? `；${previousSummary}` : ''}${recent ? `；近期对话：${recent}` : ''}`
    : previousSummary
    ? `${previousSummary}${recent ? `；近期对话：${recent}` : ''}`
    : recent;
  return merged.slice(0, 900);
}

export async function summarizeContext(params: SummarizeParams): Promise<SummarizeResult> {
  const { apiKey } = params;
  const history = boundAuxiliaryHistory(params.history);
  const previousSummary = params.previousSummary?.trim().slice(0, 2_500) ?? '';
  const protectedMemories = [...new Set((params.protectedMemories ?? [])
    .map((item) => item.trim().replace(/\s+/g, ' ').slice(0, 180))
    .filter(Boolean))].slice(0, 8);
  const protectedBlock = protectedMemories.length > 0
    ? `\n\n必须保留的用户明确记忆（不要改写成猜测，也不要遗漏）：\n${protectedMemories.map((item) => `- ${item}`).join('\n')}`
    : '';
  const previousBlock = previousSummary
    ? `\n\nPrevious compressed summary (keep valid facts):\n${previousSummary}`
    : '';

  const messages = [
    { role: 'system', content: SUMMARY_PROMPT },
    {
      role: 'user',
      content: '请压缩以下早期对话，并与之前的压缩摘要合并：\n\n' + history.map((m) => `${m.role}: ${m.content}`).join('\n') + protectedBlock + previousBlock,
    },
  ];

  if (!apiKey.trim()) {
    if (!hasAiGatewayAccess()) return { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
    return summarizeViaGateway(history, previousSummary, protectedMemories);
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
          max_tokens: 1_600,
          temperature: 0.3,
        }),
      },
      30_000,
    );

    if (!response.ok) {
      if (response.status === 401) return { error: 'auth:invalid_key' };
      if (response.status === 402) return { error: 'billing:insufficient' };
      if (response.status === 429) return { error: 'rate:limited' };
      if (hasAiGatewayAccess()) return summarizeViaGateway(history, previousSummary, protectedMemories);
      return { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const summary = text.trim();
    if (summary.length > 2_400) return { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
    if (summary.length > 0) return { summary, complete: true };
    if (hasAiGatewayAccess()) return summarizeViaGateway(history, previousSummary, protectedMemories);
    return { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
  } catch {
    if (hasAiGatewayAccess()) return summarizeViaGateway(history, previousSummary, protectedMemories);
    return { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
  }
}

async function summarizeViaGateway(history: { role: string; content: string }[], previousSummary = '', protectedMemories: string[] = []): Promise<SummarizeResult> {
  try {
    const result = await gatewayAux<{ summary?: unknown }>('context-summary', { history, previousSummary, protectedMemories });
    const summary = typeof result?.summary === 'string' ? result.summary.trim() : '';
    if (summary.length > 2_400) return { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
    return summary ? { summary, complete: true } : { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
  } catch {
    // Compression is background work. If the auxiliary provider is unavailable,
    // keep a local extractive record instead of blocking the chat or replacing a
    // valid previous summary with an error.
    return { summary: buildLocalFallbackSummary(history, previousSummary, protectedMemories), complete: false };
  }
}
