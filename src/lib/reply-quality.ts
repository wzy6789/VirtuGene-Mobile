/**
 * 回复质量自检：在把 AI 回复上屏前检查常见"翻车"情况，
 * 命中则返回修正提示，由调用方静默重试一次。
 */

import { collapseChatNewlines } from './ai/text';
import { normalizeChatParagraphBoundaries } from './chat-pacing';
import {requestsRepetition,isQuestionReaction} from './chat-turn-cues';
import {requestsBriefReply} from './chat-reply-size';
export {requestsRepetition} from './chat-turn-cues';

export type ReplyIssue =
  | 'empty'
  | 'repeat-user'
  | 'generic'
  | 'repeat-own'
  | 'too-long'
  | 'over-structured'
  | 'question-barrage'
  | 'uninvited-staging'
  | 'emotional-script'
  | 'voice-conflict'
  | 'user-source-risk'
  | 'self-report-risk';

export interface ReplyCheck {
  ok: boolean;
  issue?: ReplyIssue;
  retryHint?: string;
}

/**
 * 把模型偶尔带出的“内部格式”收束成手机聊天文本。
 * 这里只做确定安全的本地清理，不改写角色观点，也不额外调用模型。
 */
export function polishChatResponse(
  content: string,
  options: { longForm?: boolean; paragraphFallback?:boolean } = {},
): string {
  let text = (options.paragraphFallback?normalizeChatParagraphBoundaries(content,options):content)
    .replace(/\r\n?/g, '\n')
    .replace(/```(?:text|markdown|json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:回复|回答|角色回复|assistant)\s*[：:]+\s*/i, '')
    .replace(/^\s*[【\[](?:回复|回答|assistant)[】\]]\s*/i, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

  // 普通聊天不应该把内部分析词带到用户面前；整句移除比留下半句更自然。
  if (!options.longForm) {
    text = text
      .split('\n')
      .filter((line) => !/(?:作为(?:一个)?(?:AI|人工智能|语言模型)|系统提示|内部指令|记忆库|人物心意|对话导演)/u.test(line))
      .join('\n')
      .trim();
  }

  // Punctuation carries emotion. Interview-like questioning is checked below,
  // never silently rewritten into statements.
  // Keep explicit separators distinct so Chinese newline joining cannot glue
  // the next message onto a preceding Latin word.
  return text.split(/\n?-{3,}\n?/u).map(part => collapseChatNewlines(part).replace(/[ \t]{2,}/g, ' ').trim()).filter(Boolean).join('\n---\n').trim();
}

/**
 * 字符集合重叠度（用于复述检测）：0-1，越接近 1 越相似。
 * 注意：短文本（如"好"vs"好的"）字符集必然高度重叠，因此调用方应对短消息跳过复述检测。
 */
function similarity(a: string, b: string): number {
  const norm = (s: string) => new Set(s.replace(/\s+/g, ''));
  const setA = norm(a);
  const setB = norm(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const c of setA) {
    if (setB.has(c)) inter += 1;
  }
  // A short reaction can share every character with a long story without
  // repeating that story. Compare both vocabularies, not only the smaller one.
  return inter / Math.max(setA.size, setB.size);
}

/** Detect a phrase that has already appeared in at least two recent replies. */
function repeatedMotif(text: string, previous: string[], catchphrase = ''): string | undefined {
  if (text.length < 12 || previous.length < 2) return undefined;
  const phrases = text.split(/[。！？!?，,；;\n]|-{3,}/u).map(s => s.trim()).filter(s => s.length >= 12 && s !== catchphrase.trim());
  for (const phrase of phrases) {
    const count = previous.filter((item) => item.includes(phrase)).length;
    if (count >= 2) return phrase;
  }
  return undefined;
}

/** 复述检测只对足够长的文本启用：短句（如"好""嗯"）字符集必然重叠，会误伤 */
const MIN_REPEAT_LENGTH = 8;

const GENERIC_PATTERNS: RegExp[] = [
  /作为(一个)?(AI|人工智能|语言模型|助手)/,
  /我是(一个)?(人工智能|AI|助手|机器人)/,
  /很(高兴|荣幸)(能|可以)?为(?:你|您)(?:服务|提供帮助)/,
  /有什么(?:我)?可以(?:帮(?:助)?(?:你|您)|为(?:你|您)效劳)/,
];

const OVER_STRUCTURED_PATTERNS: RegExp[] = [
  /首先[，,].{0,120}(其次|然后)[，,]/s,
  /(第一[，,：:]|第二[，,：:]|第三[，,：:])/s,
  /(总的来说|综上所述|总结一下|以下是)/,
  /(^|\n)\s*[-*•]\s+/m,
];

/** A task or reply-size instruction, rather than a word in the current topic. */
const LONG_FORM_ACTION = /详细|解释|分析|教程|步骤|整理|总结|长一点|展开|写一篇|创作/u;
const MAX_CONVERSATIONAL_REPLY_CHARS = 180;

export function isLongFormRequest(message: string): boolean {
  const text=message.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|‘[^’]*’|'[^']*'/gu,'');
  let longForm=false;
  for(const sentence of text.split(/[。！？!?；;\n]/u)){
    const reported=/^(?:他|她|他们|她们|朋友|同事|老师|孩子).{0,30}(?:说(?=要|让|请|希望|[：:，,]|$)|让|希望|要求|叫)/u.test(sentence.trim());
    const discussing=/更喜欢|喜欢.*吗|你会(?:先|不会)|的时候|也没关系/u.test(sentence);
    for(const raw of sentence.split(/[，,]/u)){
      const clause=raw.trim()
        .replace(/^(?:(?:但|不过|还是|等等|现在|那么|这次|先|再|然后|之后|算了|其实|所以|那)[，,\s]*)+/u,'')
        .replace(/^今天(?=请|麻烦|帮我)/u,'')
        .replace(/^轮到我问你[：:]\s*/u,'');
      if(!clause)continue;
      const ownRequest=/^我(?:现在|这次|也|还是)?(?:(?:想|希望|需要)(?:请你|让你|你|听(?:你)?(?=详细|解释|分析|展开)|要你)|请你|要你)/u.test(clause);
      // Unquoted reported speech and hypothetical activities keep their source.
      // An explicit later request by the current speaker can still take over.
      if(reported&&!ownRequest)continue;
      if(/^(?:如果|假如|假设|要是|比如|例如)/u.test(clause))continue;
      // A short conclusion may accompany a detailed body; a new global short
      // instruction instead replaces the earlier request for a long answer.
      const localShort=/^(?:然后|再).*(?:结论|标题|摘要)|^(?:结论|结尾|标题|摘要)(?:请|只|用)/u.test(raw.trim());
      if(!localShort&&(requestsBriefReply(clause)
        ||/^(?:请|你|麻烦你)?(?:只(?:用|需|要)?|用)?(?:一句话|一两句|一句|两句).*(?:告诉我|回答|回复|说|就好|就行)/u.test(clause)
        ||/^(?:请|你)?只(?:说|讲|回答|回复)(?:一句话|一两句|一句)(?:就好|就行|吧|$)/u.test(clause)
        ||/^(?:请|你)?(?:先|暂时|现在)?(?:别|不要)说(?:了|下去)/u.test(clause)
        ||/^(?:请|你)?(?:不用|别|不要|无需|不需要)(?:再)?(?:展开|详细(?:解释|说|讲)?|写长|写一篇)/u.test(clause))){
        longForm=false;
        continue;
      }
      if(!LONG_FORM_ACTION.test(clause))continue;
      if(/(?:别|不要|不用|无需|不需要|不是要|不是让|不想让|不希望).{0,24}(?:详细|解释|分析|教程|步骤|整理|总结|长一点|展开|写一篇|创作)/u.test(clause)
        &&!/不要只(?:总结|说|讲)/u.test(clause))continue;
      // Physical tidying is a life action, including when someone asks for it.
      // Asking for its tutorial, plan, or steps is a separate writing task.
      if(/整理(?:一下|好|完|过)?(?:屋子|房间|衣柜|旧物|杂物|行李|床铺|书桌|箱子|抽屉|书架)/u.test(clause)
        &&!/(?:教程|步骤|方案|建议|方法)/u.test(clause))continue;
      const requestPrefix=/^(?:我(?:现在|这次|也|还是)?(?:(?:想|希望|需要)(?:请你|让你|你|听(?:你)?|要你)|请你|要你)|请(?:你)?|麻烦(?:你)?|帮我|给我|替我|为我|你(?:能不能|可不可以|可以|能)|能不能|可不可以|可以|能)/u;
      const requestBody=clause.replace(requestPrefix,'')
        .replace(/^(?:(?:先|再|现在|这次|好好|仔细|认真|帮我|给我|替我|为我))+/u,'');
      const requestedAction=/^(?:详细(?:地)?(?:解释|分析|说|讲|介绍|说明|展开|写)|解释|分析|整理|总结|创作|写(?:一篇|长(?:一)?点)|展开(?:说|讲|谈)|(?:说|讲|回答)(?:得)?详细(?:一)?点|(?:详细|长)(?:一)?点|教程|步骤|(?:一份|一套|一个).{0,24}(?:教程|步骤))/u.test(requestBody);
      const delivery=/^(?:把|将).{1,80}(?:列给我|写给我|发给我|展开(?:说|讲)|详细(?:解释|分析)|整理成(?:一份|一个|一套))/u.test(requestBody);
      const ownArtifact=/^我(?:想|需要|希望)(?:要|得到)?(?:一份|一套|一个).{0,24}(?:教程|步骤|分析|总结)/u.test(clause);
      const addressed=requestPrefix.test(clause)&&requestedAction||delivery||ownArtifact;
      const objectRequest=/^(?:这(?:个|部分|一点|段|道题)|那(?:个|部分|一点|段)|其中|理由|原因|细节|背景|过程|内容)(?:请|能|可以)?(?:详细|解释|分析|展开)/u.test(clause);
      const indicative=/^(?:详细(?:地)?)?(?:解释|分析|总结|整理|创作)(?:过|了|完|得|着|起来|出来)/u.test(clause)
        ||/(?:也|并不|很|不)(?:容易|简单|轻松|困难|重要)[吧啊呀]?$/u.test(clause)
        ||/(?:的|过)(?:人|朋友|同事|老师|孩子)(?:都|也|很|挺|不|$)/u.test(clause)
        ||/也没关系$/u.test(clause);
      const commandEnding=/(?:一下|一遍|吧|好吗|可以吗)$/u.test(clause);
      const explicitSpeech=/^(?:展开(?:说|讲|谈)|详细(?:地)?(?:解释|分析|说|讲|介绍|展开|写))/u.test(clause);
      const imperative=!indicative&&(!discussing||commandEnding||explicitSpeech)
        &&/^(?:详细(?:地)?(?:解释|分析|说|讲|介绍|展开|写)|解释|分析|总结|整理|创作|写一篇|展开(?:说|讲|谈)|(?:说|讲|写|回答)(?:得)?(?:详细|长一点)|(?:详细|长)(?:一)?点(?:吧|好吗|好不好|可以吗|$))/u.test(clause);
      if(!indicative&&(addressed||objectRequest||imperative))longForm=true;
    }
  }
  return longForm;
}

const RETRY_HINTS: Record<ReplyIssue, string> = {
  'user-source-risk':'保留眼前态度与玩笑，不将人物自己的话、用户笑声或不同偏好编成用户曾经说过的具体话。',
  'uninvited-staging':'刚才把发消息写成了同处一室的表演。保留角色态度和亲密感，直接接这句话；不要安排进门、坐下、看着你或当面再说，不把这些动作换一组继续演。',
  'emotional-script':'刚才把一句心意写成了层层解释的文学台词。用角色自己的口语表达当下态度；不解释如何接收这句话，不堆意象和仪式，也不强迫回应相同爱意。',
  'voice-conflict':'遵守人设中的明确表达要求，保留当前内容和角色自己的语气。',
  'self-report-risk':'刚才新增了缺少独立来源的具体生活习惯自述。接眼前这件事，说此刻的态度或一个玩笑即可；不要用以前、通常、正在做的另一种动作替换它，也不要否认未记载的经历或向用户解释资料核对过程。',
  empty: '你刚才的回复是空的。请用你的性格正常回应用户，直接说事，不要长篇大论。',
  'repeat-user': '你刚才完全复述了用户的话。不要复述用户，用你自己的性格、说法和语气回应。',
  generic: '刚才出现了通用客服或模型说明。回到角色自己的说话方式；普通招呼、口头禅和纯反应可以保留，不要自称通用助手或推销服务。',
  'repeat-own': '你刚才重复了自己刚说过的话。换个说法，说点新的内容，不要原地打转。',
  'too-long': '这一段偏长。保留角色此刻真正想说的内容，在自然停顿处用 --- 分条，不要压成固定三句，也不要删掉情绪反应。',
  'over-structured': '你刚才像在写说明或报告。去掉分点、总结和“首先其次”，只留下这个角色此刻最想说的一两句话，用自然口语重新回答。',
  'question-barrage': '刚才接连三个实质问题像采访。先接住一两个最在意的点，给出自己的反应；保留原有标点强度，不必把所有问句删掉。',
};

/**
 * @param content  模型回复
 * @param userMessage 用户本次发的消息
 * @param lastAssistantContent 上一条 AI 消息（用于自重复检测）
 */
export function checkReplyQuality(
  content: string,
  userMessage: string,
  lastAssistantContent?: string,
  recentAssistantContents: string[] = [],
  voice: { catchphrase?: string } = {},
): ReplyCheck {
  const text = content.trim();
  if (text.length === 0) {
    return { ok: false, issue: 'empty', retryHint: RETRY_HINTS.empty };
  }

  // 复述用户消息：整段相似度过高（仅长文本判定，短句字符集必然重叠会误伤）
  if (!requestsRepetition(userMessage) && text.length >= MIN_REPEAT_LENGTH && userMessage.trim().length >= MIN_REPEAT_LENGTH && similarity(text, userMessage) >= 0.85) {
    return { ok: false, issue: 'repeat-user', retryHint: RETRY_HINTS['repeat-user'] };
  }

  // 通用机器人腔
  for (const re of GENERIC_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, issue: 'generic', retryHint: RETRY_HINTS.generic };
    }
  }

  for (const re of OVER_STRUCTURED_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, issue: 'over-structured', retryHint: RETRY_HINTS['over-structured'] };
    }
  }

  const sentences = text.replace(/[“「][^”」]*[”」]/gu, '').replace(/-{3,}/gu, ' ').match(/[^。！？!?；;]*[。！？!?；;]+|[^。！？!?；;]+$/gu) ?? [];
  let questionRun = 0;
  const barrage = sentences.some(sentence => {
    const core = sentence.replace(/[。！？!?；;\s]/gu, '');
    const question = /[?？]/u.test(sentence) && core.length > 0 && !isQuestionReaction(sentence);
    questionRun = question ? questionRun + 1 : 0;
    return questionRun >= 3;
  });
  if (!isLongFormRequest(userMessage) && barrage) {
    return { ok: false, issue: 'question-barrage', retryHint: RETRY_HINTS['question-barrage'] };
  }

  // 重复自己刚说的话（仅长文本判定）
  const withoutCatchphrase = (s: string) => voice.catchphrase?.trim() ? s.split(voice.catchphrase.trim()).join('').trim() : s.trim();
  const own = withoutCatchphrase(text), previous = withoutCatchphrase(lastAssistantContent ?? '');
  if (!requestsRepetition(userMessage) && own.length >= 20 && previous.length >= 20 && own === previous) {
    return { ok: false, issue: 'repeat-own', retryHint: RETRY_HINTS['repeat-own'] };
  }

  const motif = requestsRepetition(userMessage) ? undefined : repeatedMotif(text, recentAssistantContents, voice.catchphrase);
  if (motif) {
    return {
      ok: false,
      issue: 'repeat-own',
      retryHint: `不要继续重复最近几轮已经用过的“${motif}”。回应用户当前内容，说自己的判断或新想法；不要为了换说法再编一组动作和布景。`,
    };
  }

  // 模型已经用 --- 明确分成多条短消息时，不能按总字数判定成长文；
  // 否则自然分条会被误触发重试，反而增加延迟并破坏聊天节奏。
  const bubbles = text
    .split(/\n?-{3,}\n?/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const longestBubble = bubbles.reduce((max, bubble) => Math.max(max, bubble.length), 0);
  const totalChars=bubbles.reduce((sum,bubble)=>sum+bubble.length,0);
  if(requestsBriefReply(userMessage)&&!isLongFormRequest(userMessage)
    &&(totalChars>140||totalChars>100&&bubbles.length>2)){
    return {ok:false,issue:'too-long',retryHint:'用户这次明确要求简单、简短，刚才展开太多。保留够用的核心回答和必要的关键说明，用人物自己的话说清；不再加教程、替代方案、总结或可有可无的追问。不截断事实或安全必需的信息，确实缺关键信息时简短问清。'};
  }
  if (!isLongFormRequest(userMessage) && longestBubble > MAX_CONVERSATIONAL_REPLY_CHARS) {
    return { ok: false, issue: 'too-long', retryHint: RETRY_HINTS['too-long'] };
  }

  return { ok: true };
}
