import { create } from 'zustand';
import { useAuthStore } from './auth-store';
import { useChatStore } from './chat-store';
import { useCharacterStateStore } from './character-state-store';
import { sessionRepo } from '../db/session-repo';
import { memoryRepo } from '../db/memory-repo';
import { emotionRepo } from '../db/emotion-repo';
import { stateRepo } from '../db/state-repo';
import { continuityRepo,normalizeContinuityTitle } from '../db/continuity-repo';
import {captureContinuityChatEvidence} from '../lib/continuity-sources';
import { ipc } from '../lib/ipc-client';
import { computeAffinityDelta } from '../lib/affinity';
import { canUseAi } from '../lib/ai/availability';
import { prepareMemoryMetadata } from '../lib/memory-engine';
import type { EmotionSnapshot } from '../db/index';
import {captureChatAuxiliary,validateChatAuxiliary,commitChatAuxiliary} from '../db/chat-auxiliary-guard';

const auxiliaryInFlight = new Set<string>();
let analysisSequence=0;

interface EmotionState {
  isPanelOpen: boolean;
  isAnalyzing: boolean;
  analysisError: string | null;
  currentSnapshot: EmotionSnapshot | null;
  previousSnapshot: EmotionSnapshot | null;
  snapshots: EmotionSnapshot[];
  /** 自动结算完成后的轻提示文案（如「情绪图谱已更新」），短暂展示 */
  settleNotice: string | null;

  togglePanel: () => void;
  closePanel: () => void;
  clearSettleNotice: () => void;
  analyzeCurrentSession: (characterId: string, sessionId: string, characterName: string) => Promise<void>;
  loadSessionSnapshots: (sessionId: string) => Promise<void>;
  settle: (characterId: string, sessionId: string, characterName: string) => Promise<void>;
  clearCurrent: () => void;
}

export const useEmotionStore = create<EmotionState>((set, get) => ({
  isPanelOpen: false,
  isAnalyzing: false,
  analysisError: null,
  currentSnapshot: null,
  previousSnapshot: null,
  snapshots: [],
  settleNotice: null,

  togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),

  closePanel: () => set({ isPanelOpen: false }),

  clearSettleNotice: () => set({ settleNotice: null }),

  analyzeCurrentSession: async (characterId, sessionId, characterName) => {
    const userId=useAuthStore.getState().userId??'';
    const operationKey = `aux:${userId}:${sessionId}`;
    if(auxiliaryInFlight.has(operationKey))return;
    const sequence=++analysisSequence;
    const isCurrent=()=>useAuthStore.getState().userId===userId;
    const currentView=()=>isCurrent()&&useChatStore.getState().currentSessionId===sessionId;
    const finish=(patch:Partial<EmotionState>={})=>{if(sequence===analysisSequence)set({isAnalyzing:false,...(currentView()?patch:{})});};
    const apiKey = useAuthStore.getState().apiKey ?? '';
    if (!canUseAi()) {
      finish({ analysisError: '基因序列验证失败，请检查 API Key' });
      return;
    }

    const sourceSnapshot=await captureChatAuxiliary(userId,characterId,sessionId,'analysis',isCurrent);
    if(sequence!==analysisSequence)return;
    if (!sourceSnapshot) {
      finish({ analysisError: '发送一些有效消息后即可分析情绪' });
      return;
    }

    set({ isAnalyzing: true, analysisError: null });

    const history = sourceSnapshot.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    if (auxiliaryInFlight.has(operationKey)) {
      finish();
      return;
    }
    auxiliaryInFlight.add(operationKey);

    let result;
    try {
      if(!await validateChatAuxiliary(sourceSnapshot,isCurrent)){finish({analysisError:'对话已变化，请重新分析'});return;}
      result = await ipc.emotion.analyze({ apiKey: apiKey ?? '', history, characterName });
    } catch (error) {
      console.warn('[emotion] analysis request failed', error);
      finish({ analysisError: '基因链接中断，请重试' });
      return;
    } finally {
      auxiliaryInFlight.delete(operationKey);
    }

    if (result.error) {
      const errorMap: Record<string, string> = {
        'auth:invalid_key': '基因序列验证失败，请检查 API Key',
        'billing:insufficient': 'DeepSeek 账户余额不足，请前往平台充值',
        'rate:limited': '请求过于频繁，请稍后重试',
        'timeout': '基因链接超时，请重试',
        'server:error': '基因链接中断，请重试',
      };
      finish({ analysisError: errorMap[result.error] ?? '基因链接中断，请重试' });
      return;
    }

    if (result.dimensions) {
      const snapshot: EmotionSnapshot = {
        id: crypto.randomUUID(),
        characterId,
        sessionId,
        dimensions: result.dimensions,
        dominantEmotion: result.dominantEmotion ?? '未知',
        summary: result.summary ?? '',
        messageCount: sourceSnapshot.messageCount,
        createdAt: Date.now(),
      };

      let written;
      try{written=await commitChatAuxiliary(sourceSnapshot,isCurrent,()=>emotionRepo.create(snapshot));}
      catch(error){console.warn('[emotion] local transaction failed',error);finish({analysisError:'分析记录未保存，请重试'});return;}
      if(!written){finish({analysisError:'对话已变化，请重新分析'});return;}

      // If the user switched characters/sessions while the analysis was in flight,
      // don't overwrite the new session's (possibly empty) emotion view.
      if (!currentView()) {
        finish();
        return;
      }

      // Reload snapshots
      const snapshots = await emotionRepo.getBySession(sessionId);
      const current = snapshots[0] ?? null;
      const previous = snapshots.length > 1 ? snapshots[1] : null;

      finish({
        analysisError: null,
        currentSnapshot: current,
        previousSnapshot: previous,
        snapshots,
      });
    } else {
      finish({ analysisError: '基因链接中断，请重试' });
    }
  },

  loadSessionSnapshots: async (sessionId) => {
    const owner = useAuthStore.getState().userId;
    const session=await sessionRepo.getById(sessionId);
    if(!owner||session?.userId!==owner||session.type==='group')return;
    const snapshots = await emotionRepo.getBySession(sessionId);
    if (owner !== useAuthStore.getState().userId || sessionId !== useChatStore.getState().currentSessionId) return;
    const current = snapshots[0] ?? null;
    const previous = snapshots.length > 1 ? snapshots[1] : null;
    set({ snapshots, currentSnapshot: current, previousSnapshot: previous, analysisError: null });
  },

  clearCurrent: () => {analysisSequence++;set({ isAnalyzing:false,currentSnapshot: null, previousSnapshot: null, snapshots: [], analysisError: null });},

  /** 每 5 条用户消息触发一次：合并「情绪分析 + 记忆提取 + 好感度结算」为一次 API 调用 */
  settle: async (characterId, sessionId, characterName) => {
    const apiKey = useAuthStore.getState().apiKey ?? '';
    if (!canUseAi()) return;
    const userId=useAuthStore.getState().userId??'';
    const isCurrent=()=>useAuthStore.getState().userId===userId;
    const sourceSnapshot=await captureChatAuxiliary(userId,characterId,sessionId,'settlement',isCurrent);
    if(!sourceSnapshot)return;
    const analysisMessages = sourceSnapshot.messages;
    const history = analysisMessages.map((m) => ({ role: m.role, content: m.content }));
    const operationKey = `aux:${userId}:${sessionId}`;
    if (auxiliaryInFlight.has(operationKey)) return;
    auxiliaryInFlight.add(operationKey);
    let result;
    try {
      if(!await validateChatAuxiliary(sourceSnapshot,isCurrent))return;
      result = await ipc.context.settle({ apiKey: apiKey ?? '', history, characterName,
        ...(sourceSnapshot.continuity?.length?{continuity:sourceSnapshot.continuity.map(({id,title,kind,dueAt,status})=>({id,title,kind,dueAt,status}))}:{}) });
    } catch (error) {
      console.warn('[settle] context request failed', error);
      return;
    } finally {
      auxiliaryInFlight.delete(operationKey);
    }
    if (result.error || !result.dimensions) {
      console.warn('[settle] 情绪分析失败，本次结算跳过:', result.error ?? 'invalid result');
      return;
    }

    // 溯源：分析时给模型的 history 下标 → 真实消息 id。
    // 记忆/未完成事件只接受模型回传的编号，绝不按文本相似度猜消息。
    const indexedMessages = analysisMessages;
    const idsForEvidence = (evidence: number[] | undefined): string[] => {
      // Every cited premise must be eligible. Dropping an assistant/invalid
      // premise would re-certify a dependent claim with only its remainder.
      if(!Array.isArray(evidence)||!evidence.length||evidence.some(i=>!Number.isInteger(i)||i<0||indexedMessages[i]?.role!=='user'))return [];
      return [...new Set(evidence.map(i=>indexedMessages[i].id))];
    };

    // A model's chosen ID is a locator, not evidence that an ambiguous user
    // selected that occurrence. Resolve equal titles only from a unique date
    // in the actual cited user text; unsupported references preserve records.
    const observedTarget=(targetId:string,kind:string,evidence:number[]|undefined,updating=false)=>{
      const inventory=sourceSnapshot.continuity??[];
      const selected=inventory.find(thread=>thread.id===targetId&&thread.kind===kind);
      if(!selected)return;
      const peers=inventory.filter(thread=>thread.kind===kind&&normalizeContinuityTitle(thread.title)===normalizeContinuityTitle(selected.title));
      if(peers.length===1)return selected;
      const ids=new Set(idsForEvidence(evidence));
      const dates:Array<{year?:number;month:number;day:number}>=[];
      for(const source of indexedMessages.filter(message=>ids.has(message.id))){
        let text=source.content;
        if(updating)text=text.split(/改到|改成|改为|挪到|调整为/u)[0];
        if(/[？?]|^(?:朋友|同事|他|她|据说|听说|如果|假如|假设|引用|原话|[“「『"])/u.test(text.trim()))continue;
        for(const match of text.matchAll(/(?:^|[^\d])(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)(?!\d)/gu))dates.push({year:match[1]?Number(match[1]):undefined,month:Number(match[2]),day:Number(match[3])});
        for(const match of text.matchAll(/(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/gu))dates.push({year:Number(match[1]),month:Number(match[2]),day:Number(match[3])});
      }
      const matched=peers.filter(thread=>{
        if(thread.dueAt===undefined)return false;
        const due=new Date(thread.dueAt);
        return dates.some(date=>(date.year===undefined||date.year===due.getFullYear())&&date.month===due.getMonth()+1&&date.day===due.getDate());
      });
      return matched.length===1&&matched[0].id===selected.id?selected:undefined;
    };

    const dims = result.dimensions;
    const snapshot: EmotionSnapshot = {
      id: crypto.randomUUID(),
      characterId,
      sessionId,
      dimensions: dims,
      dominantEmotion: result.dominantEmotion ?? '未知',
      userEmotion: result.userEmotion ?? undefined,
      summary: result.summary ?? '',
      messageCount: sourceSnapshot.messageCount,
      createdAt: Date.now(),
    };
    let committed;
    try{committed=await commitChatAuxiliary(sourceSnapshot,isCurrent,async()=>{
    await emotionRepo.create(snapshot);

    // Memory, continuity and relationship writes share the guarded transaction.
    // 2026-08-30：去掉「会话 ≥20 条才存记忆」的门槛——私聊三五句的关键信息也要立刻进记忆，
    // 否则群聊注入记忆时角色对用户私下说过的事一无所知（用户反馈"群聊的人不知道私下发的消息"）。
    {
      if (result.memories && result.memories.length > 0) {
        const existing = await memoryRepo.getByCharacter(characterId, userId);
        const existingContents = new Set(existing
          .filter((memory) => (memory.status ?? 'active') === 'active')
          .map((memory) => memory.content.trim()));
        const fresh = result.memories
          .map((m) => ({ content: m.content.trim(), evidence: m.evidence ?? [] }))
          .filter((m) => m.content.length > 0 && idsForEvidence(m.evidence).length>0 && !existingContents.has(m.content))
          .slice(0, 20);
        if (fresh.length > 0) {
          const now = Date.now();
          await memoryRepo.createMany(
            fresh.map((m, i) => {
              const sourceMessageIds = idsForEvidence(m.evidence);
              return {
                id: crypto.randomUUID(),
                characterId,
                userId,
                content: m.content,
                type: 'auto' as const,
                ...prepareMemoryMetadata(m.content, { confidence: 0.9 }),
                createdAt: now + i,
                sourceSessionId: sessionId,
                sourceMessageIds,
                // Unsupported or assistant-only evidence is not a user fact.
                confidence: 0.9,
                updatedAt: now + i,
              };
            }),
          );
        }
      }
    }

    // 生命连续性：把「说好了还没做完的事」沉淀成未完成事件。
    // 同一次结算调用顺带产出，不额外增加任何 API 请求；本地写失败整批回滚。
    {
      const created = (result.threads ?? []).filter((t) => t.action === 'create' && t.title.trim()&&idsForEvidence(t.evidence).length>0
        &&(!t.targetId||!!observedTarget(t.targetId,t.kind,t.evidence,true)));
      const completed = (result.threads ?? []).filter((t) => t.action === 'complete' && t.title.trim()&&idsForEvidence(t.evidence).length>0);
      if (created.length > 0) {
        await continuityRepo.createMany(
          created.map((t) => ({
            characterId,
            userId,
            kind: t.kind,
            title: t.title,
            detail: t.detail,
            dueAt: t.dueAt,
            ...(t.targetId?{targetId:t.targetId,expectedThread:observedTarget(t.targetId,t.kind,t.evidence,true)}:{}),
            sourceMessageIds: idsForEvidence(t.evidence),
            sourceEvidence:captureContinuityChatEvidence(indexedMessages,idsForEvidence(t.evidence)),
            origin: 'ai' as const,
          })),
        );
      }
      for (const t of completed) {
        const evidence=captureContinuityChatEvidence(indexedMessages,idsForEvidence(t.evidence));
        if(t.targetId){
          const selected=observedTarget(t.targetId,t.kind,t.evidence);
          if(selected)await continuityRepo.completeObserved(selected,idsForEvidence(t.evidence),evidence);
        }else await continuityRepo.completeByTitle(characterId, userId, t.title, idsForEvidence(t.evidence), t.kind,evidence);
      }
    }

    const delta = computeAffinityDelta(dims);
    // 心情改为「增量」更新（基于情绪的波动，valence 5 为中性）：
    // 用绝对值覆盖会把 bump（如主动消息未被回应导致的心情下滑）整体抹掉
    const moodDelta = Math.round((dims.valence - 5) * 2);
    const { state, upgraded } = await stateRepo.settle(
      characterId,
      userId,
      delta,
      moodDelta,
    );

    // 4.0 生命轨迹：每次完整结算都会留下一个共同事件，让关系变化可回看、可解释。
    const eventTitle = upgraded
      ? `关系进入「${upgraded.level}」阶段`
      : result.summary?.trim().slice(0, 48) || '一次新的共同经历';
    await stateRepo.recordLifeEvent(characterId, userId, {
      type: upgraded ? 'relationship' : 'interaction',
      title: eventTitle,
      detail: result.summary?.trim().slice(0, 220),
      // 5.0：标明来源（私聊结算）——世界层据此决定是否派生世界事件
      source: 'chat',
    });
    return {state,upgraded};
    });}catch(error){console.warn('[settle] local transaction failed',error);return;}
    if(!committed||!isCurrent())return;
    const {state,upgraded}=committed.value;

    const csStore = useCharacterStateStore.getState();
    if (csStore.characterId === characterId) {
      useCharacterStateStore.setState({ affinity: state.affinity, mood: state.mood, milestones: state.milestones });
    }
    useCharacterStateStore.setState((s) => ({
      affinityByCharacter: { ...s.affinityByCharacter, [characterId]: state.affinity },
    }));
    if (upgraded) {
      useCharacterStateStore.setState({ milestone: upgraded });
    }

    // 刷新内存快照：即使情绪面板未打开，也更新当前快照，
    // 让情绪按钮的「点色」随结算变化，用户能直观看到"分析过了"
    if (useChatStore.getState().currentSessionId === sessionId) {
      const snapshots = await emotionRepo.getBySession(sessionId);
      if(!isCurrent()||useChatStore.getState().currentSessionId!==sessionId)return;
      set({
        currentSnapshot: snapshots[0] ?? null,
        previousSnapshot: snapshots.length > 1 ? snapshots[1] : null,
        snapshots,
      });
    }
    // Checkpoint and auxiliary revision committed with the local derivatives.
    // 结算成功 → 轻提示，让自动分析不再静默
    set({ settleNotice: '情绪图谱已更新' });
  },
}));
