import { db, type Character, type WorldEvent, type WorldPulse } from '../../db';
import { characterRef } from './subjects';
import { worldAgentRepo } from '../../db/world-agent-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { worldLocationRepo } from '../../db/world-location-repo';
import { worldPulseRepo } from '../../db/world-pulse-repo';
import { beginWorldPulse, failWorldPulse, completeWorldPulse } from './world-pulse';
import { worldChat, type WorldLlmCaller } from './world-ai-client';
import { worldFactRepo } from '../../db/world-fact-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { ensureWorldKernel } from './world-kernel';
import { knowledgeRepo } from '../../db/knowledge-repo';

/**
 * 世界脉冲的结构化输出。模型只提出建议，最终能否改变世界由本文件的校验与本地数据库决定。
 * 不允许模型直接指定认知、关系数值或用户行为。
 */
export interface WorldAutonomyAction {
  characterId: string;
  kind: 'move' | 'interaction' | 'wait';
  locationId?: string;
  participantIds?: string[];
  title?: string;
  summary?: string;
  currentGoal?: string;
  nextIntent?: string;
  importance?: number;
}

export interface WorldAutonomyResult {
  pulse: WorldPulse | null;
  eventIds: string[];
  rejected: number;
  status: 'skipped' | 'completed' | 'failed';
  message?: string;
}

const MAX_ACTIONS = 4;
const MAX_TEXT = 180;

function cleanText(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return text ? text.slice(0, max) : undefined;
}

function clampImportance(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0.1, Math.min(0.9, parsed)) : 0.45;
}

function parseActions(raw: string, validCharacters: Set<string>, validLocations: Set<string>): { actions: WorldAutonomyAction[]; rejected: number } {
  const text = raw.trim();
  if (!text) return { actions: [], rejected: 0 };
  let value: unknown;
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    value = JSON.parse((fenced ? fenced[1] : text).trim());
  } catch {
    return { actions: [], rejected: 1 };
  }
  const list = Array.isArray(value) ? value : (value as { actions?: unknown[] } | null)?.actions;
  if (!Array.isArray(list)) return { actions: [], rejected: 1 };
  const actions: WorldAutonomyAction[] = [];
  let rejected = 0;
  const seenCharacters = new Set<string>();
  for (const item of list.slice(0, MAX_ACTIONS * 2)) {
    const row = (item ?? {}) as Record<string, unknown>;
    const characterId = cleanText(row.characterId, 120);
    const kind = row.kind === 'move' || row.kind === 'interaction' || row.kind === 'wait' ? row.kind : undefined;
    if (!characterId || !kind || !validCharacters.has(characterId) || seenCharacters.has(characterId)) {
      rejected += 1;
      continue;
    }
    const locationId = cleanText(row.locationId, 180);
    if (kind !== 'wait' && (!locationId || !validLocations.has(locationId))) {
      rejected += 1;
      continue;
    }
    const rawParticipantIds = Array.isArray(row.participantIds)
      ? row.participantIds.filter((id): id is string => typeof id === 'string').slice(0, 4)
      : undefined;
    const participantIds = rawParticipantIds?.every((id) => validCharacters.has(id))
      ? [...new Set(rawParticipantIds)]
      : undefined;
    if (kind === 'interaction' && (!participantIds || !participantIds.includes(characterId) || participantIds.length < 2)) {
      rejected += 1;
      continue;
    }
    actions.push({
      characterId,
      kind,
      ...(locationId ? { locationId } : {}),
      ...(participantIds?.length ? { participantIds } : {}),
      ...(cleanText(row.title, 120) ? { title: cleanText(row.title, 120) } : {}),
      ...(cleanText(row.summary, 300) ? { summary: cleanText(row.summary, 300) } : {}),
      ...(cleanText(row.currentGoal, 160) ? { currentGoal: cleanText(row.currentGoal, 160) } : {}),
      ...(cleanText(row.nextIntent, 160) ? { nextIntent: cleanText(row.nextIntent, 160) } : {}),
      importance: clampImportance(row.importance),
    });
    seenCharacters.add(characterId);
    if (actions.length >= MAX_ACTIONS) break;
  }
  return { actions, rejected };
}

function formatHours(from: number, to: number): string {
  const hours = Math.max(1, Math.round((to - from) / 3_600_000));
  return hours >= 24 ? `${Math.floor(hours / 24)} 天` : `${hours} 小时`;
}

function defaultTitle(kind: WorldAutonomyAction['kind'], characterName: string, locationName: string, participants: string[]): string {
  if (kind === 'move') return `${characterName} 来到 ${locationName}`;
  if (kind === 'interaction') return `${participants.join(' 与 ')} 在 ${locationName} 相遇`;
  return `${characterName} 的世界时间继续向前`;
}

/** 角色之间的相遇必须有物理位置依据，不能让模型凭空安排“隔空同场”。 */
function validateAutonomy(
  actions: WorldAutonomyAction[],
  agents: Awaited<ReturnType<typeof worldAgentRepo.listStates>>,
): { actions: WorldAutonomyAction[]; rejected: number } {
  const quiet = new Set(agents.filter((agent) => agent.autonomy === 'quiet').map((agent) => agent.characterId));
  const accepted: WorldAutonomyAction[] = [];
  let rejected = 0;
  for (const action of actions) {
    const participants = action.participantIds ?? [];
    if (quiet.has(action.characterId) || participants.some((characterId) => quiet.has(characterId))) {
      rejected += 1;
      continue;
    }
    accepted.push(action);
  }
  return { actions: accepted, rejected };
}

function validatePlacement(actions: WorldAutonomyAction[], presences: Awaited<ReturnType<typeof worldAgentRepo.listPresences>>): { actions: WorldAutonomyAction[]; rejected: number } {
  const byCharacter = new Map(presences.map((presence) => [presence.characterId, presence]));
  const accepted: WorldAutonomyAction[] = [];
  let rejected = 0;
  for (const action of actions) {
    if (action.kind !== 'interaction') {
      accepted.push(action);
      continue;
    }
    const locationId = action.locationId;
    const participantIds = action.participantIds ?? [];
    const colocated = Boolean(locationId) && participantIds.every((characterId) => {
      const presence = byCharacter.get(characterId);
      return presence?.status === 'present' && presence.locationId === locationId;
    });
    if (!colocated) {
      rejected += 1;
      continue;
    }
    accepted.push(action);
  }
  return { actions: accepted, rejected };
}

async function buildPulsePrompt(params: {
  userId: string;
  worldId: string;
  fromWorldTime: number;
  toWorldTime: number;
  characters: Character[];
}): Promise<{
  system: string;
  user: string;
  locations: Awaited<ReturnType<typeof worldLocationRepo.listForWorld>>;
  presences: Awaited<ReturnType<typeof worldAgentRepo.listPresences>>;
  agents: Awaited<ReturnType<typeof worldAgentRepo.listStates>>;
}> {
  const [world, locations, presences, agents, facts, scenes, events] = await Promise.all([
    db.worlds.get(params.worldId),
    worldLocationRepo.listForWorld(params.worldId, params.userId),
    worldAgentRepo.listPresences(params.worldId, params.userId),
    worldAgentRepo.listStates(params.worldId, params.userId),
    worldFactRepo.listWorldLevel(params.worldId, 12, params.userId),
    worldSceneRepo.listScenes(params.worldId, { status: 'active', limit: 12, userId: params.userId }),
    worldEventRepo.getRecent(params.worldId, 12, params.userId),
  ]);
  const locationLines = locations.map((location) => `${location.id} | ${location.name}${location.description ? ` | ${location.description}` : ''}`);
  const presenceLines = params.characters.map((character) => {
    const presence = presences.find((row) => row.characterId === character.id);
    const agent = agents.find((row) => row.characterId === character.id);
    const place = locations.find((location) => location.id === presence?.locationId)?.name ?? '尚未进入地点';
    return `${character.id} | ${character.name} | 当前地点：${place} | 自主性：${agent?.autonomy ?? 'normal'} | 目标：${agent?.currentGoal ?? '暂无'} | 下一步：${agent?.nextIntent ?? '暂无'} | 人设：${character.systemPrompt.slice(0, 500)}`;
  });
  const system = [
    '你是 VirtuGene Living World 的世界编排器。你只提出角色在离线时间里可能采取的少量行动，不代替用户做决定。',
    '只输出 JSON：{"actions":[{"characterId":"...","kind":"move|interaction|wait","locationId":"...","participantIds":["..."],"title":"...","summary":"...","currentGoal":"...","nextIntent":"...","importance":0.45}]}。',
    '约束：characterId、participantIds、locationId 只能使用给定列表；interaction 至少包含两名角色；wait 不产生事件；自主性为 quiet 的角色必须 wait；不要编造用户行动、关系数值、角色认知或私聊内容；每个角色最多一项行动；最多四项；摘要只写可从现有世界状态合理延伸的内容。',
    `世界：${world?.name ?? '我的世界'}`,
    `可用地点：\n${locationLines.join('\n') || '暂无地点'}`,
    `角色状态：\n${presenceLines.join('\n') || '暂无角色'}`,
    `世界设定：\n${facts.map((fact) => `- ${fact.content}`).join('\n') || '暂无额外设定'}`,
    `正在进行的剧情：\n${scenes.map((scene) => `- ${scene.title} @ ${scene.place}`).join('\n') || '无'}`,
  ].join('\n\n');
  const user = `世界时间从 ${new Date(params.fromWorldTime).toLocaleString('zh-CN')} 走到 ${new Date(params.toWorldTime).toLocaleString('zh-CN')}（约 ${formatHours(params.fromWorldTime, params.toWorldTime)}）。\n最近发生：\n${events.map((event) => `- ${event.title}：${event.summary}`).join('\n') || '暂无记录'}\n请只返回值得记入世界年表的行动，普通等待就返回 wait。`;
  return { system, user, locations, presences, agents };
}

async function commitActions(params: {
  pulse: WorldPulse;
  actions: WorldAutonomyAction[];
  characters: Character[];
  locations: Awaited<ReturnType<typeof worldLocationRepo.listForWorld>>;
  presences: Awaited<ReturnType<typeof worldAgentRepo.listPresences>>;
}): Promise<string[]> {
  const nameOf = new Map(params.characters.map((character) => [character.id, character.name]));
  const locationOf = new Map(params.locations.map((location) => [location.id, location]));
  const eventIds: string[] = [];
  const currentLocation = new Map(params.presences.map((presence) => [presence.characterId, presence.locationId]));
  await db.transaction('rw', [db.worldEvents, db.worldPresences, db.worldAgentStates, db.worldPulses, db.characterKnowledge], async () => {
    for (const [index, action] of params.actions.entries()) {
      const locationId = action.locationId ?? currentLocation.get(action.characterId);
      const characterName = nameOf.get(action.characterId) ?? '某位角色';
      const locationName = locationOf.get(locationId ?? '')?.name ?? '某处';
      const participantIds = action.kind === 'interaction'
        ? [...new Set(action.participantIds ?? [])]
        : [action.characterId];
      const participantNames = participantIds.map((id) => nameOf.get(id) ?? '某位角色');
      if (locationId && action.kind !== 'wait') {
        await worldAgentRepo.moveCharacter({
          userId: params.pulse.userId,
          worldId: params.pulse.worldId,
          characterId: action.characterId,
          locationId,
          worldTime: params.pulse.toWorldTime,
          status: 'present',
          note: action.kind === 'move' ? '世界脉冲中的自主移动' : undefined,
        });
        currentLocation.set(action.characterId, locationId);
      }
      const statePatch: Parameters<typeof worldAgentRepo.updateState>[2] = {
        ...(action.currentGoal ? { currentGoal: action.currentGoal } : {}),
        ...(action.nextIntent ? { nextIntent: action.nextIntent } : {}),
        lastPulseAt: params.pulse.toWorldTime,
      };
      if (action.kind !== 'wait') statePatch.lastActionAt = params.pulse.toWorldTime;
      await worldAgentRepo.updateState(params.pulse.worldId, action.characterId, statePatch);
      if (action.kind === 'wait') continue;
      const sourceId = `${params.pulse.id}:${index}`;
      const result = await worldEventRepo.createIfAbsent({
        userId: params.pulse.userId,
        worldId: params.pulse.worldId,
        type: 'interaction',
        title: action.title ?? defaultTitle(action.kind, characterName, locationName, participantNames),
        summary: action.summary ?? `${participantNames.join(' 与 ')} 在${locationName}留下了一段可追溯的行动。`,
        participants: participantIds.map(characterRef),
        timestamp: params.pulse.createdAt,
        worldTime: params.pulse.toWorldTime,
        importance: action.importance,
        sourceType: 'pulse',
        sourceId,
        locationId,
        visibility: 'world',
        resolved: true,
        causeEventIds: [],
        tags: ['世界脉冲', action.kind === 'move' ? '位置变化' : '自主行动'],
        meta: { pulseId: params.pulse.id, actionKind: action.kind },
      });
      eventIds.push(result.id);
      // 认知由亲身参与者决定，模型不能指定谁知道什么。重复脉冲仍然幂等。
      for (const participantId of participantIds) {
        await knowledgeRepo.upsert({
          userId: params.pulse.userId,
          worldId: params.pulse.worldId,
          characterId: participantId,
          eventId: result.id,
          knowledgeLevel: 'full',
          canMention: true,
          learnedAt: params.pulse.toWorldTime,
        });
      }
    }
  });
  return eventIds;
}

/** 在重新进入世界时推进一次离线时间，并让角色提出可验证的自主行动。 */
export async function runWorldPulse(params: {
  userId: string;
  worldId: string;
  characters: Character[];
  now?: number;
  reason?: WorldPulse['reason'];
  minGapMs?: number;
  /** 验收/离线测试用的可注入 LLM 边界；生产不传，统一走 WorldAIClient。 */
  call?: WorldLlmCaller;
}): Promise<WorldAutonomyResult> {
  const pulse = await beginWorldPulse({
    userId: params.userId,
    worldId: params.worldId,
    now: params.now,
    ...(params.reason ? { reason: params.reason } : {}),
    ...(params.minGapMs !== undefined ? { minGapMs: params.minGapMs } : {}),
  });
  if (!pulse) return { pulse: null, eventIds: [], rejected: 0, status: 'skipped' };
  try {
    await ensureWorldKernel({
      userId: params.userId,
      worldId: params.worldId,
      characterIds: params.characters.map((character) => character.id),
      now: params.now,
    });
    const prompt = await buildPulsePrompt({
      userId: params.userId,
      worldId: params.worldId,
      fromWorldTime: pulse.fromWorldTime,
      toWorldTime: pulse.toWorldTime,
      characters: params.characters,
    });
    if (params.characters.length === 0 || prompt.locations.length === 0) {
      await completeWorldPulse(pulse.id, [], `世界时间前进了 ${formatHours(pulse.fromWorldTime, pulse.toWorldTime)}，暂时没有可行动的角色。`);
      return { pulse: (await worldPulseRepo.getById(pulse.id)) ?? pulse, eventIds: [], rejected: 0, status: 'completed', message: '世界时间已前进' };
    }
    const response = await worldChat({
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      jsonMode: true,
      disableThinking: true,
      temperature: 0.65,
      maxTokens: 1200,
      timeoutMs: 45_000,
    }, params.call);
    const parsed = parseActions(response.content ?? '', new Set(params.characters.map((character) => character.id)), new Set(prompt.locations.map((location) => location.id)));
    const autonomous = validateAutonomy(parsed.actions, prompt.agents);
    const placed = validatePlacement(autonomous.actions, prompt.presences);
    const eventIds = await commitActions({ pulse, actions: placed.actions, characters: params.characters, locations: prompt.locations, presences: prompt.presences });
    await completeWorldPulse(pulse.id, eventIds, eventIds.length
      ? `世界时间前进了 ${formatHours(pulse.fromWorldTime, pulse.toWorldTime)}，留下 ${eventIds.length} 条可追溯行动。`
      : `世界时间前进了 ${formatHours(pulse.fromWorldTime, pulse.toWorldTime)}，角色暂时没有留下新的行动。`);
    return { pulse: (await worldPulseRepo.getById(pulse.id)) ?? pulse, eventIds, rejected: parsed.rejected + autonomous.rejected + placed.rejected, status: 'completed', message: eventIds.length ? '世界在你离开时继续运行' : '世界时间已前进' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'world-pulse:error';
    await failWorldPulse(pulse.id, detail);
    return { pulse: (await worldPulseRepo.getById(pulse.id)) ?? pulse, eventIds: [], rejected: 0, status: 'failed', message: '世界脉冲暂时无法完成，未写入虚构事件' };
  }
}

export async function listPulseEvents(worldId: string, pulseId: string, userId?: string): Promise<WorldEvent[]> {
  const pulse = await worldPulseRepo.getById(pulseId);
  if (!pulse || pulse.worldId !== worldId || (userId !== undefined && pulse.userId !== userId)) return [];
  const events = await worldEventRepo.listBySourceType(worldId, 'pulse', 200, userId);
  return worldEventRepo.getByIds(events
    .filter((event) => event.meta?.pulseId === pulseId)
    .map((event) => event.id));
}
