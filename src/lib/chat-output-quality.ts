import { normalizeChatResponse,shouldPreserveChatEscapes } from './chat-pacing';
import { stripRoleplayActions } from './ai/text';
import { checkReplyQuality, isLongFormRequest, polishChatResponse, type ReplyCheck } from './reply-quality';
import { allowsDramaticReply, hasOverwrittenAffection, hasUninvitedStaging } from './chat-expression-boundary';
import { findSelfReportRisk } from './chat-self-report-risk';
import {findCurrentSceneRisk} from './chat-current-scene-risk';
import {findAffectionHistoryRisk} from './chat-affection-history-risk';
import {findRememberedTeasingRisk} from './chat-remembered-teasing-risk';
import {findCurrentActivityRisk} from './chat-current-activity-risk';

export interface OutputQualityContext {
  mode: 'private' | 'proactive' | 'group';
  userMessage?: string;
  recentReplies?: string[];
  recentUserMessages?: string[];
  catchphrase?: string;
  persona?: string;
  /** Only character-owned independent life records. Never previous assistant
   * messages, style examples or user memories. */
  independentCharacterRecords?: string[];
  /** Current attached image supports observations about the user's scene,
   * never an invented scene on the character's side. */
  hasCurrentImage?: boolean;
}
/** Shared textual checks; proactive history is not a new user request. */
export function inspectChatOutput(raw: string, context: OutputQualityContext): { content: string; check: ReplyCheck; severity: number } {
  const content = polishChatResponse(stripRoleplayActions(normalizeChatResponse(raw,{preserveEscapes:shouldPreserveChatEscapes(context.userMessage??'')})), {longForm:isLongFormRequest(context.userMessage ?? ''),paragraphFallback:context.mode==='private'});
  const history = context.recentReplies ?? [];
  let check = checkReplyQuality(content, context.mode === 'proactive' ? '' : context.userMessage ?? '', history[history.length - 1], history.slice(-4), { catchphrase: context.catchphrase });
  if(check.ok && !allowsDramaticReply(context.userMessage ?? '',context.recentUserMessages)) {
    if(hasUninvitedStaging(content)) check={ok:false,issue:'uninvited-staging',retryHint:'这轮是在发消息，不是同处一室。保留角色态度与亲密感，直接接用户的话；不要继续进门、坐下、看着对方或当面再说的表演，也不要换一组动作替代。'};
    else if(hasOverwrittenAffection(content,context.userMessage ?? '')) check={ok:false,issue:'emotional-script',retryHint:'直接用角色自己的口语表达对这份心意的态度；不要层层解释如何接收这句话，不堆意象、仪式或要求当面再说，不强迫回应相同爱意。'};
    else if(findAffectionHistoryRisk(content,context.userMessage,context.recentUserMessages,context.persona)) check={ok:false,issue:'emotional-script',retryHint:'保留你对这句话的喜欢、开心或轻轻打趣；当前没有依据判断对方平时很少直白表达，不要把这一刻写成难得、终于或与过去比较。直接说自己的当下反应，不向对方解释检查过程，也不追加考查心意来历的问题。'};
    else if(findRememberedTeasingRisk(content,context.userMessage,context.recentUserMessages)) check={ok:false,issue:'user-source-risk',retryHint:'刚才把用户的笑声或不同偏好写成了他以前取笑你的具体往事。现有原话没有明确的对应说法，保留自己的偏好与眼前玩笑，别说他笑过你、记着账；也不否认全部过去、不向他解释检查过程。'};
    else if(findCurrentActivityRisk(content,context.mode==='private'?context.userMessage:'',context.persona)) check={ok:false,issue:'self-report-risk',retryHint:'刚才新增了自己正在做或尚未做完的活动，但当前没有对应的角色场景来源。选择吃什么、喜欢什么或用户正在做的事不证明你也正在做；保留自己的偏好、眼前反应或告别，不换成另一段正在忙的近况。未来想做什么仍可以作为此刻选择说清；不用向对方解释资料核对过程，不否认全部过去。'};
    else {
      const risk=findSelfReportRisk(content,context.persona,context.independentCharacterRecords);
      if(risk)check={ok:false,issue:'self-report-risk',retryHint:`刚才新增了缺少独立来源的具体生活习惯自述：${JSON.stringify(risk.quote)}。保留对眼前事情的反应、当下喜好或玩笑，不需要补一个共同经历。不要用以前或正在做的另一种动作替换它，不否认未记载的过去，不向用户解释核对过程。`};
      else {
        const scene=findCurrentSceneRisk(content,context.userMessage,context.hasCurrentImage);
        if(scene)check={ok:false,issue:'self-report-risk',retryHint:`刚才凭空补了当前窗边或房间的光线：${JSON.stringify(scene)}。人物喜欢夜色或阳光不证明眼前的光线，旧经历也不是现在的现场。直接接用户说的话，用自己的态度表达温柔或开心即可；不要换成风声、下雨等另一段现场，也不要向用户解释检查过程。`};
      }
    }
  }
  // Only explicit authored constraints are enforceable locally. No score for
  // missing catchphrases, a quiet reaction or a professional-sounding sentence.
  const noEmoji=/^(?:表情|emoji)[：:]\s*(?:不用|不使用|禁止|不要)/imu.test(context.persona ?? '');
  const requestedEmoji=/(?:用|加|来).{0,4}(?:emoji|表情)/iu.test(context.userMessage ?? '')&&!/(?:不用|不要|别)/u.test(context.userMessage ?? '');
  const forbidden=(context.persona ?? '').split(/\r?\n/u).filter(line=>/^禁用称呼[：:]/u.test(line)).flatMap(line=>line.replace(/^禁用称呼[：:]\s*/u,'').split(/[、，,]/u)).map(s=>s.trim()).filter(Boolean);
  const wrongAddress=forbidden.some(name=>content.split(/[。！？!?\n]|-{3,}/u).some(s=>s.trim().startsWith(name+'，')||s.trim().startsWith(name+',')));
  if(check.ok && (wrongAddress || noEmoji && !requestedEmoji && /\p{Extended_Pictographic}/u.test(content))) check={ok:false,issue:'voice-conflict',retryHint:'遵守人设中明确的表情与禁用称呼要求；其他内容和角色自己的语气保留，不强塞口头禅。'};
  const severity = check.ok ? 0 : check.issue === 'empty' ? 4 : check.issue === 'generic' || check.issue === 'uninvited-staging' || check.issue === 'self-report-risk' ? 3 : check.issue === 'repeat-own' || check.issue === 'emotional-script' || check.issue === 'user-source-risk' ? 2 : 1;
  return { content, check, severity };
}
