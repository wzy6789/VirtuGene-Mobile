import { create } from 'zustand';
import { useAuthStore } from './auth-store';
import { useChatStore } from './chat-store';
import { useCharacterStateStore } from './character-state-store';
import { messageRepo } from '../db/message-repo';
import { sessionRepo } from '../db/session-repo';
import { memoryRepo } from '../db/memory-repo';
import { emotionRepo } from '../db/emotion-repo';
import { stateRepo } from '../db/state-repo';
import { continuityRepo } from '../db/continuity-repo';
import { ipc } from '../lib/ipc-client';
import { computeAffinityDelta } from '../lib/affinity';
import { hasAiGatewayAccess } from '../lib/ai/gateway';
import { boundAuxiliaryHistory } from '../lib/ai/history-window';
import { prepareMemoryMetadata } from '../lib/memory-engine';
import type { EmotionSnapshot } from '../db/index';

const auxiliaryInFlight = new Set<string>();

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
    const apiKey = useAuthStore.getState().apiKey;
    if (!apiKey && !hasAiGatewayAccess()) {
      set({ analysisError: '基因序列验证失败，请检查 API Key' });
      return;
    }

    const msgs = await messageRepo.getBySession(sessionId);
    if (msgs.length === 0) {
      set({ analysisError: '发送一些消息后即可分析情绪' });
      return;
    }

    set({ isAnalyzing: true, analysisError: null });

    const history = boundAuxiliaryHistory(msgs.map((m) => ({
      role: m.role,
      content: m.content,
    })));

    const operationKey = `aux:${useAuthStore.getState().userId ?? ''}:${sessionId}`;
    if (auxiliaryInFlight.has(operationKey)) {
      set({ isAnalyzing: false });
      return;
    }
    auxiliaryInFlight.add(operationKey);

    let result;
    try {
      result = await ipc.emotion.analyze({ apiKey: apiKey ?? '', history, characterName });
    } catch (error) {
      console.warn('[emotion] analysis request failed', error);
      set({ isAnalyzing: false, analysisError: '基因链接中断，请重试' });
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
      set({ isAnalyzing: false, analysisError: errorMap[result.error] ?? '基因链接中断，请重试' });
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
        messageCount: msgs.length,
        createdAt: Date.now(),
      };

      await emotionRepo.create(snapshot);

      // If the user switched characters/sessions while the analysis was in flight,
      // don't overwrite the new session's (possibly empty) emotion view.
      if (useChatStore.getState().currentSessionId !== sessionId) {
        set({ isAnalyzing: false });
        return;
      }

      // Reload snapshots
      const snapshots = await emotionRepo.getBySession(sessionId);
      const current = snapshots[0] ?? null;
      const previous = snapshots.length > 1 ? snapshots[1] : null;

      set({
        isAnalyzing: false,
        analysisError: null,
        currentSnapshot: current,
        previousSnapshot: previous,
        snapshots,
      });
    } else {
      set({ isAnalyzing: false, analysisError: '基因链接中断，请重试' });
    }
  },

  loadSessionSnapshots: async (sessionId) => {
    const snapshots = await emotionRepo.getBySession(sessionId);
    const current = snapshots[0] ?? null;
    const previous = snapshots.length > 1 ? snapshots[1] : null;
    set({ snapshots, currentSnapshot: current, previousSnapshot: previous, analysisError: null });
  },

  clearCurrent: () => set({ currentSnapshot: null, previousSnapshot: null, snapshots: [], analysisError: null }),

  /** 每 5 条用户消息触发一次：合并「情绪分析 + 记忆提取 + 好感度结算」为一次 API 调用 */
  settle: async (characterId, sessionId, characterName) => {
    const apiKey = useAuthStore.getState().apiKey;
    if (!apiKey && !hasAiGatewayAccess()) return;

    const msgs = await messageRepo.getBySession(sessionId);
    if (msgs.filter((m) => m.role === 'user').length < 3) return;

    const analysisMessages = boundAuxiliaryHistory(msgs);
    const history = analysisMessages.map((m) => ({ role: m.role, content: m.content }));
    const operationKey = `aux:${useAuthStore.getState().userId ?? ''}:${sessionId}`;
    if (auxiliaryInFlight.has(operationKey)) return;
    auxiliaryInFlight.add(operationKey);
    let result;
    try {
      result = await ipc.context.settle({ apiKey: apiKey ?? '', history, characterName });
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
    const idsForEvidence = (evidence: number[] | undefined): string[] =>
      Array.from(new Set((evidence ?? []).map((i) => indexedMessages[i]?.id).filter((id): id is string => !!id)));

    const dims = result.dimensions;
    const userId = useAuthStore.getState().userId ?? '';
    const snapshot: EmotionSnapshot = {
      id: crypto.randomUUID(),
      characterId,
      sessionId,
      dimensions: dims,
      dominantEmotion: result.dominantEmotion ?? '未知',
      userEmotion: result.userEmotion ?? undefined,
      summary: result.summary ?? '',
      messageCount: msgs.length,
      createdAt: Date.now(),
    };
    await emotionRepo.create(snapshot);

    // 记忆提取：与已有记忆去重后入库（记忆保存失败不影响情绪/好感度结算）。
    // 2026-08-30：去掉「会话 ≥20 条才存记忆」的门槛——私聊三五句的关键信息也要立刻进记忆，
    // 否则群聊注入记忆时角色对用户私下说过的事一无所知（用户反馈"群聊的人不知道私下发的消息"）。
    try {
      if (result.memories && result.memories.length > 0) {
        const existing = await memoryRepo.getByCharacter(characterId, userId);
        const existingContents = new Set(existing
          .filter((memory) => (memory.status ?? 'active') === 'active')
          .map((memory) => memory.content.trim()));
        const fresh = result.memories
          .map((m) => ({ content: m.content.trim(), evidence: m.evidence ?? [] }))
          .filter((m) => m.content.length > 0 && !existingContents.has(m.content))
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
                ...prepareMemoryMetadata(m.content, { confidence: sourceMessageIds.length > 0 ? 0.9 : 0.6 }),
                createdAt: now + i,
                sourceSessionId: sessionId,
                sourceMessageIds,
                // 有真实消息依据的记忆更可信；只凭总结出来的给较低的置信度
                confidence: sourceMessageIds.length > 0 ? 0.9 : 0.6,
                updatedAt: now + i,
              };
            }),
          );
        }
      }
    } catch (err) {
      console.warn('[settle] 记忆保存失败（不影响结算）:', err);
    }

    // 生命连续性：把「说好了还没做完的事」沉淀成未完成事件。
    // 同一次结算调用顺带产出，不额外增加任何 API 请求；失败不影响情绪与好感度结算。
    try {
      const created = (result.threads ?? []).filter((t) => t.action === 'create' && t.title.trim());
      const completed = (result.threads ?? []).filter((t) => t.action === 'complete' && t.title.trim());
      if (created.length > 0) {
        await continuityRepo.createMany(
          created.map((t) => ({
            characterId,
            userId,
            kind: t.kind,
            title: t.title,
            detail: t.detail,
            dueAt: t.dueAt,
            sourceMessageIds: idsForEvidence(t.evidence),
            origin: 'ai' as const,
          })),
        );
      }
      for (const t of completed) {
        await continuityRepo.completeByTitle(characterId, userId, t.title, idsForEvidence(t.evidence), t.kind);
      }
    } catch (err) {
      console.warn('[settle] 未完成事件写入失败（不影响结算）:', err);
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
      set({
        currentSnapshot: snapshots[0] ?? null,
        previousSnapshot: snapshots.length > 1 ? snapshots[1] : null,
        snapshots,
      });
    }
    // 只有结算全流程成功后才推进检查点。请求失败或中途写入失败会留待下一轮补做。
    await sessionRepo.update(sessionId, {
      lastSettledUserMessageCount: msgs.filter((message) => message.role === 'user').length,
    });
    // 结算成功 → 轻提示，让自动分析不再静默
    set({ settleNotice: '情绪图谱已更新' });
  },
}));
