import { db } from '../db/index';
import { messageRepo } from '../db/message-repo';
import { memorySourceTombstoneRepo } from '../db/memory-source-tombstone-repo';
import Dexie from 'dexie';
import { memorySpeaker } from '../../server/memory-source-policy.mjs';

export interface HistoricalChatHit {
  messageId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  followsMessageId?:string;
  precedingUserText?:string;
  userAuthored?:boolean;
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
  currentSessionId?:string;
  limit?: number;
}): Promise<HistoricalChatHit[]> {
  const terms = queryTerms(params.query);
  if (terms.length === 0) return [];
  const excluded = new Set(params.excludeMessageIds ?? []);
  for (const id of await memorySourceTombstoneRepo.suppressedMessages(params.userId, params.characterId)) excluded.add(id);
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
        userAuthored:message.role==='user'&&message.secretaryDispatch?.bodyOrigin!=='composed',
        score: (exactPhrase ? 20 : 0) + matches * 2 + Math.max(0, 1 - ageDays / 365)
          + Number(/你.{0,6}(?:说过|讲过|答应)/u.test(params.query)?message.role==='assistant':message.role==='user'&&message.secretaryDispatch?.bodyOrigin!=='composed')*4,
      });
      }
      if (messages.length < 400) break;
      before = messages[0].createdAt;
    }
  }
  const selected=scored
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    .slice(0, Math.max(1, params.limit ?? 3))
    .map(({ score: _score, ...hit }) => hit);
  // Explicit positional references have no useful topical keyword. Resolve
  // the beginning of the owned active session instead of inventing an answer.
  if(params.currentSessionId&&sessions.some(s=>s.id===params.currentSessionId)
    &&/(?:我.{0,4})?(?:开头|一开始|最开始|第一句话).{0,8}(?:说|提)/u.test(params.query)) {
    const first=await db.messages.where('[sessionId+createdAt]')
      .between([params.currentSessionId,Dexie.minKey],[params.currentSessionId,Dexie.maxKey])
      .filter(m=>m.role==='user'&&m.secretaryDispatch?.bodyOrigin!=='composed'&&!m.failed&&!excluded.has(m.id)).limit(3).toArray();
    selected.unshift(...first.map(m=>({messageId:m.id,sessionId:m.sessionId,role:'user' as const,content:m.content.trim().slice(0,320),createdAt:m.createdAt,userAuthored:true})));
  }
  const result:HistoricalChatHit[]=[];
  for(const hit of selected) {
    if(result.some(row=>row.messageId===hit.messageId))continue;
    result.push(hit);
    if(hit.role!=='user'||hit.userAuthored===false)continue;
    // A correction may omit the original noun (“不是周五，是周四”). Keep
    // adjacent user corrections as separately sourced originals, not a merged
    // or interpreted fact, and stop at the next unrelated user turn.
    const next=await db.messages.where('[sessionId+createdAt]')
      .between([hit.sessionId,hit.createdAt],[hit.sessionId,Dexie.maxKey],false,true)
      .filter(m=>m.role==='user'&&!m.failed&&!excluded.has(m.id)).limit(3).toArray();
    for(const row of next) {
      if(row.secretaryDispatch?.bodyOrigin==='composed'||!/^(?:不是|不对|等等|刚才说错|我(?:刚才)?(?:说错|看错)|更正|改成|改到)/u.test(row.content.trim()))break;
      if(!result.some(item=>item.messageId===row.id))result.push({messageId:row.id,sessionId:row.sessionId,role:'user',content:row.content.trim().slice(0,320),createdAt:row.createdAt,followsMessageId:hit.messageId,precedingUserText:hit.content,userAuthored:true});
    }
  }
  return result;
}

export function formatHistoricalPrivateChat(hits: HistoricalChatHit[]): string {
  if (hits.length === 0) return '';
  const lines = hits.map((hit) => {
    const date = new Date(hit.createdAt);
    const stamp = `${date.getMonth() + 1}月${date.getDate()}日`;
    return `- ${stamp} ${memorySpeaker(hit.role, hit.userAuthored)}：${hit.content}`;
  });
  return `【你们过去实际说过的话】\n${lines.join('\n')}\n这是原对话线索，按用户当前问题作答；不要照抄或把无关旧话题重新提起。`;
}
