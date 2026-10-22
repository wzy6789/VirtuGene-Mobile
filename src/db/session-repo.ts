import { db, type Session } from './index';
import { invalidateSessionSummaryMemory, invalidateUnpinnedMemoriesForMessages } from './memory-invalidation';
import { protectDeletedSessionMessages } from './message-deletion';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import {updateConversationIfCurrent} from './chat-topic-state-repo';

export interface SummaryWriteGuard {
  previousSummary?:string;
  protectedMemories?:Record<string,number>;
  expectedSummaryRevision?:number;
  expectedConversationVersion?:number;
  coveragePolicy?:Session['summaryCoveragePolicy'];
  principal?:{userId:string;characterId:string;privateOnly?:boolean;isCurrent?:()=>boolean};
}
class SummaryPrincipalChanged extends Error {}
function matchesSummaryGuard(session:Session|undefined,guard?:SummaryWriteGuard):session is Session{
  if(!session||guard?.principal?.isCurrent?.()===false||(guard&&session.summary!==guard.previousSummary))return false;
  if(guard?.principal&&(session.userId!==guard.principal.userId||session.characterId!==guard.principal.characterId))return false;
  if(guard?.principal?.privateOnly&&session.type==='group')return false;
  if(guard?.expectedSummaryRevision!==undefined&&(!Number.isSafeInteger(guard.expectedSummaryRevision)||guard.expectedSummaryRevision<0||(session.summaryRevision??0)!==guard.expectedSummaryRevision))return false;
  if(guard?.expectedConversationVersion!==undefined&&(!Number.isSafeInteger(guard.expectedConversationVersion)||guard.expectedConversationVersion<0||(session.conversation?.version??0)!==guard.expectedConversationVersion))return false;
  return true;
}

export const sessionRepo = {
  updateConversationIfCurrent,
  /** 该用户全部会话（补记助手等场景需要跨角色收集某天的对话） */
  async getByUser(userId: string): Promise<Session[]> {
    return db.sessions
      .where('userId')
      .equals(userId)
      .toArray()
      .then((arr) => arr.sort((a, b) => b.updatedAt - a.updatedAt));
  },

  async getByCharacter(characterId: string, userId: string): Promise<Session[]> {
    const sessions = await db.sessions
      .where('[characterId+userId]')
      .equals([characterId, userId])
      .toArray();
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getById(id: string): Promise<Session | undefined> {
    return db.sessions.get(id);
  },

  /** Fresh indexed authorization without cloning a long summary's source maps.
   * The caller still reads the full session when it actually needs its context. */
  async isOwnedPrivateSession(id: string, userId: string, characterId: string): Promise<boolean> {
    return db.transaction('r', db.sessions, async () => {
      const [owned, groups] = await Promise.all([
        db.sessions.where('[characterId+userId]').equals([characterId, userId]).primaryKeys(),
        db.sessions.where('[characterId+userId+type]').equals([characterId, userId, 'group']).primaryKeys(),
      ]);
      return owned.includes(id) && !groups.includes(id);
    });
  },

  async create(session: Session): Promise<string> {
    return db.sessions.add(session);
  },

  async updateTitle(id: string, title: string): Promise<number> {
    return db.sessions.update(id, { title, updatedAt: Date.now() });
  },

  async touch(id: string): Promise<number> {
    return db.sessions.update(id, { updatedAt: Date.now() });
  },

  async markSummaryAttempt(id: string, attemptedAt = Date.now(),guard?:SummaryWriteGuard): Promise<number> {
    // 不改会话 updatedAt：失败的后台摘要不能伪装成用户最近聊过。
    try{return await db.transaction('rw',db.sessions,async()=>{
      if(!matchesSummaryGuard(await db.sessions.get(id),guard))return 0;
      const written=await db.sessions.update(id,{summaryAttemptedAt:attemptedAt});
      if(guard?.principal?.isCurrent?.()===false)throw new SummaryPrincipalChanged();
      return written;
    });}catch(error){if(error instanceof SummaryPrincipalChanged)return 0;throw error;}
  },

  async update(id: string, patch: Partial<Session>): Promise<number> {
    return db.sessions.update(id, { ...patch, updatedAt: Date.now() });
  },

  async updateSummary(
    id: string,
    summary: string,
    witnessedBy?: string[],
    sourceMessageIds?: string[],
    sourceMessageRevisions?: Record<string, number>,
    sourceMessageOffsets?: Record<string, number>,
    guard?: SummaryWriteGuard,
  ): Promise<number> {
    const patch: Partial<Session> = {
      summary,
      summaryUpdatedAt: Date.now(),
      summaryAttemptedAt: undefined,
      summaryCoveragePolicy: guard?.coveragePolicy,
      ...(sourceMessageIds ? {
        summarySourceMessageIds: [...new Set(sourceMessageIds)],
        summarySourceMessageRevisions: sourceMessageRevisions ?? {},
        summarySourceMessageOffsets: sourceMessageOffsets ?? {},
      } : {}),
    };
    if (witnessedBy) patch.summaryWitnessedBy = [...new Set(witnessedBy)].sort();
    const current=()=>guard?.principal?.isCurrent?.()!==false;
    try{return await db.transaction('rw', [db.sessions, db.messages, db.memories, db.memorySourceTombstones], async () => {
      if(!current())return 0;
      const session = await db.sessions.get(id);
      if (!matchesSummaryGuard(session,guard)) return 0;
      if(!Number.isSafeInteger(session.summaryRevision??0)||(session.summaryRevision??0)<0||(session.summaryRevision??0)>=Number.MAX_SAFE_INTEGER)return 0;
      const audiences = witnessedBy?.length ? witnessedBy : [session.characterId];
      const ids=[...new Set(sourceMessageIds??[])];
      const protectedEntries=Object.entries(guard?.protectedMemories??{});
      const [sources,protectedRows,suppressionSets]=await Promise.all([
        db.messages.bulkGet(ids),db.memories.bulkGet(protectedEntries.map(([memoryId])=>memoryId)),
        Promise.all(audiences.map(actor=>memorySourceTombstoneRepo.selectedSuppressedMessages(session.userId,actor,ids))),
      ]);
      for (let i=0;i<ids.length;i++) {
        const sourceId=ids[i],message=sources[i],offset=sourceMessageOffsets?.[sourceId];
        if (!message || message.sessionId !== id || message.failed || suppressionSets.some(ids => ids.has(sourceId))
          || (message.revision ?? 1) !== (sourceMessageRevisions?.[sourceId] ?? 1)
          ||(offset!==undefined&&(!Number.isInteger(offset)||offset<0||offset>message.content.length))) return 0;
      }
      for (let i=0;i<protectedEntries.length;i++) {
        const [,revision]=protectedEntries[i],memory=protectedRows[i];
        if (!memory || memory.userId !== session.userId || memory.characterId !== session.characterId
          || !memory.pinned || (memory.status ?? 'active') !== 'active' || (memory.updatedAt ?? memory.createdAt) !== revision) return 0;
      }
      if(!current())return 0;
      const written=await db.sessions.update(id,{...patch,summaryRevision:(session.summaryRevision??0)+1});
      if(!current())throw new SummaryPrincipalChanged();
      return written;
    });}catch(error){if(error instanceof SummaryPrincipalChanged)return 0;throw error;}
  },

  async deleteById(id: string): Promise<void> {
    await db.transaction('rw', [db.sessions, db.messages, db.memories, db.memorySourceTombstones, db.memoryClaims, db.memoryEvidence, db.memoryKnowledge, db.memoryJobs, db.secretaryTasks, db.voiceCalls], async () => {
      await db.voiceCalls.where('sessionId').equals(id).delete();
      await db.secretaryTasks.where('sessionId').equals(id).delete();
      const session = await db.sessions.get(id);
      if (session) {
        const ids = await protectDeletedSessionMessages(id, session.userId);
        await invalidateUnpinnedMemoriesForMessages(session.userId, ids);
        await invalidateSessionSummaryMemory(session.userId, session.id);
        const messageIds = new Set(ids);
        await db.memoryJobs.where('userId').equals(session.userId)
          .filter((job) => job.sourceIds.some((sourceId) => messageIds.has(sourceId)) && job.status !== 'done')
          .modify({ status: 'cancelled', leaseUntil: undefined, updatedAt: Date.now() });
      }
      await db.sessions.delete(id);
      await db.messages.where('sessionId').equals(id).delete();
    });
  },

  async incrementUnread(id: string): Promise<void> {
    const s = await db.sessions.get(id);
    if (s) await db.sessions.update(id, { unreadCount: (s.unreadCount ?? 0) + 1 });
  },

  async clearUnread(id: string): Promise<void> {
    await db.sessions.update(id, { unreadCount: 0 });
  },

  async getTotalUnread(userId: string): Promise<number> {
    const all = await db.sessions.where('userId').equals(userId).toArray();
    return all.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0);
  },

  async getUnreadByCharacter(characterId: string, userId: string): Promise<number> {
    const sessions = await db.sessions
      .where('[characterId+userId]')
      .equals([characterId, userId])
      .toArray();
    return sessions.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0);
  },
};
