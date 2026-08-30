/**
 * 群聊消息生成（3.1.0）：
 * - 用户发消息 → 单次调用让 AI 决定"群里谁说话、说什么"（1~3 条，可互相接话）
 * - AI 输出 JSON 数组 [{"speaker":"角色名","content":"..."}]，speaker 硬校验必须在群成员内
 * - 非流式（项目铁律）；群聊用全局默认对话模型（成员各自模型 P1）
 */
import { resolveModel, getProviderKey, llmChat } from './llm';
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
  '严格输出 JSON 数组，不要任何额外文字：\n' +
  '[{"speaker":"角色名","content":"说的话"},{"speaker":"角色名","content":"说的话"}]';

export async function generateGroupTurn(params: {
  apiKey: string;
  groupName: string;
  members: GroupMemberBrief[];
  history: { senderName?: string; role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
}): Promise<GroupTurn[]> {
  const model = resolveModel(); // 群聊用全局默认模型
  const key = model.provider === 'deepseek' ? params.apiKey : await getProviderKey(model.provider);
  if (!key) throw new Error('auth:invalid_key');

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
    timeoutMs: 90_000,
  });

  return parseTurns(res.content, params.members);
}

/** 解析 AI 输出的 speaker 序列；硬校验 speaker ∈ 群成员，非法丢弃 */
function parseTurns(text: string, members: GroupMemberBrief[]): GroupTurn[] {
  const byName = new Map(members.map((m) => [m.name, m.id]));
  const out: GroupTurn[] = [];
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return out;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return out;
    for (const item of arr.slice(0, 3)) {
      const name = String(item?.speaker ?? '').trim();
      const content = String(item?.content ?? '').trim();
      const senderId = byName.get(name);
      if (!senderId || !content) continue;
      out.push({ senderId, content: stripRoleplayActions(content).slice(0, 500) });
    }
    return out;
  } catch {
    return out;
  }
}
