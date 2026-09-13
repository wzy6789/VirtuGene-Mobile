/**
 * World Intent Interpreter（5.0.0 Living World §13 / §14 / §22 Stage A）
 *
 * 用户输入的第一站。它**不生成任何表演内容**，只回答一个问题：
 * "这个人现在想对这个世界的做什么？"
 *
 * 三层判定（顺序固定，可核对）：
 *  1. `ruleInterpret`  本地规则，0 次调用 —— 只认语义完全无歧义的"撤销上一轮"
 *  2. 模型判定，1 次调用 —— 其余一切（含 retcon 这种需要上下文才能判断的）
 *  3. `fallbackInterpret` 关键词兜底 —— 模型不可用/解析失败时，绝不让用户面对报错（§14）
 *
 * 为什么撤销要走规则层：见 `world-actions.ts` 的说明。撤销是**唯一**一个
 * "慢一步判断就会造成真实损失"的操作，本地判定即可，且它不需要花一次调用。
 */
import type { Character, WorldSceneEntry } from '../../db/index';
import { safeParseObject } from '../ai/safe-json';
import { worldChat, type WorldLlmCaller } from './world-ai-client';
import {
  fallbackInterpret,
  normalizeWorldAction,
  ruleInterpret,
  WORLD_INTENT_LABEL,
  WORLD_INTENTS,
  type WorldAction,
} from './world-actions';
import { entryLine } from './world-context';

export interface InterpretParams {
  userId: string;
  worldId: string;
  /** 用户这一句话 */
  text: string;
  /** 世界里的全部角色（名字 → id 解析用） */
  characters: Character[];
  /** 当前在场角色 id */
  presence: string[];
  place: string;
  timeLabel: string;
  /** 已有的世界设定（长期规则）：让解析器知道"改设定"是在改哪一条（§101） */
  worldRules?: string[];
  /** 最近的世界流（用于判断"这句话在指什么"） */
  recent: WorldSceneEntry[];
  /** 可注入的 LLM 边界（验收用） */
  call?: WorldLlmCaller;
}

export interface InterpretResult {
  action: WorldAction;
  llmCalls: number;
  via: 'rule' | 'llm' | 'fallback';
  error?: string;
}

export const INTERPRETER_INSTRUCTION = `你是一个"世界意图解析器"。用户在一个和 AI 角色共同生活的世界里说话，你要判断**用户想对这个世界的做什么**。

只输出 JSON，形如：
{"intent":"talk","addressedCharacters":["角色名"],"userAction":"用户自己做的动作（可省略）","locationChange":"去哪里（可省略）","timeChange":"到什么时候（可省略）","atmosphereChange":"气氛变成什么（可省略）","worldFact":"要写进世界设定的那句话（可省略）","factCategory":"rule|location|atmosphere|character_fact|history","replacesFact":"这条新设定替换掉的旧设定原文（有才填，必须与已有设定一字不差）","recallTarget":"想回忆什么（可省略）","retconTarget":"被修正的世界事实（可省略）","requiresNarration":true,"requiresCharacterResponse":true,"silence":false}

intent 只能取以下之一：
- talk                   和角色说话 / 闲聊
- act                    用户自己做一件事
- summon                 让某个角色过来、加入
- dismiss                让某个角色离开
- character_interaction  让角色之间互相交流（"你们两个聊聊"）
- change_location        换地点
- change_time            换时间点（不跳跃）
- change_atmosphere      换氛围（"现在开始下雨"）
- world_rule             用户在**规定这个世界的长期规则**（"这里以后每年这个时候都会下雨"）
- character_fact         用户在**设定某个角色的长期事实**（"星遥讨厌下雨"）
- start_event / continue_event / pause_event   开始 / 继续 / 暂停一段事件
- end_topic              这个话题到此为止
- time_skip              直接跳过时间（"直接到第二天早上"）
- recall                 想回忆以前发生过的事
- retcon                 用户在**修改已经发生过的世界事实**（"其实我们从来没去过那里"）
- undo                   撤销上一轮
- direct_character       指定某个角色下一轮回应
- freeform               说不清 / 以上都不是

判断要点：
1. 用户是这个世界的最高权限者。当用户明确在陈述"世界是什么样"时，走 world_rule / character_fact；在修正"已经发生过的事"时，走 retcon。**不要**让角色反问"你为什么这么说"。
2. 分不清就填 freeform —— 这永远是正确的答案，不是失败。
3. 长期设定（world_rule / character_fact）与一次性变化（change_location / change_atmosphere）要分清："现在开始下雨"是一次性，"这里以后每年这个时候都会下雨"是长期规则。
   **如果这条新设定与下面列出的某条已有设定冲突，把那条已有设定原样抄进 replacesFact**（一字不差），否则不要填。
4. addressedCharacters / mentionedCharacters 只能填上面给你的角色名，不要编名字。
5. 只解析用户想做什么，**不要写任何角色台词、不要替角色做决定**。
6. 不要输出 JSON 以外的任何文字。`;

function presenceLine(params: InterpretParams): string {
  const nameOf = (id: string) => params.characters.find((c) => c.id === id)?.name ?? '某人';
  const present = params.presence.map(nameOf).join('、') || '没有别人';
  const all = params.characters.map((c) => c.name).join('、') || '（还没有角色）';
  const rules = params.worldRules?.length
    ? `\n已有的世界设定：\n${params.worldRules.map((r) => `- ${r}`).join('\n')}`
    : '\n已有的世界设定：（还没有）';
  return `此刻：${params.place} · ${params.timeLabel}\n在场：${present}\n世界里的角色：${all}${rules}`;
}

/**
 * 解析用户意图。返回值**永远是**一个可用的 WorldAction（绝不抛错）。
 */
export async function interpretWorldIntent(params: InterpretParams): Promise<InterpretResult> {
  const text = params.text.trim();
  if (!text) return { action: fallbackInterpret(''), llmCalls: 0, via: 'fallback' };

  const ruled = ruleInterpret(text);
  if (ruled) return { action: ruled, llmCalls: 0, via: 'rule' };

  const recentLines = params.recent.slice(0, 10).reverse().map((e) => entryLine(e, (id) => params.characters.find((c) => c.id === id)?.name ?? '某人'));
  const context = `${presenceLine(params)}\n\n最近这一刻：\n${recentLines.join('\n') || '（还没有内容）'}`;

  try {
    const res = await worldChat({
      messages: [
        { role: 'system', content: `${INTERPRETER_INSTRUCTION}\n\n可选 intent：${WORLD_INTENTS.map((i) => `${i}(${WORLD_INTENT_LABEL[i]})`).join(' ')}\n\n${context}` },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
      disableThinking: true,
      jsonMode: true,
      maxTokens: 400,
      timeoutMs: 45_000,
    }, params.call);

    const parsed = safeParseObject(res.content);
    if (parsed.via === 'none') {
      // 结构失败：不让整轮失败（§14），退到关键词兜底
      return { action: fallbackInterpret(text), llmCalls: 1, via: 'fallback', error: parsed.error };
    }
    return {
      action: normalizeWorldAction(parsed.value, text, params.characters, 'llm'),
      llmCalls: 1,
      via: 'llm',
    };
  } catch (err) {
    return {
      action: fallbackInterpret(text),
      llmCalls: 1,
      via: 'fallback',
      error: (err as Error)?.message ?? 'server:error',
    };
  }
}
