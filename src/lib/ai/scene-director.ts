/**
 * Scene Director（Phase 3 世界舞台）
 *
 * 规格（§56/§57，来自 5.0.0-AUDIT.md）：
 * 1. **一次调用出多条**：复用群聊那套"单次请求 → 多个角色发言 + 结构化 JSON + jsonMode 降级重试"的形态，
 *    绝不做"旁白一次 + 每角色一次 + 判定一次"（成本会乘 3~5 倍）。
 * 2. **只在用户在场时调用**：每一个用户动作先用 1 次调用；无效回复才追加备用模型调用；
 *    离开舞台不产生任何调用。
 * 3. **LLM 负责演，VirtuGene 负责记**：这里只产出"文本 + 少量建议值"（张力/新冲突/待落地后果）。
 *    真正的数据库真相（关系数值、共同记忆、认知归属）由 `scene-consequences.ts` 校验后再由我们写入。
 * 4. 结构化解析失败 → 去掉 response_format 重试一次；仍失败时切换到可用的备用大模型，
 *    所有模型都无法给出内容才**如实报错**，绝不编造内容。
 */
import { llmChat, getProviderKey } from './llm';
import { findModel, resolveModel, type LLMModel } from './llm';
import { safeParseObject } from './safe-json';
import { worldChat } from '../world/world-ai-client';
import { buildTimeContext } from '../chat-context';
import { validateChoiceOptions, MAX_ACTS, actLabel } from '../world/scene-acts';
import { buildConversationFocus } from '../world/user-profile';

/** 可注入的 LLM 边界（验收用；生产走 llmChat） */
export type SceneLlmCaller = typeof llmChat;

/** 舞台也走统一 AI 出口：有本地 Key 时 BYOK，没有时使用已登录网关。 */
async function sceneLlmChat(params: Parameters<typeof llmChat>[0]): Promise<Awaited<ReturnType<typeof llmChat>>> {
  // DeepSeek 的登录 Key 只用于 DeepSeek；其他供应商从各自的安全存储读取，
  // 避免模型切换时把一把错误的 Key 传给新供应商。
  const providerKey = params.provider === 'deepseek' ? params.apiKey?.trim() : await getProviderKey(params.provider);
  if (providerKey) return llmChat({ ...params, apiKey: providerKey });
  // 当前网关由 DeepSeek 提供商承载；没有本地 Key 时，其他提供商不能借网关冒充调用。
  // 直接返回鉴权错误，让场景兜底链路继续尝试下一个真正可用的模型。
  if (params.provider !== 'deepseek') throw new Error('auth:invalid_key');
  const result = await worldChat({
    messages: params.messages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.jsonMode ? { jsonMode: true } : {}),
    ...(params.disableThinking ? { disableThinking: true } : {}),
    ...(params.maxTokens != null ? { maxTokens: params.maxTokens } : {}),
    ...(params.timeoutMs != null ? { timeoutMs: params.timeoutMs } : {}),
    model: { provider: params.provider, id: params.model },
  });
  return result;
}

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
  /** 只由该角色自己的历史对话整理出的隐藏用户画像 */
  userProfile?: string;
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
  /** 当前模型没有给出可用结果时，是否由备用模型接住了这一轮。 */
  fallback?: boolean;
  modelId?: string;
  /** 这次结果实际尝试了几次 LLM 边界（兜底时可能大于 1）。 */
  llmCalls?: number;
}

/** 舞台专用模型顺序：稳定的 Flash 优先，随后是更强的 Pro，再尝试用户已配置的其他供应商。 */
const SCENE_MODEL_ORDER = ['deepseek-v4-flash', 'deepseek-v4-pro', 'qwen3.7-plus', 'mimo-v2.5'] as const;
function sceneModelChain(primary: LLMModel): LLMModel[] {
  const rest = SCENE_MODEL_ORDER
    .map((id) => findModel(id))
    .filter((candidate): candidate is LLMModel => candidate != null && candidate.id !== primary.id);
  return [primary, ...rest];
}

const SCENE_INSTRUCTION = `你是一个互动故事（World Stage）的导演，同时扮演场景中的角色。
输出要求：
1. **只输出 JSON**，形如：
{"entries":[{"kind":"narration","content":"……"},{"kind":"dialogue","speaker":"角色名","content":"……"}],"tension":0.4,"newConflict":"……","pendingConsequence":"……"}
2. entries 是这一轮呈现给用户的内容：narration 是旁白（环境、动作、气氛），dialogue 是某个角色说的话。
3. 每轮 2~4 条，**短**：旁白一两句，对白像真人说话；每句对白通常不超过 90 字，旁白通常不超过 140 字。不要长篇独白，不要总结。
4. 严格按每个角色的性格与目标行动；角色**只能知道** system 里告诉 TA 知道的事，绝不凭空知道其他角色的秘密。
5. 不要替用户说话、不要替用户做决定；用户没做的事不要写成发生了。
6. tension 是当前张力（0~1 的小数，可省略）；newConflict / pendingConsequence 只在真的出现时才给（人话一句，可省略）。
7. **偶尔**（不要每轮）可以给用户一个岔路口，让 TA 选择怎么做：
   {"kind":"choice","content":"你要怎么做？","options":["选项一","选项二"]}
   规则：选项 2~3 个、每个不超过 20 字、彼此明显不同、都能推动剧情；给了选项就**不要**再替用户写 TA 的动作。
8. 当前用户输入是本轮最高优先级；用户换话题时立刻顺着新话题，不要揪着旧冲突或同一件事反复追问。
9. 不要输出 JSON 以外的任何文字。`;

const SCENE_IMMERSION_NOTE = `
演出质感：这是一个有自己生活的世界，用户不是每句对白的中心。让在场角色在合适时彼此交谈、回应对方的动作或话题，用户没有发言时也可以自然推进。多角色输出必须按顺序排列，不要让两个角色像同时播报一样抢在一起。每句对白保持短小，动作要具体并符合这个角色的性格与当下位置，不要用空泛动作或长篇总结填充。用户画像只能微调回应的关注点和节奏，不能覆盖角色本身的性格、边界与说话方式；只推进一个小节拍，给用户留下接话空间。
`;

function trimNatural(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const boundary = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('…'));
  return boundary >= Math.floor(max * 0.55) ? head.slice(0, boundary + 1) : `${head.slice(0, max - 1)}…`;
}

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
    const rawContent = typeof e.content === 'string' ? e.content.trim() : '';
    if (!rawContent) continue;
    const kindRaw = e.kind;
    if (kindRaw === 'choice') {
      // 选择分支：选项必须合法，否则降级成旁白（**绝不出现"假选择"**：只有一个选项/空选项）
      const options = validateChoiceOptions(e.options);
      const content = trimNatural(rawContent, 180);
      if (options) entries.push({ kind: 'choice', content, options });
      else entries.push({ kind: 'narration', content });
      continue;
    }
    const kind = kindRaw === 'dialogue' ? 'dialogue' : 'narration';
    const content = trimNatural(rawContent, kind === 'dialogue' ? 180 : 260);
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

/** 一次调用 → 多条正文（§56）。先做格式降级，再按模型链兜底；全链路失败才返回 error。 */
export async function directSceneTurn(
  params: SceneDirectorParams,
  callLlm: SceneLlmCaller = sceneLlmChat,
): Promise<SceneDirectorResult> {
  const model: LLMModel = resolveModel();
  // DeepSeek 在 response_format=json_object + 关闭思考时偶尔会返回 200 但 content 为空。
  // 先用同一套 JSON 指令走普通响应，正常轮次只需一次调用；只有解析失败才启用强制 JSON 重试。
  const first = await attemptScene(params, model, callLlm, false);
  let llmCalls = first.llmCalls ?? 1;
  if (first.entries.length > 0) return first;
  // 普通响应无法解析 → 启用 response_format=json_object 重试
  const second = await attemptScene(params, model, callLlm, true);
  llmCalls += second.llmCalls ?? 1;
  if (second.entries.length > 0) return second;

  // 模型兜底：舞台比普通问答更不能停在空白处。切换一个稳定候选，
  // 避免一次点击在多个无 Key/慢模型上串行等待数分钟。
  // 这里不伪造正文，所有内容仍来自一次真实 LLM 调用。
  const fallbackModels = sceneModelChain(model).slice(1, 2);
  let lastFailure = second.error ?? first.error;
  for (const fallbackModel of fallbackModels) {
    const fallbackJson = await attemptScene(params, fallbackModel, callLlm, true);
    llmCalls += fallbackJson.llmCalls ?? 1;
    if (fallbackJson.entries.length > 0) return { ...fallbackJson, fallback: true, llmCalls };
    lastFailure = fallbackJson.error ?? lastFailure;
    const fallbackPlain = await attemptScene(params, fallbackModel, callLlm, false);
    llmCalls += fallbackPlain.llmCalls ?? 1;
    if (fallbackPlain.entries.length > 0) return { ...fallbackPlain, fallback: true, llmCalls };
    lastFailure = fallbackPlain.error ?? lastFailure;
  }

  return {
    entries: [],
    via: 'none',
    error: lastFailure ?? '场景生成失败',
    ...(second.raw ? { raw: second.raw } : first.raw ? { raw: first.raw } : {}),
    modelId: model.id,
    llmCalls,
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
        const profile = m.userProfile ? `\n　· 关于用户的隐藏参考（只用于自然回应）：${m.userProfile}` : '';
        return `${m.name}：${m.persona}${goal}${knows}${secret}${profile}`;
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
        { role: 'system', content: `${SCENE_INSTRUCTION}\n${SCENE_IMMERSION_NOTE}\n\n${buildConversationFocus(params.userAction ?? '', params.history.map((item) => ({ kind: item.kind, content: item.content })))}\n\n${stateLines}\n\n出场角色：\n${membersDesc}\n\n${buildTimeContext()}` },
        ...merged,
        { role: 'user', content: userBlock },
      ],
      temperature: 0.9,
      disableThinking: true,
      jsonMode,
      maxTokens: 1200,
      timeoutMs: 45_000,
    });

    const parsed = parseSceneOutput(res.content ?? '', params.members, maxEntries);
    if (parsed.entries.length === 0) {
      return {
        entries: [],
        via: 'none',
        error: res.truncated ? '模型输出被截断' : '模型没有返回可用的场景内容',
        raw: res.content ?? '',
        modelId: model.id,
        llmCalls: 1,
      };
    }
    return {
      entries: parsed.entries,
      ...(parsed.tension != null ? { tension: parsed.tension } : {}),
      ...(parsed.newConflict ? { newConflict: parsed.newConflict } : {}),
      ...(parsed.pendingConsequence ? { pendingConsequence: parsed.pendingConsequence } : {}),
      via: parsed.via,
      raw: res.content ?? '',
      modelId: model.id,
      llmCalls: 1,
    };
  } catch (err) {
    return { entries: [], via: 'none', error: (err as Error)?.message ?? '场景生成失败', modelId: model.id, llmCalls: 1 };
  }
}

/** 结算用的第二类调用：正常只发生一次，模型无效时按兜底链路追加尝试。 */
export async function proposeSceneSettlement(
  params: {
    apiKey: string;
    scene: { title: string; place: string; timeLabel: string; mood: string; theme?: string };
    memberNames: { characterId: string; name: string }[];
    transcript: string;
  },
  callLlm: SceneLlmCaller = sceneLlmChat,
): Promise<{ raw: string; error?: string; fallback?: boolean; modelId?: string; llmCalls: number }> {
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

  const flash = findModel('deepseek-v4-flash') ?? resolveModel();
  const models = sceneModelChain(flash);
  const messages = [
    { role: 'system', content: `${instruction}\n\n出场角色：${params.memberNames.map((m) => m.name).join('、')}（用户也在这场戏里）` },
    { role: 'user', content: `场景：${params.scene.title}（${params.scene.place} · ${params.scene.timeLabel}）\n\n正文：\n${params.transcript.slice(-6000)}` },
  ];
  let llmCalls = 0;
  let lastError = '结算没有返回可用内容';
  let rawForDiagnostics = '';
  for (const [index, model] of models.entries()) {
    try {
      const res = await callLlm({
        provider: model.provider,
        model: model.id,
        apiKey: params.apiKey,
        messages,
        temperature: 0.4,
        disableThinking: true,
        jsonMode: true,
        maxTokens: 1000,
        timeoutMs: 90_000,
      });
      llmCalls += 1;
      const raw = res.content?.trim() ?? '';
      if (raw && !rawForDiagnostics) rawForDiagnostics = raw;
      const parsed = safeParseObject<Record<string, unknown>>(raw);
      const value = parsed.value;
      const hasSignal = Boolean(
        value && (
          (typeof value.summary === 'string' && value.summary.trim()) ||
          (value.memory && typeof value.memory === 'object') ||
          (Array.isArray(value.relationshipChanges) && value.relationshipChanges.length > 0) ||
          (Array.isArray(value.unresolved) && value.unresolved.length > 0)
        ),
      );
      if (parsed.via !== 'none' && hasSignal) {
        return {
          raw,
          ...(index > 0 ? { fallback: true } : {}),
          modelId: model.id,
          llmCalls,
        };
      }
      lastError = raw ? '结算返回的内容无法解析' : (res.truncated ? '结算输出被截断' : '结算没有返回内容');
    } catch (err) {
      llmCalls += 1;
      lastError = (err as Error)?.message ?? '结算失败';
    }
  }
  return { raw: rawForDiagnostics, error: lastError, modelId: flash.id, llmCalls };
}
