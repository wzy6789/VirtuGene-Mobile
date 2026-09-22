/**
 * World Narrator（5.0.0 Living World §26）
 *
 * 旁白**不由角色生成**。世界需要一个能写"环境 / 动作 / 节奏 / 场面变化"的声音，
 * 而角色只能从自己的视角说话。
 *
 * 成本纪律：Narrator 是**条件性**阶段——
 * 只有当"这一拍确实需要一个画面"（换地点 / 天气氛围 / 时间跳跃 / 用户纯动作 / 修改事实）
 * **而且** Director 自己没给旁白时才调用一次。普通对话轮不会触发它。
 *
 * 内容纪律：Narrator **不写角色心理**（除非该心理是用户可感知的：表情、动作、语气）。
 */
import { safeParseObject, salvagePlainText } from '../ai/safe-json';
import { worldChat, type WorldLlmCaller } from './world-ai-client';
import { renderWorldBrief, type WorldContext } from './world-context';
import { extractPartialJsonString } from './world-actor';
import type { WorldAction } from './world-actions';

export const NARRATOR_INSTRUCTION = `你是一段共同生活里的旁白。只写**看得见、听得见**的东西。

只输出 JSON：{"narration":"一到两句旁白"}

规则：
1. 只写环境、天气、光线、声音、场面变化，以及角色**外在**的动作与神态。
2. **不要**写任何角色的内心想法、不要写"她其实在想……"。
3. **不要**替用户说话或行动。
4. 不要总结、不要抒情排比、不要用"仿佛""似乎"堆砌。短、具体、克制。
5. 不要输出 JSON 以外的任何文字。`;

export interface NarrateParams {
  ctx: WorldContext;
  action: WorldAction;
  userText: string;
  /** Director 已经给的这一拍走向（旁白要服务于它） */
  planSummary?: string;
  /** 流式增量（星域呈现用）：旁白正文的已产出前缀 */
  onPartial?: (text: string) => void;
  call?: WorldLlmCaller;
}

/** 什么情况下值得额外花一次调用请旁白（其余情况由 Director 的 narration 承担） */
export function shouldNarrate(action: WorldAction, hasDirectorNarration: boolean, speakerCount: number): boolean {
  if (hasDirectorNarration) return false;
  if (speakerCount > 0 && (action.intent === 'talk' || action.intent === 'character_interaction' || action.intent === 'freeform')) {
    return false;
  }
  return [
    'act', 'change_location', 'change_time', 'change_atmosphere',
    'time_skip', 'retcon', 'start_event', 'continue_event', 'dismiss', 'summon',
  ].includes(action.intent);
}

export interface NarrateResult {
  narration?: string;
  llmCalls: number;
  error?: string;
}

/** 一次旁白调用（条件性） */
export async function narrateWorldBeat(params: NarrateParams): Promise<NarrateResult> {
  const trigger = [
    `用户说的是：${params.userText}`,
    `这句话被理解为：${params.action.intent}`,
    params.action.locationChange ? `地点变成：${params.action.locationChange}` : '',
    params.action.atmosphereChange ? `气氛变成：${params.action.atmosphereChange}` : '',
    params.action.timeChange ? `时间变成：${params.action.timeChange}` : '',
    params.action.userAction ? `用户自己做了：${params.action.userAction}` : '',
    params.planSummary ? `这一拍的走向：${params.planSummary}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await worldChat({
      messages: [
        { role: 'system', content: `${NARRATOR_INSTRUCTION}\n\n${renderWorldBrief(params.ctx, 8)}` },
        { role: 'user', content: trigger },
      ],
      temperature: 0.85,
      disableThinking: true,
      jsonMode: true,
      maxTokens: 300,
      timeoutMs: 45_000,
      // 星域呈现：边生成边把旁白前缀吐给世界流（网关/验收通道自动静默）
      ...(params.onPartial
        ? {
          onDelta: (accumulated: string) => {
            const partial = extractPartialJsonString(accumulated, 'narration');
            if (partial) params.onPartial?.(partial);
          },
        }
        : {}),
    }, params.call);

    const parsed = safeParseObject(res.content);
    if (parsed.via !== 'none') {
      const value = (parsed.value as Record<string, unknown>).narration;
      const narration = typeof value === 'string' ? value.trim().slice(0, 400) : '';
      if (narration) return { narration, llmCalls: 1 };
    }
    const salvaged = salvagePlainText(res.content, 400);
    if (salvaged) return { narration: salvaged, llmCalls: 1 };
    return { llmCalls: 1, error: '旁白没有生成内容' };
  } catch (err) {
    return { llmCalls: 1, error: (err as Error)?.message ?? 'server:error' };
  }
}
