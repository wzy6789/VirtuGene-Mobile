import { db } from '../db/index';
import { messageRepo } from '../db/message-repo';

export interface HistoricalChatHit {
  messageId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/g, '');
}

function queryTerms(query: string): string[] {
  const text = normalize(query).replace(/你还?记得|还记得|记得吗|以前|之前|上次|那次|那件事|这件事|我们|你们|当时|后来|有没有|是不是|什么|为什么|怎么/u, '');
  const terms = new Set<string>();
  for (const match of text.matchAll(/[\p{L}\p{N}]{2,}/gu)) {
    const part = match[0];
    terms.add(part);
    if (/^[\u4e00-\u9fff]+$/u.test(part) && part.length > 2) {
      for (let index = 0; index + 2 <= part.length; index += 1) terms.add(part.slice(index, index + 2));
    }
  }
  return [...terms].slice(0, 24);
}

/**
 * 用户明确提起旧事时，从同一角色的私聊原文里补召回压缩摘要遗漏的细节。
 * 只读本账号的一对一会话；不读取群聊、失败消息或已删除消息，不发网络请求。
 */
export async function recallHistoricalPrivateChat(params: {
  userId: string;
  characterId: string;
  query: string;
  excludeMessageIds?: string[];
  limit?: number;
}): Promise<HistoricalChatHit[]> {
  const terms = queryTerms(params.query);
  if (terms.length === 0) return [];
  const excluded = new Set(params.excludeMessageIds ?? []);
  const sessions = await db.sessions.where('[characterId+userId]')
    .equals([params.characterId, params.userId])
    .filter((session) => session.type !== 'group')
    .toArray();
  const scored: (HistoricalChatHit & { score: number })[] = [];
  const now = Date.now();
  // This runs only for an explicit old-topic question. Page through every owned
  // one-to-one session; a fixed recent-session/message window silently loses
  // exactly the older detail the user is asking about.
  for (const session of sessions.sort((a, b) => b.updatedAt - a.updatedAt)) {
    let before: number | undefined;
    while (true) {
      const messages = await messageRepo.getPage(session.id, { limit: 400, ...(before === undefined ? {} : { before }) });
      if (messages.length === 0) break;
      for (const message of messages) {
      if (excluded.has(message.id) || message.failed || (message.role !== 'user' && message.role !== 'assistant')) continue;
      const content = normalize(message.content);
      if (!content) continue;
      const matches = terms.reduce((count, term) => count + Number(content.includes(term)), 0);
      if (matches === 0) continue;
      const exactPhrase = normalize(params.query).length >= 4 && content.includes(normalize(params.query));
      const ageDays = Math.max(0, (now - message.createdAt) / 86_400_000);
      scored.push({
        messageId: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content.trim().slice(0, 320),
        createdAt: message.createdAt,
        score: (exactPhrase ? 20 : 0) + matches * 2 + Math.max(0, 1 - ageDays / 365),
      });
      }
      if (messages.length < 400) break;
      before = messages[0].createdAt;
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    .slice(0, Math.max(1, params.limit ?? 3))
    .map(({ score: _score, ...hit }) => hit);
}

export function formatHistoricalPrivateChat(hits: HistoricalChatHit[]): string {
  if (hits.length === 0) return '';
  const lines = hits.map((hit) => {
    const date = new Date(hit.createdAt);
    const stamp = `${date.getMonth() + 1}月${date.getDate()}日`;
    return `- ${stamp} ${hit.role === 'user' ? '用户' : '你'}当时说：${hit.content}`;
  });
  return `【你们过去实际说过的话】\n${lines.join('\n')}\n这是原对话线索，按用户当前问题作答；不要照抄或把无关旧话题重新提起。`;
}
