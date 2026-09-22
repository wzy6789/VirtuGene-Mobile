/**
 * World Actor（5.0.0 Living World §23 / §24 / §25）
 *
 * 每个真正要发言的角色**用自己的 Actor 提示词单独生成**。
 *
 * 为什么必须拆开（这是 5.0 与"群聊 + 场景模板"最本质的区别）：
 * 一个总模型一次写完三个人的台词，结果是三个人的语气互相污染、
 * 而且系统知道的事会从每个人的嘴里漏出来。拆成独立 Actor 之后：
 * - 古月娜是古月娜，星遥是星遥（各自的人格 / 关系 / 情绪 / 认知）
 * - **知识隔离**（§20）在结构上成立：Actor 的上下文里根本没有 TA 不知道的东西
 * - 顺序生成让角色之间真的在互动（A 说完，B 听得到 A 刚才那句）
 */
import { safeParseObject, salvagePlainText } from '../ai/safe-json';
import { worldChat, type WorldLlmCaller } from './world-ai-client';
import { findModel, resolveModel, getProviderKey } from '../ai/llm';
import { entryLine, renderCharacterContext, type WorldContext } from './world-context';
import type { TurnSpeaker } from './world-director';
import { buildConversationFocus } from './user-profile';
import { directorConversationHints } from './world-immersion';

export interface ActorParams {
  ctx: WorldContext;
  speaker: TurnSpeaker;
  /** 用户这一轮的原话（角色需要知道用户在说什么） */
  userText: string;
  /** 用户自己的动作（"我走过去抱住她"） */
  userAction?: string;
  /**
   * 已经生成完的同拍内容（顺序生成时才有）：
   * 让后面的角色**听得到**前面角色刚说的话（§24）。
   */
  priorBeats?: { characterId: string; dialogue?: string; action?: string }[];
  /** 这一拍的世界变化（例如"下雨了"） */
  worldChanges?: string[];
  /**
   * 流式增量回调（星域呈现用）：生成过程中持续吐出已产出的台词/动作前缀。
   * 不支持的通道（网关、验收注入）不会触发，调用方按"可能没有增量"处理。
   */
  onPartial?: (partial: { dialogue?: string; action?: string }) => void;
  call?: WorldLlmCaller;
}

export interface ActorBeat {
  characterId: string;
  dialogue?: string;
  action?: string;
  error?: string;
  via: 'json' | 'salvaged' | 'none';
  raw?: string;
  /** 正常为 1；空响应触发备用模型时为 2。 */
  llmCalls?: number;
}

function trimNatural(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const boundary = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('…'));
  return boundary >= Math.floor(max * 0.55) ? head.slice(0, boundary + 1) : `${head.slice(0, max - 1)}…`;
}

/**
 * 从不完整的 JSON 文本里增量提取某个字符串字段的**已产出前缀**（流式呈现用）。
 * 只处理 `\"key\":\"…` 形态；引号未闭合也返回已有部分；末尾悬挂的转义符会先留着不消费。
 */
export function extractPartialJsonString(text: string, key: string): string | undefined {
  const marker = `"${key}"`;
  const at = text.indexOf(marker);
  if (at < 0) return undefined;
  let i = at + marker.length;
  while (i < text.length && /[\s:]/.test(text[i])) i += 1;
  if (text[i] !== '"') return undefined;
  i += 1;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      if (i + 1 >= text.length) break; // 悬挂转义：等下一段增量
      const next = text[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'u') {
        if (i + 5 >= text.length) break; // Unicode 转义尚未到齐，不能先把字母 u 显示出来
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(Number.parseInt(hex, 16)); i += 6; continue; }
        break;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') break; // 字段结束
    out += ch;
    i += 1;
  }
  return out || undefined;
}

export const ACTOR_INSTRUCTION = `你现在**只扮演一个角色**，在一次共同生活里做出这一拍的反应。

只输出 JSON：
{"dialogue":"你要说的话（可以是空的）","action":"你做的动作 / 神态（可以是空的，不写心理活动）"}

规则：
1. 用**第一人称**演这个角色，只说 TA 会说的话、只做 TA 会做的事。
2. 严格保持 TA 的性格、说话习惯、与用户的关系；不要变成通用助手。
3. 你**只能使用** system 里告诉你的信息。没告诉你的秘密、别人的私事，你不知道，绝对不可以提到、暗示或猜测。
4. 用户刚刚做了什么、说了什么已经在上面；**不要复述用户的原话**。
5. 不要替用户说话、不要替用户做决定、不要描写用户的心理。
6. 台词要短、像真人说话（1~2 句，通常 15~80 字）；动作要具体、克制（通常不超过 45 字）。
7. 你可以保持沉默（dialogue 留空，只做一个动作），也可以拒绝、可以离开——但要符合这个角色。
8. 用户换话题时要跟随当前话题，不要揪着旧问题反复追问；未完成事项只有在用户主动继续或现场自然相关时才提。
9. 每次必须让人认出是**这个角色**在回应：从 TA 的偏好、措辞、关注点、小脾气或关系距离里自然露出至少一项，但不要背诵人设。
10. 允许不赞同、误解后改口、短暂停顿、岔开一句或说到一半停住；不要永远正确、永远温柔、永远追问。
11. 禁止“我理解你的感受”“听起来你……”这类通用安慰开场；不要连续用同一个句式开头，不要把每轮结尾都写成问题。
12. 不要输出 JSON 以外的任何文字。`;

const ACTOR_IMMERSION_NOTE = `
这不是客服问答。角色可以把注意力放在另一位在场者身上，回应对方的动作或话题；只有自然时才看向用户。每次只给一小段真实反应，先接住眼前的人、动作或情绪，再决定要不要展开。日常对话可以有玩笑、偏见、生活细节和不完整的句子；严肃时也不自动进入心理咨询口吻。动作必须能被别人看见，不能用动作偷写内心。不要替其他角色说话，也不要把长篇总结塞进一次回应。
`;

/** 把角色私有上下文 + 当前这一拍拼成 Actor 的 system */
export function buildActorSystem(params: ActorParams): string {
  const { ctx, speaker } = params;
  const blocks: string[] = [];
  const identity = ctx.perCharacter[speaker.characterId];
  blocks.push(`【你是谁】${identity?.name ?? ctx.nameOf(speaker.characterId)}\n${identity?.persona?.slice(0, 12000) ?? ''}`);
  blocks.push(renderCharacterContext(ctx, speaker.characterId));
  blocks.push(`【这一拍导演希望你】${speaker.intent}`);
  blocks.push(buildConversationFocus(params.userText, ctx.recentEntries));
  const rhythm = directorConversationHints(ctx.conversation);
  if (rhythm) blocks.push(`【对话节奏】\n${rhythm}`);
  if (speaker.mode === 'action') blocks.push('【这一拍只用动作回应，不要说话】');
  if (speaker.mode === 'dialogue') blocks.push('【这一拍用说话回应】');

  if (params.priorBeats?.length) {
    const lines = params.priorBeats.map((b) => {
      const name = ctx.nameOf(b.characterId);
      const parts = [b.action ? `（${name}${b.action}）` : '', b.dialogue ? `${name}：${b.dialogue}` : ''].filter(Boolean);
      return parts.join('');
    }).filter(Boolean);
    if (lines.length) blocks.push(`【刚刚发生的（你可以听到/看到）】\n${lines.join('\n')}`);
  }
  if (params.worldChanges?.length) blocks.push(`【这一刻世界的变化】${params.worldChanges.join('；')}`);
  const recent = ctx.recentEntries.slice(0, 8).reverse().map((e) => entryLine(e, ctx.nameOf));
  if (recent.length) blocks.push(`【刚才这一刻】\n${recent.join('\n')}`);
  return `${ACTOR_INSTRUCTION}\n${ACTOR_IMMERSION_NOTE}\n\n${blocks.join('\n\n')}`;
}

/** 解析 Actor 输出：结构失败但正文可用 ⇒ **保留正文**（§64） */
export function parseActorOutput(raw: string, characterId: string): ActorBeat {
  const text = (raw ?? '').trim();
  const parsed = safeParseObject(text);
  if (parsed.via !== 'none') {
    const obj = parsed.value as Record<string, unknown>;
    const spoken = obj.dialogue ?? obj.speech ?? obj.text ?? obj.content;
    const dialogue = typeof spoken === 'string' ? trimNatural(spoken.trim(), 180) : '';
    const action = typeof obj.action === 'string' ? trimNatural(obj.action.trim(), 140) : '';
    if (dialogue || action) {
      return {
        characterId,
        ...(dialogue ? { dialogue } : {}),
        ...(action ? { action } : {}),
        via: 'json',
        raw: text,
      };
    }
    return { characterId, via: 'none', error: '空回应', raw: text };
  }
  const salvaged = salvagePlainText(text, 220);
  if (salvaged) return { characterId, dialogue: trimNatural(salvaged, 180), via: 'salvaged', raw: text };
  return { characterId, via: 'none', error: '这一拍没有生成内容', raw: text };
}

/** 一个角色的一拍（1 次调用） */
export async function actAsCharacter(params: ActorParams): Promise<ActorBeat> {
  const userLine = [
    params.userAction ? `用户刚刚做了：${params.userAction}` : '',
    params.userText ? `用户说：${params.userText}` : '',
  ].filter(Boolean).join('\n') || '（这一刻刚开始）';

  try {
    const request = {
      messages: [
        { role: 'system', content: buildActorSystem(params) },
        { role: 'user', content: userLine },
      ],
      temperature: 0.95,
      disableThinking: true,
      jsonMode: true,
      maxTokens: 500,
      timeoutMs: 60_000,
    };
    let first: ActorBeat;
    try {
      first = parseActorOutput((await worldChat({
        ...request,
        // 星域呈现：边生成边把已产出的台词/动作前缀吐给世界流（网关/验收通道自动静默）
        ...(params.onPartial
          ? {
            onDelta: (accumulated: string) => {
              const dialogue = extractPartialJsonString(accumulated, 'dialogue');
              const action = extractPartialJsonString(accumulated, 'action');
              if (dialogue || action) {
                params.onPartial?.({
                  ...(dialogue ? { dialogue } : {}),
                  ...(action ? { action } : {}),
                });
              }
            },
          }
          : {}),
      }, params.call)).content ?? '', params.speaker.characterId);
    } catch (error) {
      const reason = (error as Error).message;
      if (/auth:|billing:|rate:/.test(reason)) throw error;
      first = { characterId: params.speaker.characterId, via: 'none', error: reason };
    }
    if (first.via !== 'none') return { ...first, llmCalls: 1 };

    // 只有“没有可用正文”才切换备用模型；正常回答绝不平白增加调用。
    const primary = resolveModel();
    const fallback = findModel('deepseek-v4-flash');
    const canFallback = fallback && (params.call || await getProviderKey(fallback.provider));
    try {
      // 格式不兼容时改用自然语言请求；依然是完整响应，绝不逐字输出。
      const second = await worldChat({
        ...request,
        jsonMode: false,
        maxTokens: 800,
        model: canFallback && fallback ? { provider: fallback.provider, id: fallback.id } : primary,
        messages: [
          ...request.messages,
          { role: 'user', content: '上一轮未得到可用正文。现在直接给出这个角色的一小段台词或动作，不要 JSON、解释、分析，也不要替用户行动。' },
        ],
        // 兜底输出是自然语言正文：直接作为台词增量呈现
        ...(params.onPartial
          ? { onDelta: (accumulated: string) => params.onPartial?.({ dialogue: accumulated.trim() }) }
          : {}),
      }, params.call);
      const recovered = parseActorOutput(second.content ?? '', params.speaker.characterId);
      return { ...recovered, llmCalls: 2 };
    } catch {
      return { ...first, llmCalls: 2 };
    }
  } catch (err) {
    return { characterId: params.speaker.characterId, via: 'none', error: (err as Error)?.message ?? 'server:error', llmCalls: 1 };
  }
}

/**
 * 按 Director 的决定生成这一拍的全部角色内容。
 *
 * - `sequential=true`：逐个生成，后面的角色能看到前面的（真正的互动）
 * - `sequential=false`：并行生成，降低延迟（各自独立回应用户）
 *
 * 两种模式都**每个角色恰好 1 次调用**，不做"导演一次编完所有人对白"。
 */
export async function actWorldBeat(params: {
  ctx: WorldContext;
  speakers: TurnSpeaker[];
  userText: string;
  userAction?: string;
  sequential: boolean;
  worldChanges?: string[];
  /** 流式增量（星域呈现用）：带角色 id，UI 按人渲染正在生成的内容 */
  onPartial?: (characterId: string, partial: { dialogue?: string; action?: string }) => void;
  call?: WorldLlmCaller;
}): Promise<ActorBeat[]> {
  const { ctx, speakers } = params;
  if (speakers.length === 0) return [];

  if (!params.sequential) {
    return Promise.all(speakers.map((speaker) => actAsCharacter({
      ctx,
      speaker,
      userText: params.userText,
      ...(params.userAction ? { userAction: params.userAction } : {}),
      ...(params.worldChanges?.length ? { worldChanges: params.worldChanges } : {}),
      ...(params.onPartial ? { onPartial: (partial: { dialogue?: string; action?: string }) => params.onPartial?.(speaker.characterId, partial) } : {}),
      ...(params.call ? { call: params.call } : {}),
    })));
  }

  const beats: ActorBeat[] = [];
  for (const speaker of speakers) {
    const beat = await actAsCharacter({
      ctx,
      speaker,
      userText: params.userText,
      ...(params.userAction ? { userAction: params.userAction } : {}),
      priorBeats: beats.filter((b) => b.via !== 'none').map((b) => ({
        characterId: b.characterId,
        ...(b.dialogue ? { dialogue: b.dialogue } : {}),
        ...(b.action ? { action: b.action } : {}),
      })),
      ...(params.worldChanges?.length ? { worldChanges: params.worldChanges } : {}),
      ...(params.onPartial ? { onPartial: (partial: { dialogue?: string; action?: string }) => params.onPartial?.(speaker.characterId, partial) } : {}),
      ...(params.call ? { call: params.call } : {}),
    });
    beats.push(beat);
  }
  return beats;
}
