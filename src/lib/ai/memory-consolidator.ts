import { fetchWithTimeout } from './http';
import { gatewayChat, hasAiGatewayAccess } from './gateway';

const MEMORY_EXTRACTION_PROMPT =
  '你是一个记忆提取系统。从以下对话中提取关于用户的**关键事实**和**重要信息**。\n\n' +
  '规则：\n' +
  '- 只提取用户相关的信息（偏好、经历、观点、计划、人际关系等）\n' +
  '- 只记录用户明确说过、或从同一段话可以直接确定的内容；不要把角色的猜测当成事实\n' +
  '- 对“现在不是了”“我改成了”“其实……”这类纠正，保留新说法，不要继续输出已经被否定的旧说法\n' +
  '- 时间敏感的内容保留时间范围（例如“这周”“下个月”），不要写成永久事实\n' +
  '- 每条记忆一句话概括，简洁明确\n' +
  '- 不要提取 AI 角色自身的信息\n' +
  '- 不要提取闲聊、寒暄等无意义内容\n' +
  '- 如果对话中没有值得记忆的信息，返回空数组 []\n' +
  '- 用 JSON 数组格式返回，每个元素是一条字符串\n\n' +
  '示例输出：["用户喜欢喝咖啡，尤其是拿铁", "用户在学日语，目前 N3 水平", "用户下个月要去东京旅行"]';

export interface ConsolidateParams {
  apiKey: string;
  history: { role: string; content: string; sourceId?: string }[];
}

export interface ConsolidateResult {
  memories?: string[];
  evidence?: { content: string; sourceIds: string[] }[];
  error?: string;
}

export async function extractMemories(params: ConsolidateParams): Promise<ConsolidateResult> {
  const { apiKey, history } = params;
  const userMessage = '请从以下对话中提取用户的关键信息：';
  const systemPrompt = MEMORY_EXTRACTION_PROMPT + (history.some(m => m.sourceId)
    ? '\n本次原话附有 sourceId。改用 JSON 数组对象：{"content":"事实","sourceIds":["实际支持该事实的来源id"]}。只引用明确支持这条事实的消息，不要给每条事实附上整批来源。'
    : '');
  const sourceText = history.map(m => `${m.role}${m.sourceId ? ` [sourceId=${m.sourceId}]` : ''}: ${m.content}`).join('\n');
  const viaGateway = async (): Promise<ConsolidateResult> => {
    const result = await gatewayChat({
      apiKey: '', systemPrompt,
      message: `${userMessage}\n\n${sourceText}`,
      history: [], temperature: 0.3,
    });
    return parse(result.content);
  };
  const parse = (text: string): ConsolidateResult => {
    const parseItems = (arr: unknown): ConsolidateResult => {
      if (!Array.isArray(arr)) return { error: 'parse:error' };
      const allowed = new Set(history.map(m => m.sourceId).filter(Boolean));
      const memories: string[] = [];
      const evidence: { content: string; sourceIds: string[] }[] = [];
      for (const item of arr.slice(0, 20)) {
        if (typeof item === 'string' && item.trim()) memories.push(item.trim());
        else if (item && typeof item.content === 'string' && item.content.trim()) {
          const ids: string[] = Array.isArray(item.sourceIds) ? [...new Set<string>(item.sourceIds.filter((id: unknown): id is string => typeof id === 'string'))] : [];
          if (!ids.length || ids.some(id => !allowed.has(id))) continue;
          const content = item.content.trim();
          memories.push(content); evidence.push({ content, sourceIds: ids });
        }
      }
      return { memories, evidence };
    };
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed.memories ?? []);
      return parseItems(arr);
    } catch {
      const match = text.match(/\[([\s\S]*?)\]/);
      if (match) {
        try {
          return parseItems(JSON.parse(match[0]));
        } catch { /* retryable parse failure below */ }
      }
      return { error: 'parse:error' };
    }
  };
  if (!apiKey.trim()) {
    if (!hasAiGatewayAccess()) return { error: 'auth:invalid_key' };
    try {
      return await viaGateway();
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'server:error' };
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${userMessage}\n\n${sourceText}` },
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
      if (hasAiGatewayAccess()) {
        try { return await viaGateway(); } catch { /* report the original BYOK failure */ }
      }
      if (response.status === 401) return { error: 'auth:invalid_key' };
      if (response.status === 402) return { error: 'billing:insufficient' };
      if (response.status === 429) return { error: 'rate:limited' };
      return { error: 'server:error' };
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const text: string = choice?.message?.content ?? '';
    const parsed = parse(text);
    if (parsed.error === 'parse:error' && hasAiGatewayAccess()) {
      try { return await viaGateway(); } catch { /* preserve the original parse failure; the caller can retry */ }
    }
    return parsed;
  } catch {
    if (hasAiGatewayAccess()) {
      try {
        return await viaGateway();
      } catch { /* caller will retry using its durable cursor */ }
    }
    return { error: 'server:error' };
  }
}
