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
import { sceneEntryKnownBy, hasSceneHistory, worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { isVisibleToCharacter } from './visibility';
import { formatDate, hitCount, queryTerms } from './world-recall';

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
  /** The latest scene turns, used to continue the immediate exchange. */
  entries: { id: string; kind: string; content: string; createdAt: number; speakerId?: string }[];
  /** Recent user utterances are retained separately so later AI turns cannot push them out of the context window. */
  userStatements: { id: string; content: string; createdAt: number }[];
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
 * 检索角色在**进行中**的星域片段里较早说过/经历过的话。
 *
 * 为什么需要它：进行中的片段只有"最近几步"会常规进入上下文
 * （`selectLiveSceneMoments`，最多 5 条 / 220 字）。用户隔很多轮之后问
 * "那天你说的……"，只靠最近几步就找不回来了——同一个角色会显得失忆。
 * 这里把整段正文当作**可检索的证据**：摘要/最近片段负责自然接话，
 * 关键词检索负责把旧事找回来，两者都不改变"他到底经历了什么"。
 *
 * 闸门与其余场景召回保持同一口径：
 * 1. 必须是该角色参与过的片段（`scene.characterIds`）
 * 2. `participantReadsEntry`：`present`/`amnesiac` 不读入场前正文
 * 3. 多听众场景要求**每个**听众都被允许读到这条（共享提示词安全）
 */
export interface SceneSegmentHit {
  date: string;
  timestamp: number;
  text: string;
  sceneId: string;
  sceneTitle: string;
  entryId: string;
  score: number;
}

export interface FinishedSceneMoment {
  scene: WorldScene;
  /** Recent user plans and the character's own last words from a finished, known scene. */
  entries: { id: string; kind: string; content: string; createdAt: number; speakerId?: string }[];
}

export async function finishedSceneKnownByAudience(
  scene: WorldScene,
  ownerId: string,
  audience: string[],
): Promise<boolean> {
  if (scene.status !== 'finished' || !scene.worldEventId || audience.length === 0) return false;
  const event = await worldEventRepo.getById(scene.worldEventId);
  if (!event || event.userId !== ownerId || event.worldId !== scene.worldId || event.type !== 'stage') return false;
  if (!audience.every((id) => hasSceneHistory(scene, id) && isVisibleToCharacter(event, id))) return false;
  const knowledge = await Promise.all(audience.map((id) => knowledgeRepo.getForCharacterEvent(id, event.id)));
  return knowledge.every((row, index) => row?.userId === ownerId
    && row.worldId === scene.worldId
    && (row.knowledgeLevel === 'full' || (row.knowledgeLevel === 'partial'
      && !scene.characterIds.includes(audience[index])
      && scene.state.pastParticipants?.some(p => p.characterId === audience[index])))
    && row.canMention === true
    && row.eventId === event.id
    && row.characterId === audience[index]);
}

export async function findSceneSegmentHistory(params: {
  userId?: string;
  worldId: string;
  characterId: string;
  /** 只查这一场（当前所在片段）；缺省时查该角色所有进行中的片段。 */
  sceneId?: string;
  /** 其余听众；多人场景只返回所有听众都读得到的正文。 */
  audience?: string[];
  query: string;
  limit?: number;
  /** 默认只查进行中（active/paused）的片段。 */
  includeFinished?: boolean;
}): Promise<SceneSegmentHit[]> {
  const ownerId = await ownerFor(params.worldId, params.userId);
  if (!ownerId) return [];
  const terms = queryTerms(params.query);
  if (terms.length === 0) return [];
  const limit = Math.max(1, params.limit ?? 6);
  const audience = [...new Set([params.characterId, ...(params.audience ?? [])])];

  const scenes = await worldSceneRepo.listScenesByCharacter(params.worldId, params.characterId, {
    limit: Number.MAX_SAFE_INTEGER,
    userId: ownerId,
  });
  const candidates = scenes
    .filter((scene) => !params.sceneId || scene.id === params.sceneId)
    .filter((scene) => scene.status === 'active' || scene.status === 'paused' || (params.includeFinished === true && scene.status === 'finished'))
    .filter((scene) => audience.every((id) => hasSceneHistory(scene, id)));

  const hits: SceneSegmentHit[] = [];
  for (const scene of candidates) {
    if (scene.status === 'finished' && !(await finishedSceneKnownByAudience(scene, ownerId, audience))) continue;
    const all = await worldSceneRepo.listEntries(scene.id, { limit: Number.MAX_SAFE_INTEGER });
      // 全部原文都可按问题检索；调用方按来源 id 去重，不能在这里提前丢掉
      // 最近窗口中的其他发言人原话（那些原话未必已被注入）。
    const older = all;
    for (const entry of older) {
      if (!LIVE_ENTRY_KINDS.has(entry.kind) || !entry.content.trim()) continue;
      if (!audience.every((id) => sceneEntryKnownBy(scene, id, entry))) continue;
      const text = entry.content.trim();
      const score = hitCount(text, terms) * 2 + (entry.kind === 'dialogue' ? 0.5 : 0);
      if (score < 2) continue;
      hits.push({
        date: formatDate(entry.createdAt),
        timestamp: entry.createdAt,
        text: text.slice(0, 400),
        sceneId: scene.id,
        sceneTitle: scene.title,
        entryId: entry.id,
        score,
      });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * A finished scene's latest user plans and the character's own words remain
 * part of that character's lived memory. Keep this ambient carry small and
 * strictly knowledge-gated; detailed older lines are still explicit-recall only.
 */
export async function selectRecentFinishedSceneMoments(params: {
  userId?: string;
  worldId: string;
  characterId: string;
  limit?: number;
  entriesPerScene?: number;
}): Promise<FinishedSceneMoment[]> {
  const ownerId = await ownerFor(params.worldId, params.userId);
  if (!ownerId) return [];
  const limit = Math.max(1, params.limit ?? 1);
  const scenes = await worldSceneRepo.listScenesByCharacter(params.worldId, params.characterId, {
    status: 'finished',
    limit: Math.max(limit * 8, 16),
    userId: ownerId,
  });
  const out: FinishedSceneMoment[] = [];
  for (const scene of scenes) {
    if (out.length >= limit) break;
    if (!(await finishedSceneKnownByAudience(scene, ownerId, [params.characterId]))) continue;
    const rows = await worldSceneRepo.listRecentEntries(scene.id, 4000);
    const readable = rows.filter((entry) => sceneEntryKnownBy(scene, params.characterId, entry)
      && (entry.kind === 'user_input' || (entry.kind === 'dialogue' && entry.speakerId === params.characterId))
      && entry.content.trim());
    const userStatements = readable.filter((entry) => entry.kind === 'user_input').slice(-2);
    const ownWords = readable.filter((entry) => entry.kind === 'dialogue' && entry.speakerId === params.characterId).slice(-2);
    const entries = [...new Map([...userStatements, ...ownWords]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-Math.max(1, params.entriesPerScene ?? 3))
      .map((entry) => [entry.id, {
        id: entry.id,
        kind: entry.kind,
        content: entry.content.trim().slice(0, 220),
        createdAt: entry.createdAt,
        ...(entry.speakerId ? { speakerId: entry.speakerId } : {}),
      }]))].map(([, entry]) => entry);
    if (entries.length) out.push({ scene, entries });
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
    // Filter live status before capping, so recent finished scenes cannot hide it.
    limit: Number.MAX_SAFE_INTEGER,
    userId: ownerId,
  });
  const live = scenes.filter((scene) => scene.status === 'active' || scene.status === 'paused');
  const out: LiveSceneMoment[] = [];
  for (const scene of live.slice(0, Math.max(1, params.limit ?? 2))) {
    // Keep a wider local window than the on-screen conversation. The scene is
    // persisted separately from private chat, so a short 80-row window can
    // lose a user's stated plan after only a few multi-beat turns.
    const rows = await worldSceneRepo.listRecentEntries(scene.id, 4000);
    const readable = rows
      .filter((entry) => sceneEntryKnownBy(scene, params.characterId, entry))
      .filter((entry) => LIVE_ENTRY_KINDS.has(entry.kind) && entry.content.trim());
    const entries = readable
      .slice(-(Math.max(2, params.entriesPerScene ?? 5)))
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        content: entry.content.trim().slice(0, 220),
        createdAt: entry.createdAt,
        ...(entry.speakerId ? { speakerId: entry.speakerId } : {}),
      }));
    const recentEntryIds = new Set(entries.map((entry) => entry.id));
    const userStatements = readable
      .filter((entry) => entry.kind === 'user_input' && !recentEntryIds.has(entry.id))
      .slice(-6)
      .map((entry) => ({ id: entry.id, content: entry.content.trim().slice(0, 220), createdAt: entry.createdAt }));
    if (entries.length > 0 || userStatements.length > 0) out.push({ scene, entries, userStatements });
  }
  return out;
}
