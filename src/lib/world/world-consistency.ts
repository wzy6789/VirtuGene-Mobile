/**
 * Consistency Guard（5.0.0 Living World §27）
 *
 * 重要轮次在角色输出之后做一次一致性检查。检查八件事：
 * 1. 是否泄露了 TA 不该知道的秘密
 * 2. 是否严重 OOC
 * 3. 是否违背世界规则
 * 4. 是否重复用户原话
 * 5. 是否突然创造不存在的重要事实
 * 6. 是否把人物搞错（张冠李戴）
 * 7. 是否时间 / 地点冲突
 * 8. 是否把旁白当成角色在说话
 *
 * 发现严重问题就**自动重写**，用户看不到这个过程。
 *
 * 成本纪律：**只在重要轮次调用**（有秘密在场 / 这一轮值得结算 / 涉及世界规则或修改事实）。
 * 普通寒暄不做守护——那会让每一轮都多花一次调用，而收益接近零。
 */
import { safeParseObject } from '../ai/safe-json';
import { worldChat, type WorldLlmCaller } from './world-ai-client';
import { renderGuardContext, type WorldContext } from './world-context';
import type { ActorBeat } from './world-actor';
import type { TurnPlan } from './world-director';
import type { WorldAction } from './world-actions';

export const GUARD_INSTRUCTION = `你是一致性守护者。检查下面这些角色的回应有没有严重问题。

只输出 JSON：
{"ok":true,"issues":["问题（一句话）"],"rewrites":[{"character":"角色名","dialogue":"改写后的话","action":"改写后的动作","drop":false}]}

要检查的问题（**只有严重到必须修的才报**）：
- 泄露了 TA 不该知道的秘密或别人的私事
- 严重 OOC（完全不像这个人）
- 违背已经确定的世界规则
- 原样复述用户的话
- 凭空创造重要的、此前不存在的事实（新地点、新人物、新世界规则）
- 人物搞错（把 A 的事安在 B 头上）
- 时间 / 地点与"此刻"冲突
- 旁白被当成某个角色在说话

要求：
- 没有问题就 ok=true、issues 与 rewrites 都留空数组。
- 不要为了"更好"而改写；只修真正的问题。措辞风格的小差异不算问题。
- 改写必须保持角色原本的意思和性格，只是把越界/错误的部分去掉或修正。
- 如果这条回应整体不可用，把 drop 设为 true。
- 不要输出 JSON 以外的任何文字。`;

export interface GuardResult {
  ok: boolean;
  issues: string[];
  rewrites: { characterId: string; dialogue?: string; action?: string; drop?: boolean }[];
  llmCalls: number;
  error?: string;
  /** 是否真的跑了这次守护（false = 这一轮不满足守护条件，0 次调用） */
  ran: boolean;
}

/** 这一轮值不值得守护 */
export function shouldGuard(params: { plan: TurnPlan; action: WorldAction; beats: ActorBeat[]; ctx: WorldContext }): boolean {
  const { plan, action, beats, ctx } = params;
  if (beats.length === 0) return false;
  if (ctx.secrets.length > 0) return true;
  if (plan.shouldSettle) return true;
  return ['world_rule', 'character_fact', 'retcon', 'time_skip'].includes(action.intent);
}

/** 把守护结果应用到实际内容上（**只修真正报出来的问题**） */
export function applyGuard(beats: ActorBeat[], rewrites: GuardResult['rewrites']): ActorBeat[] {
  if (rewrites.length === 0) return beats;
  const byId = new Map(rewrites.map((r) => [r.characterId, r]));
  const out: ActorBeat[] = [];
  for (const beat of beats) {
    const fix = byId.get(beat.characterId);
    if (!fix) {
      out.push(beat);
      continue;
    }
    if (fix.drop) continue;
    out.push({
      ...beat,
      ...(fix.dialogue != null ? { dialogue: fix.dialogue } : {}),
      ...(fix.action != null ? { action: fix.action } : {}),
    });
  }
  return out;
}

export interface GuardParams {
  ctx: WorldContext;
  plan: TurnPlan;
  action: WorldAction;
  beats: ActorBeat[];
  call?: WorldLlmCaller;
}

/** 一次守护调用（条件性） */
export async function guardWorldBeat(params: GuardParams): Promise<GuardResult> {
  const { ctx, plan, action, beats } = params;
  const empty: GuardResult = { ok: true, issues: [], rewrites: [], llmCalls: 0, ran: false };
  if (!shouldGuard(params)) return empty;

  const render = beats.map((b) => {
    const parts = [b.dialogue ? `说：${b.dialogue}` : '', b.action ? `动作：${b.action}` : ''].filter(Boolean).join('；');
    return `${ctx.nameOf(b.characterId)} —— ${parts || '（什么都没有）'}`;
  }).join('\n');

  const body = [
    `用户说的是：${params.action.raw}`,
    `这一句被理解为：${action.intent}`,
    plan.narration ? `这一拍的旁白：${plan.narration}` : '',
    plan.worldChanges.length ? `这一拍的世界变化：${plan.worldChanges.join('；')}` : '',
    `角色名单：${ctx.presence.map((id) => ctx.nameOf(id)).join('、')}（还有用户）`,
    `\n要检查的回应：\n${render}`,
  ].filter(Boolean).join('\n');

  try {
    const res = await worldChat({
      messages: [
        { role: 'system', content: `${GUARD_INSTRUCTION}\n\n${renderGuardContext(ctx)}` },
        { role: 'user', content: body },
      ],
      temperature: 0.1,
      disableThinking: true,
      jsonMode: true,
      maxTokens: 700,
      timeoutMs: 60_000,
    }, params.call);

    const parsed = safeParseObject(res.content);
    if (parsed.via === 'none') {
      // 守护失败**不会**让这一轮失败：宁可不修，也不能因为守护而丢掉角色的回应
      return { ...empty, llmCalls: 1, ran: true, error: '守护没有返回可用结果' };
    }
    const obj = parsed.value as Record<string, unknown>;
    const byName = new Map(ctx.presence.map((id) => [ctx.nameOf(id), id]));
    const byId = new Set(ctx.presence);
    const rewrites: GuardResult['rewrites'] = [];
    for (const item of Array.isArray(obj.rewrites) ? obj.rewrites : []) {
      const row = (item ?? {}) as Record<string, unknown>;
      const rawName = typeof row.character === 'string' ? row.character.trim() : '';
      const characterId = byId.has(rawName) ? rawName : byName.get(rawName);
      if (!characterId) continue;
      const dialogue = typeof row.dialogue === 'string' ? row.dialogue.trim().slice(0, 1200) : undefined;
      const actionText = typeof row.action === 'string' ? row.action.trim().slice(0, 600) : undefined;
      rewrites.push({
        characterId,
        ...(dialogue ? { dialogue } : {}),
        ...(actionText ? { action: actionText } : {}),
        ...(row.drop === true ? { drop: true } : {}),
      });
    }
    const issues = (Array.isArray(obj.issues) ? obj.issues : [])
      .map((x) => (typeof x === 'string' ? x.trim().slice(0, 200) : ''))
      .filter(Boolean);
    return {
      ok: obj.ok === true && rewrites.length === 0,
      issues,
      rewrites,
      llmCalls: 1,
      ran: true,
    };
  } catch (err) {
    return { ...empty, llmCalls: 1, ran: true, error: (err as Error)?.message ?? 'server:error' };
  }
}
