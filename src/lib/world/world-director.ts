/**
 * World Director（5.0.0 Living World §22 Stage C / §18）
 *
 * Director **不扮演任何角色**。它只回答"这一拍该怎么走"：
 * - 现在发生什么、要不要旁白
 * - 谁需要回应、谁**不应该**回应、用户点名了谁
 * - 角色之间要不要互动（顺序生成还是并行生成）
 * - 这一轮值不值得留下世界变化（§28：不要让"你好"产生三个事件）
 *
 * 输出是 TurnPlan，不是台词。台词由每个角色自己的 Actor 生成（§23），
 * 这样"古月娜就是古月娜，星遥就是星遥"，而不是一个总模型一次写完所有人的对白。
 */
import { safeParseObject } from '../ai/safe-json';
import { worldChat, type WorldLlmCaller } from './world-ai-client';
import type { WorldContext } from './world-context';
import { renderWorldBrief } from './world-context';
import type { WorldAction } from './world-actions';

export interface TurnSpeaker {
  characterId: string;
  /** 这个角色这一拍**为什么**说/做什么（给 Actor 的行为意图） */
  intent: string;
  /** 导演期待的形态：说话 / 只做一个动作 / 两者都可以 */
  mode: 'dialogue' | 'action' | 'both';
}

export interface TurnPlan {
  /** 这一拍的旁白（可空：很多拍不需要旁白） */
  narration?: string;
  speakers: TurnSpeaker[];
  /** true = 后一个角色的上下文要包含前一个角色刚说的话（真正的互动） */
  sequential: boolean;
  /** 这一轮真的发生的世界变化（人话，一句一条；用于世界痕迹与结算判断） */
  worldChanges: string[];
  /** 是否值得做一次 World Settlement（§28） */
  shouldSettle: boolean;
  /** 灵感建议（§37：只在明显犹豫时给，绝不对每轮都给三选一） */
  suggestions: string[];
  /** 这一轮给用户看的世界痕迹（§11.5：克制的一句话，可空） */
  trace?: string;
  /** 这次导演实际发生的调用次数（0 = 走的是"规则不需要导演"的短路路径，可核对） */
  llmCalls: number;
  error?: string;
  via: 'json' | 'none';
  raw?: string;
}

export const DIRECTOR_INSTRUCTION = `你是一段"共同生活"的导演。用户和几位角色正在同一个世界里。你要决定**这一拍怎么走**，但**不要写任何台词**。

只输出 JSON：
{"narration":"这一拍的旁白，可省略","speakers":[{"character":"角色名","intent":"TA 这一拍想做什么/想说什么（一句话）","mode":"dialogue|action|both"}],"sequential":false,"worldChanges":["这一轮真的发生的世界变化（人话，一句）"],"shouldSettle":false,"suggestions":["给用户的灵感建议，可省略"],"trace":"这一轮值得被记住时的一句话，可省略"}

硬性规则：
1. speakers **只能**从"在场的人"里选，最多 2 个（用户明确要求大家交流时可以 3 个）。
2. 用户点名了谁，谁就必须在 speakers 里。
3. 没被点名、也和这一拍无关的角色**不要**说话——不要机械轮流发言。
4. 允许 0 个角色（例如用户说"大家安静一会"）：这时只给 narration。
5. sequential=true 表示后面的角色要听到前面角色刚说的话（角色之间真的在互动）；
   两人各自独立回应用户时用 sequential=false（可以并行生成，更快）。
6. worldChanges 只写**真的发生了**的变化（去了哪里、气氛变了、说了什么重要的话、约定了什么）。
   聊天寒暄、打招呼**不要**写进 worldChanges。
7. shouldSettle 只在这一轮确实值得被世界记住时为 true：明确的承诺、关系明显变化、
   创建了新地点、改了世界规则、重要互动、新秘密、重要冲突、重要决定、用户明确要求记住。
   普通的问候、闲聊、日常寒暄一律 false。
8. suggestions 只在**用户明显站在岔路口**时才给（2~3 条，每条不超过 16 字，风格是"用户可能想做的事"）。
   绝大多数情况下省略。**绝对不要**每轮都给。
9. 旁白只写环境、动作、节奏、场面变化，**不要替角色表达心理**。
10. 不要输出 JSON 以外的任何文字。`;

const IMMERSION_DIRECTIVE = `
剧情推进：先判断用户是在闲聊、观察、行动还是旁观。闲聊允许安静停留；观察应呈现一个现场可感知、可继续调查的具体细节；行动必须产生符合现有设定的即时反馈，不能只让人物评价用户；旁观时让人物围绕自己的目标相互行动。推进事件时遵循“已有原因→可见变化→留下应对空间”，不要每轮凭空制造灾难或陌生人，不要反复把同一个悬念重新包装。
每个选择都应有不同的行动对象或代价，避免三个同义选项。不要替用户选择，也不要把尚未调查的猜测写成已经证实的事实。只有真实演出的变化才进入 worldChanges；用户仅提出想法不等于已经实现。
演出节奏：这是有自己生活的世界，用户不是每句话的中心。合适时让在场角色彼此交谈、回应彼此，话题可以停留在他们之间；只有被点名或确实相关时才回应用户。两位及以上角色必须按顺序演出（sequential=true），不要让他们同时开口。动作要具体并符合角色的性格、目标和现场；对白保持短而自然，每个角色通常只说 1~3 句、总回应不超过 90 字。用户换话题时立刻跟随当前意图，不要揪着旧问题或同一件事反复追问；每轮只推进一个小节拍，给用户留下接话空间。
当用户只是简短回应、没有明确问题时，也不要机械地追问。可以让角色从现场的一件物品、正在发生的声音、自己的小目标或另一位角色身上主动开一个很小的话头；主动话题必须和此刻有关，不能凭空讲设定。已经反复出现的意象、比喻和问题要换一种具体生活细节，连续几轮不要重复同一核心词。
`;

export interface DirectorParams {
  ctx: WorldContext;
  action: WorldAction;
  /** 用户原话 */
  userText: string;
  maxSpeakers?: number;
  call?: WorldLlmCaller;
}

function presentNames(ctx: WorldContext): string {
  return ctx.presence.map((id) => ctx.nameOf(id)).join('、') || '（此刻没有别的角色在场）';
}

/** 用户点名/提到的角色必须在场（不在场的由调用方先召集，§19 自然语言与 chips 等效） */
export function requiredSpeakers(action: WorldAction, ctx: WorldContext): string[] {
  const ids = [...(action.addressedCharacters ?? []), ...(action.mentionedCharacters ?? [])];
  return [...new Set(ids)].filter((id) => ctx.presence.includes(id));
}

/** 解析导演输出（宽容；未知角色丢弃；speakers 上限强制生效） */
export function parseDirectorOutput(
  raw: string,
  ctx: WorldContext,
  maxSpeakers: number,
): Omit<TurnPlan, 'error' | 'raw' | 'llmCalls'> & { via: 'json' | 'none' } {
  const parsed = safeParseObject(raw);
  if (parsed.via === 'none') {
    return { speakers: [], sequential: false, worldChanges: [], shouldSettle: false, suggestions: [], via: 'none' };
  }
  const obj = parsed.value as Record<string, unknown>;
  const byName = new Map(ctx.presence.map((id) => [ctx.nameOf(id), id]));
  const byId = new Set(ctx.presence);

  const speakers: TurnSpeaker[] = [];
  const list = Array.isArray(obj.speakers) ? obj.speakers : [];
  for (const item of list) {
    if (speakers.length >= maxSpeakers) break;
    const row = (item ?? {}) as Record<string, unknown>;
    const rawName = typeof row.character === 'string' ? row.character.trim() : typeof row.characterId === 'string' ? row.characterId.trim() : '';
    const id = byId.has(rawName) ? rawName : byName.get(rawName);
    if (!id) continue; // 不在场的人不能说话（丢弃，绝不安到别人头上）
    if (speakers.some((s) => s.characterId === id)) continue;
    const modeRaw = row.mode;
    const mode: TurnSpeaker['mode'] = modeRaw === 'dialogue' || modeRaw === 'action' ? modeRaw : 'both';
    const intent = typeof row.intent === 'string' && row.intent.trim() ? row.intent.trim().slice(0, 200) : '自然地回应';
    speakers.push({ characterId: id, intent, mode });
  }

  const str = (v: unknown, max: number): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : undefined;
  };
  const strList = (v: unknown, max: number, cap: number): string[] =>
    (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter((x): x is string => !!x).slice(0, cap);

  return {
    ...(str(obj.narration, 400) ? { narration: str(obj.narration, 400)! } : {}),
    speakers,
    // 两位及以上角色必须依次回应，后一位会真实读到前一位刚说的话。
    sequential: speakers.length > 1 ? true : obj.sequential === true,
    worldChanges: strList(obj.worldChanges, 160, 5),
    shouldSettle: obj.shouldSettle === true,
    suggestions: strList(obj.suggestions, 40, 3),
    ...(str(obj.trace, 60) ? { trace: str(obj.trace, 60)! } : {}),
    via: speakers.length > 0 || str(obj.narration, 400) ? 'json' : 'none',
  };
}

/**
 * 本地兜底计划：模型不可用或解析失败时，至少要让"世界继续回应"（§51）。
 *
 * 兜底不会编内容——它只决定"谁能说话"：
 * 点名的人先说；没人点名时，在场角色里第一个（最多两个）。
 * 台词仍由各自的 Actor 生成（如果 Actor 也失败，这一轮会如实失败并保留用户原话）。
 */
export function fallbackPlan(action: WorldAction, ctx: WorldContext, maxSpeakers: number): TurnPlan {
  const required = requiredSpeakers(action, ctx);
  const candidates = required.length > 0 ? required : ctx.presence;
  const speakers: TurnSpeaker[] = candidates.slice(0, maxSpeakers).map((id) => ({
    characterId: id,
    intent: '自然地回应刚刚发生的事',
    mode: 'both',
  }));
  if (action.silence) {
    return {
      speakers: [],
      sequential: false,
      worldChanges: [],
      shouldSettle: false,
      suggestions: [],
      narration: '周围安静了下来。',
      via: 'none',
      llmCalls: 0,
    };
  }
  return { speakers, sequential: speakers.length > 1, worldChanges: [], shouldSettle: false, suggestions: [], via: 'none', llmCalls: 0 };
}

/** 一轮 Director 调用（§22 Stage C） */
export async function directWorldTurn(params: DirectorParams): Promise<TurnPlan> {
  const { ctx, action } = params;
  const maxSpeakers = Math.max(1, Math.min(3, params.maxSpeakers ?? 2));

  if (action.silence) {
    // 用户明确要求安静：这是**规则**，不是模型判断（"大家别说话"轮不到模型反对）
    return {
      speakers: [],
      sequential: false,
      worldChanges: [],
      shouldSettle: false,
      suggestions: [],
      narration: '周围安静了下来。',
      via: 'none',
      llmCalls: 0,
    };
  }

  const required = requiredSpeakers(action, ctx);
  const actionLine = [
    `用户这句话被理解为：${action.intent}${action.raw ? `（原话：${action.raw}）` : ''}`,
    action.userAction ? `用户自己的动作：${action.userAction}` : '',
    required.length ? `用户点名了：${required.map((id) => ctx.nameOf(id)).join('、')}` : '',
    action.requiresCharacterResponse === false ? '这一轮不需要角色回应。' : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await worldChat({
      messages: [
        { role: 'system', content: `${DIRECTOR_INSTRUCTION}\n${IMMERSION_DIRECTIVE}\n\n${renderWorldBrief(ctx)}\n\n在场的人：${presentNames(ctx)}` },
        { role: 'user', content: actionLine },
      ],
      temperature: 0.7,
      disableThinking: true,
      jsonMode: true,
      maxTokens: 700,
      timeoutMs: 60_000,
    }, params.call);

    const plan = parseDirectorOutput(res.content ?? '', ctx, maxSpeakers);
    if (plan.via === 'none') {
      const fb = fallbackPlan(action, ctx, maxSpeakers);
      return { ...fb, llmCalls: 1, error: '导演没有给出可用的这一拍', raw: res.content ?? '' };
    }
    // 用户点名的角色必须出现（模型漏掉就补上，模型不认识"谁在场"时以用户为准）
    const speakers = [...plan.speakers];
    for (const id of required) {
      if (speakers.length >= maxSpeakers) break;
      if (!speakers.some((s) => s.characterId === id)) {
        speakers.push({ characterId: id, intent: '回应用户刚刚对你说的话', mode: 'both' });
      }
    }
    if (action.requiresCharacterResponse === false) speakers.length = 0;
    return { ...plan, speakers, sequential: speakers.length > 1 ? true : plan.sequential, llmCalls: 1, raw: res.content ?? '' };
  } catch (err) {
    const fb = fallbackPlan(action, ctx, maxSpeakers);
    return { ...fb, llmCalls: 1, error: (err as Error)?.message ?? 'server:error' };
  }
}
