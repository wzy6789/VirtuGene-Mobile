import { stripRoleplayActions } from './text';

const PROACTIVE_INSTRUCTION =
  '你是下面描述的角色。用户已经有一段时间没有给你发消息了。请基于你的性格，主动发起一次自然的对话。\n\n' +
  '要求：\n' +
  '- 像发微信/短信一样说话，简短自然，不要长篇大论\n' +
  '- 具体发多长由你的性格决定：话痨角色可以多说几句，高冷角色可以只说一两个字\n' +
  '- 内容要符合你的性格设定，让用户感觉是"这个角色在想我"，而不是系统在推送通知\n' +
  '- 可以是一句突如其来的感慨、一个问题、一个分享、或者一个撒娇\n' +
  '- 不要用"你好"、"在吗"这类模板化开场\n' +
  '- 不要在消息中提到"主动发消息"、"推送"等机制性词汇\n' +
  '- 不要用任何 Markdown 或列表符号（#、*、-、数字编号），就是纯文本打字\n' +
  '- 不要用括号描述动作或表情\n' +
  '- 直接输出消息正文，不要任何前缀或后缀';

export interface ProactiveMessageParams {
  apiKey: string;
  systemPrompt: string;
  lastMessages: { role: string; content: string }[];
  characterName: string;
  affinity?: number;
  mood?: number;
  /** 最后一条消息的时间戳，用于感知「多久没联系了」 */
  lastMessageAt?: number;
  /** 问候类型：早安/晚安（缺省为普通主动消息） */
  kind?: 'morning' | 'night';
}

function buildTimeContext(lastMessageAt?: number): string {
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const pad = (n: number) => String(n).padStart(2, '0');
  let text = `现在是${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (lastMessageAt) {
    const diffMin = Math.round((Date.now() - lastMessageAt) / 60000);
    if (diffMin >= 60) {
      const hours = Math.floor(diffMin / 60);
      text += hours < 24 ? `，距上次聊天约 ${hours} 小时` : `，距上次聊天约 ${Math.floor(hours / 24)} 天`;
    }
  }
  return text + '。';
}

export async function generateProactiveMessage(params: ProactiveMessageParams): Promise<string> {
  const { apiKey, systemPrompt, lastMessages, characterName, affinity, mood, lastMessageAt } = params;

  const contextLines = lastMessages.slice(-6).map((m) => {
    const label = m.role === 'user' ? '用户' : characterName;
    return `${label}: ${m.content.slice(0, 200)}`;
  });

  // Single system message to avoid API compatibility issues
  let systemContent = systemPrompt + '\n\n' + PROACTIVE_INSTRUCTION;
  // 每日问候：早安/晚安额外加场景引导（每日灵魂互动）
  if (params.kind === 'morning') {
    systemContent +=
      '\n\n[现在是早晨] 角色正在给用户发早安问候。像真人朋友一样自然地问早：可以问昨晚睡得如何、今天打算做什么、随口提一件小事；简短温暖，不要模板化的"早安！"开场，不要提"问候/推送"等机制词。';
  } else if (params.kind === 'night') {
    systemContent +=
      '\n\n[现在是夜晚] 角色正在向用户道晚安。像真人朋友一样自然地告别这一天：可以关心今天过得怎么样、叮嘱早点休息、说一句心里话；简短温暖，不要模板化的"晚安！"结尾，不要提"问候/推送"等机制词。';
  }
  if (affinity != null && mood != null) {
    systemContent +=
      `\n\n[当前关系状态]\n用户与你的好感度：${Math.round(affinity)}，你此刻的心情：${Math.round(mood)}/100。` +
      '让这两个数值自然影响你这条消息的语气：好感度越低越疏离、甚至懒得主动找，心情越差越低落或烦躁；反之越亲近越轻快。不要直接说出这些数字。';
  }
  if (contextLines.length > 0) {
    systemContent += '\n\n最近的对话记录：\n' + contextLines.join('\n');
  }
  // 时间感知：让角色知道现在几点、多久没联系了
  systemContent += '\n\n' + buildTimeContext(lastMessageAt);

  const userPrompt =
    params.kind === 'morning'
      ? `（现在是早晨，请以${characterName}的身份发一条早安问候）`
      : params.kind === 'night'
        ? `（现在是夜晚，请以${characterName}的身份发一条晚安问候）`
        : `（用户已有一段时间未读消息）请以${characterName}的身份，主动发一条消息过来。`;

  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userPrompt },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages,
        max_tokens: 300,
        temperature: 1.0,
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      const data = await response.json();
      return stripRoleplayActions(data.choices[0].message.content.trim());
    }

    console.error('[proactive] API error:', response.status);
    throw new Error('server:error');
  } finally {
    clearTimeout(timeout);
  }
}
