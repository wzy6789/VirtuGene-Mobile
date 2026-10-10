import { normalizeChatResponse,shouldPreserveChatEscapes } from './chat-pacing';
import { stripRoleplayActions } from './ai/text';
import { checkReplyQuality, isLongFormRequest, polishChatResponse, type ReplyCheck } from './reply-quality';
import { allowsDramaticReply, hasOverwrittenAffection, hasUninvitedStaging } from './chat-expression-boundary';
import { findSelfReportRisk } from './chat-self-report-risk';
import {findCurrentSceneRisk} from './chat-current-scene-risk';
import {findAffectionHistoryRisk} from './chat-affection-history-risk';
import {findRememberedTeasingRisk} from './chat-remembered-teasing-risk';
import {findCurrentActivityRisk} from './chat-current-activity-risk';
import {findUserAudioRisk} from './chat-user-audio-risk';
import {findUserVisualRisk} from './chat-user-visual-risk';
import {findUserHabitRisk} from './chat-user-habit-risk';
import {findDomesticReferenceRisk} from './chat-domestic-reference-risk';
import {rejectsSelectedPartner,type OwnedPartnerRole} from './chat-owned-identity';

export interface OutputQualityContext {
  mode: 'private' | 'proactive' | 'group';
  userMessage?: string;
  recentReplies?: string[];
  recentUserMessages?: string[];
  /** Raw user statements only; never model summaries or generated replies. */
  userHabitSources?: string[];
  catchphrase?: string;
  persona?: string;
  /** Only character-owned independent life records. Never previous assistant
   * messages, style examples or user memories. */
  independentCharacterRecords?: string[];
  /** Current attached image supports observations about the user's scene,
   * never an invented scene on the character's side. */
  hasCurrentImage?: boolean;
  /** Images actually supplied in this request, including user-image history.
   * Distinct from the current attachment used by current-scene checks. */
  hasUserVisualEvidence?: boolean;
  /** Supplied only after validating the unedited owned preset and current role. */
  selectedPartnerRole?: OwnedPartnerRole;
}
/** Shared textual checks; proactive history is not a new user request. */
export function inspectChatOutput(raw: string, context: OutputQualityContext): { content: string; check: ReplyCheck; severity: number } {
  const content = polishChatResponse(stripRoleplayActions(normalizeChatResponse(raw,{preserveEscapes:shouldPreserveChatEscapes(context.userMessage??'')})), {longForm:isLongFormRequest(context.userMessage ?? ''),paragraphFallback:context.mode==='private'});
  const history = context.recentReplies ?? [];
  let check = checkReplyQuality(content, context.mode === 'proactive' ? '' : context.userMessage ?? '', history[history.length - 1], history.slice(-4), { catchphrase: context.catchphrase });
  // Story identity selection is not a license to contradict the app's current
  // relationship. This narrow check also applies to explicitly fictional turns.
  const identityConflict=context.selectedPartnerRole&&rejectsSelectedPartner(content,context.selectedPartnerRole,context.userMessage??'');
  if(identityConflict)check={ok:false,issue:'voice-conflict',retryHint:'本条用户已明确选择应用支持的伴侣故事身份；先前退出阶段的疏离不再是当前关系。直接回应本条内容或心意，不否定扮演身份、不要求证明真假，也不编造此前等待或共同经历。保留你自己的语气与主见，不必解释身份规则。'};
  if(check.ok&&!allowsDramaticReply(context.userMessage??'',context.recentUserMessages)
    &&findDomesticReferenceRisk(content,context.persona,context.independentCharacterRecords,context.userHabitSources))
    check={ok:false,issue:'self-report-risk',retryHint:'保留你对眼前小事的反应、看法和自然玩笑。刚才的假设夹带了没有来源的已有家庭物件；假设某人看见或怎么做，不证明家里已经有那些东西。可以说这个设想本身，不用另编家里的现成物件或解释资料核对。'};
  if(check.ok && !allowsDramaticReply(context.userMessage ?? '',context.recentUserMessages)) {
    if(findUserAudioRisk(content))check={ok:false,issue:'user-source-risk',retryHint:'这次请求只有文字或图片，没有用户的声音。保留你对原话的反应与心意，不把文字中的开心写成听到了笑声、嗓音或呼吸；普通“听你这么说”仍可使用，不替换成看见身体表情，也不向用户解释检查过程。'};
    else if(findUserVisualRisk(content,context.hasUserVisualEvidence??context.hasCurrentImage))check={ok:false,issue:'user-source-risk',retryHint:'这次请求没有可查看的用户图片。沿用户已经描述的内容表达自己的兴趣、联想或看法，也可以自然请他发图；不要假装已看见画面、检查过像不像或补未提供的颜色细节。不需要向用户解释核对过程。'};
    else if(hasUninvitedStaging(content)) check={ok:false,issue:'uninvited-staging',retryHint:'这轮是在发消息，不是同处一室。保留角色态度与亲密感，直接接用户的话；不要继续进门、坐下、看着对方或当面再说的表演，也不要换一组动作替代。'};
    else if(hasOverwrittenAffection(content,context.userMessage ?? '')) check={ok:false,issue:'emotional-script',retryHint:'直接用角色自己的口语表达对这份心意的态度；不要层层解释如何接收这句话，不堆意象、仪式或要求当面再说，不强迫回应相同爱意。'};
    else if(findAffectionHistoryRisk(content,context.userMessage,context.recentUserMessages,context.persona)) check={ok:false,issue:'emotional-script',retryHint:'保留你对这句话的喜欢、开心或轻轻打趣；当前没有依据判断对方平时很少直白表达，不要把这一刻写成难得、终于或与过去比较。直接说自己的当下反应，不向对方解释检查过程，也不追加考查心意来历的问题。'};
    else if(findRememberedTeasingRisk(content,context.userMessage,context.recentUserMessages)) check={ok:false,issue:'user-source-risk',retryHint:'刚才把用户的笑声或不同偏好写成了他以前取笑你的具体往事。现有原话没有明确的对应说法，保留自己的偏好与眼前玩笑，别说他笑过你、记着账；也不否认全部过去、不向他解释检查过程。'};
    else if(findUserHabitRisk(content,context.userHabitSources??[...(context.recentUserMessages??[]),context.userMessage??'']))check={ok:false,issue:'user-source-risk',retryHint:'保留你的当下喜好、心意与对这件事的反应。刚才把熟悉的语气写成了缺少原话支持的用户习惯；已有关系不证明对方平时如何说话或做事，不需要编共同体验来解释自己的偏好。不要换成另一种用户习惯或身体经历，也不用解释检查过程。'};
    else if(findCurrentActivityRisk(content,context.mode==='private'?context.userMessage:'',context.persona)) check={ok:false,issue:'self-report-risk',retryHint:'刚才新增了自己正在做或尚未做完的活动，但当前没有对应的角色场景来源。选择吃什么、喜欢什么或用户正在做的事不证明你也正在做；保留自己的偏好、眼前反应或告别，不换成另一段正在忙的近况。未来想做什么仍可以作为此刻选择说清；不用向对方解释资料核对过程，不否认全部过去。'};
    else {
      const risk=findSelfReportRisk(content,context.persona,context.independentCharacterRecords);
      if(risk)check={ok:false,issue:'self-report-risk',retryHint:`刚才新增了缺少独立来源的具体经历或生活习惯自述：${JSON.stringify(risk.quote)}。保留对眼前事情的反应、当下喜好或玩笑，不需要补一个共同经历。不要用以前或正在做的另一种动作替换它，不否认未记载的过去，不向用户解释核对过程。`};
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
  const severity = check.ok ? 0 : identityConflict || check.issue === 'empty' ? 4 : check.issue === 'generic' || check.issue === 'uninvited-staging' || check.issue === 'self-report-risk' ? 3 : check.issue === 'repeat-own' || check.issue === 'emotional-script' || check.issue === 'user-source-risk' ? 2 : 1;
  return { content, check, severity };
}
