import { taskChat } from './task-client';
import { inspectChatOutput } from '../chat-output-quality';
import { withChatMessagingPolicy } from '../../../server/chat-messaging-policy.mjs';
import { recordQualityEvent } from '../chat-quality-metrics';
import { useAuthStore } from '../../store/auth-store';

const PROACTIVE_INSTRUCTION =
  '你是下面描述的角色。用户已经有一段时间没有给你发消息了。请基于你的性格，主动发起一次自然的对话。\n\n' +
  '要求：\n' +
  '- 像发微信/短信一样说话，简短自然，不要长篇大论\n' +
  '- 具体发多长由你的性格决定：话痨角色可以多说几句，高冷角色可以只说一两个字\n' +
  '- 内容要符合你的性格设定，让用户感觉是"这个角色在想我"，而不是系统在推送通知\n' +
  '- 可以是一句突如其来的感慨、一个问题、一个分享、或者一个撒娇\n' +
  '- 问候可以自然出现，但不要反复照搬同一句开场\n' +
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
  /** 待跟进事项：从记忆里捞到的"TA 最近说过的事/目标"——可以自然地关心进展 */
  followUp?: string;
  memoryContext?: string;
  /** 角色自己的近期生活线；只允许引用已有记录，不要求模型凭空编造。 */
  lifeHints?: string[];
  catchphrase?: string;
  signal?: AbortSignal;
  voiceCard?: string;
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
  const owner=useAuthStore.getState().userId ?? '',started=performance.now();
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
      '\n\n[现在是早晨] 按角色性格自然问早，可以简短问候或随口聊一句；不必固定追问睡眠和安排，不提问候机制。';
  } else if (params.kind === 'night') {
    systemContent +=
      '\n\n[现在是夜晚] 按角色性格自然告别这一天，可以说晚安，不必固定叮嘱或追问，不提问候机制。';
  }
  if (affinity != null && mood != null) {
    systemContent +=
      `\n\n[当前关系状态]\n用户与你的好感度：${Math.round(affinity)}，你此刻的心情：${Math.round(mood)}/100。` +
      '让这两个数值自然影响你这条消息的语气：好感度越低越疏离、甚至懒得主动找，心情越差越低落或烦躁；反之越亲近越轻快。不要直接说出这些数字。';
  }
  if (contextLines.length > 0) {
    systemContent += '\n\n最近的对话记录：\n' + contextLines.join('\n');
  }
  if (params.memoryContext) systemContent += '\n\n' + params.memoryContext;
  // 待跟进事项：角色记得用户最近说过的事，可自然关心进展（别生硬，别每次重复问同一件）
  if (params.followUp) {
    systemContent +=
      `\n\n[你可以关心的事]\n你记得 TA 说过：${params.followUp.slice(0, 120)}。` +
      '若这次合适，可以自然地关心一下进展（一句即可）；如果上次你已经问过同样的事，就别重复追问。';
  }
  const lifeHints = [...new Set((params.lifeHints ?? []).map((hint) => hint.trim()).filter((hint) => hint.length >= 3))].slice(0, 3);
  if (lifeHints.length > 0) {
    systemContent +=
      `\n\n[你自己的近期生活线]\n${lifeHints.map((hint) => `- ${hint.slice(0, 120)}`).join('\n')}\n` +
      '你可以偶尔从这里自然说起一件自己的近况，让对方感觉你也在过自己的生活；只选一件，不能补写记录里没有的新经历。';
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

  messages[0].content = withChatMessagingPolicy(messages[0].content + (params.voiceCard ? '\n\n' + params.voiceCard : ''));
  const recentReplies = lastMessages.filter(m => m.role === 'assistant').map(m => m.content);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (params.signal?.aborted || (useAuthStore.getState().userId ?? '') !== owner) return '';
    const result = await taskChat({ apiKey, messages, maxTokens: 300, temperature: 1,
      disableThinking: true, timeoutMs: 30_000, signal: params.signal });
    if (params.signal?.aborted || (useAuthStore.getState().userId ?? '') !== owner) return '';
    const inspected = inspectChatOutput(result.content, { mode:'proactive', recentReplies, catchphrase:params.catchphrase,persona:params.systemPrompt });
    if (inspected.check.ok) {recordQualityEvent(owner,{mode:'proactive',retries:attempt,blocked:false,streamed:false,durationMs:performance.now()-started});return inspected.content;}
    if(attempt === 1) recordQualityEvent(owner,{mode:'proactive',issue:inspected.check.issue,retries:1,blocked:true,streamed:false,durationMs:performance.now()-started});
    messages[1].content = userPrompt + '\n' + inspected.check.retryHint;
  }
  // A proactive message may be omitted; never replace a bad draft with a canned greeting.
  return '';

}
