/**
 * World Turn —— 一轮世界交互的状态机与编排（5.0.0 Living World §52 / §57 / §58 / §83）
 *
 * 完整数据流（§83）：
 *   Natural Language
 *     ↓ Intent Interpreter        （1 次调用，或规则层 0 次）
 *     ↓ WorldAction
 *     ↓ Context Builder           （0 次）
 *     ↓ World Director            （1 次）
 *     ↓ Actor / Narrator          （每个要发言的角色 1 次；需要画面时 +1）
 *     ↓ Consistency Guard         （重要轮次 1 次）
 *     ↓ Visible World Response    （**先给用户看，再谈结算**）
 *     ↓ Settlement                （值得留下时才 1 次）
 *     ↓ WorldEvent / SharedMemory / Relationship / Knowledge / Continuity / WorldFact
 *     ↓ Future Interaction
 *
 * 三条不可动摇的纪律：
 * 1. **用户输入先落库**（§51/§52）：任何 AI 阶段失败都只是 status='failed'，
 *    原话与已经写下的正文都还在；重试复用同一行、同一条正文（§53）。
 * 2. **渐进式呈现**（§57）：`onEvent` 在每一段可见内容落库后立刻回调，
 *    用户不必面对长时间纯 loading；看到角色回复后即可继续输入。
 * 3. **事务队列**（§58）：同一个世界的轮次串行执行，下一轮不会读到半完成状态。
 */
import type { Character, WorldScene, WorldSceneEntry } from '../../db/index';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldTurnRepo } from '../../db/world-turn-repo';
import { worldFactRepo } from '../../db/world-fact-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { db } from '../../db/index';
import { buildWorldContext, renderWorldBrief, type WorldContext } from './world-context';
import { interpretWorldIntent } from './world-intent';
import { directWorldTurn, type TurnPlan, type TurnSpeaker } from './world-director';
import { actAsCharacter, actWorldBeat, type ActorBeat } from './world-actor';
import { narrateWorldBeat, shouldNarrate } from './world-narrator';
import { applyGuard, guardWorldBeat } from './world-consistency';
import { settleWorldTurn, type SettleTurnResult } from './world-settlement';
import { findRelevantHistory } from './world-recall';
import { upsertWorldFactWithReconcile } from './world-facts';
import { undoLastTurn, type UndoResult } from './world-undo';
import type { WorldLlmCaller } from './world-ai-client';
import type { WorldAction } from './world-actions';
import type { WorldTurn, WorldTurnStatus } from '../../db/index';
import { worldLocationRepo } from '../../db/world-location-repo';
import { worldAgentRepo } from '../../db/world-agent-repo';
import { worldObjectRepo } from '../../db/world-object-repo';
import { deriveWorldVisualState, updateConversationState, type WorldBeatMeta } from './world-immersion';

/* ------------------------------------------------------------------ *
 * 串行队列（§58）：同一个世界同一时刻只跑一轮，避免读到半完成状态
 * ------------------------------------------------------------------ */
const queues = new Map<string, Promise<unknown>>();

export function enqueueWorldTurn<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(worldId) ?? Promise.resolve();
  const next = previous.then(task, task);
  // 队列本身不记录失败（失败由 turn 行记录），否则一次失败会让后续全部拒绝执行
  queues.set(worldId, next.catch(() => undefined));
  return next;
}

/* ------------------------------------------------------------------ *
 * 本地动作（0 次调用）：世界状态的确定性变化
 * ------------------------------------------------------------------ */

export interface LocalActionOutcome {
  /** 要写进世界流的系统/旁白条目 */
  entries: { kind: WorldSceneEntry['kind']; content: string; speakerId?: string }[];
  /** 这一轮真的发生的世界变化（人话） */
  changes: string[];
  /** 是否已经处理掉了这个意图（处理掉之后仍然会走 Director，让世界自然回应） */
  handled: boolean;
  /** 因为与新设定冲突而被**停用**的旧设定（撤销时要恢复） */
  deactivatedFactIds: string[];
  /** 这一轮新写下的世界设定（撤销时要删除） */
  createdFactIds: string[];
}

/** 用户这一句话本身就构成持久世界变化的意图（这些一定会结算） */
const LOCAL_SETTLE_INTENTS: WorldAction['intent'][] = [
  'change_location', 'world_rule', 'character_fact', 'retcon', 'summon', 'dismiss', 'start_event',
];

/** 角色名 → id 的宽松解析（用于"让星遥过来"这类召令：模型没给出名字时再从原话里找） */
function namesInText(text: string, characters: Character[]): string[] {
  const out: string[] = [];
  for (const c of characters) {
    if (c.name && text.includes(c.name) && !out.includes(c.id)) out.push(c.id);
  }
  return out;
}

/** 时段时间标签（时间跳跃时用本地时钟给出人话） */
export function timeLabelFor(offsetMs: number, now = Date.now()): string {
  const d = new Date(now + offsetMs);
  const hour = d.getHours();
  const dayDiff = Math.floor((now + offsetMs - now) / 86_400_000);
  const period = hour < 5 ? '深夜' : hour < 8 ? '清晨' : hour < 11 ? '上午' : hour < 14 ? '中午' : hour < 17 ? '下午' : hour < 19 ? '黄昏' : hour < 23 ? '夜晚' : '深夜';
  const dayLabel = dayDiff <= 0 ? '' : dayDiff === 1 ? '第二天' : `第 ${dayDiff + 1} 天`;
  return dayPart(dayLabel, period);
}

function dayPart(dayLabel: string, period: string): string {
  return dayLabel ? `${dayLabel} · ${period}` : period;
}

/** 把"第二天早上"这类自由文本粗略换算成偏移量（只用于时钟，不伪造历史） */
export function offsetForTimeChange(text: string, currentOffsetMs: number, now = Date.now()): number {
  const t = text ?? '';
  let days = 0;
  if (/第二天|明天|次日/.test(t)) days = 1;
  else if (/后天/.test(t)) days = 2;
  else if (/一周后|下周/.test(t)) days = 7;
  else if (/一个月后/.test(t)) days = 30;
  let targetHour: number | null = null;
  if (/早上|早晨|清晨/.test(t)) targetHour = 7;
  else if (/中午/.test(t)) targetHour = 12;
  else if (/下午/.test(t)) targetHour = 15;
  else if (/黄昏|傍晚/.test(t)) targetHour = 18;
  else if (/晚上|夜晚|夜里/.test(t)) targetHour = 21;
  else if (/深夜/.test(t)) targetHour = 1;

  const base = now + currentOffsetMs;
  if (days === 0 && targetHour == null) return currentOffsetMs;
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  if (targetHour != null) d.setHours(targetHour, 0, 0, 0);
  return d.getTime() - now;
}

/**
 * 应用"本地可确定性执行"的意图。
 *
 * 这些操作**不需要模型同意**：用户是世界最高权限者（§15）。
 * 它们只改世界状态与设定，绝不代替角色说话——角色的反应仍然由 Actor 生成。
 */
export async function applyLocalWorldAction(params: {
  action: WorldAction;
  scene: WorldScene;
  characters: Character[];
  userId: string;
  worldId: string;
  entryMemoryMode?: 'memory' | 'present';
}): Promise<LocalActionOutcome> {
  const { action, scene, characters, userId, worldId, entryMemoryMode } = params;
  const entries: LocalActionOutcome['entries'] = [];
  const changes: string[] = [];
  const deactivatedFactIds: string[] = [];
  const createdFactIds: string[] = [];
  let handled = false;

  // 1) 世界规则 / 角色事实：直接写进世界设定（§32/§33，设定页与世界空间等效）
  if ((action.intent === 'world_rule' || action.intent === 'character_fact') && (action.worldFact || action.raw)) {
    const content = (action.worldFact ?? action.raw).trim();
    const category = action.intent === 'world_rule' ? 'rule' : 'character_fact';
    const target = action.addressedCharacters?.[0] ?? namesInText(action.raw, characters)[0];
    const written = await upsertWorldFactWithReconcile({
      userId,
      worldId,
      category,
      content,
      visibility: category === 'rule' ? 'world' : 'selected',
      ...(category === 'rule' ? {} : { visibleTo: target ? [target] : scene.characterIds }),
      sourceType: 'user',
      sourceId: `fact:${content.slice(0, 60)}`,
      ...(category === 'character_fact' && target ? { data: { characterId: target } } : {}),
      ...(action.replacesFact ? { replaces: action.replacesFact } : {}),
    });
    deactivatedFactIds.push(...written.deactivated);
    createdFactIds.push(written.factId);
    entries.push({ kind: 'system', content: category === 'rule' ? `这个世界记住了：${content}` : `TA 的设定更新了：${content}` });
    changes.push(category === 'rule' ? `世界规则：${content}` : `角色设定：${content}`);
    handled = true;
  }

  // 2) 换地点（§ "我们去海边"）
  if (action.intent === 'change_location' && action.locationChange) {
    const place = action.locationChange.trim().slice(0, 80);
    await worldSceneRepo.updateScene(scene.id, { place });
    const movedScene = await worldSceneRepo.getScene(scene.id);
    const location = movedScene ? await worldLocationRepo.ensureFromScene(movedScene) : undefined;
    const world = await db.worlds.get(worldId);
    if (location && movedScene) {
      await worldObjectRepo.ensureForScene({ ...movedScene, locationId: location.id });
      await Promise.all(movedScene.characterIds.map((characterId) => worldAgentRepo.moveCharacter({
        userId,
        worldId,
        characterId,
        locationId: location.id,
        worldTime: world?.clock?.worldAt ?? Date.now(),
      })));
    }
      const known = await worldFactRepo.listByWorld(worldId, { category: 'location', userId });
    if (!known.some((f) => f.content.includes(place) || place.includes(f.content))) {
      await worldFactRepo.upsert({
        userId,
        worldId,
        category: 'location',
        content: place,
        visibility: 'world',
        sourceType: 'user',
        sourceId: `place:${place}`,
      });
    }
    entries.push({ kind: 'system', content: `地点：${place}` });
    changes.push(`去了${place}`);
    handled = true;
  }

  // 3) 换氛围（"现在开始下雨"——一次性，不写长期设定）
  if (action.intent === 'change_atmosphere' && action.atmosphereChange) {
    const mood = action.atmosphereChange.trim().slice(0, 40);
    await worldSceneRepo.updateScene(scene.id, { mood });
    changes.push(`气氛：${mood}`);
    handled = true;
  }

  // 4) 时间跳跃 / 换时间点（只改时钟，不伪造历史）
  if ((action.intent === 'time_skip' || action.intent === 'change_time')) {
    const text = action.timeChange ?? action.raw;
    const offset = offsetForTimeChange(text, scene.state.timeOffsetMs ?? 0);
    const label = timeLabelFor(offset);
    await worldSceneRepo.updateScene(scene.id, { timeLabel: label });
    await worldSceneRepo.patchSceneState(scene.id, { timeOffsetMs: offset });
    entries.push({ kind: 'system', content: `时间：${label}` });
    changes.push(`时间到了${label}`);
    handled = true;
  }

  // 5) 召集 / 让角色离开（§19：自然语言与 chips 完全等效）
  if (action.intent === 'summon' || action.intent === 'dismiss') {
    const targets = [...(action.addressedCharacters ?? []), ...(action.mentionedCharacters ?? []), ...namesInText(action.raw, characters)];
    const unique = [...new Set(targets)];
    for (const id of unique) {
      const character = characters.find((c) => c.id === id);
      if (!character) continue;
      if (action.intent === 'summon' && !scene.characterIds.includes(id)) {
        await worldSceneRepo.addParticipant(scene.id, id, {
          entryMemoryMode: entryMemoryMode ?? scene.state.entryMemoryMode ?? 'memory',
        });
        const currentScene = await worldSceneRepo.getScene(scene.id);
        const location = currentScene ? await worldLocationRepo.ensureFromScene(currentScene) : undefined;
        const world = await db.worlds.get(worldId);
        if (location) {
          await worldAgentRepo.moveCharacter({
            userId,
            worldId,
            characterId: id,
            locationId: location.id,
            worldTime: world?.clock?.worldAt ?? Date.now(),
          });
        }
        entries.push({ kind: 'system', content: `${character.name} 来到了这里` });
        changes.push(`${character.name}加入了`);
        handled = true;
      }
      if (action.intent === 'dismiss' && scene.characterIds.includes(id)) {
        await worldSceneRepo.removeParticipant(scene.id, id);
        const world = await db.worlds.get(worldId);
        await worldAgentRepo.setPresenceStatus({
          userId,
          worldId,
          characterId: id,
          status: 'away',
          worldTime: world?.clock?.worldAt ?? Date.now(),
          note: '暂时离开当前地点',
        });
        entries.push({ kind: 'system', content: `${character.name} 先离开了` });
        changes.push(`${character.name}离开了`);
        handled = true;
      }
    }
  }

  // 6) 话题归档（"别继续这个话题了"）：记录一条系统痕迹，并让导演别再顺着说
  if (action.intent === 'end_topic') {
    entries.push({ kind: 'system', content: '这个话题先到这里' });
    changes.push('这个话题告一段落');
    handled = true;
  }

  // 7) 修改已经发生过的世界事实（§15 Canon Override）
  if (action.intent === 'retcon') {
    const content = (action.retconTarget ?? action.raw).trim();
    const written = await upsertWorldFactWithReconcile({
      userId,
      worldId,
      category: 'history',
      content,
      visibility: 'world',
      sourceType: 'user',
      sourceId: `retcon:${content.slice(0, 60)}`,
    });
    deactivatedFactIds.push(...written.deactivated);
    createdFactIds.push(written.factId);
    entries.push({ kind: 'system', content: `世界被改写了：${content}` });
    changes.push(`世界事实更新：${content}`);
    handled = true;
  }

  return { entries, changes, handled, deactivatedFactIds, createdFactIds };
}

/* ------------------------------------------------------------------ *
 * 一轮世界交互
 * ------------------------------------------------------------------ */

export type WorldTurnEvent =
  | { type: 'user_entry'; entry: WorldSceneEntry }
  | { type: 'entry'; entry: WorldSceneEntry }
  | { type: 'status'; status: WorldTurnStatus }
  /** 可见内容已经全部落库：用户可以继续输入了（结算仍在后台进行，§58） */
  | { type: 'ready' }
  | { type: 'error'; message: string };

export interface RunWorldTurnParams {
  userId: string;
  worldId: string;
  sceneId: string;
  text: string;
  origin?: WorldTurn['origin'];
  characters: Character[];
  /** 通过自然语言召入角色时，决定他能否带入与用户的旧记忆。 */
  entryMemoryMode?: 'memory' | 'present';
  /** 可注入的 LLM 边界（验收用） */
  call?: WorldLlmCaller;
  /** 渐进式回调（UI 用它即时渲染） */
  onEvent?: (event: WorldTurnEvent) => void;
  /** 强制结算（控制面板的"保存这一刻"，§39） */
  forceSettle?: boolean;
  /**
   * 「让他们自己聊」额外自动推进几小拍（§40）。
   * 不传时：意图为 character_interaction 且在场至少两人 ⇒ 默认 2 拍；其余 0 拍。
   */
  autoRounds?: number;
  /** 用户已经又输入了 ⇒ 立即中断自动互动（§40） */
  shouldInterrupt?: () => boolean;
  /** 跳过串行队列（仅在内部/验收里一次性调用时使用） */
  bypassQueue?: boolean;
}

export interface WorldTurnResult {
  turnId: string;
  status: WorldTurnStatus;
  action?: WorldAction;
  plan?: TurnPlan;
  beats: ActorBeat[];
  narration?: string;
  suggestions: string[];
  trace?: string;
  /** 本轮新增的可见正文（顺序即显示顺序） */
  entries: WorldSceneEntry[];
  settlement?: SettleTurnResult;
  undo?: UndoResult;
  llmCalls: number;
  error?: string;
}

function snapshotOf(scene: WorldScene) {
  return {
    place: scene.place,
    timeLabel: scene.timeLabel,
    mood: scene.mood,
    timeOffsetMs: scene.state.timeOffsetMs ?? 0,
    characterIds: [...scene.characterIds],
  };
}

/** 本轮实际呈现给用户的内容 → 结算依据（也是"世界记住了什么"的唯一来源） */
function buildTranscript(entries: WorldSceneEntry[], nameOf: (id: string) => string, fromIndex = -1): string {
  return entries.filter((e) => e.index >= fromIndex).map((e) => {
    if (e.kind === 'narration') return `（旁白）${e.content}`;
    if (e.kind === 'action') return `（${nameOf(e.speakerId ?? '')}的动作）${e.content}`;
    if (e.kind === 'user_input') return `（用户）${e.content}`;
    if (e.kind === 'choice') return `（用户选择）${e.content}`;
    if (e.kind === 'system') return `（${e.content}）`;
    if (e.kind === 'suggestion') return '';
    return `${nameOf(e.speakerId ?? '')}：${e.content}`;
  }).filter(Boolean).join('\n');
}

export function runWorldTurn(params: RunWorldTurnParams): Promise<WorldTurnResult> {
  if (params.bypassQueue) return runWorldTurnInner(params);
  return enqueueWorldTurn(params.worldId, () => runWorldTurnInner(params));
}

async function runWorldTurnInner(params: RunWorldTurnParams): Promise<WorldTurnResult> {
  const { userId, worldId, sceneId, characters } = params;
  const text = params.text.trim().slice(0, 1200);
  const emit = (event: WorldTurnEvent) => params.onEvent?.(event);

  const scene = await worldSceneRepo.getScene(sceneId);
  if (!scene || scene.userId !== userId || scene.worldId !== worldId) {
    return { turnId: '', status: 'failed', beats: [], suggestions: [], entries: [], llmCalls: 0, error: '这一片段不存在' };
  }

  // ---- 0) 用户输入先落库（§51/§52）：无论后面发生什么，这句话都不会丢
  const turn = await worldTurnRepo.create({
    userId,
    worldId,
    sceneId,
    input: text,
    origin: params.origin ?? 'text',
    characterIds: scene.characterIds,
    before: snapshotOf(scene),
  });
  let llmCalls = 0;

  const userEntry = await worldSceneRepo.appendEntry(sceneId, {
    kind: params.origin === 'suggestion' ? 'choice' : 'user_input',
    content: text,
  });
  await worldTurnRepo.patch(turn.id, { userEntryId: userEntry.id, entryIds: [userEntry.id] });
  emit({ type: 'user_entry', entry: userEntry });

  const finish = async (patch: Partial<WorldTurnResult> & { status: WorldTurnStatus }): Promise<WorldTurnResult> => {
    await worldTurnRepo.addCalls(turn.id, llmCalls);
    const result: WorldTurnResult = {
      turnId: turn.id,
      beats: [], suggestions: [], entries: [userEntry], llmCalls,
      ...patch,
    };
    if (patch.status === 'failed') {
      await worldTurnRepo.markFailed(turn.id, 'responding', patch.error ?? '世界没有继续回应');
    } else {
      await worldTurnRepo.setStatus(turn.id, patch.status);
    }
    emit({ type: 'status', status: patch.status });
    return result;
  };

  try {
    // ---- 1) 理解意图（Stage A）
    await worldTurnRepo.setStatus(turn.id, 'interpreting');
    emit({ type: 'status', status: 'interpreting' });
    const interpreted = await interpretWorldIntent({
      userId, worldId, text, characters,
      presence: scene.characterIds,
      place: scene.place,
      timeLabel: scene.timeLabel,
      // 让解析器知道已有的世界设定，这样"改设定"能带上 replacesFact（§101）
      worldRules: (await worldFactRepo.listByWorld(worldId, { category: 'rule', activeOnly: true, userId })).map((f) => f.content).slice(0, 12),
      recent: await worldSceneRepo.listEntries(sceneId, { limit: 12 }),
      ...(params.call ? { call: params.call } : {}),
    });
    llmCalls += interpreted.llmCalls;
    const action = interpreted.action;
    await worldTurnRepo.setAction(turn.id, action);

    // ---- 2) 撤销：本地执行，0 次调用（§16）
    if (action.intent === 'undo') {
      const undo = await undoLastTurn({ userId, worldId });
      const entry = await worldSceneRepo.appendEntry(sceneId, {
        kind: 'system',
        content: undo.ok ? '刚刚那一轮被撤回了。' : undo.message,
      });
      await worldTurnRepo.addEntryIds(turn.id, [entry.id]);
      emit({ type: 'entry', entry });
      await worldTurnRepo.patch(turn.id, { settled: true, settledEventIds: [] });
      return finish({ status: 'completed', action, undo, entries: [userEntry, entry], trace: undo.ok ? '世界回到了上一刻' : undefined });
    }

    // ---- 3) 本地确定性动作（0 次调用）
    const local = await applyLocalWorldAction({
      action,
      scene,
      characters,
      userId,
      worldId,
      entryMemoryMode: params.entryMemoryMode,
    });
    const localEntries: WorldSceneEntry[] = [];
    for (const item of local.entries) {
      const entry = await worldSceneRepo.appendEntry(sceneId, {
        kind: item.kind,
        content: item.content,
        ...(item.speakerId ? { speakerId: item.speakerId } : {}),
      });
      localEntries.push(entry);
      emit({ type: 'entry', entry });
    }
    if (localEntries.length) await worldTurnRepo.addEntryIds(turn.id, localEntries.map((e) => e.id));
    if (local.createdFactIds.length) await worldTurnRepo.addFactIds(turn.id, local.createdFactIds, 'created');
    if (local.deactivatedFactIds.length) await worldTurnRepo.addFactIds(turn.id, local.deactivatedFactIds, 'deactivated');

    // 本地动作可能改了在场的人 / 地点 / 时间 → 重新读一次，作为这一拍的真相
    const beatScene = (await worldSceneRepo.getScene(sceneId)) ?? scene;

    // ---- 4) 构建上下文（Stage B，0 次调用）
    let ctx = await buildWorldContext({ userId, worldId, scene: beatScene, characters, userText: text });

    // 回忆类意图：把"相关但很久以前"的事也捞回来（§60 相关性优先于时间）
    let recallBlock = '';
    if (action.intent === 'recall' || /记得|还记得|以前|那次|上次|第一次/.test(text)) {
      const found = await findRelevantHistory({ userId, worldId, query: action.recallTarget ?? text, limit: 5 });
      if (found.length) recallBlock = `【用户正在回忆的事（可能在很久以前）】\n${found.map((f) => `- ${f.date} ${f.text}`).join('\n')}`;
    }

    // ---- 5) 导演（Stage C，1 次调用）
    await worldTurnRepo.setStatus(turn.id, 'planning');
    emit({ type: 'status', status: 'planning' });
    const planBase = await directWorldTurn({
      ctx, action, userText: text,
      ...(params.call ? { call: params.call } : {}),
    });
    llmCalls += planBase.llmCalls;
    // 本地识别出的世界变化要并进计划（模型可能没意识到我们已经改了地点/时间）
    const plan: TurnPlan = {
      ...planBase,
      worldChanges: [...new Set([...local.changes, ...planBase.worldChanges])],
    };

    // ---- 6) 旁白（条件性，0/1 次）与角色表演（每角色 1 次）
    await worldTurnRepo.setStatus(turn.id, 'responding');
    emit({ type: 'status', status: 'responding' });

    const turnEntries: WorldSceneEntry[] = [userEntry, ...localEntries];
    let narration = plan.narration;
    if (!narration && shouldNarrate(action, !!plan.narration, plan.speakers.length)) {
      const narrated = await narrateWorldBeat({
        ctx, action, userText: text,
        ...(plan.worldChanges.length ? { planSummary: plan.worldChanges.join('；') } : {}),
        ...(params.call ? { call: params.call } : {}),
      });
      llmCalls += narrated.llmCalls;
      if (narrated.narration) narration = narrated.narration;
    }
    if (narration) {
      const entry = await worldSceneRepo.appendEntry(sceneId, {
        kind: 'narration',
        content: narration,
        meta: { beatId: turn.id, layer: 'environment', sequence: turnEntries.length, camera: 'wide' } satisfies WorldBeatMeta,
      });
      turnEntries.push(entry);
      emit({ type: 'entry', entry });
    }

    let beats = await actWorldBeat({
      ctx,
      speakers: plan.speakers,
      userText: text,
      ...(action.userAction ? { userAction: action.userAction } : {}),
      // 两位及以上角色必须按顺序演出，后一位要先听到前一位的回应。
      sequential: plan.speakers.length > 1 ? true : plan.sequential,
      ...(plan.worldChanges.length ? { worldChanges: plan.worldChanges } : {}),
      ...(params.call ? { call: params.call } : {}),
    });
    llmCalls += beats.reduce((sum, beat) => sum + (beat.llmCalls ?? 1), 0);

    /**
     * §40「让他们自己聊」：用户让角色自己交流时，在初次回应之后**继续往下走若干小拍**，
     * 后面的角色能看到前面角色刚说的话（真正的互动）。
     * 成本有上限（默认 2 拍，每拍 1 次调用），内容有上限（每拍仍是一两句），
     * 且 `shouldInterrupt` 一旦为真立刻停下——用户只要一输入就打断自动互动。
     */
    const autoRounds = params.autoRounds ?? (action.intent === 'character_interaction' && plan.speakers.length >= 2 ? 2 : 0);
    if (autoRounds > 0 && plan.speakers.length >= 2) {
      const extra = await runAutoBeats({
        ctx,
        speakers: plan.speakers,
        userText: text,
        worldChanges: plan.worldChanges,
        rounds: autoRounds,
        prior: beats,
        ...(params.call ? { call: params.call } : {}),
        ...(params.shouldInterrupt ? { shouldStop: params.shouldInterrupt } : {}),
      });
      llmCalls += extra.calls;
      beats = [...beats, ...extra.beats];
    }

    // ---- 7) 角色内容落库（动作与对白分成两条，UI 负责把同一角色合成一组）
    //     先落库再守护：用户要**立刻**看到第一位角色的回应（§57），
    //     守护发现问题后再把改写落回那一行（不是"让用户看到未修正版本"）。
    const beatRows: { beatIndex: number; actionEntryId?: string; dialogueEntryId?: string }[] = [];
    for (const beat of beats) {
      if (beat.via === 'none') continue;
      const row: { beatIndex: number; actionEntryId?: string; dialogueEntryId?: string } = { beatIndex: beatRows.length };
      if (beat.action) {
        const entry = await worldSceneRepo.appendEntry(sceneId, {
          kind: 'action',
          content: beat.action,
          speakerId: beat.characterId,
          meta: { beatId: turn.id, layer: 'action', sequence: turnEntries.length, camera: 'focus' } satisfies WorldBeatMeta,
        });
        turnEntries.push(entry);
        row.actionEntryId = entry.id;
        emit({ type: 'entry', entry });
      }
      if (beat.dialogue) {
        const entry = await worldSceneRepo.appendEntry(sceneId, {
          kind: 'dialogue',
          content: beat.dialogue,
          speakerId: beat.characterId,
          meta: { beatId: turn.id, layer: 'dialogue', sequence: turnEntries.length, camera: 'close' } satisfies WorldBeatMeta,
        });
        turnEntries.push(entry);
        row.dialogueEntryId = entry.id;
        emit({ type: 'entry', entry });
      }
      beatRows.push(row);
    }
    await worldTurnRepo.addEntryIds(turn.id, turnEntries.map((e) => e.id));

    // ---- 8) 一致性守护（重要轮次才跑；失败不影响已经生成的内容）
    const guard = await guardWorldBeat({
      ctx, plan, action, beats,
      ...(params.call ? { call: params.call } : {}),
    });
    llmCalls += guard.llmCalls;
    if (guard.rewrites.length > 0) {
      const rewritten = applyGuard(beats, guard.rewrites);
      const byCharacter = new Map(guard.rewrites.map((r) => [r.characterId, r]));
      for (let i = 0; i < beats.length && i < beatRows.length; i += 1) {
        const fix = byCharacter.get(beats[i].characterId);
        if (!fix) continue;
        const row = beatRows[i];
        if (fix.drop) {
          if (row.actionEntryId) await worldSceneRepo.removeEntry(row.actionEntryId);
          if (row.dialogueEntryId) await worldSceneRepo.removeEntry(row.dialogueEntryId);
          continue;
        }
        if (fix.action != null && row.actionEntryId) await worldSceneRepo.updateEntryContent(row.actionEntryId, fix.action);
        if (fix.dialogue != null && row.dialogueEntryId) await worldSceneRepo.updateEntryContent(row.dialogueEntryId, fix.dialogue);
      }
      beats = rewritten;
    }

    // ---- 9) 灵感建议（§37/§38：只在导演认为用户站在岔路口时给）
    if (plan.suggestions.length > 0) {
      const entry = await worldSceneRepo.appendEntry(sceneId, {
        kind: 'suggestion',
        content: plan.suggestions[0],
        meta: { options: plan.suggestions, turnId: turn.id },
      });
      turnEntries.push(entry);
      await worldTurnRepo.addEntryIds(turn.id, [entry.id]);
      emit({ type: 'entry', entry });
    }

    const visibleBeats = beats.filter((b) => b.via !== 'none');
    // 一个角色都没说话、也没有旁白 ⇒ 这一轮世界没有回应（如实失败，保留用户原话）
    if (visibleBeats.length === 0 && !narration) {
      const reason = plan.error ?? guard.error ?? beatError(beats) ?? '世界没有继续回应';
      return finish({
        status: 'failed', action, plan, beats, entries: turnEntries,
        ...(narration ? { narration } : {}),
        suggestions: plan.suggestions,
        error: reason,
      });
    }

    // 5.2：把这一拍的节奏与视觉状态写回场景。它们是可压缩的导演状态，
    // 不会污染正文，也不会跨用户共享；下次进入同一地点时会自然延续。
    const stateScene = (await worldSceneRepo.getScene(sceneId)) ?? beatScene;
    const stateEntries = await worldSceneRepo.listEntries(sceneId, { limit: 120 });
    await worldSceneRepo.patchSceneState(sceneId, {
      conversation: updateConversationState(stateScene.state.conversation, text, stateEntries),
      visual: deriveWorldVisualState(stateScene, stateScene.state.visual),
    });

    // ---- 10) 可见内容已经给到用户：解除阻塞（§57）
    emit({ type: 'ready' });

    // ---- 11) 结算（§28：只在值得留下时；§29：一次专门调用）
    //
    // 什么算"值得留下"（三条，缺一不可，且都由**程序**判断，不靠模型单方面主张）：
    //   1. 控制面板明确要求（"保存这一刻"）
    //   2. 导演认为这一轮真有事发生（shouldSettle / worldChanges）
    //   3. 用户的这句话**本身就是一次持久的世界变化**：建了新地点、立了规则、
    //      改了角色事实、改写或撤销了世界事实、有角色加入或离开
    // 时间跳跃 / 一次性氛围 / 结束话题**不**在此列：它们只是"此刻"的变化，
    // 已经由本地动作写成系统痕迹，再花一次结算调用是纯浪费。
    const localPersistentChange = LOCAL_SETTLE_INTENTS.includes(action.intent);
    const wantSettle = params.forceSettle === true
      || planBase.shouldSettle
      || planBase.worldChanges.length > 0
      || localPersistentChange;
    let settlement: SettleTurnResult | undefined;
    if (wantSettle) {
      await worldTurnRepo.setStatus(turn.id, 'settling');
      emit({ type: 'status', status: 'settling' });
      ctx = (await worldSceneRepo.getScene(sceneId))
        ? await buildWorldContext({ userId, worldId, scene: (await worldSceneRepo.getScene(sceneId))!, characters, userText: text })
        : ctx;
      settlement = await settleWorldTurn({
        ctx,
        actionText: text,
        // 结算依据**从数据库读回**：守护可能改写过某些行，内存里的副本未必最新
        transcript: [recallBlock, buildTranscript(await worldSceneRepo.listEntries(sceneId, { limit: 400 }), ctx.nameOf, userEntry.index)].filter(Boolean).join('\n\n'),
        turnId: turn.id,
        ...(params.call ? { call: params.call } : {}),
      });
      llmCalls += settlement.llmCalls;
      await worldTurnRepo.addFactIds(turn.id, settlement.applied.factIds, 'created');
      await worldTurnRepo.addFactIds(turn.id, settlement.applied.deactivatedFactIds, 'deactivated');
      await worldTurnRepo.patch(turn.id, {
        settledEventIds: settlement.applied.worldEventIds,
        settledMemoryIds: settlement.applied.memoryIds,
        settledRelationshipEventIds: settlement.applied.relationshipEventIds,
        settledThreadIds: settlement.applied.threadIds,
        settledLifeEventIds: settlement.applied.lifeEventIds,
        stateDeltas: settlement.applied.stateDeltas,
      });
    }
    await worldTurnRepo.patch(turn.id, { settled: true });

    if (plan.trace || (settlement && settlement.applied.worldEventIds.length > 0)) {
      const trace = plan.trace ?? '这一刻被世界记住了。';
      const entry = await worldSceneRepo.appendEntry(sceneId, { kind: 'system', content: trace, meta: { trace: true, turnId: turn.id } });
      turnEntries.push(entry);
      await worldTurnRepo.addEntryIds(turn.id, [entry.id]);
      emit({ type: 'entry', entry });
    }

    return finish({
      status: 'completed', action, plan, beats, entries: turnEntries,
      ...(narration ? { narration } : {}),
      suggestions: plan.suggestions,
      ...(plan.trace ? { trace: plan.trace } : {}),
      ...(settlement ? { settlement } : {}),
    });
  } catch (err) {
    llmCalls += 0;
    return finish({ status: 'failed', error: (err as Error)?.message ?? 'server:error' });
  }
}

function beatError(beats: ActorBeat[]): string | undefined {
  return beats.find((b) => b.error)?.error;
}

/* ------------------------------------------------------------------ *
 * §40「让他们自己聊」：初次回应之后继续自动推进若干小拍
 * ------------------------------------------------------------------ */

export interface AutoBeatsResult {
  beats: ActorBeat[];
  calls: number;
  /** 是否因为用户输入而提前中断 */
  interrupted: boolean;
}

/**
 * 让在场的角色按顺序继续互动若干拍。
 *
 * 三个上限（缺一不可，否则会变成"AI 自己写小说"）：
 * - **拍数上限**：`rounds`（默认 2，最多 6）
 * - **内容上限**：每个角色每拍仍然只产出一个动作 + 一句对白
 * - **中断**：`shouldStop()` 为真时立刻停止（用户一输入就打断）
 *
 * 角色轮转而不是"只让一个人说"；如果某个角色选择沉默（没有任何输出），自动互动结束。
 */
export async function runAutoBeats(params: {
  ctx: WorldContext;
  speakers: TurnSpeaker[];
  userText: string;
  worldChanges?: string[];
  rounds: number;
  prior?: ActorBeat[];
  call?: WorldLlmCaller;
  shouldStop?: () => boolean;
}): Promise<AutoBeatsResult> {
  const rounds = Math.max(0, Math.min(6, params.rounds));
  const beats: ActorBeat[] = [...(params.prior ?? [])];
  const added: ActorBeat[] = [];
  let calls = 0;
  if (rounds === 0 || params.speakers.length < 2) return { beats: added, calls, interrupted: false };

  for (let round = 0; round < rounds; round += 1) {
    if (params.shouldStop?.()) return { beats: added, calls, interrupted: true };
    const speaker = params.speakers[round % params.speakers.length];
    const beat = await actAsCharacter({
      ctx: params.ctx,
      speaker: { ...speaker, intent: round === 0 ? '接着刚才的话往下说' : '回应对方刚刚说的话' },
      userText: params.userText,
      priorBeats: beats.filter((b) => b.via !== 'none').map((b) => ({
        characterId: b.characterId,
        ...(b.dialogue ? { dialogue: b.dialogue } : {}),
        ...(b.action ? { action: b.action } : {}),
      })),
      ...(params.worldChanges?.length ? { worldChanges: params.worldChanges } : {}),
      ...(params.call ? { call: params.call } : {}),
    });
    calls += beat.llmCalls ?? 1;
    if (beat.via === 'none') return { beats: added, calls, interrupted: false };
    beats.push(beat);
    added.push(beat);
  }
  return { beats: added, calls, interrupted: false };
}

/* ------------------------------------------------------------------ *
 * 失败恢复（§52/§53）：重试复用同一行、同一条正文
 * ------------------------------------------------------------------ */

export async function retryWorldTurn(params: {
  turnId: string;
  characters: Character[];
  call?: WorldLlmCaller;
  onEvent?: (event: WorldTurnEvent) => void;
}): Promise<WorldTurnResult | null> {
  const turn = await worldTurnRepo.markRetrying(params.turnId);
  if (!turn) return null;
  // 关键：**不再插入一条用户输入**。把这一轮已经落下的正文档位之后，
  // 直接以原话重跑生成阶段（用户原话仍在世界流里，不会被重复写第二遍）。
  return enqueueWorldTurn(turn.worldId, () => rerunAfterUserEntry({
    turn,
    characters: params.characters,
    ...(params.call ? { call: params.call } : {}),
    ...(params.onEvent ? { onEvent: params.onEvent } : {}),
  }));
}

async function rerunAfterUserEntry(params: {
  turn: WorldTurn;
  characters: Character[];
  call?: WorldLlmCaller;
  onEvent?: (event: WorldTurnEvent) => void;
}): Promise<WorldTurnResult> {
  const { turn } = params;
  const scene = await worldSceneRepo.getScene(turn.sceneId);
  if (!scene) return { turnId: turn.id, status: 'failed', beats: [], suggestions: [], entries: [], llmCalls: 0, error: '这一片段不存在' };
  const entries = await worldSceneRepo.listEntries(turn.sceneId, { limit: 400 });
  const userEntry = entries.find((e) => e.id === turn.userEntryId);
  const ctx = await buildWorldContext({ userId: turn.userId, worldId: turn.worldId, scene, characters: params.characters });
  const emit = (event: WorldTurnEvent) => params.onEvent?.(event);
  const action: WorldAction = turn.action ?? { intent: 'freeform', raw: turn.input, by: 'fallback', requiresNarration: true, requiresCharacterResponse: true };
  let llmCalls = 0;

  const plan = await directWorldTurn({ ctx, action, userText: turn.input, ...(params.call ? { call: params.call } : {}) });
  llmCalls += plan.llmCalls;
  emit({ type: 'status', status: 'planning' });
  emit({ type: 'status', status: 'responding' });

  const added: WorldSceneEntry[] = [];
  if (plan.narration) {
    const entry = await worldSceneRepo.appendEntry(turn.sceneId, { kind: 'narration', content: plan.narration });
    added.push(entry);
    emit({ type: 'entry', entry });
  }
  const beats = await actWorldBeat({
    ctx,
    speakers: plan.speakers,
    userText: turn.input,
    sequential: plan.speakers.length > 1 ? true : plan.sequential,
    ...(params.call ? { call: params.call } : {}),
  });
  llmCalls += beats.reduce((sum, beat) => sum + (beat.llmCalls ?? 1), 0);
  for (const beat of beats) {
    if (beat.action) {
      const entry = await worldSceneRepo.appendEntry(turn.sceneId, { kind: 'action', content: beat.action, speakerId: beat.characterId });
      added.push(entry);
      emit({ type: 'entry', entry });
    }
    if (beat.dialogue) {
      const entry = await worldSceneRepo.appendEntry(turn.sceneId, { kind: 'dialogue', content: beat.dialogue, speakerId: beat.characterId });
      added.push(entry);
      emit({ type: 'entry', entry });
    }
  }
  await worldTurnRepo.addEntryIds(turn.id, added.map((e) => e.id));
  await worldTurnRepo.addCalls(turn.id, llmCalls);

  const visible = beats.filter((b) => b.via !== 'none');
  if (visible.length === 0 && !plan.narration) {
    await worldTurnRepo.markFailed(turn.id, 'responding', plan.error ?? '世界没有继续回应');
    emit({ type: 'status', status: 'failed' });
    return { turnId: turn.id, status: 'failed', action, plan, beats, entries: userEntry ? [userEntry] : [], suggestions: [], llmCalls, error: plan.error ?? '世界没有继续回应' };
  }
  emit({ type: 'ready' });

  const wantSettle = plan.shouldSettle || plan.worldChanges.length > 0;
  let settlement: SettleTurnResult | undefined;
  if (wantSettle) {
    settlement = await settleWorldTurn({
      ctx, actionText: turn.input,
      transcript: buildTranscript(added, ctx.nameOf),
      turnId: turn.id,
      ...(params.call ? { call: params.call } : {}),
    });
    llmCalls += settlement.llmCalls;
    await worldTurnRepo.addFactIds(turn.id, settlement.applied.factIds, 'created');
    await worldTurnRepo.addFactIds(turn.id, settlement.applied.deactivatedFactIds, 'deactivated');
    await worldTurnRepo.patch(turn.id, {
      settledEventIds: settlement.applied.worldEventIds,
      settledMemoryIds: settlement.applied.memoryIds,
      settledRelationshipEventIds: settlement.applied.relationshipEventIds,
      settledThreadIds: settlement.applied.threadIds,
      settledLifeEventIds: settlement.applied.lifeEventIds,
      stateDeltas: settlement.applied.stateDeltas,
    });
  }
  await worldTurnRepo.patch(turn.id, { settled: true });
  await worldTurnRepo.setStatus(turn.id, 'completed');
  emit({ type: 'status', status: 'completed' });
  return {
    turnId: turn.id, status: 'completed', action, plan, beats, entries: added,
    suggestions: plan.suggestions, ...(plan.narration ? { narration: plan.narration } : {}),
    ...(settlement ? { settlement } : {}), llmCalls,
  };
}

/** 详情/调试：把这一轮的世界层产物读回来（世界痕迹点开后展示"世界记住了什么"） */
export async function describeTurnArtifacts(turn: WorldTurn): Promise<{ events: string[]; memories: string[]; facts: string[]; threads: string[] }> {
  const events = turn.settledEventIds.length
    ? (await db.worldEvents.bulkGet(turn.settledEventIds)).filter(Boolean).map((e) => e!.title)
    : [];
  const memories = turn.settledMemoryIds.length
    ? (await db.sharedMemories.bulkGet(turn.settledMemoryIds)).filter(Boolean).map((m) => m!.title)
    : [];
  const facts = turn.settledFactIds.length
    ? (await db.worldFacts.bulkGet(turn.settledFactIds)).filter(Boolean).map((f) => f!.content)
    : [];
  const threads = turn.settledThreadIds.length
    ? (await continuityRepo.getByIds(turn.settledThreadIds)).map((t) => t.title)
    : [];
  return { events, memories, facts, threads };
}

/** 未完成的事（世界主页"最近发生"与报告用） */
export async function openThreadTitles(userId: string, limit = 5): Promise<string[]> {
  const threads = await continuityRepo.getOpenByUser(userId);
  return threads.slice(0, limit).map((t) => t.title);
}

/** 只读：世界层的"这一段现在是什么样"（Canvas 顶部与报告用） */
export async function worldNow(scene: WorldScene, characters: Character[]): Promise<{ place: string; timeLabel: string; mood: string; names: string[] }> {
  return {
    place: scene.place,
    timeLabel: scene.timeLabel,
    mood: scene.mood,
    names: scene.characterIds.map((id) => characters.find((c) => c.id === id)?.name ?? '某人'),
  };
}

/** 报告的"世界全貌"快照（不用于 UI） */
export async function worldBriefForReport(userId: string, worldId: string, scene: WorldScene, characters: Character[]): Promise<string> {
  const ctx = await buildWorldContext({ userId, worldId, scene, characters });
  return renderWorldBrief(ctx);
}
