/**
 * Scene Director（Phase 3 世界舞台）
 *
 * 规格（§56/§57，来自 5.0.0-AUDIT.md）：
 * 1. **一次调用出多条**：复用群聊那套"单次请求 → 多个角色发言 + 结构化 JSON + jsonMode 降级重试"的形态，
 *    绝不做"旁白一次 + 每角色一次 + 判定一次"（成本会乘 3~5 倍）。
 * 2. **只在用户在场时调用**：每一个用户动作 = 1 次调用；离开舞台不产生任何调用。
 * 3. **LLM 负责演，VirtuGene 负责记**：这里只产出"文本 + 少量建议值"（张力/新冲突/待落地后果）。
 *    真正的数据库真相（关系数值、共同记忆、认知归属）由 `scene-consequences.ts` 校验后再由我们写入。
 * 4. 结构化解析失败 → 去掉 response_format 重试一次；再失败就**如实报错**，绝不编造内容。
 */
import { llmChat } from './llm';
import { findModel, resolveModel, type LLMModel } from './llm';
import { buildTimeContext } from '../chat-context';
import { validateChoiceOptions, MAX_ACTS, actLabel } from '../world/scene-acts';

/** 可注入的 LLM 边界（验收用；生产走 llmChat） */
export type SceneLlmCaller = typeof llmChat;

export interface SceneDirectorMember {
  characterId: string;
  name: string;
  /** 人设（systemPrompt 摘要） */
  persona: string;
  /** TA 本场想要什么 */
  goal?: string;
  /** TA 已经知道的事（只读，防止凭空知道） */
  knows?: string;
  /** TA 本场隐瞒的事（不直接展示给用户） */
  secret?: string;
}

export interface SceneDirectorParams {
  apiKey: string;
  scene: { title: string; place: string; timeLabel: string; mood: string; theme?: string };
  state: {
    sceneGoal?: string;
    currentAct: number;
    currentTension: number;
    activeConflicts: string[];
    pendingConsequences: string[];
  };
  members: SceneDirectorMember[];
  /** 最近若干条正文（旁白/对白/用户动作），新的在后 */
  history: { kind: 'narration' | 'dialogue' | 'user_input'; speakerName?: string; content: string }[];
  /** 用户这一轮做了什么 / 说了什么；为空表示"让角色先开口" */
  userAction?: string;
  maxEntries?: number;
}

export interface SceneDirectorEntry {
  kind: 'narration' | 'dialogue' | 'choice';
  speakerId?: string;
  content: string;
  /** kind='choice' 时：2~3 个选项（由 validateChoiceOptions 校验过） */
  options?: string[];
}

export interface SceneDirectorResult {
  entries: SceneDirectorEntry[];
  /** 0~1；越界会被夹住，非法值直接忽略 */
  tension?: number;
  /** 本场新出现的冲突（人话，一句） */
  newConflict?: string;
  /** 已经发生、但后果尚未落地的变化（人话，一句） */
  pendingConsequence?: string;
  error?: string;
  /** 原始输出（诊断用，便于下次失败时定位是格式还是发言人问题） */
  raw?: string;
  via: 'json' | 'plain' | 'none';
}

const SCENE_INSTRUCTION = `你是一个互动故事（World Stage）的导演，同时扮演场景中的角色。
输出要求：
1. **只输出 JSON**，形如：
{"entries":[{"kind":"narration","content":"……"},{"kind":"dialogue","speaker":"角色名","content":"……"}],"tension":0.4,"newConflict":"……","pendingConsequence":"……"}
2. entries 是这一轮呈现给用户的内容：narration 是旁白（环境、动作、气氛），dialogue 是某个角色说的话。
3. 每轮 2~4 条，**短**：旁白一两句，对白像真人说话，不要长篇独白，不要总结。
4. 严格按每个角色的性格与目标行动；角色**只能知道** system 里告诉 TA 知道的事，绝不凭空知道其他角色的秘密。
5. 不要替用户说话、不要替用户做决定；用户没做的事不要写成发生了。
6. tension 是当前张力（0~1 的小数，可省略）；newConflict / pendingConsequence 只在真的出现时才给（人话一句，可省略）。
7. **偶尔**（不要每轮）可以给用户一个岔路口，让 TA 选择怎么做：
   {"kind":"choice","content":"你要怎么做？","options":["选项一","选项二"]}
   规则：选项 2~3 个、每个不超过 20 字、彼此明显不同、都能推动剧情；给了选项就**不要**再替用户写 TA 的动作。
8. 不要输出 JSON 以外的任何文字。`;

/** 导演输出的条目类型（解析后） */

/** 解析导演输出：宽容取 JSON（可能被包在 ```json 里），逐条校验，丢弃非法条目 */
export function parseSceneOutput(
  raw: string,
  members: SceneDirectorMember[],
  maxEntries = 4,
): { entries: SceneDirectorEntry[]; tension?: number; newConflict?: string; pendingConsequence?: string; via: 'json' | 'plain' | 'none'; unknownSpeakers: string[] } {
  const unknownSpeakers: string[] = [];
  const text = (raw ?? '').trim();
  if (!text) return { entries: [], via: 'none', unknownSpeakers };

  let data: unknown;
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    data = JSON.parse((fenced ? fenced[1] : text).trim());
  } catch {
    // 解析不出 JSON：**不猜**，如实返回空（由上层报错/重试）
    return { entries: [], via: 'none', unknownSpeakers };
  }

  const obj = (data ?? {}) as Record<string, unknown>;
  const byName = new Map(members.map((m) => [m.name.trim(), m.characterId]));
  const byId = new Set(members.map((m) => m.characterId));
  const entries: SceneDirectorEntry[] = [];
  const list = Array.isArray(obj.entries) ? obj.entries : [];
  for (const item of list) {
    if (entries.length >= maxEntries) break;
    const e = (item ?? {}) as Record<string, unknown>;
    const content = typeof e.content === 'string' ? e.content.trim().slice(0, 1200) : '';
    if (!content) continue;
    const kindRaw = e.kind;
    if (kindRaw === 'choice') {
      // 选择分支：选项必须合法，否则降级成旁白（**绝不出现"假选择"**：只有一个选项/空选项）
      const options = validateChoiceOptions(e.options);
      if (options) entries.push({ kind: 'choice', content, options });
      else entries.push({ kind: 'narration', content });
      continue;
    }
    const kind = kindRaw === 'dialogue' ? 'dialogue' : 'narration';
    if (kind === 'narration') {
      entries.push({ kind, content });
      continue;
    }
    const speakerRaw = typeof e.speaker === 'string' ? e.speaker.trim() : '';
    const speakerId = byId.has(speakerRaw) ? speakerRaw : byName.get(speakerRaw);
    if (!speakerId) {
      // 未知发言人：**丢弃这一条**（绝不"随便安在某个角色头上"）
      unknownSpeakers.push(speakerRaw || '(空)');
      continue;
    }
    entries.push({ kind, speakerId, content });
  }

  const pickString = (v: unknown, max: number): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : undefined;
  };
  const tensionRaw = typeof obj.tension === 'number' ? obj.tension : Number.NaN;
  const tension = Number.isFinite(tensionRaw) ? Math.max(0, Math.min(1, tensionRaw)) : undefined;

  return {
    entries,
    ...(tension != null ? { tension } : {}),
    ...(pickString(obj.newConflict, 120) ? { newConflict: pickString(obj.newConflict, 120)! } : {}),
    ...(pickString(obj.pendingConsequence, 160) ? { pendingConsequence: pickString(obj.pendingConsequence, 160)! } : {}),
    via: entries.length > 0 ? 'json' : 'none',
    unknownSpeakers,
  };
}

/** 一次调用 → 多条正文（§56）。失败会降级重试一次，再失败如实返回 error。 */
export async function directSceneTurn(
  params: SceneDirectorParams,
  callLlm: SceneLlmCaller = llmChat,
): Promise<SceneDirectorResult> {
  const model: LLMModel = resolveModel();
  const first = await attemptScene(params, model, callLlm, true);
  if (first.entries.length > 0) return first;
  // jsonMode 失败（DeepSeek 在 json_object + 关思考组合下曾返回 200+空内容）→ 去掉 response_format 重试
  const second = await attemptScene(params, model, callLlm, false);
  if (second.entries.length > 0) return second;
  return {
    entries: [],
    via: 'none',
    error: second.error ?? first.error ?? '场景生成失败',
    ...(first.raw ? { raw: first.raw } : {}),
  };
}

async function attemptScene(
  params: SceneDirectorParams,
  model: LLMModel,
  callLlm: SceneLlmCaller,
  jsonMode: boolean,
): Promise<SceneDirectorResult> {
  const maxEntries = Math.max(1, params.maxEntries ?? 4);
  try {
    const membersDesc = params.members
      .map((m) => {
        const goal = m.goal ? `\n　· 本场目标：${m.goal}` : '';
        const knows = m.knows ? `\n　· TA 已经知道：${m.knows}` : '';
        const secret = m.secret ? `\n　· TA 隐瞒着（其他人不知道）：${m.secret}` : '';
        return `${m.name}：${m.persona}${goal}${knows}${secret}`;
      })
      .join('\n');

    const stateLines = [
      `场景：${params.scene.title}（${params.scene.place} · ${params.scene.timeLabel} · 气氛：${params.scene.mood}）`,
      params.scene.theme ? `主题：${params.scene.theme}` : '',
      params.state.sceneGoal ? `本场目标：${params.state.sceneGoal}` : '',
      `现在是 ${actLabel(params.state.currentAct)}（这一场最多 ${MAX_ACTS} 幕）；当前张力约 ${params.state.currentTension.toFixed(2)}`,
      params.state.activeConflicts.length > 0 ? `已经存在的冲突：${params.state.activeConflicts.join('；')}` : '',
      params.state.pendingConsequences.length > 0 ? `尚未落地的后果：${params.state.pendingConsequences.join('；')}` : '',
    ].filter(Boolean).join('\n');

    const history = params.history.slice(-12).map((h) => ({
      role: h.kind === 'user_input' ? 'user' : 'assistant',
      content:
        h.kind === 'narration'
          ? `（旁白）${h.content}`
          : h.kind === 'user_input'
            ? `（用户）${h.content}`
            : `${h.speakerName ?? '某人'}：${h.content}`,
    }));
    // 群聊同款修复：连续同 role 会被 DeepSeek 判成异常格式（200+空内容）→ 合并保证交替
    const merged: { role: string; content: string }[] = [];
    for (const h of history) {
      const last = merged[merged.length - 1];
      if (last && last.role === h.role) last.content += '\n' + h.content;
      else merged.push({ ...h });
    }

    const userBlock = params.userAction
      ? `（用户刚刚：${params.userAction}）\n请继续这一场戏。`
      : '（场景刚刚开始，还没有人说话。请让角色自然地开口，或先用一句旁白给出画面。）';

    const res = await callLlm({
      provider: model.provider,
      model: model.id,
      apiKey: params.apiKey,
      messages: [
        { role: 'system', content: `${SCENE_INSTRUCTION}\n\n${stateLines}\n\n出场角色：\n${membersDesc}\n\n${buildTimeContext()}` },
        ...merged,
        { role: 'user', content: userBlock },
      ],
      temperature: 0.9,
      disableThinking: true,
      jsonMode,
      maxTokens: 1200,
      timeoutMs: 90_000,
    });

    const parsed = parseSceneOutput(res.content ?? '', params.members, maxEntries);
    if (parsed.entries.length === 0) {
      return { entries: [], via: 'none', error: res.truncated ? '模型输出被截断' : '模型没有返回可用的场景内容', raw: res.content ?? '' };
    }
    return {
      entries: parsed.entries,
      ...(parsed.tension != null ? { tension: parsed.tension } : {}),
      ...(parsed.newConflict ? { newConflict: parsed.newConflict } : {}),
      ...(parsed.pendingConsequence ? { pendingConsequence: parsed.pendingConsequence } : {}),
      via: parsed.via,
      raw: res.content ?? '',
    };
  } catch (err) {
    return { entries: [], via: 'none', error: (err as Error)?.message ?? '场景生成失败' };
  }
}

/** 结算用的第二类调用：**只在一场戏结束时发生一次**，产出结构化"后果建议" */
export async function proposeSceneSettlement(
  params: {
    apiKey: string;
    scene: { title: string; place: string; timeLabel: string; mood: string; theme?: string };
    memberNames: { characterId: string; name: string }[];
    transcript: string;
  },
  callLlm: SceneLlmCaller = llmChat,
): Promise<{ raw: string; error?: string }> {
  const instruction = `你是一段互动故事的记录者。请阅读这场戏的正文，输出**只包含 JSON** 的结算建议：
{"summary":"这场戏发生了什么（一句话，给年表用）",
 "memory":{"title":"值得两个人一起记住的一件事（一句话）","summary":"细节（可省略）"},
 "relationshipChanges":[{"a":"角色名或「用户」","b":"角色名或「用户」","facets":{"trust":3,"conflict":-2},"reason":"为什么变了（人话，一句）"}],
 "unresolved":[{"who":"角色名","kind":"promise|plan|topic|conflict|reminder","title":"还没做完/没说清的一件事"}]}
要求：
- 只写**正文里真的发生过**的事；没有就留空数组或省略字段，不要编造。
- facets 只允许 trust / dependency / conflict / familiarity（0~100 区间内的**增量**，-10~10 之间），不要写 affinity。
- 每条 relationshipChanges 必须带 reason；没有原因的不要写。
- 不要输出 JSON 以外的任何文字。`;

  try {
    const model = findModel('deepseek-v4-flash') ?? resolveModel();
    const res = await callLlm({
      provider: model.provider,
      model: model.id,
      apiKey: params.apiKey,
      messages: [
        { role: 'system', content: `${instruction}\n\n出场角色：${params.memberNames.map((m) => m.name).join('、')}（用户也在这场戏里）` },
        { role: 'user', content: `场景：${params.scene.title}（${params.scene.place} · ${params.scene.timeLabel}）\n\n正文：\n${params.transcript.slice(-6000)}` },
      ],
      temperature: 0.4,
      disableThinking: true,
      jsonMode: true,
      maxTokens: 1000,
      timeoutMs: 90_000,
    });
    if (!res.content?.trim()) return { raw: '', error: '结算没有返回内容' };
    return { raw: res.content };
  } catch (err) {
    return { raw: '', error: (err as Error)?.message ?? '结算失败' };
  }
}
