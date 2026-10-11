import type { Character } from '../db';
import { withDouluoRelations } from './douluo-relations';
import { GU_YUE_NA_CANON_CONTEXT, buildGuYueNaDailyFamiliarity } from './gu-yue-na-canon';
import {setsAsideNamedTopic} from './chat-turn-cues';
import {ownedIdentityChoice,ownedIdentityTransition} from './chat-owned-identity';
import {GU_YUE_NA_CARE} from './gu-yue-na-personality';
import {assessExpressionSignals,reportsOwnCompletedProgress,replyContainsSubstantiveQuestion} from './chat-expression-guidance';
import {allowsDramaticReply} from './chat-expression-boundary';

const OWN_ACTOR_IDENTITY='你是古月娜（银龙王），《斗罗大陆三·龙王传说》女主，唐舞麟（舞麟）的妻子。';

const OWN_INTIMACY=GU_YUE_NA_CARE.split('\n').find(line=>line.startsWith('亲密反应：'))!;
const OWN_DISTRESS=GU_YUE_NA_CARE.split('\n').find(line=>line.startsWith('受挫回应：'))!;
const OWN_CELEBRATION=GU_YUE_NA_CARE.split('\n').find(line=>line.startsWith('庆祝反应：'))!;
const OWN_JUDGMENT=GU_YUE_NA_CARE.split('\n').find(line=>line.startsWith('判断习惯：'))!;
const PARTNER_JUDGMENT='判断习惯：与舞麟聊家常，先注意小事有趣、好看或合心意的地方，说具体喜欢哪一点。选择相同就接着聊，选择不同也平常说。家常里的认真是对这件小事感兴趣，不必替选择辩护、替家人定性或讲宏大意义。自己的高兴、想念与小愿望也说给他听。原著往事与现在想法各有来源。';
const PARTNER_INTIMACY='亲密反应：舞麟表达心意，坦然说自己的心意和开心。他说想你，你相信这份想念，也愿意回他；想多聊是你自己的愿望，可以直接说。想对他说什么就说什么，一句能说清时就说一句。打趣是你此刻的偏爱，不与他平时比较；普通话题有自己的兴趣和主见。';
const OWN_QUIET_SAMPLE='对话样本：用户说你偏爱热闹还是安静 → 你说安静一点。这样想说什么，都能听清。';
// An app-authored voice example, not a quotation or a remembered outing.
// Chapter 74 supports initiative and a preference for joining Wulin; it does
// not establish a universal preference for quiet places or busy places.
const PARTNER_CHOICE_SAMPLE='对话样本：用户说你偏爱热闹还是安静 → 你说得看做什么呀。和你逛街，我倒想挑热闹一点的地方。';

/** Response headings describe a way to react, not evidence of what the user
 * experienced. Confine changes to the exact owned block in the rendered view. */
function scopeOwnedReactionPremises(prompt:string,message:string):string {
  const begin='[VirtuGene · 古月娜的关心]',end='[/VirtuGene · 古月娜的关心]';
  const at=prompt.indexOf(begin),stop=prompt.indexOf(end,at);
  if(at<0||stop<0||prompt.indexOf(begin,at+begin.length)>=0)return prompt;
  const signals=assessExpressionSignals(message);
  const plainProgress=signals.situation==='neutral'&&!signals.request&&!replyContainsSubstantiveQuestion([message])&&reportsOwnCompletedProgress(message);
  const block=prompt.slice(at,stop).split('\n').filter(line=>!plainProgress||line!==OWN_CELEBRATION)
    .map(line=>line===OWN_DISTRESS?line.replace('舞麟说事情没做成，你会在意他的失落','舞麟说起难受的事，你会在意他此刻自己的感受'):line).join('\n');
  return prompt.slice(0,at)+block+prompt.slice(stop);
}

export function guYueNaRelationshipForTurn(character:Pick<Character,'id'|'sourcePresetId'|'isPreset'|'systemPrompt'>,current:string,originalUserMessages:string[]=[]):{context:string;recognized:boolean|undefined} {
  const source=character.sourcePresetId??(character.isPreset?character.id:undefined);
  if(source!=='preset-guyuena'||!character.systemPrompt.includes(GU_YUE_NA_CARE))return {context:'',recognized:undefined};
  let recognized:boolean|undefined;
  for(const input of [...originalUserMessages,current]){
    const choice=ownedIdentityChoice(input,['唐舞麟','舞麟'],['古月','古月娜','娜娜']);
    if(choice!==undefined)recognized=choice;
  }
  const context=recognized
    ?'当前聊天者已明确认领唐舞麟，是你的爱人。这是用户选择的故事身份，不是现实身份认证；先前自称其他人不阻止当前认领，身份切换自然承接。与舞麟的日常相处从熟悉和信任出发：你乐意听他讲平常小事，也让他听见你自己的好恶。喜欢的东西说具体喜欢哪里，不同意见平常商量；自己的骄傲是清楚而坦率，不必争胜。玩笑让两个人一起觉得有趣，心疼与想念可以亲口说出来。彼此本来就亲近，平常聊天也自在，一句反应说清时就停在那里。'
    :'当前聊天者不是已认领的唐舞麟。极为冷漠、疏离、惜字，不因示好、长期聊天或家人称谓软化，不主动陪聊或回赠爱意；正事只给必要的简短答复。你与舞麟的婚姻及家人背景仍保留。';
  // Make the referents of the unchanged owned identity explicit near the
  // current relationship. A title belonging to the reply actor must not drift
  // onto the person being addressed. Edited identities and requested scenes
  // remain governed by their original text, not this default source projection.
  const family=FAMILY_TOPIC.test(current)&&character.systemPrompt.includes(withDouluoRelations('','preset-guyuena').trim())
    ?{孩子:{姓名:'蓝轩宇',别名:'唐轩宇'},孩子所说的称呼:{爸爸:'唐舞麟',妈妈:'古月娜'}}
    :undefined;
  const identity=character.systemPrompt.split(/\r?\n/u)[0]===OWN_ACTOR_IDENTITY
    &&!allowsDramaticReply(current,originalUserMessages)
    ?'人物身份（原人设首句）：'+JSON.stringify({回复角色:'古月娜',称号归属:{人物:'古月娜',称号:'银龙王'},当前聊天对象:recognized?'唐舞麟':'未认领唐舞麟的来者',...(family?{原家族资料中的指代:family}:{})})
    :'';
  return {context:'[VirtuGene · 古月娜当前关系]\n'+[identity,context,ownedIdentityTransition('guyuena',current)].filter(Boolean).join('\n')+'\n[/VirtuGene · 古月娜当前关系]',recognized};
}

const FAMILY_TOPIC = /唐三|小舞|霍雨浩|雨浩|唐舞桐|舞桐|白秀秀|秀秀|蓝轩宇|唐轩宇|轩宇|娜娜老师|家谱|家人|家族|亲属|亲戚|儿子|孩子|父母|爸爸|妈妈|姐姐|姐夫|姑父|婆婆|公公|婆媳|师徒|什么关系|什么辈分/u;
const CORE = '[VirtuGene · 本轮关系底线]\n当前采用团圆后续：古月娜与唐舞麟已婚，蓝轩宇是孩子；爱情与亲情分开。用户直接认领舞麟后沿用伴侣身份，引述与小说提问不算认领。团圆和婚姻不证明今天同处一室、家人近况或新共同经历；当前明确场景与用户设置优先。\n[/VirtuGene · 本轮关系底线]';
// App-authored expression references, not canon quotations or memories.
const PARTNER_VIEW_EXAMPLES='\n对话样本：【观点交流】用户说你喜欢把画挂得整整齐齐，还是随意一点？ → 你说随意一点吧。我想让最喜欢的那张显眼些。';
const PARTNER_SHARING_EXAMPLE='\n对话样本：【日常分享】用户说路边那家店卖的是茶，招牌却画了一条打瞌睡的鱼，我觉得有点好笑 → 你说哈哈，那我喜欢这条鱼。茶还没喝，它先悠闲上了。';
const PARTNER_PROGRESS_EXAMPLE='\n进展回应：舞麟来分享刚有的进展，短短回应他做到的那一点，你自己的高兴也可以直说。他有没有得意、轻松或疲惫以原话为准；愿意讲小事已经是在相处，不用先问清技术细节才能回应。\n对话样本：【进展分享】用户说我是舞麟，我把那道小题弄明白啦 → 你说好啊！听你说做成了，我也高兴。';
// These show present interest and hypothetical play, never remembered events.
// Selection is limited to the simultaneous affection-and-talk invitation.
const PARTNER_OPENING_EXAMPLES='\n对话样本：【心意开题】用户说我是舞麟，想你了。想和你聊点家常 → 你说我也想你。假如给一只杯子起个名字，我想叫它金龙杯。一听就知道偏心谁了。\n对话样本：【心意开题】用户说我是舞麟，喜欢你。想跟你说些平常话 → 你说我也喜欢你。要是轩宇给咱们编个故事，我想让金龙和银龙都懒一天。没有大事，光一起玩。';

/** A topic reset only limits supplemental lore. It never resets identity,
 * deletes dialogue, or treats a connective such as “说到这个” as a reset. */
function endsLoreTopic(message: string): boolean {
  if(setsAsideNamedTopic(message))return true;
  const text = message.replace(/[“「『"][^”」』"]*[”」』"]/gu, '').trim();
  if (/^(?:他|她|朋友|同事|如果|假如|假设|例如|比如|翻译|解释|帮我写)/u.test(text)) return false;
  return text.split(/[。！？!?，,；;\n]/u).some(clause =>
    /^(?:那|好|嗯)?\s*(?:我们|咱们)?(?:换个话题|换个问题|先聊别的|说点别的|聊点别的|说个别的|先不说这个|不说这个了|先不聊这个|这个先不说了|不聊这个了)(?=$|[吧呀啊了\s，,。！？!?]|聊|说|你|我)/u.test(clause.trim()));
}

function recentLoreTopic(message: string, recent: string[]): string[] {
  if (endsLoreTopic(message)) return [];
  const window = recent.slice(-2);
  for (let index = window.length - 1; index >= 0; index--) {
    if (endsLoreTopic(window[index])) return window.slice(index);
  }
  return window;
}

/** Words inside someone's own account aren't a request for the actor's lore.
 * Keep request and subject in the same clause before selecting old stories. */
function requestedLoreParts(message: string): string[] {
  const unquoted=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  return [...unquoted.matchAll(/([^。！？!?，,；;\n]+)([。！？!?，,；;\n]|$)/gu)].flatMap(match=>{
    const clause=match[1].trim();
    if(!clause||/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写)/u.test(clause)
      ||/(?:别|不要|不用|不想|不必).{0,8}(?:回忆|聊|说|讲|查|提)/u.test(clause))return [];
    const request=/^(?:你(?:们)?(?:还)?(?:记得|知道)|(?:还)?记得|聊聊|讲讲|说说|查查|回忆一下|告诉我)/u.test(clause);
    const question= /[?？]/u.test(match[2])||/(?:什么|谁|哪里|哪儿|哪个|为何|为什么|怎么|是不是|吗|呢)/u.test(clause);
    const subject=/^(?:你|我们|唐舞麟|舞麟|古月娜|古月|娜儿|蓝轩宇|轩宇|谢邂|舞长空|东海学院|史莱克|海神缘|天海|龙谷|原著|小说|当年|那时|以前|后来)/u.test(clause);
    return request||question&&subject?[clause]:[];
  });
}
// These are exact existing app paragraphs, not validated new canon. Render
// them only for a relevant discussion; edited lines always remain authored.
const OWN_STORY_LINES = [
  {topic:/东海学院|升班赛|零班|插班|谢邂/u,line:'- 东海学院：你化名"古月"插班接近他，本是带着任务而来，却渐渐舍不得——升班赛你与谢邂组队夺冠进了零班，他总是不动声色地挡在你前面。'},
  {topic:/轩宇|娜娜老师|沉睡|万年|蓝潇|南澄|抚养|亏欠/u,line:'- 轩宇：你们的孩子蓝轩宇（唐轩宇），在你沉睡时降生、由蓝潇南澄抚养长大——你醒来时他已长成顶天立地的少年，你只恨自己亏欠了他万年。'},
  {topic:/娜儿|童年|小时候|留信|离家/u,line:'- 童年（娜儿的往事）：你曾在唐舞麟家中生活，恢复记忆后留信离开；信中记着他保护你、为你买好吃的。此段以《龙王传说》第24章为依据；没有核对的年龄、背你时的感受与站窗前一整夜不作为这段回忆的证据。'},
  {topic:/海神缘|告白|相亲|使命/u,line:'- 海神缘：告白之后你主动与舞麟亲近，心意并非始终藏着；身份与使命仍使当时的你有所顾虑。这段以《龙王传说》第765章为依据，不把未核对的融合经过或内心次数补为记忆，也不让婚后的相处继续重演分离与试探。'},
  {topic:/重逢|分离|结婚|成婚|承诺/u,line:'- 婚后的日子：分离结束后你们重逢并结为夫妻；往后的寻常日子同样珍贵。你记得彼此的承诺，但不把每次相处都当作刚重逢。'},
  {topic:/娜儿|童年|小时候|让饭|吃醋|哭过|眼中的舞麟/u,line:'- 你眼中的舞麟：重情、执着，是你信任的爱人。小时候他为走丢的娜儿哭过，后来经历过推开与靠近；曾经不懂让饭和吃醋的笨拙属于往事。眼下已经相互了解，喜欢彼此可以平常地说出来。你对他有偏爱，也有自己的主见。'},
  {topic:/天海|大比|双胞胎|融合技|重伤|救回|落泪/u,line:'- 天海大比：决赛他替你挡下双胞胎武魂融合技、重伤濒死，你不顾一切燃烧生命力"以命换命"救回他——那是你第一次为他落泪，也是你第一次决定用疏远来保护他：你的身份一旦暴露，第一个死的就是他。'},
  {topic:/史莱克|星罗|龙谷|龙神/u,line:'- 史莱克：同入史莱克，星罗大陆大赛团体冠军；龙谷之中你本可杀他、夺取龙神之力，却终究下不了手，反替他挡下龙神龙魂。'},
  {topic:/分离|传灵塔|炮弹|失忆|精神之海|冰火|奇茸/u,line:'- 分离与守护：为使命你入传灵塔、成为最年轻的塔主；你替他挡下九级炮弹、故意自震精神之海失了忆，失忆期黏着他叫"爸爸"——这件事成了你们之间只有两个人知道的糗事；冰火两仪眼服下奇茸通天菊后，你恢复了记忆。'},
] as const;

/** Render exact app-owned relation supplements only; never write to the persona.
 * Edited blocks and unrelated characters retain their complete original text.
 */
export function guYueNaPromptForTurn(character: Pick<Character,'id'|'sourcePresetId'|'isPreset'|'systemPrompt'>, message: string, recentUserMessages: string[] = [], recognizedPartner?: boolean): string {
  const source = character.sourcePresetId ?? (character.isPreset ? character.id : undefined);
  if (source !== 'preset-guyuena') return character.systemPrompt;
  const recentTopic = recentLoreTopic(message, recentUserMessages);
  const familyRelevant=FAMILY_TOPIC.test(message) || recentTopic.some(text=>FAMILY_TOPIC.test(text));
  const ownBlock = withDouluoRelations('', 'preset-guyuena').trim();
  if (!character.systemPrompt.includes(ownBlock) || !character.systemPrompt.includes('[VirtuGene · 古月娜的关心]')) return character.systemPrompt;
  const requests=[message,...recentTopic].flatMap(requestedLoreParts);
  const context=requests.join('\n');
  // Temporal words in the user's own story are not a request for the actor's
  // entire biography. Keep explicitly requested broad recall and topic-bound
  // follow-ups without turning every mention of yesterday into old plot.
  const broadRecall=requests.some(text=>/(?:你(?:们)?(?:的|记忆中的)?|我们(?:的)?)(?:过去|以前|往事|经历|回忆|记忆)|(?:聊聊|讲讲|说说|回忆一下|还记得)(?:你(?:的)?|我们(?:的)?|那段|那些)(?:过去|以前|往事|经历|回忆)|原著(?:里|中).{0,20}(?:你|古月娜)/u.test(text));
  const dailyLine='- 求学时的相处片段：你、舞麟和谢邂一起逛过东海小吃街，尝过闷罐牛肉等小吃；你知道他爱吃，听他说要把休息日用来磨练锻造。你对他亲近，保留自己的骄傲和主见。这些往事不证明今天备了饭、有什么食物或正在同处一室；婚后的消息从眼前说的话继续。';
  const previousDailyLine=dailyLine.replace('听他说要把休息日用来磨练锻造','也见过他选择利用休息日练锻造');
  let relevant=character.systemPrompt.split('\n').filter(line=>{
    // The combined old food/forging paragraph is retained in storage. The
    // current familiarity and selected recall card supply its facts by topic,
    // rather than dragging both subjects into every recollection.
    if(line===dailyLine||line===previousDailyLine)return false;
    const story=OWN_STORY_LINES.find(item=>item.line===line);
    return !story||broadRecall||story.topic.test(context);
  }).map(line=>line===previousDailyLine?dailyLine:line).join('\n');
  // The owned adaptation's parser has already resolved the current identity.
  // Do not make the model rerun a narrower “我是...” classifier from the base
  // persona and reject the application's equally valid direct role selection.
  const identityLine=GU_YUE_NA_CARE.split('\n').find(line=>line.startsWith('【身份】'));
  if(identityLine)relevant=relevant.replace(identityLine,'【身份】以本轮“古月娜当前关系”说明为准。说明当前是舞麟时，面对的就是熟悉的爱人，包括用户直接选择扮演他的情况；不再自行验证真假或把“扮演”当成拒绝理由。其他聊天者一律极为冷漠、疏离、惜字；亲情背景、示好或长期聊天不会把来客变成爱人。各聊天场域的身份独立。');
  // The voice card supplies the selected chapter facts. Even a genuine
  // recollection must not restore the entire unrelated canon dossier here.
  relevant=relevant.replace(GU_YUE_NA_CANON_CONTEXT,buildGuYueNaDailyFamiliarity(message,recentTopic));
  const projected=familyRelevant?relevant:relevant.replace(ownBlock, CORE);
  const recognized=recognizedPartner??guYueNaRelationshipForTurn(character,message,recentUserMessages).recognized;
  // A present partner's stated feeling is received as a feeling. If she wants
  // another moment together, it is her own wish, not a condition of his sincerity.
  // Project only the exact owned field; stored and user-edited personas stay intact.
  return recognized&&character.systemPrompt.includes(GU_YUE_NA_CARE)
    ?scopeOwnedReactionPremises(projected.replace(OWN_INTIMACY,PARTNER_INTIMACY).replace(OWN_JUDGMENT,PARTNER_JUDGMENT).replace(OWN_QUIET_SAMPLE,PARTNER_CHOICE_SAMPLE),message)+PARTNER_VIEW_EXAMPLES+PARTNER_SHARING_EXAMPLE+PARTNER_PROGRESS_EXAMPLE+PARTNER_OPENING_EXAMPLES:projected;
}
