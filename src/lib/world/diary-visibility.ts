/**
 * 我的生活 → 世界：日记的三级可见性（Phase 2b-4）
 *
 * 规则（严格按审核确认的口径）：
 * - `private`（默认）**只有用户自己**。不写世界事件、不给任何角色认知。
 * - `selected`（告诉某角色）**只授予指定角色"认知 + 可提起"**，**不写世界事件**
 *   —— 这是"我只告诉你一个人"，不该在世界年表里留痕。
 * - `world`（加入共同世界）才写世界事件（`reality`），并按**参与者**建立认知。
 *
 * 认知锚点：日记的授权认知挂在 `diary:<diaryId>` 上（不是每条都有一条世界事件）。
 * `CharacterKnowledge.eventId` 在这里当"认知锚点"用：普通世界事件用事件 id，
 * 只告诉某个角色的现实记录用日记锚点。这样"谁能提起这条日记"只有一个判断口径。
 *
 * 撤回是**立即生效**的：收回授权会删掉认知行（并移除世界事件），
 * 因此下一次发送的上下文里就不会再出现它（验收里用真实两次发送对比过）。
 */
import { db, type Diary, type WorldVisibility } from '../../db/index';
import { worldRepo } from '../../db/world-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { characterRef, derivedWorldEventId, userRef } from './subjects';

/** 日记授权认知的锚点前缀（与普通世界事件 id 不会撞名） */
export const DIARY_ANCHOR_PREFIX = 'diary:';

export function diaryKnowledgeAnchor(diaryId: string): string {
  return `${DIARY_ANCHOR_PREFIX}${diaryId}`;
}

export function diaryIdFromAnchor(anchor: string): string | null {
  return anchor.startsWith(DIARY_ANCHOR_PREFIX) ? anchor.slice(DIARY_ANCHOR_PREFIX.length) : null;
}

/** 日记进入世界层后的事件 id（确定性 ⇒ 反复授权只会有同一条） */
export function derivedDiaryWorldEventId(userId: string, worldId: string, diaryId: string): string {
  return derivedWorldEventId(userId, worldId, 'diary', diaryId);
}

export interface SetDiarySharingInput {
  userId: string;
  diaryId: string;
  visibility: WorldVisibility;
  /** visibility='selected' 时：被允许知道的角色（去重；空数组会按 private 处理） */
  visibleTo?: string[];
}

export interface SetDiarySharingResult {
  visibility: WorldVisibility;
  visibleTo: string[];
  worldEventId?: string;
  /** 本次授予认知的角色 */
  granted: string[];
  /** 本次收回认知的角色数 */
  revoked: number;
}

/** 该日记是否真的"可见"（selected 但没选人 ⇒ 视为 private，不留一个半开的口子） */
function normalize(visibility: WorldVisibility, visibleTo: string[]): { visibility: WorldVisibility; visibleTo: string[] } {
  if (visibility === 'selected' && visibleTo.length === 0) return { visibility: 'private', visibleTo: [] };
  return visibility === 'selected' ? { visibility, visibleTo } : { visibility, visibleTo: [] };
}

/**
 * 设置一条日记的可见性（幂等）。
 * 会同步三件事：日记行本身 / 授权认知 / 世界事件（仅 world 时存在）。
 */
export async function setDiarySharing(input: SetDiarySharingInput): Promise<SetDiarySharingResult> {
  const diary = await db.diaries.get(input.diaryId);
  if (!diary || diary.userId !== input.userId) throw new Error('diary-visibility: 日记不存在或不属于该用户');

  const world = await worldRepo.ensureDefaultWorld(input.userId);
  const anchor = diaryKnowledgeAnchor(diary.id);
  const eventId = derivedDiaryWorldEventId(input.userId, world.id, diary.id);
  const { visibility, visibleTo } = normalize(input.visibility, [...new Set(input.visibleTo ?? [])]);

  // 目标认知集合：selected=被选中的角色；world=参与者（用户 + 该条日记关联的角色）；private=空
  const participantIds = diary.characterId ? [diary.characterId] : [];
  const shouldKnow = visibility === 'selected' ? visibleTo : visibility === 'world' ? participantIds : [];

  // 先收回：把当前锚点上的所有认知删掉，再按新规则重授（简单、无残留）
  const revoked = await knowledgeRepo.removeForEvent(anchor);
  const granted: string[] = [];
  for (const characterId of shouldKnow) {
    await knowledgeRepo.upsert({
      userId: input.userId,
      worldId: world.id,
      characterId,
      eventId: anchor,
      knowledgeLevel: 'full',
      canMention: true,
    });
    granted.push(characterId);
  }

  let worldEventId: string | undefined;
  if (visibility === 'world') {
    const participants = [userRef(input.userId), ...participantIds.map(characterRef)];
    await worldEventRepo.create({
      userId: input.userId,
      worldId: world.id,
      type: 'reality',
      title: diary.title.trim() || '一页没有标题的日记',
      summary: diary.content.trim().slice(0, 200),
      participants,
      timestamp: new Date(`${diary.date}T12:00:00`).getTime() || diary.createdAt,
      importance: 0.6,
      sourceType: 'diary',
      sourceId: diary.id,
      visibility: 'world',
      resolved: true,
      tags: ['你写下的生活'],
      meta: { diaryId: diary.id, diaryDate: diary.date },
    });
    worldEventId = eventId;
  } else {
    // 降级（world → selected/private）或本来就是 private/selected：确保世界层没有残留
    await worldEventRepo.remove(eventId);
  }

  // 写回日记行：worldEventId 必须**真的删掉**（而不是留一个 undefined），
  // 与 diary-repo.restore 同一套做法，避免 Dexie 里留下"半开"的字段
  const next: Diary = { ...diary, visibility, visibleTo, updatedAt: Date.now() };
  if (worldEventId) next.worldEventId = worldEventId;
  else delete (next as { worldEventId?: string }).worldEventId;
  await db.diaries.put(next);

  return { visibility, visibleTo, ...(worldEventId ? { worldEventId } : {}), granted, revoked };
}

/** 日记被彻底删除（清空回收站 / 角色删除清理）时，收回认知并移除派生事件 */
export async function clearDiarySharing(userId: string, diaryId: string): Promise<void> {
  const world = await worldRepo.ensureDefaultWorld(userId);
  await knowledgeRepo.removeForEvent(diaryKnowledgeAnchor(diaryId));
  await worldEventRepo.remove(derivedDiaryWorldEventId(userId, world.id, diaryId));
}

/**
 * 该角色**确实知道并且可以主动提起**的日记 id（上下文注入的认知闸门）。
 * 认知等级要求 full：只知道一点点的（partial）不注入，避免角色说错。
 */
export async function listMentionableDiaryIds(userId: string, worldId: string, characterId: string): Promise<Set<string>> {
  const rows = await knowledgeRepo.listKnownBy(characterId, worldId, { minLevel: 'full', limit: 300, userId });
  const out = new Set<string>();
  for (const row of rows) {
    if (!row.canMention || row.knowledgeLevel !== 'full') continue;
    const diaryId = diaryIdFromAnchor(row.eventId);
    if (diaryId) out.add(diaryId);
  }
  return out;
}

/** 一条日记当前的授权对象（给 UI 用的人话描述数据） */
export function describeSharing(diary: Diary, nameOf: (id: string) => string): string {
  if (diary.visibility === 'world') {
    return diary.characterId ? `已加入共同世界（${nameOf(diary.characterId)} 也知道）` : '已加入共同世界';
  }
  if (diary.visibility === 'selected') {
    const names = (diary.visibleTo ?? []).map(nameOf).filter(Boolean);
    return names.length > 0 ? `只告诉了 ${names.join('、')}` : '仅自己可见';
  }
  return '仅自己可见';
}
