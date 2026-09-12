/**
 * 舞台后果 → 私聊上下文（Phase 3b：把场景闭环成"说得出来"）
 *
 * 一场戏演完，它会被写进世界层（stage 事件 / 共同记忆 / 关系变化 / 未完成事件 / 参与者认知）。
 * 本模块负责**在私聊里把它召回来**，规则与共同记忆完全一致、同样是三道闸门：
 *
 * 1. **参与过**：`WorldScene.characterIds` 必须包含这个角色（没在场就不可能记得）
 * 2. **知道且可提起**：该角色在**这场戏的 stage 世界事件**上有 `full` + `canMention` 的认知
 *    （收尾结算时按"参与者亲身经历"授予；角色被删除/清理后自然消失）
 * 3. **可见性**：stage 事件必须对这个角色可见（`lib/world/visibility.ts` 的统一闸门，
 *    与 settle 时写入的 `selected + visibleTo=参与者` 对齐，属于防御性二次校验）
 *
 * 只召回**已经结束**的戏：正在演/搁着的戏属于"舞台上还没发生完的事"，
 * 不应该在私聊里被当成"我们经历过"来讲。
 */
import type { WorldEvent, WorldScene } from '../../db/index';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { isVisibleToCharacter } from './visibility';

export interface RecallableScene {
  scene: WorldScene;
  event: WorldEvent;
}

/** 一次最多召回几场戏（戏是长篇，给 2 场就够；再多会把上下文挤满） */
export const DEFAULT_SCENE_RECALL_LIMIT = 2;

export async function selectRecallableScenes(params: {
  worldId: string;
  characterId: string;
  limit?: number;
}): Promise<RecallableScene[]> {
  const { worldId, characterId } = params;
  const limit = Math.max(1, params.limit ?? DEFAULT_SCENE_RECALL_LIMIT);

  const finished = await worldSceneRepo.listScenesByCharacter(worldId, characterId, { status: 'finished', limit: 20 });
  if (finished.length === 0) return [];

  // 认知闸门：这个角色确实知道、且可以主动提起的世界事件
  const known = await knowledgeRepo.listKnownBy(characterId, worldId, { minLevel: 'full', limit: 300 });
  const mentionable = new Set(known.filter((row) => row.canMention && row.knowledgeLevel === 'full').map((row) => row.eventId));
  if (mentionable.size === 0) return [];

  const out: RecallableScene[] = [];
  for (const scene of finished) {
    if (out.length >= limit) break;
    if (!scene.worldEventId) continue;
    if (!mentionable.has(scene.worldEventId)) continue;
    const event = await worldEventRepo.getById(scene.worldEventId);
    if (!event || event.type !== 'stage') continue;
    // 防御性二次校验：事件本身也要对这个角色可见
    if (!isVisibleToCharacter(event, characterId)) continue;
    out.push({ scene, event });
  }
  return out;
}
