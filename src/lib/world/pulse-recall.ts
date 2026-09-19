/**
 * 世界脉冲事件 → 私聊上下文（Living World Phase 3）。
 *
 * 脉冲发生在用户离开世界时。它只有在以下条件同时满足时，才会成为角色
 * 可以自然想起的一件事：
 *  - 事件属于当前用户的世界，且对角色可见；
 *  - 角色确实是这次行动的参与者；
 *  - 认知表有 full + canMention 记录。
 *
 * 这里不调用 LLM，也不依赖文本相似度。失败或缺少认知时宁可不召回，
 * 不能让角色凭空知道世界里发生了什么。
 */
import { db, type WorldEvent } from '../../db';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { characterRef } from './subjects';
import { isVisibleToCharacter } from './visibility';

export interface RecallablePulseEvent {
  event: WorldEvent;
}

export const DEFAULT_PULSE_RECALL_LIMIT = 3;

async function ownerFor(worldId: string, requestedUserId?: string): Promise<string | undefined> {
  const ownerId = (await db.worlds.get(worldId))?.userId;
  if (!ownerId) return undefined;
  if (requestedUserId && requestedUserId !== ownerId) return undefined;
  return ownerId;
}

/** 挑出角色亲身参与、知道且可主动提及的世界脉冲事件。 */
export async function selectRecallablePulseEvents(params: {
  userId?: string;
  worldId: string;
  characterId: string;
  limit?: number;
  /** 当前会话最近已经提过的事件，避免角色连续几轮重复同一件事。 */
  excludeEventIds?: string[];
}): Promise<RecallablePulseEvent[]> {
  const ownerId = await ownerFor(params.worldId, params.userId);
  if (!ownerId || !params.characterId) return [];
  const limit = Math.max(1, params.limit ?? DEFAULT_PULSE_RECALL_LIMIT);

  const known = await knowledgeRepo.listKnownBy(params.characterId, params.worldId, {
    minLevel: 'full',
    limit: 300,
    userId: ownerId,
  });
  const mentionable = new Set(
    known.filter((row) => row.knowledgeLevel === 'full' && row.canMention).map((row) => row.eventId),
  );
  if (mentionable.size === 0) return [];

  const visible = await worldEventRepo.listVisibleToCharacter(params.worldId, params.characterId, 200, ownerId);
  const ref = characterRef(params.characterId);
  const excluded = new Set(params.excludeEventIds ?? []);
  return visible
    .filter((event) => event.sourceType === 'pulse' && event.type === 'interaction')
    .filter((event) => event.participants.includes(ref))
    .filter((event) => mentionable.has(event.id))
    .filter((event) => !excluded.has(event.id))
    .filter((event) => isVisibleToCharacter(event, params.characterId))
    .sort((a, b) => (b.worldTime ?? b.timestamp) - (a.worldTime ?? a.timestamp))
    .slice(0, limit)
    .map((event) => ({ event }));
}
