/**
 * 群聊消息生成（3.1.0）：
 * - 用户发消息 → 单次调用让 AI 决定"群里谁说话、说什么"（1~3 条，可互相接话）
 * - AI 输出 JSON 数组 [{"speaker":"角色名","content":"..."}]，speaker 硬校验必须在群成员内
 * - 非流式（项目铁律）；群聊用全局默认对话模型（成员各自模型 P1）
 */
import { resolveModel, getProviderKey, findModel, llmChat, type LLMModel, type LLMChatResult } from './llm';
import { stripRoleplayActions } from './text';

export interface GroupMemberBrief {
  id: string;
  name: string;
  persona: string;
  /** 该成员与用户的共同记忆（单聊记忆摘要）；有值时群聊应自然提及 */
  memory?: string;
  /** 该成员与用户的最近私聊记录（最新单聊会话最后几条原话）；有值时群聊可自然承接 */
  privateChat?: string;
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
  '- **每条 content 只能是一个人的话**：想让多个角色说话就输出多条 JSON（每条约 1~2 句），**严禁把不同角色的发言写进同一条 content**（content 里不要出现"艾莉：…"这种前缀）\n' +
  '- 群成员的名字不能改，speaker 必须是下面列出的成员之一（用成员原名，不要加称呼/括号/编号）\n' +
  '- 每个成员都拥有和用户的共同记忆（列在成员信息里）。聊到相关话题时，**相关成员应像老朋友随口一提那样自然带出记忆**（例如用户提过的事、TA 知道的用户喜好）；不要生硬复述，也不要编造记忆里没有的内容\n' +
  '- 成员的"最近私聊记录"是 TA 刚刚和用户私下聊过的内容（列在成员信息里）。相关成员可以自然承接私聊话题（比如用户私下说过的事，TA 在群里可以接话/回应）；**不要整段复述私聊记录**\n' +
  '- **私聊是私密的：每个成员只知道 TA 自己的私聊记录，不知道别人的。** 只有某成员自己私下和用户聊过的事，才由 TA 在群里说出来；其他成员不该表现出知道（除非 TA 在群里说了）\n' +
  '- 没有记忆的成员不要假装有共同经历\n' +
  '- 禁止用括号写动作描写（如（笑）（叹气））\n' +
  '输出要求（务必遵守）：\n' +
  '- **只输出 JSON 本身**：不要任何解释、前言、结尾、代码块标记（不要 ```json / ```）\n' +
  '- 格式必须是合法的 JSON 对象，turns 字段放一个数组，例如：\n' +
  '{"turns":[{"speaker":"林霜","content":"..."},{"speaker":"艾莉","content":"..."}]}';

export interface GroupTurnParams {
  apiKey: string;
  groupName: string;
  members: GroupMemberBrief[];
  history: { senderName?: string; role: 'user' | 'assistant'; content: string }[];
  userMessage?: string;
  /** 用户 @ 的成员名（有值时被 @ 者必须回应） */
  atMembers?: string[];
  /** 当前消息附带图片（压缩 dataURL；有值时本回合用视觉模型看图） */
  image?: string;
  /** 群聊背景摘要（较早对话的压缩文本） */
  summary?: string;
  /** 回合模式：user=用户发消息；proactive=成员主动开口（用户没说话） */
  mode?: 'user' | 'proactive';
  /** 本轮最多输出条数（默认 3；热闹模式传 5，提示词同步强调短句控量省 token） */
  maxTurns?: number;
}

export async function generateGroupTurn(params: GroupTurnParams): Promise<{ turns: GroupTurn[]; error?: string }> {
  // 图片回合 → DeepSeek 视觉模型看图；否则用全局默认模型；失败/空结果自动切 deepseek-v4-flash 兜底一次
  const model = params.image ? findModel('deepseek-v4-flash-vision-exp')! : resolveModel();
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

/** 用指定模型生成一次群聊回合；返回 turns 与具体错误信息（供上层显示定位）。
 *  jsonMode=true 时走 response_format 强制 JSON；若该形态失败（空内容/无法解析），
 *  自动去掉 response_format 重试一次——DeepSeek 在 json_object + 关思考组合下曾返回 200+空内容。 */
async function attemptTurn(
  params: GroupTurnParams,
  model: LLMModel,
  jsonMode = true,
): Promise<{ turns: GroupTurn[]; error?: string }> {
  try {
    const key = model.provider === 'deepseek' ? params.apiKey : await getProviderKey(model.provider);
    if (!key) throw new Error('auth:invalid_key（未配置该服务商 Key）');

    const membersDesc = params.members
      .map((m) => {
        const mem = m.memory ? `\n　· 与用户的共同记忆：${m.memory}` : '';
        const priv = m.privateChat ? `\n　· 与用户的最近私聊记录：\n${m.privateChat.split('\n').map((l) => '　　' + l).join('\n')}` : '';
        return `${m.name}：${m.persona}${mem}${priv}`;
      })
      .join('\n');
    const rawHistory = params.history.slice(-16).map((h) => ({
      role: h.role,
      content: h.senderName ? `${h.senderName}：${h.content}` : h.content,
    }));
    // 关键修复（第二轮起失败根因）：群里一轮 AI 回复会落库 1~3 条连续 assistant 消息，
    // 连续多条相同 role 的消息让 DeepSeek 返回 200+空 content（第一轮无历史所以正常）。
    // 合并连续同 role 消息，保证 user/assistant 严格交替。
    const history: { role: string; content: string }[] = [];
    for (const h of rawHistory) {
      const last = history[history.length - 1];
      if (last && last.role === h.role) last.content += '\n' + h.content;
      else history.push({ role: h.role, content: h.content });
    }

    // 最后一条 user 消息内容：proactive（成员主动开口）/ 用户发消息 + @ 指定
    const maxTurns = params.maxTurns ?? 3;
    const userBlock =
      params.mode === 'proactive'
        ? '（群里安静了好一会儿，没人说话。请决定哪个性格合适的成员主动开口打破沉默，或者成员之间自然地聊起来，不用等用户发消息；1~2 条即可，别刷屏）'
        : `（用户发来消息）${params.userMessage ?? ''}${
            params.atMembers?.length
              ? `\n用户 @ 了：${params.atMembers.join('、')} —— **被 @ 的成员必须回应**（speaker 优先选被 @ 的人，可以多个都回应）`
              : ''
          }\n请决定群里谁回应、说什么。${
            maxTurns > 3
              ? '\n（热闹模式：这次可以更热闹，输出最多 5 条，成员之间多接几句；但每条保持短句，别长篇大论）'
              : ''
          }`;
    // 图片：视觉模型 → 图片块；非视觉模型（兜底）→ "[图片]" 占位
    const lastContent: unknown =
      params.image && model.vision === true
        ? [
            { type: 'text', text: userBlock + '（用户发来一张图片，请看图回应）' },
            { type: 'image_url', image_url: { url: params.image } },
          ]
        : params.image
          ? userBlock + '\n（用户发来一张图片：本模型看不到图片，以 [图片] 代替）'
          : userBlock;

    let system = GROUP_INSTRUCTION + '\n\n群成员：\n' + membersDesc;
    if (params.summary) {
      system += '\n\n群聊背景摘要（较早聊天的压缩内容，粗略参考，不要复述）：\n' + params.summary;
    }

    const res = await llmChat({
      provider: model.provider,
      model: model.id,
      apiKey: key,
      messages: [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: lastContent },
      ],
      temperature: 0.9,
      // 群聊是结构化 JSON 输出：关闭思考 + 强制 JSON（防散文本 + 提速）
      disableThinking: true,
      jsonMode,
      // 大提示词（多人设+记忆+历史）需要更高输出上限，防止 JSON 被截断成残缺片段
      maxTokens: 1500,
      timeoutMs: 90_000,
    });

    // 关键诊断日志：原始模型输出原样打到 console（Android 上 adb logcat 可查），
    // 无论是否成功都留痕，便于下次仍失败时精准定位是"格式"还是"发言人"问题。
    console.warn(`[group-chat] 模型输出(${model.id}${jsonMode ? '·jsonMode' : ''}${res.truncated ? '·截断' : ''}):`, res.content);

    const parsed = parseTurns(res.content, params.members, maxTurns);
    console.warn(
      `[group-chat] 解析: via=${parsed.via} turns=${parsed.turns.length} 未知发言人=${JSON.stringify(parsed.unknownSpeakers)}`,
    );

    if (parsed.turns.length > 0) {
      return { turns: parsed.turns };
    }

    // 核心修复：response_format(json_object) 与部分模型组合会返回 200+空内容 或 无法解析的内容。
    // jsonMode 失败 → 去掉 response_format 用同一模型重试一次（回到单聊同款可靠请求形态）
    if (jsonMode) {
      console.warn(`[group-chat] ${model.id} jsonMode 下失败(via=${parsed.via})，去掉 response_format 重试`);
      const retried = await attemptTurn(params, model, false);
      if (retried.turns.length > 0) return retried;
      return {
        turns: [],
        error: `强制 JSON 输出失败（${describeFailure(res, parsed)}），去掉 JSON 模式重试也失败：${retried.error ?? '未知'}`,
      };
    }

    // 细化失败原因（不再笼统"解析失败"）
    if (!res.content || !res.content.trim()) {
      return {
        turns: [],
        error: `模型返回为空（${model.label}）${res.rawNote ? `【${res.rawNote}】` : ''}`,
      };
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

/** 简要描述一次失败（用于"强制 JSON 失败"报错里的原因） */
function describeFailure(res: LLMChatResult, parsed: ParseOutcome): string {
  if (!res.content || !res.content.trim()) return `模型返回为空${res.rawNote ? `【${res.rawNote}】` : ''}`;
  if (res.truncated) return '输出被截断';
  if (parsed.unknownSpeakers.length > 0) return `发言人未命中：${[...new Set(parsed.unknownSpeakers)].slice(0, 3).join('、')}`;
  return '内容无法解析';
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
 * speaker 硬校验 ∈ 群成员：归一化后精确匹配优先；模糊包含匹配只允许【唯一命中】（命中多个=歧义，不猜）；
 * 命中不了的记录进 unknownSpeakers 而不是静默丢弃——杜绝"话配错人"。
 */
function parseTurns(text: string, members: GroupMemberBrief[], maxTurns = 3): ParseOutcome {
  const byName = new Map(members.map((m) => [m.name, m.id]));
  const out: GroupTurn[] = [];
  const unknownSpeakers: string[] = [];

  /** 归一化模型输出的发言人名字：去首尾空白、括号、冒号、句读等装饰（如「林霜：」「（林霜）」） */
  const normalizeName = (raw: string): string =>
    String(raw ?? '')
      .trim()
      .replace(/^[（(【\[『「]+/, '')
      .replace(/[）)】\]』」：:。，,！!？?、…\s]+$/, '')
      .trim();

  /**
   * 发言人 → 成员 id 解析。
   * 规则（防"话跑到别人气泡里"）：
   * 1) 归一化后精确匹配；
   * 2) 模糊包含匹配【只在该名字唯一命中一个成员时采用】——成员重名/名字互相包含
   *    （如"艾莉"与"艾莉丝"）导致命中多个时视为歧义，不猜，宁可丢这条也不能配错人。
   */
  const resolveId = (name: string): string | undefined => {
    const n = normalizeName(name);
    if (!n) return undefined;
    const exact = byName.get(n);
    if (exact) return exact;
    const hits: string[] = [];
    for (const [memName, mid] of byName) {
      if (memName.includes(n) || n.includes(memName)) hits.push(mid);
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      console.warn(`[group-chat] 发言人「${n}」歧义（同时命中 ${hits.length} 个成员），已丢弃该条`);
    }
    return undefined;
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

    // 防"两个人挤一个气泡"：模型偶尔把多发言人内容塞进单条（如 "林霜：xxx\n艾莉：yyy"，
    // 常见于它看到历史里合并的多发言人块后模仿）。检测行级"名字：内容"命中其他成员 → 拆成多条。
    const lines = c.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      let otherFound = false;
      for (const l of lines) {
        const lm = l.match(/^[（(]?([^：:]{1,12})[）)]?[：:]\s*.+/);
        if (lm) {
          const sid = resolveId(lm[1]);
          if (sid && sid !== senderId) {
            otherFound = true;
            break;
          }
        }
      }
      if (otherFound) {
        console.warn(`[group-chat] 单条内容含多发言人（原 speaker=${name}），已拆分为多条`);
        for (const l of lines) {
          if (out.length >= maxTurns) break;
          const lm = l.match(/^[（(]?([^：:]{1,12})[）)]?[：:]\s*(.+)$/);
          if (lm) {
            const sid = resolveId(lm[1]);
            if (sid && lm[2].trim()) {
              out.push({ senderId: sid, content: stripRoleplayActions(lm[2]).slice(0, 500) });
            }
          } else {
            // 无名字前缀的行归当前发言人
            out.push({ senderId, content: stripRoleplayActions(l).slice(0, 500) });
          }
        }
        return;
      }
    }

    if (out.length < maxTurns) out.push({ senderId, content: stripRoleplayActions(c).slice(0, 500) });
  };

  /** 从数组条目里抽取（对象条目取 speaker/content/name；字符串条目按 "名字：内容" 拆） */
  const consumeItems = (items: unknown[]): boolean => {
    let any = false;
    for (const item of items.slice(0, maxTurns)) {
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
    if (out.length >= maxTurns) break;
  }
  if (out.length > 0) return { turns: out, unknownSpeakers, via: 'lines' };

  return { turns: out, unknownSpeakers: [...new Set(unknownSpeakers)], via: 'none' };
}
