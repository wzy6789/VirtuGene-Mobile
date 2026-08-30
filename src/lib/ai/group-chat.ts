/**
 * 群聊消息生成（3.1.0）：
 * - 用户发消息 → 单次调用让 AI 决定"群里谁说话、说什么"（1~3 条，可互相接话）
 * - AI 输出 JSON 数组 [{"speaker":"角色名","content":"..."}]，speaker 硬校验必须在群成员内
 * - 非流式（项目铁律）；群聊用全局默认对话模型（成员各自模型 P1）
 */
import { resolveModel, getProviderKey, findModel, llmChat, type LLMModel } from './llm';
import { stripRoleplayActions } from './text';

export interface GroupMemberBrief {
  id: string;
  name: string;
  persona: string;
  /** 该成员与用户的共同记忆（单聊记忆摘要）；有值时群聊应自然提及 */
  memory?: string;
}

export interface GroupTurn {
  senderId: string;
  content: string;
}

const GROUP_INSTRUCTION =
  '这是一个微信式角色群聊。你是群聊的"编剧"，根据群成员的性格决定谁开口、说什么。规则：\n' +
  '- 像真人微信群：短句、口语、自然，不要长篇大论、不要分点、不要 Markdown\n' +
  '- 不是每人都必须说话：性格活泼/相关的人接话，高冷/无关的人可以沉默\n' +
  '- 角色之间可以互相接话、吐槽、拌嘴，但别自说自话刷屏\n' +
  '- 输出 1~3 条即可，最多 3 条；某角色回应后其他角色可补一句，也可以就此打住\n' +
  '- 群成员的名字不能改，speaker 必须是下面列出的成员之一\n' +
  '- 每个成员都拥有和用户的共同记忆（列在成员信息里）。聊到相关话题时，**相关成员应像老朋友随口一提那样自然带出记忆**（例如用户提过的事、TA 知道的用户喜好）；不要生硬复述，也不要编造记忆里没有的内容\n' +
  '- 没有记忆的成员不要假装有共同经历\n' +
  '- 禁止用括号写动作描写（如（笑）（叹气））\n' +
  '输出要求（务必遵守）：\n' +
  '- **只输出 JSON 数组本身**：不要任何解释、前言、结尾、代码块标记（不要 ```json / ```）\n' +
  '- 格式必须是合法的 JSON 数组，例如：\n' +
  '[{"speaker":"林霜","content":"..."},{"speaker":"艾莉","content":"..."}]';

export async function generateGroupTurn(params: {
  apiKey: string;
  groupName: string;
  members: GroupMemberBrief[];
  history: { senderName?: string; role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
}): Promise<{ turns: GroupTurn[]; error?: string }> {
  // 群聊用全局默认模型；失败/空结果自动切 deepseek-v4-flash 兜底重试一次
  const model = resolveModel();
  const fallback = findModel('deepseek-v4-flash')!;

  const first = await attemptTurn(params, model);
  if (first.turns.length > 0) return first;

  // 默认模型失败 → 兜底 flash（仅当不是同一个模型）
  if (model.id !== fallback.id) {
    const fb = await attemptTurn(params, fallback);
    if (fb.turns.length > 0) return fb;
    return { turns: [], error: `默认模型失败：${first.error ?? '未知'}；兜底模型也失败：${fb.error ?? '未知'}` };
  }
  return { turns: [], error: first.error ?? '生成结果为空' };
}

/** 用指定模型生成一次群聊回合；返回 turns 与具体错误信息（供上层显示定位） */
async function attemptTurn(
  params: {
    apiKey: string;
    groupName: string;
    members: GroupMemberBrief[];
    history: { senderName?: string; role: 'user' | 'assistant'; content: string }[];
    userMessage: string;
  },
  model: LLMModel,
): Promise<{ turns: GroupTurn[]; error?: string }> {
  try {
    const key = model.provider === 'deepseek' ? params.apiKey : await getProviderKey(model.provider);
    if (!key) throw new Error('auth:invalid_key（未配置该服务商 Key）');

    const membersDesc = params.members
      .map((m) => {
        const mem = m.memory ? `\n　· 与用户的共同记忆：${m.memory}` : '';
        return `${m.name}：${m.persona}${mem}`;
      })
      .join('\n');
    const history = params.history.slice(-16).map((h) => ({
      role: h.role,
      content: h.senderName ? `${h.senderName}：${h.content}` : h.content,
    }));

    const res = await llmChat({
      provider: model.provider,
      model: model.id,
      apiKey: key,
      messages: [
        { role: 'system', content: GROUP_INSTRUCTION + '\n\n群成员：\n' + membersDesc },
        ...history,
        { role: 'user', content: `（用户发来消息）${params.userMessage}\n请决定群里谁回应、说什么。` },
      ],
      temperature: 0.9,
      // 群聊是结构化 JSON 输出：关闭思考 + 强制 JSON（防散文本 + 提速）
      disableThinking: true,
      jsonMode: true,
      timeoutMs: 90_000,
    });

    const turns = parseTurns(res.content, params.members);
    if (turns.length === 0) {
      return { turns, error: `模型返回内容解析失败（${model.label}）` };
    }
    return { turns };
  } catch (err) {
    const msg = (err as Error)?.message ?? '未知错误';
    return { turns: [], error: `${model.label}：${msg}` };
  }
}

/** 解析 AI 输出的 speaker 序列；依次尝试 JSON 数组 → 单对象 → 行解析（"名字：内容"），硬校验 speaker ∈ 群成员 */
function parseTurns(text: string, members: GroupMemberBrief[]): GroupTurn[] {
  const byName = new Map(members.map((m) => [m.name, m.id]));
  const out: GroupTurn[] = [];

  const resolveId = (name: string): string | undefined => {
    let id = byName.get(name);
    if (!id) {
      // 模糊匹配：AI 可能带语气词/简称/前后缀（如「林霜：」），按包含关系再试
      for (const [memName, mid] of byName) {
        if (memName.includes(name) || name.includes(memName)) {
          id = mid;
          break;
        }
      }
    }
    return id;
  };

  const push = (speakerName: string, content: string): boolean => {
    const name = speakerName.trim();
    const c = content.trim();
    const senderId = resolveId(name);
    if (!senderId || !c) return false;
    if (out.length >= 3) return true;
    out.push({ senderId, content: stripRoleplayActions(c).slice(0, 500) });
    return true;
  };

  try {
    // 1) JSON 数组（可能被 ```json 或前后文字包裹）
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const arr = JSON.parse(m[0]);
        if (Array.isArray(arr)) {
          for (const item of arr.slice(0, 3)) {
            push(String(item?.speaker ?? ''), String(item?.content ?? ''));
          }
          return out;
        }
      } catch {
        /* 数组解析失败，继续 */
      }
    }
    // 2) 单对象兼容
    try {
      const obj = JSON.parse(m ? m[0] : text.trim());
      if (obj && typeof obj === 'object' && obj.speaker) {
        push(String(obj.speaker), String(obj.content));
        return out;
      }
    } catch {
      /* 无法解析，继续 */
    }
    // 3) 行解析兜底：模型输出散文本 "名字：内容"（防 AI 不守 JSON 规则）
    for (const line of text.split('\n')) {
      const lm = line.match(/^[（(]?([^：:]{1,12})[）)]?[：:]\s*(.+)$/);
      if (lm) push(lm[1], lm[2]);
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    return out;
  }
}
