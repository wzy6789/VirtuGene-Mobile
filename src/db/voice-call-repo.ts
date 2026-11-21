import { db } from './index';
import { messageRepo } from './message-repo';
import { projectCallMessages, type VoiceCallRecord } from '../lib/voice-call/record';
import { useAuthStore } from '../store/auth-store';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import Dexie from 'dexie';
import {readValidatedConversation,updateConversationIfCurrent} from './chat-topic-state-repo';
import {emptyChatConversationState} from '../lib/chat-conversation-state';
import {advanceExplicitTopics} from '../lib/chat-topic-outcomes';
import {appendTopicReplyEvidence} from '../lib/chat-topic-replies';
import {allowsDramaticReply} from '../lib/chat-expression-boundary';

/** Audit data and its heard-speech projection commit atomically, using existing memory job rules. */
export const voiceCallRepo = {
  async save(record: VoiceCallRecord): Promise<VoiceCallRecord> {
    projectCallMessages(record);
    if (!Number.isFinite(record.startedAt) || !Number.isFinite(record.endedAt) || record.endedAt < record.startedAt) throw new Error('voice:record');
    return db.transaction('rw', db.tables, async () => {
      if (useAuthStore.getState().userId !== record.userId) throw new Error('voice:account_changed');
      const [session, character, existing] = await Promise.all([
        db.sessions.get(record.sessionId), db.characters.get(record.characterId), db.voiceCalls.get(record.id),
      ]);
      if (!session || session.userId !== record.userId || session.characterId !== record.characterId || session.type === 'group'
        || !character || character.createdBy !== record.userId || character.agentProfile === 'secretary') throw new Error('voice:context_changed');
      if (existing) {
        if (existing.userId !== record.userId || existing.sessionId !== record.sessionId || existing.characterId !== record.characterId) throw new Error('voice:record_collision');
        if (existing.status !== 'active' || existing.exchanges.length > record.exchanges.length) return existing;
      }
      // Previous committed turns are immutable; only append new completed/interrupted turns.
      const exchanges = [...(existing?.exchanges ?? []), ...record.exchanges.slice(existing?.exchanges.length ?? 0)].map((exchange, index) => ({
        ...exchange, recordedAt: exchange.recordedAt ?? record.endedAt + index * 2,
      }));
      const rows = projectCallMessages({ ...record, exchanges });
      const [originals,withdrawn]=await Promise.all([db.messages.bulkGet(rows.map(row=>row.id)),
        memorySourceTombstoneRepo.blocksImports(rows.map(row=>({userId:record.userId,sourceType:'message' as const,sourceId:row.id,sourceRevision:1})))]);
      const newUsers=[];
      for (const [index,row] of rows.entries()) {
        if (withdrawn[index]) throw new Error('voice:source_withdrawn');
        const current = originals[index];
        if (existing?.messageIds.includes(row.id)) {
          if (!current || current.sessionId !== row.sessionId || current.role !== row.role || current.content !== row.content) throw new Error('voice:source_changed');
          continue;
        }
        if (current) throw new Error('voice:message_collision');
        await messageRepo.create(row);
        if(row.role==='user')newUsers.push(row);
      }
      if(newUsers.length){
        const principal={userId:record.userId,characterId:record.characterId,sessionId:record.sessionId,isCurrent:()=>useAuthStore.getState().userId===record.userId};
        const previous=await readValidatedConversation(principal);
        if(!previous)throw new Error('voice:context_changed');
        let conversation=previous.conversation??emptyChatConversationState();
        const recent=await messageRepo.getPage(record.sessionId,{limit:80});
        const suppressed=await memorySourceTombstoneRepo.selectedSuppressedMessages(record.userId,record.characterId,recent.map(row=>row.id));
        for(const user of newUsers){
          if(user.createdAt<(conversation.appliedThrough?.observedAt??-Infinity))continue;
          const history=recent.filter(row=>row.role==='user'&&!row.failed&&!row.secretaryDispatch&&!suppressed.has(row.id)&&row.createdAt<user.createdAt).map(row=>row.content);
          const domain=allowsDramaticReply(user.content,history)?'story':'user-reality';
          conversation={...conversation,...advanceExplicitTopics(conversation,{message:user,domain,utcOffsetMinutes:new Date(user.createdAt).getTimezoneOffset()})};
          conversation=appendTopicReplyEvidence(conversation,user,rows.filter(row=>row.role==='assistant'&&row.replyToUserMessageId===user.id),domain);
        }
        if(!await updateConversationIfCurrent(principal,previous.version,conversation))throw new Error('voice:context_changed');
      }
      const saved = { ...record, summary: undefined, summaryParts: undefined, summaryTotalParts: undefined, summaryState: 'pending' as const, messageIds: rows.map(row => row.id),
        exchanges: exchanges.map(exchange => ({ ...exchange, heardText: rows.find(row => row.id === `voice:${record.id}:${exchange.turnId}:assistant`)?.content ?? '' })) };
      await db.voiceCalls.put(saved);
      await db.sessions.update(record.sessionId, { updatedAt: Math.max(record.endedAt, session.updatedAt) });
      if (useAuthStore.getState().userId !== record.userId) throw new Error('voice:account_changed');
      return saved;
    });
  },
  async get(id: string, userId: string): Promise<VoiceCallRecord | undefined> {
    if (useAuthStore.getState().userId !== userId) return;
    const row = await db.voiceCalls.get(id);
    return useAuthStore.getState().userId === userId && row?.userId === userId ? row : undefined;
  },
  async list(sessionId: string, userId: string, options: { before?: number; beforeId?: string; limit?: number } = {}): Promise<VoiceCallRecord[]> {
    if (useAuthStore.getState().userId !== userId) return [];
    const session = await db.sessions.get(sessionId);
    if (session?.userId !== userId) return [];
    const rows = await db.voiceCalls.where('[sessionId+endedAt]').between([sessionId, Dexie.minKey], [sessionId, options.before ?? Dexie.maxKey], true, options.before === undefined || !!options.beforeId)
      .reverse().filter(row => row.userId === userId && !(options.beforeId && row.endedAt === options.before && row.id >= options.beforeId)).limit(Math.max(1, Math.min(50, options.limit ?? 20))).toArray();
    return useAuthStore.getState().userId === userId ? rows : [];
  },
};
