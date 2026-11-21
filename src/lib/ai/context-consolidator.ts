import { taskChat, taskUsesGateway } from './task-client';
import { gatewayChat } from './gateway';
import { boundAuxiliaryHistory } from './history-window';

/**
 * 「对话后结算」合并调用：一次请求同时完成
 * 1) 长期记忆提取（关于用户的关键事实，带消息依据）
 * 2) AI 角色情绪六维分析
 * 3) 未完成事件提取（说好了但还没做完的事）
 *
 * 相比此前「每 3 条情绪分析 + 每 10 条记忆提取」的两次独立调用，减少额外 API 消耗；
 * 4.0 的生命连续性也复用这一次调用，绝不为了「未完成事件」再发一次请求。
 */
const CONTEXT_SETTLE_PROMPT =
  '你是 VirtuGene 的「灵魂状态读取器」。给定一段对话（每行开头的 [n] 是该条消息的编号），' +
  '你需要完成四件事，并严格输出一个 JSON 对象：\n' +
  '{\n' +
  '  "memories": [{"content": string, "evidence": number[]}],\n' +
  '  "threads": [{"action": "create"|"complete", "targetId": string|null, "kind": "promise"|"plan"|"topic"|"conflict"|"reminder", "title": string, "detail": string, "dueAt": string|null, "evidence": number[]}],\n' +
  '  "valence": number, "arousal": number, "intimacy": number, "engagement": number, "expressiveness": number, "stability": number,\n' +
  '  "dominantEmotion": string,\n' +
  '  "userEmotion": string,\n' +
  '  "summary": string\n' +
  '}\n\n' +
  '规则1（记忆提取）：只提取用户明确陈述、值得跨会话延续的事实、偏好、更正、重要经历及已确认的约定；共同经历的结果也须有用户明确确认。角色自己的近况、回忆、猜测及单方面承诺不列入用户记忆；用户对其真实性的追问也不是确认。每条简洁、保留对象、时间和范围，不记录寒暄、重复内容、引用、假设或创作中的事件为已发生事实；用户更正要覆盖旧说法。没有值得记忆的内容时返回空数组 []。\n' +
  'evidence 是「支持这条记忆」的消息编号数组（行首 [n] 里的数字），只能引用用户原话，且每个编号必须真实存在；找不到依据就写 []。角色回复可用于情绪分析和理解对话，但不作为用户事实或事项结论的依据，不混入 evidence，不编造或借用无关编号。\n\n' +
  '规则2（未完成事件）：只提取对话里**明确出现**的、还没有做完的事，最多 3 条：\n' +
  '- promise=一方答应对方要做的事；plan=说好要一起做但还没做的事；topic=聊到一半、明确说了"下次再聊/回头说"的话题；conflict=明确的不愉快或分歧且尚未和解；reminder=明确约定要在某个时间点记得的事。\n' +
  '- 每条要有具体的 title（不超过 24 字，写清是什么事，不要写"他们聊了天"这类空话）。\n' +
  '- dueAt 只有对话里明确提到时间才填 "YYYY-MM-DD"，否则为 null；不要猜时间。\n' +
  '- action=create 表示新建；action=complete 表示对话里明确显示这件事**已经完成/已经说清/已经和解**（例如"我昨天已经去了""那件事解决了"），此时 title 要能与原来的事对上。\n' +
  '- 寒暄、日常闲聊、单纯的情绪表达、已经当场完成的小事，一律不要提取。没有就返回 []，拿不准也返回 []。\n' +
  '- evidence 同上：只能引用用户原话中明确说明或确认的事项；角色单方面说会做、已做或希望一起做，不证明用户同意、事情已安排或已经完成。\n\n' +
  '规则3（情绪分析）：分析对话中 AI 角色（role=assistant）消息体现的情绪状态，6 个维度各 1-10 分（允许小数）：valence=愉悦度、arousal=唤醒度、intimacy=亲密度、engagement=投入度、expressiveness=外显度、stability=稳定度。只依据 AI 角色的消息判断，忽略 user 消息。dominantEmotion 用 2-5 字中文短语概括 AI 角色情绪（如"平静满足""焦虑不安""愉悦放松"），summary 用 1-2 句话总结 AI 角色情绪状态。\n\n' +
  '规则4（用户情绪感知）：根据对话中用户（role=user）消息的语气与内容，用 2-5 字中文短语概括用户此刻的情绪（如"开心""低落""焦虑""平静""疲惫""兴奋"）。若对话太短无法判断，返回"平静"。\n\n' +
  '严格按 JSON 输出，不要添加任何解释文字或 Markdown 代码块。';

export interface ContextSettleParams {
  apiKey: string;
  history: { role: string; content: string }[];
  characterName: string;
  continuity?:{id:string;title:string;kind:ContinuityActionKind;dueAt?:number;status:string}[];
}

export interface SettledMemory {
  content: string;
  /** 依据的消息编号（对应传入 history 的下标），找不到依据时为空数组 */
  evidence: number[];
}

export type ContinuityActionKind = 'promise' | 'plan' | 'topic' | 'conflict' | 'reminder';

export interface SettledThread {
  action: 'create' | 'complete';
  targetId?:string;
  kind: ContinuityActionKind;
  title: string;
  detail?: string;
  /** 明确提到的时间点（时间戳）；没提就是 undefined */
  dueAt?: number;
  evidence: number[];
}

export interface ContextSettleResult {
  memories?: SettledMemory[];
  threads?: SettledThread[];
  dimensions?: {
    valence: number;
    arousal: number;
    intimacy: number;
    engagement: number;
    expressiveness: number;
    stability: number;
  };
  dominantEmotion?: string;
  userEmotion?: string;
  summary?: string;
  error?: string;
}

const THREAD_KINDS: ContinuityActionKind[] = ['promise', 'plan', 'topic', 'conflict', 'reminder'];

export async function consolidateContext(params: ContextSettleParams): Promise<ContextSettleResult> {
  const { apiKey, characterName } = params;
  const history = boundAuxiliaryHistory(params.history);
  const inventory=(Array.isArray(params.continuity)?params.continuity:[]).slice(0,8).filter(row=>row&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=160&&typeof row.title==='string'&&row.title.length<=60&&THREAD_KINDS.includes(row.kind)&&['open','archived'].includes(row.status)).map(({id,title,kind,dueAt,status})=>({id,title,kind,status,dueAt:typeof dueAt==='number'&&Number.isFinite(new Date(dueAt).getTime())?new Date(dueAt).toISOString():null}));
  const systemPrompt=CONTEXT_SETTLE_PROMPT+(inventory.length?'\n[已存在的事项]\n'+JSON.stringify(inventory)+'\n同一事项的更新或完成填写其原有targetId；同名不同日期分别处理，不猜对象。create可带targetId更新仍开放的同一项；真正新事项targetId为null。ID只作定位，结论仍需本轮用户原话evidence；列表本身不证明事情已完成。\n[/已存在的事项]':'');

  const contextNote = characterName
    ? `用户正在与名为"${characterName}"的AI角色对话。`
    : '';

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content:
        `${contextNote}请分析以下对话，输出记忆、未完成事件与情绪 JSON：\n\n` +
        history.map((m, i) => `[${i}] ${m.role}: ${m.content}`).join('\n'),
    },
  ];

  // 与聊天及情绪分析保持一致：登录了 VirtuGene 网关但没有本地 Key 时，
  // 结算也走网关，避免“聊天能用、结算却显示链接中断”。
  if (taskUsesGateway(apiKey)) return settleViaGateway('请根据上面的带编号对话完成结算，并严格输出 JSON。', history,systemPrompt);

  try {
    const result = await taskChat({ apiKey, messages, maxTokens: 1600, temperature: .3, jsonMode: true, disableThinking: true, timeoutMs: 30_000 });
    const text = result.content;
    const parsed = parseSettleJSON(text, history);
    if (parsed.error === 'server:error' && taskUsesGateway('')) return settleViaGateway('请根据上面的带编号对话完成结算，并严格输出 JSON。', history,systemPrompt);
    return parsed;
  } catch (error) {
    if (error instanceof Error && ['auth:invalid_key', 'billing:insufficient', 'rate:limited'].includes(error.message)) return { error: error.message };
    if (taskUsesGateway('')) return settleViaGateway('请根据上面的带编号对话完成结算，并严格输出 JSON。', history,systemPrompt);
    return { error: 'server:error' };
  }
}

async function settleViaGateway(message: string, history: { role: string; content: string }[],systemPrompt=CONTEXT_SETTLE_PROMPT): Promise<ContextSettleResult> {
  try {
    const result = await gatewayChat({
      apiKey: '',
      systemPrompt,
      message,
      history: history.map((item, index) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: `[${index}] ${item.role}: ${item.content}`,
      })),
      temperature: 0.3,
      timeoutMs: 30_000,
    });
    return parseSettleJSON(result.content, history);
  } catch (error) {
    return { error: normalizeAiError(error) };
  }
}

function normalizeAiError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return ['auth:invalid_key', 'billing:insufficient', 'rate:limited', 'server:error', 'timeout'].includes(message)
    ? message
    : 'server:error';
}

function parseSettleJSON(text: string, history: {role:string}[]): ContextSettleResult {
  const clean = (s: string) => {
    let t = s.trim();
    if (t.startsWith('```')) {
      t = t.replace(/```json?/i, '').replace(/```/, '').trim();
    }
    return t;
  };

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(clean(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return { error: 'server:error' };
      }
    }
  }
  if (!parsed) return { error: 'server:error' };
  return validateResult(parsed, history);
}

/** Reject the whole dependent evidence list if any premise is ineligible. */
function sanitizeEvidence(value: unknown, history: {role:string}[]): number[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<number>();
  for (const item of value) {
    if(typeof item!=='number'||!Number.isInteger(item)||item<0||history[item]?.role!=='user')return [];
    out.add(item);
  }
  return [...out].sort((a, b) => a - b);
}

/** 只接受明确的、真实存在的 YYYY-MM-DD；模型给别的一律当作「没有时间」，绝不猜。 */
export function parseDueAt(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ts = new Date(year, month - 1, day, 12, 0, 0).getTime();
  if (Number.isNaN(ts)) return undefined;
  // 真实性校验：JS 的 Date 会把 2026-02-31 自动滚到 3 月 3 日，这里必须原样比对回来，
  // 否则未完成事项会挂上一个根本不存在的截止日。
  const parsed = new Date(ts);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return undefined;
  }
  // 明显不合理的年份（例如模型笔误）也不要
  const now = Date.now();
  if (ts < now - 365 * 86400000 || ts > now + 5 * 365 * 86400000) return undefined;
  return ts;
}

function validateResult(obj: Record<string, unknown>, history: {role:string}[]): ContextSettleResult {
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return isNaN(n) ? fallback : Math.max(1, Math.min(10, n));
  };

  const rawMemories = Array.isArray(obj.memories) ? obj.memories : [];
  const memories: SettledMemory[] = [];
  const seen = new Set<string>();
  for (const raw of rawMemories) {
    // 兼容旧格式（纯字符串）与新格式（带 evidence 的对象）
    const content = typeof raw === 'string'
      ? raw
      : (raw && typeof raw === 'object' && typeof (raw as { content?: unknown }).content === 'string'
        ? (raw as { content: string }).content
        : '');
    const trimmed = content.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    const evidence = raw && typeof raw === 'object'
      ? sanitizeEvidence((raw as { evidence?: unknown }).evidence, history)
      : [];
    memories.push({ content: trimmed, evidence });
    if (memories.length >= 20) break;
  }

  const rawThreads = Array.isArray(obj.threads) ? obj.threads : [];
  const threads: SettledThread[] = [];
  for (const raw of rawThreads) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 40) : '';
    if (!title) continue;
    const action = item.action === 'complete' ? 'complete' : 'create';
    if(item.targetId!==undefined&&item.targetId!==null&&(typeof item.targetId!=='string'||!item.targetId.trim()||item.targetId.length>160))continue;
    const kind = typeof item.kind === 'string' && (THREAD_KINDS as string[]).includes(item.kind)
      ? (item.kind as ContinuityActionKind)
      : 'topic';
    const dueAt = action === 'create' ? parseDueAt(item.dueAt) : undefined;
    threads.push({
      action,
      ...(typeof item.targetId==='string'?{targetId:item.targetId.trim()}:{}),
      kind,
      title,
      ...(typeof item.detail === 'string' && item.detail.trim() ? { detail: item.detail.trim().slice(0, 200) } : {}),
      ...(dueAt ? { dueAt } : {}),
      evidence: sanitizeEvidence(item.evidence, history),
    });
    if (threads.length >= 4) break;
  }

  return {
    memories,
    threads,
    dimensions: {
      valence: num(obj.valence, 5),
      arousal: num(obj.arousal, 5),
      intimacy: num(obj.intimacy, 5),
      engagement: num(obj.engagement, 5),
      expressiveness: num(obj.expressiveness, 5),
      stability: num(obj.stability, 5),
    },
    dominantEmotion: typeof obj.dominantEmotion === 'string' ? obj.dominantEmotion : '未知',
    userEmotion: typeof obj.userEmotion === 'string' ? obj.userEmotion : undefined,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}
