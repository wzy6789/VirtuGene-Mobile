/**
 * Undo / Retcon（5.0.0 Living World §16 / §52）
 *
 * 世界必须允许犯错。用户不应该因为模型一次糟糕生成而**永久污染**世界。
 *
 * 撤销的语义（严格、可核对）：
 * - 回收这一轮写下的**世界流正文**（按 turn.entryIds 精确删除，不靠猜）
 * - 回收这一轮结算写下的**世界事件 / 共同记忆 / 未完成的事 / 世界设定**，
 *   以及它们带来的**认知行**（`knowledgeRepo.removeForEvent`）
 * - **反向回退**关系分面增量与 4.x 角色状态增量（不是删库重来）
 * - 把"此刻"（地点 / 时间 / 氛围 / 在场的人）还原成这一轮开始前的快照
 * - **不新增任何 AI 调用**
 *
 * 撤销**不**重写历史：它把这一轮标记为 `undone`，因此"当时到底发生过什么"
 * 依然可查（这也是为什么 Turn 行本身不删）。
 */
import { db, type WorldTurn } from '../../db/index';
import { worldTurnRepo } from '../../db/world-turn-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { worldFactRepo } from '../../db/world-fact-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { stateRepo } from '../../db/state-repo';
import { RELATIONSHIP_FACETS, type CharacterState, type RelationshipFacet } from '../../db/index';

export interface UndoResult {
  ok: boolean;
  /** 人话说明（直接给用户看） */
  message: string;
  turnId?: string;
  removedEntries: number;
  removedEvents: number;
  removedMemories: number;
  removedFacts: number;
  removedThreads: number;
  removedRelationships: number;
  /** 被恢复启用的旧设定数 */
  restoredFacts: number;
  restoredState: boolean;
  llmCalls: 0;
}

function emptyResult(message: string): UndoResult {
  return {
    ok: false,
    message,
    removedEntries: 0,
    removedEvents: 0,
    removedMemories: 0,
    removedFacts: 0,
    removedThreads: 0,
    removedRelationships: 0,
    restoredFacts: 0,
    restoredState: false,
    llmCalls: 0,
  };
}

/** 按分面增量反向回退（下限 0；关系不会因为撤销变成负数） */
async function reverseRelationship(turn: WorldTurn, worldId: string): Promise<number> {
  let count = 0;
  for (const eventId of turn.settledRelationshipEventIds) {
    const event = await relationshipRepo.getEvent(eventId);
    if (!event) continue;
    const state = await relationshipRepo.getState(worldId, event.pairKey);
    if (state) {
      const next: Partial<Record<RelationshipFacet, number>> = {};
      for (const facet of RELATIONSHIP_FACETS) {
        const delta = event.facets[facet];
        if (!delta) continue;
        next[facet] = Math.max(0, (state[facet] ?? 0) - delta);
      }
      if (Object.keys(next).length > 0) {
        try {
          await relationshipRepo.overrideFacets(worldId, event.pairKey, next);
        } catch {
          /* 回退失败不影响其它回收：世界层是派生数据，宁可留一条记录也不中断撤销 */
        }
      }
    }
    await relationshipRepo.removeEvent(eventId);
    count += 1;
  }
  return count;
}

/** 反向回退 4.x 角色状态（好感度/心情），并删掉这次写下的"为什么变了"轨迹 */
async function reverseCharacterState(turn: WorldTurn, userId: string): Promise<boolean> {
  let touched = false;
  for (const delta of turn.stateDeltas ?? []) {
    try {
      await stateRepo.adjust(delta.characterId, userId, -delta.affinityDelta, -delta.moodDelta);
      touched = true;
    } catch {
      /* 忽略：状态回退失败不应阻断撤销 */
    }
  }
  const lifeEventIds = new Set(turn.settledLifeEventIds ?? []);
  if (lifeEventIds.size > 0) {
    for (const characterId of new Set((turn.stateDeltas ?? []).map((d) => d.characterId).concat(turn.characterIds))) {
      const state: CharacterState | undefined = await stateRepo.get(characterId, userId);
      if (!state?.lifeEvents?.length) continue;
      const kept = state.lifeEvents.filter((e) => !lifeEventIds.has(e.id));
      if (kept.length === state.lifeEvents.length) continue;
      await db.characterStates.put({
        ...state,
        lifeEvents: kept,
        lifeFocus: kept[0]?.title ?? state.lifeFocus,
        updatedAt: Date.now(),
      });
      touched = true;
    }
  }
  return touched;
}

/** 撤销最近一轮（0 次 AI 调用） */
export async function undoLastTurn(params: { userId: string; worldId: string; turnId?: string }): Promise<UndoResult> {
  const turn = params.turnId
    ? await worldTurnRepo.getById(params.turnId)
    : await worldTurnRepo.lastUndoable(params.worldId);
  if (!turn || turn.userId !== params.userId) return emptyResult('还没有可以撤回的一刻。');
  if (turn.status === 'undone') return emptyResult('这一轮已经撤回过了。');

  const result = emptyResult('刚刚那一轮已经撤回。');
  result.ok = true;
  result.turnId = turn.id;
  result.message = '刚刚那一轮已经撤回，世界回到了上一刻。';

  // 1) 世界流正文
  const entryIds = [...turn.entryIds];
  if (entryIds.length > 0) {
    await db.worldSceneEntries.bulkDelete(entryIds);
    result.removedEntries = entryIds.length;
  }

  // 2) 世界事件 + 它带来的认知
  for (const eventId of turn.settledEventIds) {
    await knowledgeRepo.removeForEvent(eventId);
    await worldEventRepo.remove(eventId);
    result.removedEvents += 1;
  }

  // 3) 共同记忆
  for (const memoryId of turn.settledMemoryIds) {
    await sharedMemoryRepo.remove(memoryId);
    result.removedMemories += 1;
  }

  // 4) 世界设定（只删**这一轮新写下**的；被停用的旧设定在第 4.5 步恢复）
  for (const factId of turn.settledFactIds) {
    await worldFactRepo.remove(factId);
    result.removedFacts += 1;
  }

  // 4.5) 这一轮因为与它冲突而被停用的旧设定：恢复启用（**不删除**——世界的历史不该被静默抹掉）
  for (const factId of turn.deactivatedFactIds ?? []) {
    await worldFactRepo.setActive(factId, true);
    result.restoredFacts += 1;
  }

  // 5) 未完成的事
  for (const threadId of turn.settledThreadIds) {
    await continuityRepo.remove(threadId);
    result.removedThreads += 1;
  }

  // 6) 关系分面反向回退
  result.removedRelationships = await reverseRelationship(turn, params.worldId);

  // 7) 4.x 角色状态反向回退
  result.restoredState = await reverseCharacterState(turn, params.userId);

  // 8) "此刻"还原成这一轮开始前的快照
  if (turn.before) {
    await worldSceneRepo.updateScene(turn.sceneId, {
      place: turn.before.place,
      timeLabel: turn.before.timeLabel,
      mood: turn.before.mood,
    });
    await worldSceneRepo.patchSceneState(turn.sceneId, { timeOffsetMs: turn.before.timeOffsetMs });
    const scene = await worldSceneRepo.getScene(turn.sceneId);
    if (scene) {
      await db.worldScenes.put({
        ...scene,
        characterIds: [...turn.before.characterIds],
        updatedAt: Date.now(),
      });
    }
  }

  await worldTurnRepo.markUndone(turn.id);
  return result;
}

/** 撤回之后，最新一轮还在不在（UI 用它决定"撤销"按钮是否可点） */
export async function canUndo(worldId: string): Promise<boolean> {
  const turn = await worldTurnRepo.lastUndoable(worldId);
  return !!turn;
}

/**
 * Retcon（§15 Canon Override）：用户直接修改世界事实。
 *
 * 与撤销不同：撤销是"这一段不算"，retcon 是"世界从来就是这样"。
 * 因此它**不回滚**任何已经发生的内容，而是把用户的新说法变成世界设定，
 * 由后续的世界上下文与结算自然吸收（角色不会反问"你为什么这么说"）。
 */
export async function retconWorld(params: {
  userId: string;
  worldId: string;
  content: string;
  /** 被替换掉的旧设定（有就停用它，避免两个互相冲突的 Canon 同时生效，§101） */
  supersedesFactId?: string;
}): Promise<{ factId?: string; deactivated?: string }> {
  const content = params.content.trim().slice(0, 300);
  if (!content) return {};
  if (params.supersedesFactId) {
    await worldFactRepo.setActive(params.supersedesFactId, false);
  }
  const factId = await worldFactRepo.upsert({
    userId: params.userId,
    worldId: params.worldId,
    category: 'history',
    content,
    visibility: 'world',
    sourceType: 'user',
    sourceId: `retcon:${content.slice(0, 60)}`,
  });
  return { factId, ...(params.supersedesFactId ? { deactivated: params.supersedesFactId } : {}) };
}
