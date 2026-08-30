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
  '- 群成员的名字不能改，speaker 必须是下面列出的成员之一（用成员原名，不要加称呼/括号/编号）\n' +
  '- 每个成员都拥有和用户的共同记忆（列在成员信息里）。聊到相关话题时，**相关成员应像老朋友随口一提那样自然带出记忆**（例如用户提过的事、TA 知道的用户喜好）；不要生硬复述，也不要编造记忆里没有的内容\n' +
  '- 没有记忆的成员不要假装有共同经历\n' +
  '- 禁止用括号写动作描写（如（笑）（叹气））\n' +
  '输出要求（务必遵守）：\n' +
  '- **只输出 JSON 本身**：不要任何解释、前言、结尾、代码块标记（不要 ```json / ```）\n' +
  '- 格式必须是合法的 JSON 对象，turns 字段放一个数组，例如：\n' +
  '{"turns":[{"speaker":"林霜","content":"..."},{"speaker":"艾莉","content":"..."}]}';

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
      // 大提示词（多人设+记忆+历史）需要更高输出上限，防止 JSON 被截断成残缺片段
      maxTokens: 1500,
      timeoutMs: 90_000,
    });

    // 关键诊断日志：原始模型输出原样打到 console（Android 上 adb logcat 可查），
    // 无论是否成功都留痕，便于下次仍失败时精准定位是"格式"还是"发言人"问题。
    console.warn(`[group-chat] 模型输出(${model.id}${res.truncated ? '·截断' : ''}):`, res.content);

    const parsed = parseTurns(res.content, params.members);
    console.warn(
      `[group-chat] 解析: via=${parsed.via} turns=${parsed.turns.length} 未知发言人=${JSON.stringify(parsed.unknownSpeakers)}`,
    );

    if (parsed.turns.length > 0) {
      return { turns: parsed.turns };
    }
    // 细化失败原因（不再笼统"解析失败"）
    if (!res.content || !res.content.trim()) {
      return { turns: [], error: `模型返回为空（${model.label}）` };
    }
    if (res.truncated) {
      return { turns: [], error: `模型输出被截断，JSON 不完整（${model.label}）` };
    }
    if (parsed.unknownSpeakers.length > 0) {
      const names = [...new Set(parsed.unknownSpeakers)].slice(0, 3).join('、');
      return { turns: [], error: `模型已返回内容，但发言人不在群成员里：${names}（${model.label}）` };
    }
    return { turns: [], error: `模型返回内容无法解析为群聊回合（${model.label}）` };
  } catch (err) {
    const msg = (err as Error)?.message ?? '未知错误';
    return { turns: [], error: `${model.label}：${msg}` };
  }
}

/** 解析结果：turns + 诊断信息（未知发言人 / 解析途径） */
interface ParseOutcome {
  turns: GroupTurn[];
  /** JSON 里解析到了条目、但 speaker 不在群成员内的名字（用于精准报错） */
  unknownSpeakers: string[];
  /** 命中的解析途径：json-object / json-array / json-string / lines / none */
  via: string;
}

/**
 * 解析 AI 输出的群聊回合。依次尝试（覆盖 json_object 模式的所有常见输出形态）：
 * 1) 整文 JSON 对象（`{"turns":[...]}`，json_object 模式保证输出对象）→ 读 turns/messages/result 等键；
 *    兼容模型把数组包成 JSON 字符串（`{"result":"[...]"}`，需反转义）；
 * 2) 整文/提取的 JSON 数组（提示词可能被模型无视直接输出数组）；
 * 3) 单对象（{"speaker","content"}）；
 * 4) 行解析（"名字：内容"散文本兜底）。
 * speaker 硬校验 ∈ 群成员（精确 + 包含模糊）；命中不了的记录进 unknownSpeakers 而不是静默丢弃。
 */
function parseTurns(text: string, members: GroupMemberBrief[]): ParseOutcome {
  const byName = new Map(members.map((m) => [m.name, m.id]));
  const out: GroupTurn[] = [];
  const unknownSpeakers: string[] = [];

  const resolveId = (name: string): string | undefined => {
    const n = name.trim();
    let id = byName.get(n);
    if (!id) {
      // 模糊匹配：AI 可能带语气词/简称/前后缀（如「林霜：」），按包含关系再试
      for (const [memName, mid] of byName) {
        if (memName.includes(n) || n.includes(memName)) {
          id = mid;
          break;
        }
      }
    }
    return id;
  };

  const push = (speakerName: unknown, content: unknown): void => {
    const name = String(speakerName ?? '').trim();
    const c = String(content ?? '').trim();
    if (!name) {
      unknownSpeakers.push('(空名字)');
      return;
    }
    const senderId = resolveId(name);
    if (!senderId) {
      unknownSpeakers.push(name);
      return;
    }
    if (!c) return;
    if (out.length < 3) out.push({ senderId, content: stripRoleplayActions(c).slice(0, 500) });
  };

  /** 从数组条目里抽取（对象条目取 speaker/content/name；字符串条目按 "名字：内容" 拆） */
  const consumeItems = (items: unknown[]): boolean => {
    let any = false;
    for (const item of items.slice(0, 3)) {
      if (item && typeof item === 'object') {
        const it = item as Record<string, unknown>;
        if ('speaker' in it || 'name' in it || 'content' in it) {
          push(it.speaker ?? it.name, it.content);
          any = true;
        }
      } else if (typeof item === 'string') {
        const lm = item.match(/^[（(]?([^：:]{1,12})[）)]?[：:]\s*(.+)$/);
        if (lm) {
          push(lm[1], lm[2]);
          any = true;
        }
      }
    }
    return any;
  };

  /** 尝试把一段文本当 JSON 数组消费（含反转义后的片段） */
  const consumeArrayText = (chunk: string): boolean => {
    try {
      const arr = JSON.parse(chunk);
      if (Array.isArray(arr)) return consumeItems(arr);
    } catch {
      /* 忽略，继续 */
    }
    return false;
  };

  const text0 = text.trim();
  if (text0) {
    // 1) 整文 JSON 对象（json_object 模式的保证形态）
    try {
      const obj = JSON.parse(text0);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const o = obj as Record<string, unknown>;
        // 1a) 已知键（数组或 JSON 字符串数组）
        for (const key of ['turns', 'messages', 'result', 'data', 'response', 'output', 'replies', 'items']) {
          const v = o[key];
          if (Array.isArray(v)) {
            consumeItems(v);
            if (out.length > 0 || unknownSpeakers.length > 0) return { turns: out, unknownSpeakers, via: 'json-object' };
          } else if (typeof v === 'string' && v.trim()) {
            // 模型把数组转义成了 JSON 字符串（{"result":"[{\"speaker\"...}]"}）
            const inner = v.replace(/\\"/g, '"');
            if (consumeArrayText(inner)) {
              return { turns: out, unknownSpeakers, via: 'json-string' };
            }
          }
        }
        // 1b) 扫描任意数组值（模型可能用别的键名）
        for (const v of Object.values(o)) {
          if (Array.isArray(v)) {
            consumeItems(v);
            if (out.length > 0 || unknownSpeakers.length > 0) return { turns: out, unknownSpeakers, via: 'json-object' };
          }
        }
        // 1c) 对象本身是单条
        if ('speaker' in o || 'name' in o) {
          push(o.speaker ?? o.name, o.content);
          return { turns: out, unknownSpeakers, via: 'json-object' };
        }
      }
    } catch {
      /* 整文不是 JSON，继续 */
    }

    // 2) 提取 JSON 数组（可能被 ```json 或前后文字包裹）
    const arrM = text0.match(/\[[\s\S]*\]/);
    if (arrM && consumeArrayText(arrM[0])) {
      return { turns: out, unknownSpeakers, via: 'json-array' };
    }
    // 2b) 数组被转义（前面对象解析没兜住时）
    const escM = text0.match(/\\"\[[\s\S]*?\\"\]/);
    if (escM && consumeArrayText(escM[0].replace(/\\"/g, '"'))) {
      return { turns: out, unknownSpeakers, via: 'json-string' };
    }
  }

  // 3) 行解析兜底：模型输出散文本 "名字：内容"（防 AI 不守 JSON 规则）
  for (const line of text.split('\n')) {
    // 跳过 JSON 残片（{、"、[ 开头的行不是"名字：内容"），避免把残缺 JSON 当发言人报错
    const lt = line.trim();
    if (!lt || lt.startsWith('{') || lt.startsWith('[') || lt.startsWith('"')) continue;
    const lm = line.match(/^[（(]?([^：:]{1,12})[）)]?[：:]\s*(.+)$/);
    if (lm) push(lm[1], lm[2]);
    if (out.length >= 3) break;
  }
  if (out.length > 0) return { turns: out, unknownSpeakers, via: 'lines' };

  return { turns: out, unknownSpeakers: [...new Set(unknownSpeakers)], via: 'none' };
}
