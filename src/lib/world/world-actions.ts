/**
 * WorldAction —— 自然语言的**内部**结构化形态（5.0.0 Living World §13）
 *
 * 设计原则（这三条决定了 5.0 和"线性剧本工具"的分界）：
 *
 * 1. **用户不选模式**。用户说的每一句话都先被翻译成 WorldAction，
 *    但 WorldAction **永远不出现在 UI 上**——它只是系统内部的中间表示。
 * 2. **解析不出来不是错误**（§14）。任何无法判断的情况一律落到 `freeform`，
 *    由 Director 结合上下文理解；绝不让用户"先选一个行为类型"。
 * 3. **程序负责校验，模型只负责建议**（§30）。模型给的名字会在这里被解析成
 *    真实存在的角色 id，解析不出来的名字被丢弃（绝不"随便安在某个角色头上"）。
 *
 * 本文件**不依赖 db 层**（只导入类型），因此 `db/index.ts` 可以用它给
 * `WorldTurn.action` 定型而不产生运行时循环依赖。
 */
import type { WorldFactCategory } from '../../db/index';

export type WorldIntent =
  | 'talk'
  | 'act'
  | 'summon'
  | 'dismiss'
  | 'character_interaction'
  | 'change_location'
  | 'change_time'
  | 'change_atmosphere'
  | 'world_rule'
  | 'character_fact'
  | 'start_event'
  | 'continue_event'
  | 'pause_event'
  | 'end_topic'
  | 'time_skip'
  | 'recall'
  | 'retcon'
  | 'undo'
  | 'direct_character'
  | 'freeform';

export const WORLD_INTENTS: WorldIntent[] = [
  'talk', 'act', 'summon', 'dismiss', 'character_interaction',
  'change_location', 'change_time', 'change_atmosphere',
  'world_rule', 'character_fact',
  'start_event', 'continue_event', 'pause_event', 'end_topic',
  'time_skip', 'recall', 'retcon', 'undo', 'direct_character', 'freeform',
];

/** 中文标签：只用于报告与调试，不在产品 UI 里显示 */
export const WORLD_INTENT_LABEL: Record<WorldIntent, string> = {
  talk: '交谈',
  act: '做一件事',
  summon: '召集角色',
  dismiss: '让角色离开',
  character_interaction: '角色之间互动',
  change_location: '改变地点',
  change_time: '改变时间',
  change_atmosphere: '改变氛围',
  world_rule: '世界规则',
  character_fact: '角色事实',
  start_event: '开始一段事件',
  continue_event: '继续事件',
  pause_event: '暂停事件',
  end_topic: '结束话题',
  time_skip: '时间跳跃',
  recall: '回忆',
  retcon: '修改世界事实',
  undo: '撤销上一轮',
  direct_character: '指定角色回应',
  freeform: '自由表达',
};

export interface WorldAction {
  intent: WorldIntent;
  /** 用户在跟谁说话（已解析为真实角色 id；解析不出来的名字被丢弃） */
  addressedCharacters?: string[];
  /** 用户顺带提到的角色（不一定要回应） */
  mentionedCharacters?: string[];
  locationChange?: string;
  timeChange?: string;
  atmosphereChange?: string;
  /** 用户自己要做的动作（"我走过去抱住她"） */
  userAction?: string;
  /** 要写进世界设定的那句话（world_rule / character_fact） */
  worldFact?: string;
  /** world_rule / character_fact 的具体分类 */
  factCategory?: WorldFactCategory;
  /** recall：想回忆什么（自由文本） */
  recallTarget?: string;
  /** retcon：被修正的世界事实（自由文本） */
  retconTarget?: string;
  /**
   * world_rule / character_fact：这条新设定**替换掉了**哪一条旧设定。
   * 必须是既有设定的**原文**（程序按精确匹配停用旧的那一条，见 world-facts.ts）。
   * 这样"改一下，这个世界其实存在魔法"不会留下两条互相冲突的 Canon（§101）。
   */
  replacesFact?: string;
  /** 是否值得写进世界层（默认由 intent 推断） */
  shouldPersist?: boolean;
  /** 这一轮是否要旁白 */
  requiresNarration?: boolean;
  /** 这一轮是否要角色回应（false ⇒ 允许 0 个角色回应，例如"大家安静一会"） */
  requiresCharacterResponse?: boolean;
  /** 用户明确要求安静：可以只有旁白 */
  silence?: boolean;
  /** 原始输入（永远保留） */
  raw: string;
  /** 判定来源：rule=本地规则（0 次调用）/ llm=模型判定 / fallback=模型不可用时的关键词兜底 */
  by: 'rule' | 'llm' | 'fallback';
  /** undo / retcon 指向的具体轮次（为空表示"最近一轮"） */
  targetTurnId?: string;
}

const MAX_NAME = 40;
const MAX_TEXT = 300;

function str(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s ? s.slice(0, max) : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 把模型给的自由文本名字解析成真实角色 id。
 * - 已经就是 id 的，直接通过
 * - 名字精确匹配（去掉首尾空白）通过
 * - 其余**一律丢弃**（绝不猜、绝不安到别人头上）
 */
export function resolveCharacterNames(
  names: unknown,
  characters: { id: string; name: string }[],
): string[] {
  if (!Array.isArray(names)) return [];
  const byExactName = new Map(characters.map((c) => [c.name.trim(), c.id]));
  const byId = new Set(characters.map((c) => c.id));
  const out: string[] = [];
  for (const raw of names) {
    const value = str(raw, MAX_NAME);
    if (!value) continue;
    const id = byId.has(value) ? value : byExactName.get(value);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

const FACT_CATEGORIES: WorldFactCategory[] = ['rule', 'location', 'atmosphere', 'history', 'shared_knowledge', 'character_fact', 'custom'];

function factCategory(value: unknown, fallback: WorldFactCategory): WorldFactCategory {
  return FACT_CATEGORIES.includes(value as WorldFactCategory) ? (value as WorldFactCategory) : fallback;
}

/** 某些意图天然要落库（世界规则、角色事实、事件），某些天然不落库（纯闲聊） */
const PERSIST_INTENTS = new Set<WorldIntent>([
  'world_rule', 'character_fact', 'start_event', 'time_skip', 'change_location',
  'change_atmosphere', 'change_time', 'retcon',
]);

/**
 * 归一化模型输出 → WorldAction。
 *
 * 宽容但不放水：模型多给字段没关系，给错类型就丢掉那一个字段（不整条失败，§64）。
 */
export function normalizeWorldAction(
  raw: unknown,
  rawText: string,
  characters: { id: string; name: string }[],
  by: WorldAction['by'] = 'llm',
): WorldAction {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const intentRaw = str(obj.intent, MAX_NAME);
  const intent: WorldIntent = (WORLD_INTENTS as string[]).includes(intentRaw ?? '')
    ? (intentRaw as WorldIntent)
    : 'freeform';

  const addressed = resolveCharacterNames(obj.addressedCharacters, characters);
  const mentioned = resolveCharacterNames(obj.mentionedCharacters, characters);

  const action: WorldAction = {
    intent,
    raw: rawText.slice(0, 1200),
    by,
    requiresCharacterResponse: bool(obj.requiresCharacterResponse) ?? intent !== 'world_rule',
    requiresNarration: bool(obj.requiresNarration) ?? (intent === 'act' || intent === 'freeform'),
  };
  if (addressed.length) action.addressedCharacters = addressed;
  if (mentioned.length) action.mentionedCharacters = mentioned;

  const locationChange = str(obj.locationChange, 120);
  if (locationChange) action.locationChange = locationChange;
  const timeChange = str(obj.timeChange, 60);
  if (timeChange) action.timeChange = timeChange;
  const atmosphereChange = str(obj.atmosphereChange, 60);
  if (atmosphereChange) action.atmosphereChange = atmosphereChange;
  const userAction = str(obj.userAction, 600);
  if (userAction) action.userAction = userAction;
  const worldFact = str(obj.worldFact, 300);
  if (worldFact) action.worldFact = worldFact;
  if (intent === 'world_rule') action.factCategory = factCategory(obj.factCategory, 'rule');
  else if (intent === 'character_fact') action.factCategory = 'character_fact';
  else if (obj.factCategory) action.factCategory = factCategory(obj.factCategory, 'custom');

  const recallTarget = str(obj.recallTarget, 200);
  if (recallTarget) action.recallTarget = recallTarget;
  const retconTarget = str(obj.retconTarget, 300);
  if (retconTarget) action.retconTarget = retconTarget;
  const replacesFact = str(obj.replacesFact, 300);
  if (replacesFact) action.replacesFact = replacesFact;
  const targetTurnId = str(obj.targetTurnId, 80);
  if (targetTurnId) action.targetTurnId = targetTurnId;

  const shouldPersist = bool(obj.shouldPersist);
  if (shouldPersist != null) action.shouldPersist = shouldPersist;
  else if (PERSIST_INTENTS.has(intent)) action.shouldPersist = true;

  if (bool(obj.silence) === true) {
    action.silence = true;
    action.requiresCharacterResponse = false;
  }
  // 撤销/修改世界事实不需要角色表演
  if (intent === 'undo') {
    action.requiresCharacterResponse = false;
    action.requiresNarration = false;
  }
  return action;
}

/** 一个"什么也没解析出来"的自由表达（§14 的落点） */
export function freeformAction(rawText: string, by: WorldAction['by'] = 'fallback'): WorldAction {
  return {
    intent: 'freeform',
    raw: rawText.slice(0, 1200),
    by,
    requiresNarration: true,
    requiresCharacterResponse: true,
  };
}

/* ------------------------------------------------------------------ *
 * 本地规则层（0 次调用）：只处理**语义无歧义**的控制指令
 * ------------------------------------------------------------------ */

const UNDO_PATTERNS = [
  /^(刚才|刚刚)?(那段|这段|这句|这句?话)?\s*(不算|作废|撤回|撤销|回退|重来)\s*[。.!！]?$/,
  /^(撤销|撤回)(上一轮|刚才|刚刚|上一步|上一次)\s*[。.!！]?$/,
  /^(重新|再来)(来|生成|写)?\s*(一次|一遍|上一条|刚才那段)\s*[。.!！]?$/,
  /^(刚才|刚刚)(那段|这段)?\s*重新(来|写|生成)\s*[。.!！]?$/,
];

/**
 * 规则层：只有"撤销上一轮"被认定为语义无歧义。
 * 其余一切（包括 retcon）都交给模型——因为"其实我们从来没去过那里"到底是
 * 修改设定还是角色在说话，只有模型结合上下文才能判断。
 */
export function ruleInterpret(text: string): WorldAction | null {
  const t = text.trim();
  if (!t || t.length > 30) return null;
  if (UNDO_PATTERNS.some((re) => re.test(t))) {
    return { intent: 'undo', raw: t, by: 'rule', requiresCharacterResponse: false, requiresNarration: false };
  }
  return null;
}

/**
 * 兜底解析（模型不可用/解析失败时用）：按关键词给出**保守**判断。
 *
 * 为什么要有它：§55 要求没有可用 AI 服务时必须明确告诉用户，
 * 但"明确告诉"不等于"世界直接瘫掉"——用户说"直接到第二天早上"这种
 * 结构极其明确的句子，本地规则完全可以正确执行，没必要失败。
 */
export function fallbackInterpret(text: string): WorldAction {
  const t = text.trim();
  if (!t) return freeformAction(t, 'fallback');
  const timeSkip = /^(直接|现在)?\s*(到|跳到|快进到)\s*(第二天|明天|后天|晚上|早上|早晨|中午|下午|黄昏|夜里|深夜|一周后|一个月后)/.exec(t);
  if (timeSkip) {
    return { intent: 'time_skip', raw: t, by: 'fallback', timeChange: t.slice(0, 60), requiresCharacterResponse: true, requiresNarration: true };
  }
  if (/^(其实|实际上)?\s*(我们)?(从来)?(没|没有)(去过|发生|说过)/.test(t)) {
    return { intent: 'retcon', raw: t, by: 'fallback', retconTarget: t.slice(0, 300), requiresCharacterResponse: false, requiresNarration: true };
  }
  if (/(以后|从此|一直|永远|再也)/.test(t) && t.length <= 40) {
    return { intent: 'world_rule', raw: t, by: 'fallback', worldFact: t.slice(0, 300), factCategory: 'rule', requiresCharacterResponse: false, requiresNarration: true };
  }
  if (/^(让|叫)\s*\S{1,10}\s*(过来|来|加入|一起)/.test(t)) {
    return { intent: 'summon', raw: t, by: 'fallback', requiresCharacterResponse: true, requiresNarration: true };
  }
  if (/^(让|叫)\s*\S{1,10}\s*(先)?(离开|走开|回避)/.test(t)) {
    return { intent: 'dismiss', raw: t, by: 'fallback', requiresCharacterResponse: true, requiresNarration: true };
  }
  if (/^(我们|咱们)?\s*(去|出发去|出发到)/.test(t)) {
    return { intent: 'change_location', raw: t, by: 'fallback', locationChange: t.slice(0, 120), requiresCharacterResponse: true, requiresNarration: true };
  }
  if (/^(大家|都|你们)?\s*(别|不要)(说话|出声)/.test(t)) {
    return { intent: 'talk', raw: t, by: 'fallback', silence: true, requiresCharacterResponse: false, requiresNarration: true };
  }
  return freeformAction(t, 'fallback');
}

/** 这一轮是否需要"把用户这句话当成一次世界状态变化"来处理（用于统计与 UI 痕迹） */
export function leavesWorldTrace(action: WorldAction): boolean {
  return PERSIST_INTENTS.has(action.intent) || action.intent === 'undo';
}
