import { normalizeChatResponse } from './chat-pacing';
import { stripRoleplayActions } from './ai/text';
import { checkReplyQuality, isLongFormRequest, polishChatResponse, type ReplyCheck } from './reply-quality';
import { allowsDramaticReply, hasOverwrittenAffection, hasUninvitedStaging } from './chat-expression-boundary';

export interface OutputQualityContext {
  mode: 'private' | 'proactive' | 'group';
  userMessage?: string;
  recentReplies?: string[];
  recentUserMessages?: string[];
  catchphrase?: string;
  persona?: string;
}
/** Shared textual checks; proactive history is not a new user request. */
export function inspectChatOutput(raw: string, context: OutputQualityContext): { content: string; check: ReplyCheck; severity: number } {
  const content = polishChatResponse(stripRoleplayActions(normalizeChatResponse(raw)), {longForm:isLongFormRequest(context.userMessage ?? ''),paragraphFallback:context.mode==='private'});
  const history = context.recentReplies ?? [];
  let check = checkReplyQuality(content, context.mode === 'proactive' ? '' : context.userMessage ?? '', history[history.length - 1], history.slice(-4), { catchphrase: context.catchphrase });
  if(check.ok && !allowsDramaticReply(context.userMessage ?? '',context.recentUserMessages)) {
    if(hasUninvitedStaging(content)) check={ok:false,issue:'uninvited-staging',retryHint:'这轮是在发消息，不是同处一室。保留角色态度与亲密感，直接接用户的话；不要继续进门、坐下、看着对方或当面再说的表演，也不要换一组动作替代。'};
    else if(hasOverwrittenAffection(content,context.userMessage ?? '')) check={ok:false,issue:'emotional-script',retryHint:'直接用角色自己的口语表达对这份心意的态度；不要层层解释如何接收这句话，不堆意象、仪式或要求当面再说，不强迫回应相同爱意。'};
  }
  // Only explicit authored constraints are enforceable locally. No score for
  // missing catchphrases, a quiet reaction or a professional-sounding sentence.
  const noEmoji=/^(?:表情|emoji)[：:]\s*(?:不用|不使用|禁止|不要)/imu.test(context.persona ?? '');
  const requestedEmoji=/(?:用|加|来).{0,4}(?:emoji|表情)/iu.test(context.userMessage ?? '')&&!/(?:不用|不要|别)/u.test(context.userMessage ?? '');
  const forbidden=(context.persona ?? '').split(/\r?\n/u).filter(line=>/^禁用称呼[：:]/u.test(line)).flatMap(line=>line.replace(/^禁用称呼[：:]\s*/u,'').split(/[、，,]/u)).map(s=>s.trim()).filter(Boolean);
  const wrongAddress=forbidden.some(name=>content.split(/[。！？!?\n]|-{3,}/u).some(s=>s.trim().startsWith(name+'，')||s.trim().startsWith(name+',')));
  if(check.ok && (wrongAddress || noEmoji && !requestedEmoji && /\p{Extended_Pictographic}/u.test(content))) check={ok:false,issue:'voice-conflict',retryHint:'遵守人设中明确的表情与禁用称呼要求；其他内容和角色自己的语气保留，不强塞口头禅。'};
  const severity = check.ok ? 0 : check.issue === 'empty' ? 4 : check.issue === 'generic' || check.issue === 'uninvited-staging' ? 3 : check.issue === 'repeat-own' || check.issue === 'emotional-script' ? 2 : 1;
  return { content, check, severity };
}
