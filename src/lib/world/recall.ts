/**
 * 共同记忆召回（Phase 2b-3 / L1「让角色说得出来」）
 *
 * 目标：让角色在聊天里**真的**能提起你们一起经历过的事，而不是只有世界页记得。
 *
 * 三道闸门缺一不可（这是 5.0 世界真实性的地基，也是审核过的隐私边界）：
 * 1. **可见性**：这条记忆（以及它对应的世界事件）必须对该角色可见
 *    —— 走 `sharedMemoryRepo.listRelevant` / `worldEventRepo.listVisibleToCharacter`，
 *    两份查询都过 `lib/world/visibility.ts` 的统一闸门（private 永远不返回）。
 * 2. **认知**：光"被允许知道"不等于"已经知道"（§62）。必须有 `characterKnowledge`
 *    且 `knowledgeLevel === 'full'` 且 `canMention === true`，角色才会真的提起它。
 * 3. **只挑相关的几条**：按"和该角色的相关度 + 重要度 + 新鲜度"（§39）排序后取前 N 条，
 *    不做"把全部记忆塞进 Prompt"。
 *
 * 另外：这里**不发任何网络/LLM 请求**，只是本地读三张表。
 */
import { db, type SharedMemory } from '../../db/index';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { isVisibleToCharacter } from './visibility';

export interface RecallableSharedMemory {
  memory: SharedMemory;
  /** 支撑这条记忆的世界事件（溯源用；认知是挂在事件上的） */
  eventIds: string[];
}

/** 一次召回最多给角色几条（默认 3：够自然，也不至于让 Prompt 变成回忆录） */
export const DEFAULT_RECALL_LIMIT = 3;

async function ownerFor(worldId: string, requestedUserId?: string): Promise<string | undefined> {
  const ownerId = (await db.worlds.get(worldId))?.userId;
  if (!ownerId) return undefined;
  if (requestedUserId && requestedUserId !== ownerId) return undefined;
  return ownerId;
}

/**
 * 挑出"这个角色确实知道、且现在适合提起"的共同记忆。
 * 返回顺序 = 相关度/重要度/新鲜度排序（由 `listRelevant` 决定），调用方可直接截断。
 */
export async function selectRecallableSharedMemories(params: {
  userId?: string;
  worldId: string;
  characterId: string;
  limit?: number;
}): Promise<RecallableSharedMemory[]> {
  const { userId, worldId, characterId } = params;
  const ownerId = await ownerFor(worldId, userId);
  if (!ownerId) return [];
  const limit = Math.max(1, params.limit ?? DEFAULT_RECALL_LIMIT);

  // 候选：过了可见性闸门、按相关度排好序（多取一些，后面还要过认知闸门）
  const candidates = await sharedMemoryRepo.listRelevant(worldId, [characterId], Math.max(limit * 4, 12), ownerId);
  if (candidates.length === 0) return [];
  const candidateIds = new Set(candidates.map((m) => m.id));

  // 认知闸门：这个角色**确实知道并且可以主动提起**的世界事件
  const known = await knowledgeRepo.listKnownBy(characterId, worldId, { minLevel: 'full', limit: 200, userId: ownerId });
  const mentionableEventIds = new Set(
    known.filter((row) => row.canMention && row.knowledgeLevel === 'full').map((row) => row.eventId),
  );
  if (mentionableEventIds.size === 0) return [];

  // 把记忆和事件对上：只有"可见的事件 + 可提起的认知 + 指向候选记忆"三者都成立才算数
  const events = await worldEventRepo.listVisibleToCharacter(worldId, characterId, 200, ownerId);
  const eventIdsByMemory = new Map<string, string[]>();
  for (const event of events) {
    if (event.type !== 'shared_memory') continue;
    if (!mentionableEventIds.has(event.id)) continue;
    for (const memoryId of event.memoryIds) {
      if (!candidateIds.has(memoryId)) continue;
      const list = eventIdsByMemory.get(memoryId) ?? [];
      list.push(event.id);
      eventIdsByMemory.set(memoryId, list);
    }
  }

  const out: RecallableSharedMemory[] = [];
  for (const memory of candidates) {
    // 再对记忆本身做一次可见性校验（防御性：即使将来有人只改了记忆的可见性也不会泄漏）
    if (!isVisibleToCharacter(memory, characterId)) continue;
    const eventIds = eventIdsByMemory.get(memory.id);
    if (!eventIds || eventIds.length === 0) continue;
    out.push({ memory, eventIds });
    if (out.length >= limit) break;
  }
  return out;
}
