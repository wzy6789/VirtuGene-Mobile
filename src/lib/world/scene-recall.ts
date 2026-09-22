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
 * 已结束的戏走 `selectRecallableScenes`，必须经过世界事件认知与可见性闸门；
 * 正在演/搁着的戏走下方的 `selectLiveSceneMoments`，只带最近正文，不能被
 * 私聊说成已经结算的完整经历。
 */
import { db, type WorldEvent, type WorldScene } from '../../db/index';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { isVisibleToCharacter } from './visibility';

export interface RecallableScene {
  scene: WorldScene;
  event: WorldEvent;
}

/**
 * 进行中的舞台片段：它还没有结算成世界事件，但参与者已经亲身经历了其中
 * 的最近几步。只把正文带进对应角色的私聊，绝不让旁观角色或其它用户看到。
 */
export interface LiveSceneMoment {
  scene: WorldScene;
  entries: { id: string; kind: string; content: string; speakerId?: string }[];
}

/** 一次最多召回几场戏（戏是长篇，给 2 场就够；再多会把上下文挤满） */
export const DEFAULT_SCENE_RECALL_LIMIT = 2;

const LIVE_ENTRY_KINDS = new Set(['user_input', 'dialogue', 'narration', 'action']);

async function ownerFor(worldId: string, requestedUserId?: string): Promise<string | undefined> {
  const ownerId = (await db.worlds.get(worldId))?.userId;
  if (!ownerId) return undefined;
  if (requestedUserId && requestedUserId !== ownerId) return undefined;
  return ownerId;
}

export async function selectRecallableScenes(params: {
  userId?: string;
  worldId: string;
  characterId: string;
  limit?: number;
}): Promise<RecallableScene[]> {
  const { userId, worldId, characterId } = params;
  const ownerId = await ownerFor(worldId, userId);
  if (!ownerId) return [];
  const limit = Math.max(1, params.limit ?? DEFAULT_SCENE_RECALL_LIMIT);

  const finished = await worldSceneRepo.listScenesByCharacter(worldId, characterId, { status: 'finished', limit: 20, userId: ownerId });
  if (finished.length === 0) return [];

  // 认知闸门：这个角色确实知道、且可以主动提起的世界事件
  const known = await knowledgeRepo.listKnownBy(characterId, worldId, { minLevel: 'full', limit: 300, userId: ownerId });
  const mentionable = new Set(known.filter((row) => row.canMention && row.knowledgeLevel === 'full').map((row) => row.eventId));
  if (mentionable.size === 0) return [];

  const out: RecallableScene[] = [];
  for (const scene of finished) {
    if (out.length >= limit) break;
    if (!scene.worldEventId) continue;
    if (!mentionable.has(scene.worldEventId)) continue;
    const event = await worldEventRepo.getById(scene.worldEventId);
    if (!event || event.type !== 'stage' || event.userId !== ownerId) continue;
    // 防御性二次校验：事件本身也要对这个角色可见
    if (!isVisibleToCharacter(event, characterId)) continue;
    out.push({ scene, event });
  }
  return out;
}

/**
 * 读取角色正在经历或暂时搁置的星域片段。与已结束场景的事件认知闸门不同，
 * 这里的资格来自 scene.characterIds：在场就是亲历；场景仍未完成，不能
 * 伪装成已经写入年表的长期记忆。只返回少量最近正文，避免污染私聊上下文。
 */
export async function selectLiveSceneMoments(params: {
  userId?: string;
  worldId: string;
  characterId: string;
  limit?: number;
  entriesPerScene?: number;
}): Promise<LiveSceneMoment[]> {
  const ownerId = await ownerFor(params.worldId, params.userId);
  if (!ownerId) return [];
  const scenes = await worldSceneRepo.listScenesByCharacter(params.worldId, params.characterId, {
    limit: Math.max(1, params.limit ?? 2) + 2,
    userId: ownerId,
  });
  const live = scenes.filter((scene) => scene.status === 'active' || scene.status === 'paused');
  const out: LiveSceneMoment[] = [];
  for (const scene of live.slice(0, Math.max(1, params.limit ?? 2))) {
    const rows = await worldSceneRepo.listRecentEntries(scene.id, 80);
    const participant = scene.state.participants.find((item) => item.characterId === params.characterId);
    const presentSince = participant?.entryMemoryMode === 'present' ? participant.enteredAt : undefined;
    const entries = rows
      .filter((entry) => presentSince === undefined || entry.createdAt >= presentSince)
      .filter((entry) => LIVE_ENTRY_KINDS.has(entry.kind) && entry.content.trim())
      .slice(-(Math.max(2, params.entriesPerScene ?? 5)))
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        content: entry.content.trim().slice(0, 220),
        ...(entry.speakerId ? { speakerId: entry.speakerId } : {}),
      }));
    if (entries.length > 0) out.push({ scene, entries });
  }
  return out;
}
