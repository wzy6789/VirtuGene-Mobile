/**
 * 世界舞台运行时（Phase 3）
 *
 * 成本纪律（§56/§57）：
 * - **每个用户动作 = 1 次调用**（这一调用出多条正文）
 * - **一场戏结束 = 1 次结算调用**（把后果写回世界层）
 * - **打开 / 离开 / 暂停舞台 = 0 次调用**（绝不新增离线后台 LLM）
 *
 * 写入纪律：
 * - 正文只进 `worldSceneEntries`（不碰 sessions/messages）
 * - 结构化状态进 `WorldScene.state`（不是"塞进 Prompt"）
 * - 结算的后果由 `validateSettlement` 校验后，再经既有 writer/repo 写入：
 *   `reality/stage` 世界事件、`sharedMemories`、`relationshipEvents`（带原因）、
 *   `continuityThreads`（带 sourceSceneId）、参与者认知
 */
import { db, type WorldScene, type WorldSceneEntry } from '../../db/index';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldLocationRepo } from '../../db/world-location-repo';
import { worldObjectRepo } from '../../db/world-object-repo';
import { worldAgentRepo } from '../../db/world-agent-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { characterRepo } from '../../db/character-repo';
import { characterRef, userRef } from './subjects';
import {
  directSceneTurn,
  proposeSceneSettlement,
  type SceneDirectorMember,
  type SceneDirectorParams,
  type SceneLlmCaller,
} from '../ai/scene-director';
import { validateSettlement } from './scene-consequences';
import { actMarkerContent, shouldAdvanceAct } from './scene-acts';
import { buildHiddenUserProfile } from './user-profile';
import { recallCharacterMemory } from '../character-memory';

/** 一次场景推演的结果（供 UI 与验收断言） */
export interface SceneTurnResult {
  entries: WorldSceneEntry[];
  tension?: number;
  /** 兼容旧验收与旧调用方；新场景不再推进或显示幕次。 */
  actAdvanced?: number;
  error?: string;
  /** 主模型无输出时是否由备用模型接续（仅诊断，不展示内部模型细节）。 */
  fallback?: boolean;
  modelId?: string;
  llmCalls: number;
}

async function buildMembers(scene: WorldScene, userId: string, query = ''): Promise<SceneDirectorMember[]> {
  const members: SceneDirectorMember[] = [];
  for (const characterId of scene.characterIds) {
    const character = await characterRepo.getById(characterId);
    if (!character) continue;
    const participant = scene.state.participants.find((p) => p.characterId === characterId);
    const carryMemory = (participant?.entryMemoryMode ?? scene.state.entryMemoryMode ?? 'memory') !== 'present';
    // 角色**只能知道**自己参与过的事件：用认知边界过滤（§62）
    const recalled = carryMemory ? await recallCharacterMemory({ userId, characterId, query, audience: scene.characterIds, worldId: scene.worldId, excludeSceneId: scene.id }) : { text: '' };
    const userMemories = carryMemory
      ? await db.memories.where('characterId').equals(characterId).toArray()
        .then((rows) => rows
          .filter((row) => row.userId === userId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 18))
      : [];
    const userProfile = buildHiddenUserProfile(userMemories, query);
    members.push({
      characterId,
      name: character.name,
      persona: (character.systemPrompt ?? '').slice(0, 600),
      ...(participant?.goals?.length ? { goal: participant.goals.join('；') } : {}),
      ...(recalled.text ? { knows: recalled.text } : {}),
      ...(participant?.secrets?.length ? { secret: participant.secrets.join('；') } : {}),
      ...(userProfile ? { userProfile } : {}),
    });
  }
  return members;
}

/** 把场景正文转成导演需要的 history（新的在后，取最近若干条） */
function toDirectorHistory(entries: WorldSceneEntry[], nameOf: (id: string) => string) {
  return entries
    .filter((e) => !(e.kind === 'system' && e.content.startsWith('——')))
    .map((e) => ({
      kind: e.kind === 'dialogue' || e.kind === 'narration' || e.kind === 'user_input' ? e.kind : ('narration' as const),
      ...(e.speakerId ? { speakerName: nameOf(e.speakerId) } : {}),
      content: e.content,
    }));
}

/**
 * 开始一场戏：**不调用 LLM**（打开舞台是免费的）。
 * 正文由第一次 `runSceneTurn` 产生（用户动作或"让他们先开口"）。
 */
export async function startScene(params: {
  userId: string;
  worldId: string;
  title: string;
  place: string;
  timeLabel: string;
  mood: string;
  theme?: string;
  characterIds: string[];
  sceneGoal?: string;
  participants?: { characterId: string; goals: string[]; knowsEventIds: string[]; secrets: string[]; entryMemoryMode?: 'memory' | 'present' }[];
}): Promise<string> {
  if (params.characterIds.length === 0) throw new Error('scene:participants_required');
  // 同一个角色同一时间只属于一段正在进行的星域片段。离开旧片段会先暂停它；
  // 若要把完整经历写入世界记忆，再结束并保存旧片段即可。
  const activeScenes = await worldSceneRepo.listScenes(params.worldId, { limit: 500, userId: params.userId });
  // 活跃或暂停中的片段都仍然占用角色；只有明确结束并保存后才释放。
  // 这样角色离开旧片段后，必须先保留完整经历，才能进入下一段片段。
  const occupied = new Set(
    activeScenes
      .filter((scene) => scene.status === 'active' || scene.status === 'paused')
      .flatMap((scene) => scene.characterIds),
  );
  const conflict = [...new Set(params.characterIds)].find((characterId) => occupied.has(characterId));
  if (conflict) throw new Error('scene:character_occupied');
  const sceneId = await worldSceneRepo.createScene({
    userId: params.userId,
    worldId: params.worldId,
    title: params.title,
    place: params.place,
    timeLabel: params.timeLabel,
    mood: params.mood,
    ...(params.theme ? { theme: params.theme } : {}),
    characterIds: params.characterIds,
    ...(params.sceneGoal ? { sceneGoal: params.sceneGoal } : {}),
    ...(params.participants ? { participants: params.participants } : {}),
  });
  await worldSceneRepo.setSceneStatus(sceneId, 'active');
  const scene = await worldSceneRepo.getScene(sceneId);
  if (scene) {
    const location = await worldLocationRepo.ensureFromScene(scene);
    await worldObjectRepo.ensureForScene({ ...scene, locationId: location.id });
    const world = await db.worlds.get(params.worldId);
    const worldTime = world?.clock?.worldAt ?? Date.now();
    await Promise.all(params.characterIds.map((characterId) => worldAgentRepo.moveCharacter({
      userId: params.userId,
      worldId: params.worldId,
      characterId,
      locationId: location.id,
      worldTime,
    })));
  }
  await worldSceneRepo.appendEntry(sceneId, {
    kind: 'system',
    content: `${params.place} · ${params.timeLabel}`,
  });
  return sceneId;
}

/**
 * 先把用户这一轮写进舞台正文，再开始等待模型。
 *
 * 这是有意独立出来的两阶段写入：用户按下发送时，动作已经是真实发生过的，
 * 即使模型稍后超时或所有供应商都不可用，也不能让这句话从屏幕和历史里消失。
 * 调用方随后把返回的 id 作为 retryOfUserEntryId 传给 runSceneTurn，避免重复写入。
 */
export async function appendSceneUserEntry(params: {
  userId: string;
  sceneId: string;
  action: string;
  chosenFromEntryId?: string;
}): Promise<WorldSceneEntry> {
  const scene = await worldSceneRepo.getScene(params.sceneId);
  if (!scene || scene.userId !== params.userId) throw new Error('scene:not_found');
  if (scene.status === 'finished') throw new Error('scene:finished');
  const action = params.action.trim().slice(0, 600);
  if (!action) throw new Error('scene:empty_action');

  if (params.chosenFromEntryId) {
    await worldSceneRepo.patchEntryMeta(params.chosenFromEntryId, { chosen: action });
    const row = await worldSceneRepo.appendEntry(params.sceneId, {
      kind: 'choice',
      content: action,
      meta: { chosen: action, fromEntryId: params.chosenFromEntryId },
    });
    if (scene.status === 'draft') await worldSceneRepo.setSceneStatus(params.sceneId, 'active');
    return row;
  }

  const row = await worldSceneRepo.appendEntry(params.sceneId, { kind: 'user_input', content: action });
  if (scene.status === 'draft') await worldSceneRepo.setSceneStatus(params.sceneId, 'active');
  return row;
}

/**
 * 推演一轮：**恰好 1 次调用** → 追加多条正文 + 更新结构化状态。
 * 失败时**不写入任何编造内容**，只把 error 交给 UI。
 */
export async function runSceneTurn(params: {
  userId: string;
  sceneId: string;
  userAction?: string;
  /** 这次动作来自哪个"选择提示"（点选项时传；会在那条上记录用户的选择） */
  chosenFromEntryId?: string;
  /** 失败后重试时传入原用户动作条目，避免再次写入同一条动作。 */
  retryOfUserEntryId?: string;
  apiKey: string;
  callLlm?: SceneLlmCaller;
}): Promise<SceneTurnResult> {
  const scene = await worldSceneRepo.getScene(params.sceneId);
  if (!scene || scene.userId !== params.userId) return { entries: [], error: '场景不存在', llmCalls: 0 };
  if (scene.status === 'finished') return { entries: [], error: '这场戏已经结束了', llmCalls: 0 };

  const characters = await Promise.all(scene.characterIds.map((id) => characterRepo.getById(id)));
  const nameOf = (id: string) => characters.find((c) => c?.id === id)?.name ?? '某人';

  // 1) 用户动作通常已由 UI 在等待模型前落库；旧调用方仍可直接调用 runtime，
  //    所以这里保留同样的幂等写入逻辑。重试沿用原条目，不复制动作。
  const appended: WorldSceneEntry[] = [];
  if (params.userAction?.trim()) {
    const action = params.userAction.trim().slice(0, 600);
    const existingRetry = params.retryOfUserEntryId
      ? (await worldSceneRepo.getEntriesById([params.retryOfUserEntryId]))[0]
      : undefined;
    if (existingRetry) {
      // 原条目已经在本地显示，director 仍会从完整历史读取它。
    } else {
      appended.push(await appendSceneUserEntry({
        userId: params.userId,
        sceneId: params.sceneId,
        action,
        ...(params.chosenFromEntryId ? { chosenFromEntryId: params.chosenFromEntryId } : {}),
      }));
    }
  }
  if (scene.status === 'draft') await worldSceneRepo.setSceneStatus(params.sceneId, 'active');

  // 2) 一次调用出多条
  const history = await worldSceneRepo.listRecentEntries(params.sceneId, 200);
  const members = await buildMembers(scene, params.userId, params.userAction);
  const directorParams: SceneDirectorParams = {
    apiKey: params.apiKey,
    scene: { title: scene.title, place: scene.place, timeLabel: scene.timeLabel, mood: scene.mood, ...(scene.theme ? { theme: scene.theme } : {}) },
    state: {
      ...(scene.state.sceneGoal ? { sceneGoal: scene.state.sceneGoal } : {}),
      currentTension: scene.state.currentTension,
      activeConflicts: scene.state.activeConflicts,
      pendingConsequences: scene.state.pendingConsequences,
    },
    members,
    history: toDirectorHistory(history, nameOf),
    ...(params.userAction?.trim() ? { userAction: params.userAction.trim().slice(0, 600) } : {}),
  };
  const result = await directSceneTurn(directorParams, params.callLlm);

  if (result.entries.length === 0) {
    return {
      entries: appended,
      error: result.error ?? '这一轮没有生成内容',
      ...(result.fallback ? { fallback: true } : {}),
      ...(result.modelId ? { modelId: result.modelId } : {}),
      llmCalls: result.llmCalls ?? 1,
    };
  }

  // 3) 正文落库（旁白/对白/选择提示）
  for (const entry of result.entries) {
    appended.push(
      await worldSceneRepo.appendEntry(params.sceneId, {
        kind: entry.kind,
        content: entry.content,
        ...(entry.speakerId ? { speakerId: entry.speakerId } : {}),
        ...(entry.options ? { meta: { options: entry.options } } : {}),
      }),
    );
  }

  // 4) 结构化状态（由**我们的规则**决定怎么用模型给的建议值）
  const patch: Parameters<typeof worldSceneRepo.patchSceneState>[1] = {};
  if (result.tension != null) patch.currentTension = result.tension;
  if (result.newConflict) patch.activeConflicts = [...scene.state.activeConflicts, result.newConflict];
  if (result.pendingConsequence) patch.pendingConsequences = [...scene.state.pendingConsequences, result.pendingConsequence];

  // 旧数据兼容：仍维护内部节奏游标与历史标记，便于旧场景和导出数据继续工作。
  // 新 UI 会隐藏这些 system 条目，模型提示词也不再暴露“其一/其二”。
  let actAdvanced: number | undefined;
  {
    const allEntries = await worldSceneRepo.listRecentEntries(params.sceneId, 400);
    const decision = shouldAdvanceAct({
      state: { currentAct: scene.state.currentAct, currentTension: patch.currentTension ?? scene.state.currentTension },
      entries: allEntries,
    });
    if (decision.advance) {
      patch.currentAct = decision.nextAct;
      patch.currentTension = 0;
      actAdvanced = decision.nextAct;
    }
  }

  if (Object.keys(patch).length > 0) await worldSceneRepo.patchSceneState(params.sceneId, patch);
  if (actAdvanced != null) {
    appended.push(await worldSceneRepo.appendEntry(params.sceneId, {
      kind: 'system',
      content: actMarkerContent(actAdvanced),
      act: actAdvanced,
    }));
  }

  return {
    entries: appended,
    ...(result.tension != null ? { tension: result.tension } : {}),
    ...(actAdvanced != null ? { actAdvanced } : {}),
    ...(result.fallback ? { fallback: true } : {}),
    ...(result.modelId ? { modelId: result.modelId } : {}),
    llmCalls: result.llmCalls ?? 1,
  };
}

/** 离开舞台（暂停）：**0 次调用**，不产生任何后果 */
export async function pauseScene(sceneId: string, userId?: string): Promise<void> {
  const scene = await worldSceneRepo.getScene(sceneId);
  if (!scene || scene.status === 'finished' || (userId !== undefined && scene.userId !== userId)) return;
  await worldSceneRepo.setSceneStatus(sceneId, 'paused');
}

export interface SceneSettlementResult {
  worldEventId?: string;
  memoryId?: string;
  relationshipEvents: number;
  unresolvedThreads: number;
  dropped: string[];
  llmCalls: number;
  fallback?: boolean;
  modelId?: string;
  error?: string;
}

/**
 * 结束一场戏并结算：正常 1 次调用，模型无效时按兜底链路重试。
 * 顺序：结算建议 → 校验 → 写世界层（事件/记忆/关系史/未完成事件/认知）→ 标记 finished。
 */
export async function finishSceneAndSettle(params: {
  userId: string;
  sceneId: string;
  apiKey: string;
  callLlm?: SceneLlmCaller;
}): Promise<SceneSettlementResult> {
  const empty: SceneSettlementResult = { relationshipEvents: 0, unresolvedThreads: 0, dropped: [], llmCalls: 0 };
  const scene = await worldSceneRepo.getScene(params.sceneId);
  if (!scene || scene.userId !== params.userId) return { ...empty, error: '场景不存在' };
  // 已经结束过的场景**不再结算**：否则重复点"结束"会白白多花一次调用，
  // 并且可能覆盖那次真实的结算结果（验收 C⑳ 抓到的真实缺陷）
  if (scene.status === 'finished') return { ...empty, error: '这场戏已经结束了' };

  const entries = await worldSceneRepo.listRecentEntries(params.sceneId, 400);
  const characters = await Promise.all(scene.characterIds.map((id) => characterRepo.getById(id)));
  const names = scene.characterIds.map((id) => ({ characterId: id, name: characters.find((c) => c?.id === id)?.name ?? '某人' }));
  const nameOf = (id: string) => names.find((n) => n.characterId === id)?.name ?? '某人';
  const transcript = entries
    .map((e) => (e.kind === 'narration' ? `（旁白）${e.content}` : e.kind === 'user_input' ? `（用户）${e.content}` : `${e.speakerId ? nameOf(e.speakerId) : '某人'}：${e.content}`))
    .join('\n');

  const proposed = await proposeSceneSettlement(
    {
      apiKey: params.apiKey,
      scene: { title: scene.title, place: scene.place, timeLabel: scene.timeLabel, mood: scene.mood, ...(scene.theme ? { theme: scene.theme } : {}) },
      memberNames: names,
      transcript,
    },
    params.callLlm,
  );
  const llmCalls = proposed.llmCalls ?? 1;
  if (proposed.error || !proposed.raw.trim()) {
    return {
      ...empty,
      llmCalls,
      ...(proposed.modelId ? { modelId: proposed.modelId } : {}),
      ...(proposed.fallback ? { fallback: true } : {}),
      error: '这场戏暂时没能完成结算，请再试一次',
    };
  }

  const { proposal, dropped } = validateSettlement(proposed.raw, {
    userId: params.userId,
    characterIds: scene.characterIds,
    resolveCharacter: (name) => names.find((n) => n.name === name)?.characterId,
  });

  const participants = [userRef(params.userId), ...scene.characterIds.map(characterRef)];
  const summary = proposal.summary ?? `${scene.title}（${scene.place}）`;

  // 1) 舞台世界事件（**真实场景才能产生 stage**：2b-0 起从未伪造过）
  const eventId = await worldEventRepo.create({
    userId: params.userId,
    worldId: scene.worldId,
    type: 'stage',
    title: scene.title,
    summary,
    participants,
    timestamp: scene.finishedAt ?? Date.now(),
    importance: 0.9,
    sourceType: 'scene',
    sourceId: scene.id,
    // 与既有口径一致：这场戏是"你们之间发生的事"，不擅自让全世界角色都知道
    visibility: 'selected',
    visibleTo: [...scene.characterIds],
    resolved: true,
    tags: ['星域'],
    meta: { place: scene.place, timeLabel: scene.timeLabel, mood: scene.mood, ...(scene.theme ? { theme: scene.theme } : {}) },
  });

  // 2) 共同记忆（有建议才写；与事件互相引用）
  let memoryId: string | undefined;
  if (proposal.memory) {
    memoryId = await sharedMemoryRepo.create({
      userId: params.userId,
      worldId: scene.worldId,
      title: proposal.memory.title,
      summary: proposal.memory.summary ?? '',
      participants,
      sourceType: 'scene',
      sourceId: scene.id,
      importance: 0.8,
      visibility: 'selected',
      visibleTo: [...scene.characterIds],
      tags: ['一起经历的戏'],
    });
    await worldEventRepo.update(eventId, { memoryIds: [memoryId] });
  }

  // 3) 关系变化（**每条都带原因**；数值由校验层夹过）
  let relationshipEvents = 0;
  for (const change of proposal.relationshipChanges) {
    try {
      const applied = await relationshipRepo.applyEvent({
        userId: params.userId,
        worldId: scene.worldId,
        a: change.a,
        b: change.b,
        facets: change.facets,
        reason: change.reason,
        sourceEventId: eventId,
        sourceType: 'scene',
        idempotencyKey: `${scene.id}:${change.a}:${change.b}`,
        createdAt: scene.finishedAt ?? Date.now(),
      });
      if (applied.applied) relationshipEvents += 1;
    } catch {
      dropped.push('关系变化写入失败');
    }
  }

  // 4) 未完成事件（带 sourceSceneId；既有 writer 会派生 continuity 世界事件）
  let unresolvedThreads = 0;
  for (const item of proposal.unresolved) {
    try {
      await continuityRepo.create({
        characterId: item.characterId,
        userId: params.userId,
        kind: item.kind,
        title: item.title,
        ...(item.detail ? { detail: item.detail } : {}),
        origin: 'ai',
        sourceSceneId: scene.id,
      });
      unresolvedThreads += 1;
    } catch {
      dropped.push('未完成事件写入失败');
    }
  }

  // 5) 认知：**亲身经历 ⇒ 只有参与者获得**（不接受模型指定）
  for (const characterId of scene.characterIds) {
    await knowledgeRepo.upsert({
      userId: params.userId,
      worldId: scene.worldId,
      characterId,
      eventId,
      knowledgeLevel: 'full',
      canMention: true,
    });
  }

  // 6) 收尾：场景标记结束 + 挂上事件 + 清空已落地的待结算后果
  await worldSceneRepo.appendEntry(scene.id, { kind: 'system', content: '这个世界结束了，经历已经写入世界。' });
  await worldSceneRepo.patchSceneState(scene.id, {
    pendingConsequences: [],
    newEventIds: [...scene.state.newEventIds, eventId],
  });
  await worldSceneRepo.finishScene(scene.id, eventId);

  return {
    worldEventId: eventId,
    ...(memoryId ? { memoryId } : {}),
    relationshipEvents,
    unresolvedThreads,
    dropped,
    llmCalls,
    ...(proposed.modelId ? { modelId: proposed.modelId } : {}),
    ...(proposed.fallback ? { fallback: true } : {}),
  };
}

/** 场景列表（世界页/舞台页共用） */
export async function listScenes(worldId: string, status?: WorldScene['status'], userId?: string): Promise<WorldScene[]> {
  return worldSceneRepo.listScenes(worldId, { ...(status ? { status } : {}), limit: 50, ...(userId ? { userId } : {}) });
}

/** 删除一场戏（连同正文） */
export async function deleteScene(sceneId: string, userId?: string): Promise<void> {
  const scene = await worldSceneRepo.getScene(sceneId);
  if (!scene || (userId !== undefined && scene.userId !== userId)) return;
  await worldSceneRepo.deleteScene(sceneId);
}

/** 只读：拿一场戏 + 正文（UI 渲染用） */
export async function loadScene(sceneId: string, userId?: string): Promise<{ scene?: WorldScene; entries: WorldSceneEntry[] }> {
  const scene = await worldSceneRepo.getScene(sceneId);
  if (!scene || (userId !== undefined && scene.userId !== userId)) return { entries: [] };
  return { scene, entries: await worldSceneRepo.listRecentEntries(sceneId, 400) };
}
