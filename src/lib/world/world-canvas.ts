/**
 * World Canvas 数据门面（5.0.0 Living World §8 / §9 / §68 / §74 / §78）
 *
 * "世界空间"不是聊天页，但它复用**同一套**世界流数据（`worldScenes` /
 * `worldSceneEntries`）——因为一段共同经历本来就该是一条连续的时间线。
 *
 * 三个关键约定：
 * 1. **懒创建**：用户第一次进入世界时才创建"此刻"这一段，且**0 次 AI 调用**（§56 成本纪律）。
 * 2. **只渲染最近 60 条**（§68）：更早的内容按需分页加载，绝不一次把整段历史塞进 DOM。
 * 3. **默认延续**：新的片段继承上一段的地点与氛围，因此"世界感觉是连续的"（§49 Soft Continuity）。
 */
import type { Character, WorldScene, WorldSceneEntry } from '../../db/index';
import { db } from '../../db/index';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { worldLocationRepo } from '../../db/world-location-repo';
import { worldObjectRepo } from '../../db/world-object-repo';
import { worldAgentRepo } from '../../db/world-agent-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { characterRef, userRef } from './subjects';
import { timeLabelFor } from './world-turn';

/** 默认只渲染多少条世界流（§68） */
export const CANVAS_PAGE_SIZE = 60;

export interface CanvasView {
  scene: WorldScene;
  /** 最近 N 条（旧 → 新，直接喂给渲染） */
  entries: WorldSceneEntry[];
  /** 这一段总共有多少条 */
  total: number;
  /** 还有更早的内容吗（决定"查看更早内容"按钮） */
  hasMore: boolean;
}

/** 世界时钟：真实时间 + 这一段的偏移量（时间跳跃只改偏移，不伪造历史） */
export function worldNowDate(scene: WorldScene): Date {
  return new Date(Date.now() + (scene.state.timeOffsetMs ?? 0));
}

export function worldTimeLabel(scene: WorldScene): string {
  return scene.timeLabel || timeLabelFor(scene.state.timeOffsetMs ?? 0);
}

/** Move the active scene through the same persistent location state used by
 * the world canvas. This deliberately updates the scene before the next turn
 * is sent, so the director and every participant see the new place. */
export async function moveSceneToLocation(params: {
  userId: string;
  worldId: string;
  sceneId: string;
  locationId: string;
}): Promise<WorldScene | null> {
  const scene = await worldSceneRepo.getScene(params.sceneId);
  if (!scene || scene.userId !== params.userId || scene.worldId !== params.worldId) return null;

  const location = await db.worldLocations.get(params.locationId);
  if (
    !location
    || location.userId !== params.userId
    || location.worldId !== params.worldId
    || !location.active
    || location.type === 'reality'
  ) return null;

  await worldSceneRepo.updateScene(scene.id, { place: location.name });
  await db.worldScenes.update(scene.id, { locationId: location.id, updatedAt: Date.now() });
  const world = await db.worlds.get(params.worldId);
  const worldTime = world?.clock?.worldAt ?? Date.now();
  await Promise.all(scene.characterIds.map((characterId) => worldAgentRepo.moveCharacter({
    userId: params.userId,
    worldId: params.worldId,
    characterId,
    locationId: location.id,
    worldTime,
  })));

  const moved = (await worldSceneRepo.getScene(scene.id)) ?? {
    ...scene,
    place: location.name,
    locationId: location.id,
    updatedAt: Date.now(),
  };
  await worldObjectRepo.ensureForScene(moved);
  return moved;
}

/**
 * 取回（必要时创建）"此刻"这一段。**0 次 AI 调用**。
 *
 * 优先复用**未结束**的那一段（active / paused）；都没有就新建，
 * 并继承上一段的地点 / 氛围，让世界看起来是连续生活而不是一次次重开。
 */
export async function ensureCanvasScene(params: {
  userId: string;
  worldId: string;
  characters: Character[];
}): Promise<WorldScene> {
  const { userId, worldId } = params;
  const open = await worldSceneRepo.listScenes(worldId, { status: 'active', limit: 1, userId });
  if (open[0]) {
    const location = await worldLocationRepo.ensureFromScene(open[0]);
    await worldObjectRepo.ensureForScene({ ...open[0], locationId: location.id });
    return (await worldSceneRepo.getScene(open[0].id)) ?? { ...open[0], locationId: location.id };
  }
  const paused = await worldSceneRepo.listScenes(worldId, { status: 'paused', limit: 1, userId });
  if (paused[0]) {
    await worldSceneRepo.setSceneStatus(paused[0].id, 'active');
    const resumed = (await worldSceneRepo.getScene(paused[0].id)) ?? paused[0];
    const location = await worldLocationRepo.ensureFromScene(resumed);
    await worldObjectRepo.ensureForScene({ ...resumed, locationId: location.id });
    return (await worldSceneRepo.getScene(resumed.id)) ?? { ...resumed, locationId: location.id };
  }

  // 新建：延续上一段的地点到"此刻"，让世界感觉是连续的
  const recent = await worldSceneRepo.listScenes(worldId, { limit: 1, userId });
  const previous = recent[0];
  const owned = params.characters.filter((c) => c.createdBy === userId);
  const participants = (previous?.characterIds.length ? previous.characterIds : owned.slice(0, 2).map((c) => c.id))
    .filter((id) => params.characters.some((c) => c.id === id));
  const now = Date.now();
  const id = await worldSceneRepo.createScene({
    userId,
    worldId,
    title: '此刻',
    place: previous?.place || '你们常在的地方',
    timeLabel: timeLabelFor(0, now),
    mood: previous?.mood || '安静',
    characterIds: participants,
  });
  await worldSceneRepo.setSceneStatus(id, 'active');
  const created = (await worldSceneRepo.getScene(id))!;
  const location = await worldLocationRepo.ensureFromScene(created);
  await worldObjectRepo.ensureForScene({ ...created, locationId: location.id });
  return (await worldSceneRepo.getScene(id)) ?? { ...created, locationId: location.id };
}

/** 只读加载（分页）：默认最近 CANVAS_PAGE_SIZE 条 */
export async function loadCanvas(sceneId: string, opts: { pageSize?: number; userId?: string } = {}): Promise<CanvasView | null> {
  const scene = await worldSceneRepo.getScene(sceneId);
  if (!scene || (opts.userId !== undefined && scene.userId !== opts.userId)) return null;
  const pageSize = Math.max(10, opts.pageSize ?? CANVAS_PAGE_SIZE);
  const all = await worldSceneRepo.listEntries(sceneId, { limit: 4000 });
  const entries = all.slice(Math.max(0, all.length - pageSize));
  return { scene, entries, total: all.length, hasMore: all.length > entries.length };
}

/** 继续加载更早的内容（§68 顶部的"查看更早内容"） */
export async function loadEarlier(sceneId: string, beforeIndex: number, limit = CANVAS_PAGE_SIZE, userId?: string): Promise<WorldSceneEntry[]> {
  const scene = await worldSceneRepo.getScene(sceneId);
  if (!scene || (userId !== undefined && scene.userId !== userId)) return [];
  const all = await worldSceneRepo.listEntries(sceneId, { limit: 4000 });
  const older = all.filter((e) => e.index < beforeIndex);
  return older.slice(Math.max(0, older.length - limit));
}

/** 一次只读：这一段现在是什么样（Canvas 顶部） */
export async function canvasHeader(scene: WorldScene, characters: Character[]): Promise<{
  place: string;
  time: string;
  mood: string;
  names: string[];
  dayIndex: number;
}> {
  return {
    place: scene.place,
    time: worldTimeLabel(scene),
    mood: scene.mood,
    names: scene.characterIds.map((id) => characters.find((c) => c.id === id)?.name ?? '某人'),
    dayIndex: Math.max(1, Math.floor((Date.now() - scene.startedAt) / 86_400_000) + 1),
  };
}

/** 在场角色（人物 chips 的数据源；顺序即用户看到的顺序） */
export async function canvasPresence(scene: WorldScene, characters: Character[]): Promise<{ present: Character[]; absent: Character[] }> {
  const present: Character[] = [];
  const absent: Character[] = [];
  for (const character of characters) {
    if (scene.characterIds.includes(character.id)) present.push(character);
    else absent.push(character);
  }
  return { present, absent };
}

/** 最近一条灵感建议（§37：给用户灵感，但永远可以无视） */
export function latestSuggestions(entries: WorldSceneEntry[]): { entryId: string; options: string[] } | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== 'suggestion') continue;
    const options = (entry.meta?.options ?? []).filter((o) => typeof o === 'string' && o.trim().length > 0);
    if (options.length > 0) return { entryId: entry.id, options };
    return null;
  }
  return null;
}

/** 这一轮的世界痕迹（§11.5：点开才看具体记住了什么） */
export function latestTrace(entries: WorldSceneEntry[]): WorldSceneEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind === 'system' && entries[i].meta?.trace) return entries[i];
  }
  return null;
}

/**
 * 保存为故事（§78）：把**已经发生的一段**标记成一个完整章节。
 *
 * 与"先创建故事才能体验世界"相反：故事是世界经历的**结果**，不是前提。
 * 全程 0 次 AI 调用——用户按下按钮就应该立刻成功。
 */
export async function saveAsStory(params: {
  userId: string;
  worldId: string;
  sceneId: string;
  title?: string;
}): Promise<{ eventId: string; memoryId: string; title: string } | null> {
  const scene = await worldSceneRepo.getScene(params.sceneId);
  if (!scene || scene.userId !== params.userId) return null;
  const entries = await worldSceneRepo.listEntries(params.sceneId, { limit: 4000 });
  const titled = params.title?.trim();
  const firstDialogue = entries.find((e) => e.kind === 'dialogue' && e.content.trim());
  const title = (titled || scene.title || firstDialogue?.content.slice(0, 20) || '一段共同经历').slice(0, 60);
  const summary = entries
    .filter((e) => e.kind === 'narration' || e.kind === 'user_input')
    .slice(0, 3)
    .map((e) => e.content.slice(0, 60))
    .join('；')
    .slice(0, 300);

  const participants = [userRef(params.userId), ...scene.characterIds.map(characterRef)];
  const eventId = await worldEventRepo.create({
    userId: params.userId,
    worldId: params.worldId,
    type: 'stage',
    title,
    summary,
    participants,
    timestamp: Date.now(),
    importance: 0.85,
    sourceType: 'story',
    sourceId: params.sceneId,
    visibility: 'selected',
    visibleTo: [...scene.characterIds],
    resolved: true,
    tags: ['你们的故事'],
    meta: { place: scene.place, timeLabel: scene.timeLabel, mood: scene.mood, savedBy: 'user' },
  });
  const memoryId = await sharedMemoryRepo.create({
    userId: params.userId,
    worldId: params.worldId,
    title,
    summary,
    participants,
    sourceType: 'story',
    sourceId: params.sceneId,
    importance: 0.8,
    visibility: 'selected',
    visibleTo: [...scene.characterIds],
    tags: ['你们的故事'],
  });
  await worldEventRepo.update(eventId, { memoryIds: [memoryId] });
  for (const characterId of scene.characterIds) {
    await knowledgeRepo.upsert({
      userId: params.userId,
      worldId: params.worldId,
      characterId,
      eventId,
      knowledgeLevel: 'full',
      canMention: true,
    });
  }
  return { eventId, memoryId, title };
}

/** "保存为故事"是否已经做过（避免重复按钮） */
export async function isSavedAsStory(userId: string, worldId: string, sceneId: string): Promise<boolean> {
  const existing = await worldEventRepo.getBySource(userId, worldId, 'story', sceneId);
  return !!existing;
}

/** 把这一段收束起来（用户点"结束这一刻"）：只暂停，0 次 AI 调用（结算由用户显式触发） */
export async function pauseCanvas(sceneId: string, userId?: string): Promise<void> {
  const scene = await worldSceneRepo.getScene(sceneId);
  if (!scene || (userId !== undefined && scene.userId !== userId)) return;
  await worldSceneRepo.setSceneStatus(sceneId, 'paused');
}

/** 全部片段（新 → 旧）：记忆页与时间线的数据源 */
export async function listSegments(worldId: string, limit = 50): Promise<WorldScene[]> {
  return worldSceneRepo.listScenes(worldId, { limit });
}

/** 删除一段（连同正文） */
export async function removeSegment(sceneId: string): Promise<void> {
  await worldSceneRepo.deleteScene(sceneId);
}

/** 这一段的全部正文（导出/分享/报告用） */
export async function segmentEntries(sceneId: string): Promise<WorldSceneEntry[]> {
  return worldSceneRepo.listEntries(sceneId, { limit: 4000 });
}

/** 段落条数统计（世界主页弱化统计用） */
export async function segmentCount(worldId: string): Promise<number> {
  return db.worldScenes.where('worldId').equals(worldId).count();
}
