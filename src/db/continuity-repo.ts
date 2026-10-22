import { db, type ContinuityThread, type ContinuityChatEvidence,type Message } from './index';
import {continuityEvidenceSources,mergeContinuityChatEvidence,readContinuitySourceBatch,explicitlyCompletesManualThread,captureContinuityChatEvidence} from '../lib/continuity-sources';
import {parseContinuityReopenRequest,type ContinuityReopenRequest} from '../lib/chat-topic-controls';
import {isContinuityFocusResume} from '../lib/chat-topic-controls';
import type {ContinuityFocus} from '../lib/chat-topic-outcomes';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import {
  removeContinuityThreadFromWorld,
  syncContinuityThreadToWorld,
} from '../lib/world/world-writer';

/** 每个角色最多同时挂着的「未完成事件」数量；超出时把最旧的归档，而不是删掉。 */
export const MAX_OPEN_THREADS = 8;

const mutationTables=[db.continuityThreads,db.characterStates,db.characters,db.memorySourceTombstones];
async function advanceContinuityRevision(characterId:string,userId:string){
  const character=await db.characters.get(characterId);
  if(character?.createdBy!==userId)return; // Deleted characters must not gain orphan state.
  const state=await db.characterStates.get([characterId,userId]);
  const revision=state?.continuityRevision??0;
  if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw Error('continuity:invalid_revision');
  await db.characterStates.put({...state,characterId,userId,affinity:state?.affinity??0,mood:state?.mood??70,milestones:state?.milestones??[],updatedAt:state?.updatedAt??Date.now(),continuityRevision:revision+1});
}
async function mutateThread(id:string,change:(existing:ContinuityThread)=>ContinuityThread,validate?:(existing:ContinuityThread)=>Promise<boolean>){
  return db.transaction('rw',validate?[...mutationTables,db.messages,db.sessions]:mutationTables,async()=>{
    const existing=await db.continuityThreads.get(id);
    if(!existing||validate&&!await validate(existing))return;
    const next=change(existing);await db.continuityThreads.put(next);
    await advanceContinuityRevision(next.characterId,next.userId);
    return next;
  });
}

async function completeThread(id:string,sourceMessageIds?:string[],sourceEvidence?:ContinuityChatEvidence,expected?:ContinuityThread){
  const now=Date.now();
  const automatic=sourceMessageIds!==undefined||sourceEvidence!==undefined;
  const next=await mutateThread(id,existing=>({
    ...existing,status:'done',completedAt:now,updatedAt:now,
    ...(sourceMessageIds?.length?{
      sourceMessageIds:Array.from(new Set([...(existing.sourceMessageIds??[]),...sourceMessageIds])).slice(-6),
      sourceEvidence:mergeContinuityChatEvidence(existing,{sourceMessageIds,sourceEvidence}),
    }:{}),
  }),automatic?async existing=>{
    if(expected&&JSON.stringify(existing)!==JSON.stringify(expected))return false;
    // Validate only the selected incoming originals, inside this mutation's
    // native transaction. Never read all chat or re-certify an old revision.
    const proxy:ContinuityThread={...existing,origin:'ai',sourceSceneId:undefined,sourceWorldEventId:undefined,sourceMessageIds,sourceEvidence};
    const verified=(await readContinuitySourceBatch({userId:existing.userId,characterId:existing.characterId},[proxy],false)).get(id);
    if(!verified)return false;
    if(existing.origin!=='user')return true;
    return sourceEvidence!.sources.some(ref=>{
      const message=verified.messages.find(row=>row.id===ref.messageId);
      return !!message&&explicitlyCompletesManualThread(existing.title,message.content.slice(ref.start,ref.end));
    });
  }:undefined);
  if(!next)return false;
  await syncThreadSafely(next);
  return true;
}

export type ContinuityKind = ContinuityThread['kind'];

export const CONTINUITY_KINDS: { key: ContinuityKind; label: string; hint: string }[] = [
  { key: 'promise', label: '承诺', hint: '答应过对方的事' },
  { key: 'plan', label: '计划', hint: '说好要一起做、还没做' },
  { key: 'topic', label: '话题', hint: '聊到一半、还没说完' },
  { key: 'conflict', label: '分歧', hint: '还没化解的不愉快' },
  { key: 'reminder', label: '提醒', hint: '某天要记得的事' },
];

export const KIND_LABEL: Record<ContinuityKind, string> = {
  promise: '承诺',
  plan: '计划',
  topic: '话题',
  conflict: '分歧',
  reminder: '提醒',
};

/** 状态文案：区分「用户自己说不聊了」与「因为超上限被系统自动收起」 */
export const STATUS_LABEL: Record<ContinuityThread['status'], string> = {
  open: '还没做完',
  done: '已完成',
  dropped: '你说稍后再说',
  archived: '自动收起（超出上限）',
};

/** 归一化：去掉标点与空白，便于比较两条线索是不是同一件事。 */
export function normalizeContinuityTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。、！？；：,.!?;:'"“”‘’（）()\[\]【】—\-…~]/g, '');
}
const normalize=normalizeContinuityTitle;

/** 世界层同步一律"失败不阻断"：派生数据写不进去，不能影响未完成事件本身 */
async function syncThreadSafely(thread: ContinuityThread): Promise<void> {
  try {
    await syncContinuityThreadToWorld({ userId: thread.userId, thread });
  } catch (err) {
    console.warn('[world] 未完成事件同步失败（不影响线索）:', err);
  }
}

async function removeThreadFromWorldSafely(userId: string, threadIds: string[]): Promise<void> {
  try {
    await removeContinuityThreadFromWorld(userId, threadIds);
  } catch (err) {
    console.warn('[world] 派生世界事件移除失败（不影响线索删除）:', err);
  }
}

export interface NewThreadInput {
  /** Explicitly selected from this job's observed records; never title fallback. */
  targetId?:string;
  expectedThread?:ContinuityThread;
  characterId: string;
  userId: string;
  kind: ContinuityKind;
  title: string;
  detail?: string;
  dueAt?: number;
  sourceMessageIds?: string[];
  sourceEvidence?:ContinuityChatEvidence;
  origin?: 'ai' | 'user';
  /** 5.0：来自某场 World Stage / 某条世界事件时的来源（4.x 数据为空） */
  sourceSceneId?: string;
  sourceWorldEventId?: string;
}
export interface ContinuityResumeResult {context:string;thread?:ContinuityThread}

/**
 * 未完成事件仓库。
 * 设计约束：只有明确出现的约定/计划/话题/冲突/提醒才允许进来；
 * 同一件事不会因为反复提起而重复入库；超过上限时最旧的自动归档（可再打开）。
 */
export const continuityRepo = {
  async getById(id: string): Promise<ContinuityThread | undefined> {
    return db.continuityThreads.get(id);
  },

  async getByIds(ids: string[]): Promise<ContinuityThread[]> {
    if (ids.length === 0) return [];
    const items = await db.continuityThreads.bulkGet(ids);
    return items.filter((item): item is ContinuityThread => !!item);
  },

  async getByCharacter(characterId: string, userId: string): Promise<ContinuityThread[]> {
    const all = await db.continuityThreads.where('characterId').equals(characterId).toArray();
    return all
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** 只取还挂着的（open），供上下文注入与 Shared Space 展示 */
  async getOpenByCharacter(characterId: string, userId: string): Promise<ContinuityThread[]> {
    const all = await db.continuityThreads.where('[characterId+status]').equals([characterId,'open']).toArray();
    return all
      .filter((t) => t.userId === userId)
      .sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt)||b.updatedAt-a.updatedAt);
  },

  /**
   * 该用户**全部角色**还挂着的未完成事件（世界页「未完成的故事」用）。
   * 按约定时间/创建时间排序，让"最该先看见的"排在前面。
   */
  async getOpenByUser(userId: string): Promise<ContinuityThread[]> {
    const all = await db.continuityThreads.where('userId').equals(userId).toArray();
    return all
      .filter((t) => t.status === 'open')
      .sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt));
  },

  async getAllByUser(userId: string): Promise<ContinuityThread[]> {
    return db.continuityThreads.where('userId').equals(userId).toArray();
  },

  async countOpen(characterId: string, userId: string): Promise<number> {
    return (await this.getOpenByCharacter(characterId, userId)).length;
  },

  /**
   * 批量写入分析结果。返回真正新增的条数。
   * - 更新已有事项须匹配选中的快照；去重须同类型、标题、日期、场景及来源证据。
   * - 标题相近不足以认定同一件事；不同日期或独立来源保留独立事项。
   * - open 超过 MAX_OPEN_THREADS 时，最旧的置为 archived，保留用户暂停的独立语义。
   */
  async createMany(inputs: NewThreadInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const characterId = inputs[0].characterId;
    const userId = inputs[0].userId;
    if(inputs.some(input=>input.characterId!==characterId||input.userId!==userId))return 0;
    let created = 0;
    /** 需要同步进世界层的线索（新增的 + 被更新的同一件事） */
    const touched: ContinuityThread[] = [];

    // Only selected private-source updates need these stores. Ordinary world
    // creation must remain compatible with its enclosing world transaction.
    const tables=inputs.some(input=>input.targetId&&input.origin!=='user')
      ?[...mutationTables,db.messages,db.sessions]:mutationTables;
    await db.transaction('rw', tables, async () => {
      const existing = (await db.continuityThreads.where('[characterId+status]').equals([characterId,'open']).toArray())
        .filter((t) => t.userId === userId);
      const open = existing.filter((t) => t.status === 'open');
      const pool = [...open];
      const now = Date.now();

      for (const input of inputs) {
        const title = input.title.trim().slice(0, 60);
        if (!title) continue;
        let duplicate:ContinuityThread|undefined;
        if(input.targetId){
          const selected=await db.continuityThreads.get(input.targetId);
          if(!selected||selected.userId!==userId||selected.characterId!==characterId||selected.kind!==input.kind
            ||selected.status!=='open'||!input.expectedThread||JSON.stringify(selected)!==JSON.stringify(input.expectedThread))continue;
          if(input.origin!=='user'&&!(await readContinuitySourceBatch({userId,characterId},[selected],false)).has(selected.id))continue;
          duplicate=selected;
        }else{
          // A model must not create a shadow copy of a user's hand-kept record.
          if(input.origin!=='user'&&pool.some(t=>t.origin==='user'&&t.kind===input.kind&&normalize(t.title)===normalize(title)
            &&t.dueAt===input.dueAt&&t.sourceSceneId===input.sourceSceneId&&t.sourceWorldEventId===input.sourceWorldEventId))continue;
          const candidates=pool.filter(t=>t.kind===input.kind&&normalize(t.title)===normalize(title)
            &&t.dueAt===input.dueAt&&t.sourceSceneId===input.sourceSceneId&&t.sourceWorldEventId===input.sourceWorldEventId);
          const incoming=continuityEvidenceSources(input.sourceEvidence,input.sourceMessageIds);
          const proven=candidates.filter(t=>{
            if(t.origin==='user'&&input.origin==='user')return (t.detail??'')===(input.detail?.trim().slice(0,200)??'');
            if(input.sourceWorldEventId)return t.sourceWorldEventId===input.sourceWorldEventId;
            const previous=continuityEvidenceSources(t.sourceEvidence,t.sourceMessageIds);
            return !!previous&&!!incoming&&previous.some(a=>incoming.some(b=>a.messageId===b.messageId&&a.sessionId===b.sessionId&&a.revision===b.revision));
          });
          if(proven.length===1)duplicate=proven[0];
        }
        if (duplicate) {
          // An automatic extraction cannot silently rewrite a user's record.
          if(duplicate.origin==='user'&&input.origin!=='user')continue;
          const mergedIds = Array.from(new Set([...(duplicate.sourceMessageIds ?? []), ...(input.sourceMessageIds ?? [])]));
          const merged: ContinuityThread = {
            ...duplicate,
            detail: input.detail?.trim().slice(0, 200) || duplicate.detail,
            dueAt: input.dueAt ?? duplicate.dueAt,
            sourceMessageIds: mergedIds.slice(-6),
            sourceEvidence:input.origin==='user'?undefined:mergeContinuityChatEvidence(duplicate,input),
            ...(input.origin==='user'?{origin:'user' as const}:{}),
            updatedAt: now,
          };
          await db.continuityThreads.put(merged);
          const idx = pool.findIndex((t) => t.id === duplicate.id);
          if (idx >= 0) pool[idx] = merged;
          // 同一件事再次被提起：也要同步（世界层是幂等的，只更新同一条）
          touched.push(merged);
          continue;
        }
        const thread: ContinuityThread = {
          id: crypto.randomUUID(),
          characterId,
          userId,
          kind: input.kind,
          title,
          ...(input.detail?.trim() ? { detail: input.detail.trim().slice(0, 200) } : {}),
          status: 'open',
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
          sourceMessageIds: (input.sourceMessageIds ?? []).slice(-6),
          ...(continuityEvidenceSources(input.sourceEvidence,input.sourceMessageIds)?{sourceEvidence:input.sourceEvidence}:{}),
          ...(input.sourceSceneId ? { sourceSceneId: input.sourceSceneId } : {}),
          ...(input.sourceWorldEventId ? { sourceWorldEventId: input.sourceWorldEventId } : {}),
          origin: input.origin ?? 'ai',
          createdAt: now + created,
          updatedAt: now + created,
        };
        await db.continuityThreads.put(thread);
        pool.push(thread);
        touched.push(thread);
        created += 1;
      }

      const stillOpen = pool
        .filter((t) => t.status === 'open')
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (stillOpen.length > MAX_OPEN_THREADS) {
        // 超出上限只「自动收起」最旧的几条（保留原文与时间，用户可随时重新挂起），不做删除。
        // 用 archived 而不是 dropped：dropped 是用户自己说"稍后再说"，系统不该混用这个语义。
        const archived = stillOpen
          .slice(MAX_OPEN_THREADS)
          .map((t) => ({ ...t, status: 'archived' as const }));
        await db.continuityThreads.bulkPut(archived);
        // 归档也是状态变化：派生世界事件必须同步（否则世界里仍显示为"还挂着"）
        touched.push(...archived);
      }
      if(touched.length)await advanceContinuityRevision(characterId,userId);
    });

    // 5.0（Phase 2b-0）：约定 / 未完成事项同步进世界层（零额外 AI 调用，纯本地派生）
    for (const thread of touched) {
      try {
        await syncContinuityThreadToWorld({ userId, thread });
      } catch (err) {
        console.warn('[world] 未完成事件同步进世界层失败（不影响线索本身）:', err);
      }
    }

    return created;
  },

  /** 用户手动添加一条未完成事件（不走去重以外的 AI 逻辑） */
  async create(input: NewThreadInput): Promise<void> {
    await this.createMany([{ ...input, origin: input.origin ?? 'user' }]);
  },

  /**
   * 把标题与已有线索匹配后标记完成。
   * - 先在还挂着的线索里找；找不到再找「被系统自动收起」的（那件事真的发生过，只是当时排不下了）。
   * - 不匹配用户自己说了「稍后再说」的线索（尊重用户的选择）。
   * - 完全找不到就不动，绝不会凭空造一条「已完成」的记录。
   */
  async completeByTitle(
    characterId: string,
    userId: string,
    title: string,
    sourceMessageIds?: string[],
    kind?: ContinuityKind,
    sourceEvidence?:ContinuityChatEvidence,
  ): Promise<boolean> {
    const all = await this.getByCharacter(characterId, userId);
    const open = all.filter((t) => t.status === 'open');
    const archived = all.filter((t) => t.status === 'archived');
    const candidates=[...open,...archived].filter(t=>(!kind||t.kind===kind)&&normalize(t.title)===normalize(title));
    // Equal-looking records from different scenes/dates are not interchangeable.
    if(candidates.length!==1)return false;
    const hit=candidates[0];
    if(hit.origin==='user'&&normalize(hit.title)!==normalize(title))return false;
    // This entry point is automatic settlement, never an implicit UI action.
    return completeThread(hit.id,sourceMessageIds??[],sourceEvidence,hit);
  },

  async complete(id: string, sourceMessageIds?: string[],sourceEvidence?:ContinuityChatEvidence): Promise<void> {
    await completeThread(id,sourceMessageIds,sourceEvidence);
  },

  async completeObserved(expected:ContinuityThread,sourceMessageIds:string[],sourceEvidence?:ContinuityChatEvidence):Promise<boolean>{
    if(!['open','archived'].includes(expected.status))return false;
    return completeThread(expected.id,sourceMessageIds,sourceEvidence,expected);
  },

  /** 「稍后再说」：标记为不再挂起（仍可在时间线里回看） */
  async drop(id: string): Promise<void> {
    const next=await mutateThread(id,existing=>({...existing,status:'dropped',updatedAt:Date.now()}));
    if(!next)return;
    // dropped ≠ 已解决，世界事件仍保留为「未完成」
    await syncThreadSafely(next);
  },

  async reopen(id: string): Promise<void> {
    const next=await mutateThread(id,existing=>({...existing,status:'open',completedAt:undefined,updatedAt:Date.now()}));
    if(!next)return;
    await syncThreadSafely(next);
  },

  /** Explicit current user control. Candidate lookup and the actual source
   * checks share native locks; ordinary turns never enter this path. */
  async resumeFromUserMessage(principal:{userId:string;characterId:string;isCurrent:()=>boolean},source:Message,request:ContinuityReopenRequest):Promise<ContinuityResumeResult>{
    const note=(text:string):ContinuityResumeResult=>({context:'[本轮接续事项]\n'+text+'\n[/本轮接续事项]'});
    const result=await db.transaction('rw',[...mutationTables,db.messages,db.sessions],async()=>{
      if(!principal.isCurrent())throw Error('chat:account_changed');
      const [actor,session,current]=await Promise.all([db.characters.get(principal.characterId),db.sessions.get(source.sessionId),db.messages.get(source.id)]);
      if(actor?.createdBy!==principal.userId||actor.agentProfile==='secretary'||session?.userId!==principal.userId||session.characterId!==principal.characterId||session.type==='group'
        ||!current||current.role!=='user'||current.sessionId!==source.sessionId||current.content!==source.content||current.image!==source.image||(current.revision??1)!==(source.revision??1)||current.secretaryDispatch?.bodyOrigin==='composed')throw Error('chat:source_changed');
      const declared=parseContinuityReopenRequest(current.content);
      if(!declared||declared.title!==request.title||JSON.stringify(declared.calendar)!==JSON.stringify(request.calendar))return note('当前用户原话没有对应的明确恢复指令，尚未恢复；请先确认。');
      const denied=await memorySourceTombstoneRepo.selectedSuppressedMessages(principal.userId,principal.characterId,[current.id]);
      if(denied.has(current.id))throw Error('chat:source_changed');
      const key=[principal.userId,principal.characterId,request.title],date=request.calendar;
      let candidates:ContinuityThread[];
      if(date?.year!==undefined){
        const start=new Date(date.year,date.month-1,date.day),end=new Date(date.year,date.month-1,date.day+1);
        candidates=await db.continuityThreads.where('[userId+characterId+title+dueAt]').between([...key,start.getTime()],[...key,end.getTime()],true,false).limit(9).toArray();
      }else candidates=await db.continuityThreads.where('[userId+characterId+title]').equals(key).limit(9).toArray();
      if(candidates.length>8)return note('有多个同名事项，尚未恢复；请补充完整年月日以定位，不能代选。');
      if(date)candidates=candidates.filter(thread=>thread.dueAt!==undefined&&new Date(thread.dueAt).getMonth()+1===date.month&&new Date(thread.dueAt).getDate()===date.day);
      if(!candidates.length)return {context:''};
      if(candidates.length!==1)return note('有多个同名事项，尚未恢复；请说明要继续哪一天的记录，不能代选。');
      const selected=candidates[0];
      if(selected.sourceSceneId||selected.sourceWorldEventId)return note('这条记录来自世界或剧情，请回到对应场景核对；没有把它恢复成现实安排。');
      const blocked=await memorySourceTombstoneRepo.blocksImports([{userId:principal.userId,sourceType:'message',sourceId:current.id,sourceRevision:current.revision??1},{userId:principal.userId,sourceType:'continuityThread',sourceId:selected.id,sourceRevision:selected.updatedAt}]);
      if(blocked.some(Boolean))return note('来源已撤回或失效，尚未恢复；需要重新确认。');
      const base={...selected,reopenEvidence:undefined};
      if(!(await readContinuitySourceBatch(principal,[base],false)).has(selected.id))return note('原事项来源已变化，尚未恢复；请重新确认需要保留的信息。');
      const reopenEvidence=captureContinuityChatEvidence([current],[current.id]);
      if(!reopenEvidence)return note('当前指令无法完整核对，尚未恢复；请明确要继续的事项。');
      let thread=selected;
      if(selected.status!=='open'||JSON.stringify(selected.reopenEvidence)!==JSON.stringify(reopenEvidence)){
        if(!Number.isSafeInteger(selected.updatedAt)||selected.updatedAt<0||selected.updatedAt>=Number.MAX_SAFE_INTEGER)return note('原事项版本无法核对，尚未恢复；请先检查记录。');
        thread={...selected,status:'open',completedAt:undefined,reopenEvidence,updatedAt:Math.max(Date.now(),selected.updatedAt+1)};
        await db.continuityThreads.put(thread);await advanceContinuityRevision(principal.characterId,principal.userId);
      }
      if(!principal.isCurrent())throw Error('chat:account_changed');
      return {thread,context:note('用户本轮明确接续了原记录，已恢复为未完成；仅恢复事项状态，没有创建待办或安排提醒。原记录信息：'+JSON.stringify({id:thread.id,title:thread.title,detail:thread.detail,dueAt:thread.dueAt,status:thread.status})+'。日期保留原值，不按今天重算；缺少的信息仍须补问。').context};
    });
    if(result.thread&&principal.isCurrent())await syncThreadSafely(result.thread);
    return result;
  },

  /** A session focus is only a locator. Re-read its current owner, user
   * selection evidence, target and original premises on every use. */
  async readFocusedItem(principal:{userId:string;characterId:string;sessionId:string;isCurrent:()=>boolean},focus:ContinuityFocus):Promise<ContinuityResumeResult>{
    const unavailable=():ContinuityResumeResult=>({context:'[本轮接续事项]\n原接续事项或其选择来源已变化，本轮未恢复或修改任何事项；请核对具体对象，不沿用旧字段。\n[/本轮接续事项]'});
    return db.transaction('r',[db.characters,db.sessions,db.messages,db.continuityThreads,db.memorySourceTombstones],async()=>{
      if(!principal.isCurrent())throw Error('chat:account_changed');
      if(focus?.domain!=='user-reality'||!focus.threadId||!focus.source)return unavailable();
      const refs=[focus.source,...(focus.activationSource?[focus.activationSource]:[])];
      if(refs.some(ref=>!ref||!ref.messageId||!Number.isSafeInteger(ref.revision)||ref.revision<1||ref.start!==0||!Number.isInteger(ref.end)||ref.end<=0||ref.end>4000))return unavailable();
      const ids=[...new Set(refs.map(ref=>ref.messageId))];
      const [actor,session,thread,messages,suppressed,blocked]=await Promise.all([
        db.characters.get(principal.characterId),db.sessions.get(principal.sessionId),db.continuityThreads.get(focus.threadId),db.messages.bulkGet(ids),
        memorySourceTombstoneRepo.selectedSuppressedMessages(principal.userId,principal.characterId,ids),
        memorySourceTombstoneRepo.blocksImports(refs.map(ref=>({userId:principal.userId,sourceType:'message' as const,sourceId:ref.messageId,sourceRevision:ref.revision}))),
      ]);
      if(actor?.createdBy!==principal.userId||actor.agentProfile==='secretary'||session?.userId!==principal.userId||session.characterId!==principal.characterId||session.type==='group'
        ||!thread||thread.userId!==principal.userId||thread.characterId!==principal.characterId||thread.status!=='open'||thread.sourceSceneId||thread.sourceWorldEventId)return unavailable();
      const byId=new Map(ids.map((id,index)=>[id,messages[index]]));
      if(refs.some((ref,index)=>{const source=byId.get(ref.messageId);return !source||source.sessionId!==principal.sessionId||source.role!=='user'||source.secretaryDispatch?.bodyOrigin==='composed'||(source.revision??1)!==ref.revision||source.content.length<ref.end||blocked[index]||suppressed.has(source.id);}))return unavailable();
      const original=focus.source,selected=parseContinuityReopenRequest(byId.get(original.messageId)!.content.slice(original.start,original.end));
      if(!selected||selected.title!==thread.title)return unavailable();
      if(selected.calendar){const date=thread.dueAt===undefined?undefined:new Date(thread.dueAt),wanted=selected.calendar;
        if(!date||date.getMonth()+1!==wanted.month||date.getDate()!==wanted.day||wanted.year!==undefined&&date.getFullYear()!==wanted.year)return unavailable();
      }
      if(focus.activationSource){const ref=focus.activationSource;if(!isContinuityFocusResume(byId.get(ref.messageId)!.content.slice(ref.start,ref.end)))return unavailable();}
      if(!(await readContinuitySourceBatch(principal,[thread],false)).has(thread.id))return unavailable();
      if(!principal.isCurrent())throw Error('chat:account_changed');
      return {thread,context:'[本轮接续事项]\n本轮指向已核对的同一记录，仅查询，未重新恢复、修改、创建待办或安排提醒。当前记录字段：'+JSON.stringify({id:thread.id,title:thread.title,detail:thread.detail,dueAt:thread.dueAt,status:thread.status})+'。当前字段不冒充历史旧值；问原先怎样需与原话区分，相对日期不按今天重算。\n[/本轮接续事项]'};
    });
  },

  async update(
    id: string,
    patch: Partial<Pick<ContinuityThread, 'title' | 'detail' | 'kind' | 'dueAt' | 'status'>>,
  ): Promise<void> {
    const next=await mutateThread(id,existing=>({
      ...existing,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim().slice(0, 60) || existing.title : existing.title,
      detail: patch.detail !== undefined ? patch.detail.trim().slice(0, 200) || undefined : existing.detail,
      // This API is the user's editor. Their edits are maintained as manual
      // information rather than falsely attributed to an earlier chat source.
      ...(['title','detail','kind','dueAt'].some(key=>Object.prototype.hasOwnProperty.call(patch,key))?{origin:'user' as const,sourceEvidence:undefined,reopenEvidence:undefined}:{}),
      updatedAt: Date.now(),
    }));
    if(!next)return;
    await syncThreadSafely(next);
  },

  async remove(id: string): Promise<void> {
    const existing=await db.transaction('rw',mutationTables,async()=>{
    const existing = await db.continuityThreads.get(id);
    if (existing) await memorySourceTombstoneRepo.record({
      userId: existing.userId,
      sourceType: 'continuityThread',
      sourceId: existing.id,
      sourceRevision: existing.updatedAt ?? existing.createdAt,
      status: 'superseded',
    });
    await db.continuityThreads.delete(id);
    if(existing)await advanceContinuityRevision(existing.characterId,existing.userId);
    return existing;
    });
    // 用户主动删除：派生事件一并移除，避免世界里留下无法解释的孤儿
    if (existing) await removeThreadFromWorldSafely(existing.userId, [id]);
  },

  async deleteByCharacter(characterId: string, userId: string): Promise<void> {
    const ids=await db.transaction('rw',mutationTables,async()=>{
    const all = await db.continuityThreads.where('characterId').equals(characterId).toArray();
    const removed = all.filter((t) => t.userId === userId);
    const ids = removed.map((t) => t.id);
    for (const thread of removed) await memorySourceTombstoneRepo.record({
      userId,
      sourceType: 'continuityThread',
      sourceId: thread.id,
      sourceRevision: thread.updatedAt ?? thread.createdAt,
      status: 'deleted',
    });
    if (ids.length) await db.continuityThreads.bulkDelete(ids);
    if(ids.length)await advanceContinuityRevision(characterId,userId);
    return ids;
    });
    // 该角色的约定随角色一起消失 ⇒ 派生世界事件也移除
    await removeThreadFromWorldSafely(userId, ids);
  },

  async clearForUser(userId: string): Promise<void> {
    const ids=await db.transaction('rw',mutationTables,async()=>{
    const all = await db.continuityThreads.where('userId').equals(userId).toArray();
    const ids = all.map((t) => t.id);
    if (ids.length) await db.continuityThreads.bulkDelete(ids);
    for(const characterId of new Set(all.map(thread=>thread.characterId)))await advanceContinuityRevision(characterId,userId);
    return ids;
    });
    await removeThreadFromWorldSafely(userId, ids);
  },
};
