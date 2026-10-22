import Dexie from 'dexie';
import { db, type Message } from './index';
import { invalidateUnpinnedMemoriesForMessages } from './memory-invalidation';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import { protectDeletedSessionMessages } from './message-deletion';
import { memoryLedgerRepo } from './memory-ledger-repo';
import { invalidateSessionSummarySources } from './session-summary-repo';
import {hasSettledReplyDelivery,normalizeImportedReplyDelivery} from '../lib/chat/reply-delivery';

/** 会话消息分页大小：进入会话时只加载最近 200 条，更早的消息按需加载 */
export const MESSAGE_PAGE_SIZE = 200;

/** Stable index position; a timestamp alone cannot identify a tied row. */
export type MessagePageCursor = Pick<Message, 'createdAt' | 'id'>;

/** Failure belongs to the exact user input, never a later edit or reused id. */
export function sameMessageFailureSource(current:Message|undefined,original:Message):boolean{
  const left=current?.secretaryDispatch,right=original.secretaryDispatch;
  const dispatchMatches=left===undefined&&right===undefined||!!left&&!!right
    &&left.taskId===right.taskId&&left.assistantName===right.assistantName&&left.bodyOrigin===right.bodyOrigin;
  return !!current&&original.role==='user'&&current.role===original.role&&current.id===original.id
    &&current.sessionId===original.sessionId&&current.content===original.content&&current.image===original.image
    &&(current.revision??1)===(original.revision??1)&&current.createdAt===original.createdAt&&dispatchMatches;
}
class MessageFailureContextChanged extends Error {}

export const messageRepo = {
  /** Close only loaded, owned stranded prefixes. No archive scan or generation.
   * Callers exclude a live session queue; native guards are repeated after I/O. */
  async settleInterruptedPrefixes(principal:{userId:string;characterId:string;sessionId:string;isCurrent:()=>boolean},loaded:Message[]):Promise<Message[]|undefined>{
    if(!principal.isCurrent()||loaded.length>MESSAGE_PAGE_SIZE)return;
    const ids=loaded.filter(row=>row.role==='assistant'&&!hasSettledReplyDelivery(row)).map(row=>row.id);
    if(!ids.length)return loaded;
    class DeliveryChanged extends Error {}
    try{return await db.transaction('rw',db.sessions,db.characters,db.messages,async()=>{
      const [session,actor]=await Promise.all([db.sessions.get(principal.sessionId),db.characters.get(principal.characterId)]);
      if(!principal.isCurrent()||session?.userId!==principal.userId||session.characterId!==principal.characterId||session.type==='group'
        ||actor?.createdBy!==principal.userId)return;
      const rows=await db.messages.bulkGet(ids),changed=new Map<string,Message>();
      for(const row of rows){
        if(!row||row.sessionId!==principal.sessionId||row.role!=='assistant'||hasSettledReplyDelivery(row))continue;
        const settled=normalizeImportedReplyDelivery(row);await db.messages.put(settled);changed.set(row.id,settled);
      }
      if(!principal.isCurrent())throw new DeliveryChanged();
      return loaded.map(row=>changed.get(row.id)??row);
    });}catch(error){if(error instanceof DeliveryChanged)return;throw error;}
  },
  /** 全量读取（后台分析用，如记忆/情绪结算，调用方自行 slice） */
  async getBySession(sessionId: string): Promise<Message[]> {
    return db.messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('createdAt');
  },

  /**
   * 分页读取：取该会话最近的 limit 条（升序返回）。
   * beforeMessage 用时间戳与主键继续翻页，避免同毫秒原话被跳过。
   * 旧 before 数字参数仍表示 createdAt < before，不改变旧调用含义。
   */
  async getPage(sessionId: string, opts: { limit?: number; before?: number; beforeMessage?: MessagePageCursor } = {}): Promise<Message[]> {
    const limit = Math.max(1, opts.limit ?? MESSAGE_PAGE_SIZE);
    const cursor=opts.beforeMessage;
    const upper = cursor ? [sessionId,cursor.createdAt,cursor.id]
      : opts.before != null ? [sessionId,opts.before,Dexie.minKey]
        : [sessionId,Dexie.maxKey,Dexie.maxKey];
    const rows = await db.messages
      .where('[sessionId+createdAt+id]')
      .between([sessionId,Dexie.minKey,Dexie.minKey],upper,true,!cursor&&opts.before==null)
      .reverse()
      .limit(limit)
      .toArray();
    return rows.reverse();
  },

  /** Read a bounded archive interval using its stable chronological index.
   * Both explicit cursors are exclusive. Results are always ascending, including
   * backward pages, so callers share the same tuple ordering at tied timestamps. */
  async getRangePage(sessionId: string, opts: {
    afterMessage?: MessagePageCursor;
    beforeMessage?: MessagePageCursor;
    direction: 'forward' | 'backward';
    limit: number;
  }): Promise<Message[]> {
    const after = opts.afterMessage, before = opts.beforeMessage;
    if (after && before && (after.createdAt > before.createdAt
      || after.createdAt === before.createdAt && after.id >= before.id)) return [];
    const limit = Math.max(1, Math.floor(Number.isFinite(opts.limit) ? opts.limit : MESSAGE_PAGE_SIZE));
    const lower = after ? [sessionId, after.createdAt, after.id] : [sessionId, Dexie.minKey, Dexie.minKey];
    const upper = before ? [sessionId, before.createdAt, before.id] : [sessionId, Dexie.maxKey, Dexie.maxKey];
    const interval = db.messages.where('[sessionId+createdAt+id]').between(lower, upper, !after, !before);
    if (opts.direction === 'backward') return (await interval.reverse().limit(limit).toArray()).reverse();
    return interval.limit(limit).toArray();
  },

  async countBySession(sessionId: string): Promise<number> {
    return db.messages.where('sessionId').equals(sessionId).count();
  },

  async countUserBySession(sessionId: string): Promise<number> {
    // Settlement scheduling must not deserialize every historical body after
    // each reply, holding the foreground session queue on a long archive.
    return db.messages.where('[sessionId+role]').equals([sessionId, 'user']).count();
  },

  /** 按 id 取消息（记忆溯源"看当时说的话"用） */
  async getById(id: string): Promise<Message | undefined> {
    return db.messages.get(id);
  },

  async getByIds(ids: string[]): Promise<Message[]> {
    if (ids.length === 0) return [];
    const items = await db.messages.bulkGet(ids);
    return items.filter((item): item is Message => !!item);
  },

  /** 取会话最后一条消息（利用复合索引，避免全量加载） */
  async getLast(sessionId: string): Promise<Message | undefined> {
    return db.messages
      .where('[sessionId+createdAt]')
      .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
      .last();
  },

  /** 取会话第一条消息（相识天数等统计用） */
  async getFirst(sessionId: string): Promise<Message | undefined> {
    return db.messages
      .where('[sessionId+createdAt]')
      .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
      .first();
  },

  async create(message: Message): Promise<string> {
    return db.transaction('rw', db.messages, db.sessions, db.groups, db.memoryJobs, db.characters, async () => {
      const session = await db.sessions.get(message.sessionId);
      const group = session?.type === 'group' && session.groupId ? await db.groups.get(session.groupId) : undefined;
      const witnessedBy = group && group.userId === session?.userId ? [...new Set(group.characterIds)] : undefined;
      const stored = { ...message, revision: message.revision ?? 1, witnessedBy };
      await db.messages.add(stored);
      if (session && stored.role === 'user' && stored.content.trim() && stored.secretaryDispatch?.bodyOrigin !== 'composed') {
        const characterIds = [...new Set(witnessedBy?.length ? witnessedBy : [session.characterId])];
        await queueMemoryExtraction(stored, session.userId, characterIds, session.type === 'group' ? 'group' : 'chat');
      }
      return stored.id;
    });
  },

  async deleteBySession(sessionId: string): Promise<void> {
    await db.transaction('rw', [db.messages, db.sessions, db.memories, db.memorySourceTombstones, db.memoryJobs, db.memoryClaims, db.memoryEvidence, db.memoryKnowledge, db.secretaryTasks, db.voiceCalls], async () => {
      await db.voiceCalls.where('sessionId').equals(sessionId).delete();
      const session = await db.sessions.get(sessionId);
      if (session) {
        const ids = await protectDeletedSessionMessages(sessionId, session.userId);
        await invalidateUnpinnedMemoriesForMessages(session.userId, ids);
        await invalidateSessionSummarySources(sessionId, ids);
        const messageIdSet = new Set(ids);
        await db.memoryJobs.where('userId').equals(session.userId).filter((job) => job.sourceIds.some((sourceId) => messageIdSet.has(sourceId)) && job.status !== 'done').modify({ status: 'cancelled', leaseUntil: undefined, updatedAt: Date.now() });
      }
      await db.messages.where('sessionId').equals(sessionId).delete();
      await db.secretaryTasks.where('sessionId').equals(sessionId).delete();
    });
  },

  async deleteById(id: string): Promise<void> {
    await db.transaction('rw', [db.messages, db.sessions, db.memories, db.memorySourceTombstones, db.memoryJobs, db.memoryClaims, db.memoryEvidence, db.memoryKnowledge, db.secretaryTasks, db.voiceCalls], async () => {
      const message = await db.messages.get(id);
      if (!message) return;
      await db.voiceCalls.where('sessionId').equals(message.sessionId).filter(call => call.messageIds.includes(id)).delete();
      const session = await db.sessions.get(message.sessionId);
      if (session) {
        await invalidateUnpinnedMemoriesForMessages(session.userId, [id]);
        await invalidateSessionSummarySources(session.id, [id]);
        await memorySourceTombstoneRepo.record({ userId: session.userId, sourceType: 'message', sourceId: id, sourceRevision: message.revision ?? 1, status: 'deleted' });
        await db.memoryJobs.where('userId').equals(session.userId).filter((job) => job.sourceIds.includes(id) && job.status !== 'done').modify({ status: 'cancelled', leaseUntil: undefined, updatedAt: Date.now() });
      }
      await db.messages.delete(id);
      await db.secretaryTasks.where('messageId').equals(id).delete();
      if (message.secretaryTaskId) await db.secretaryTasks.delete(message.secretaryTaskId);
    });
  },

  /** 标记发送失败/成功（微信式重发机制） */
  async markFailed(id: string, failed = true): Promise<number> {
    const count = await db.messages.update(id, { failed });
    if (!failed) {
      const message = await db.messages.get(id);
      const session = message ? await db.sessions.get(message.sessionId) : undefined;
      if (message?.role === 'user' && session) {
        const group = session.type === 'group' && session.groupId ? await db.groups.get(session.groupId) : undefined;
        const audience = group?.userId === session.userId ? [...new Set(group.characterIds)] : [session.characterId];
        await queueMemoryExtraction(message, session.userId, audience, session.type === 'group' ? 'group' : 'chat');
      }
    }
    return count;
  },

  /** A late transport/local failure can only mark its unchanged owned input.
   * The caller supplies fresh account identity; secretaries use private sessions
   * too, so this guard does not exclude their character profile. */
  async markFailedIfUnchanged(original:Message,userId:string,characterId:string,isCurrent:()=>boolean):Promise<boolean>{
    if(!userId||!characterId||!isCurrent())return false;
    try{
      return await db.transaction('rw',db.messages,db.sessions,async()=>{
        if(!isCurrent())return false;
        const [current,session]=await Promise.all([db.messages.get(original.id),db.sessions.get(original.sessionId)]);
        if(!session||session.userId!==userId||session.characterId!==characterId||session.type==='group'
          ||!sameMessageFailureSource(current,original)||!isCurrent())return false;
        const marked=await db.messages.update(original.id,{failed:true});
        if(!isCurrent())throw new MessageFailureContextChanged();
        return marked>0;
      });
    }catch(error){if(error instanceof MessageFailureContextChanged)return false;throw error;}
  },

  async update(id: string, patch: Partial<Message>): Promise<number> {
    if (patch.content === undefined) return db.messages.update(id, patch);
    return db.transaction('rw', [db.messages, db.sessions, db.memories, db.memorySourceTombstones, db.memoryJobs, db.groups, db.memoryClaims, db.memoryEvidence, db.memoryKnowledge, db.characters, db.voiceCalls], async () => {
      const current = await db.messages.get(id);
      if (!current) return 0;
      if (current.content !== patch.content) {
        await db.voiceCalls.where('sessionId').equals(current.sessionId).filter(call => call.messageIds.includes(id)).delete();
        const session = await db.sessions.get(current.sessionId);
        if (session) {
          await invalidateUnpinnedMemoriesForMessages(session.userId, [id]);
          await invalidateSessionSummarySources(session.id, [id]);
          await memorySourceTombstoneRepo.record({
            userId: session.userId,
            sourceType: 'message',
            sourceId: id,
            sourceRevision: current.revision ?? 1,
            status: 'superseded',
          });
          await db.memoryJobs.where('userId').equals(session.userId).filter((job) => job.sourceIds.includes(id) && job.status !== 'done').modify({ status: 'cancelled', leaseUntil: undefined, updatedAt: Date.now() });
        }
        const next = { ...current, ...patch, revision: (current.revision ?? 1) + 1 };
        const count = await db.messages.update(id, { ...patch, revision: next.revision });
        if (session && current.role === 'user' && next.content.trim()) {
          await db.memoryJobs.where('userId').equals(session.userId).filter((job) => job.sourceIds.includes(id) && job.status !== 'done').modify({ status: 'cancelled', leaseUntil: undefined, updatedAt: Date.now() });
          const group = session.type === 'group' && session.groupId ? await db.groups.get(session.groupId) : undefined;
          const audience = group?.userId === session.userId ? [...new Set(group.characterIds)] : [session.characterId];
          await queueMemoryExtraction(next, session.userId, audience, session.type === 'group' ? 'group' : 'chat');
        }
        return count;
      }
      return db.messages.update(id, patch);
    });
  },
};

function splitRanges(text: string, maxChars = 6_000): [number, number][] {
  const ranges: [number, number][] = [];
  for (let start = 0; start < text.length; start += maxChars) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length && end > start && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[end] ?? '')) end -= 1;
    if (end <= start) end = Math.min(text.length, start + maxChars + 1);
    ranges.push([start, end]);
    start = end - maxChars;
  }
  return ranges;
}

async function queueMemoryExtraction(
  message: Message,
  userId: string,
  characterIds: string[],
  sourceType: 'chat' | 'group',
): Promise<void> {
  if (message.secretaryDispatch?.bodyOrigin === 'composed') return;
  // Evidence offsets always address the stored original, including whitespace.
  const content = message.content;
  const audience = [...new Set(characterIds.filter(Boolean))];
  if (!content.trim() || !audience.length) return;
  const members = await db.characters.bulkGet(audience);
  // Even imported mixed groups must not turn assistant instructions into shared role memory.
  if (members.some(c => c?.agentProfile === 'secretary')) return;
  const ranges = splitRanges(content);
  for (const [start, end] of ranges) {
    if (!content.slice(start, end).trim()) continue;
    await memoryLedgerRepo.enqueue({
      userId,
      sessionId: message.sessionId,
      characterIds: audience,
      sourceType,
      sourceIds: [message.id],
      sourceRevisions: { [message.id]: message.revision ?? 1 },
      sourceOffsets: { [message.id]: start },
      sourceEndOffsets: { [message.id]: end },
      sourceCoordinateSystem: 'original',
      task: 'extract',
    });
  }
}
