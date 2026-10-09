import {assessExpressionSignals} from './chat-expression-guidance';
import {isDirectAffection,allowsDramaticReply} from './chat-expression-boundary';
import {authoredVoiceFields,JUDGMENT_FIELDS,REACTION_FIELDS} from './character-voice-fields';
import {topicTerms} from './chat-conversation-state';
import {recentQuestionDirection} from './chat-expression-guidance';

export type InteractionMoment='praise'|'affection'|'disagreement'|'repair'|'tired'|'celebration'|'ordinary';
type VoiceStyle='professional'|'partner'|'gentle'|'energetic'|'playful'|'guarded';
type ExpressionCharacter={tags:string[];systemPrompt:string;catchphrase?:string;hasVoiceJudgment?:boolean};

/** A conversational clue about what was said, never a diagnosis or relationship change. */
export function interactionMoment(message:string):InteractionMoment {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(!text||/^(?:如果|假如|假设|比如|例如|他|她|朋友|同事|主角)/u.test(text))return 'ordinary';
  // Asking about the wording of disagreement does not express that disagreement.
  if(/^(?:我(?:也|其实|还是|有点)?|也|其实)?不(?:太|完全|怎么)?(?:同意|赞成|认同)\s*(?:这个词|这句话|这几个字)(?:是)?什么意思[？?]?$/u.test(text))return 'ordinary';
  if(isDirectAffection(text))return 'affection';
  if(/^(?:对不起|抱歉|不好意思)(?:[，,。！!\s]|$)|(?:我刚才|刚才是我).{0,12}(?:说重了|太冲了|误会你|弄错了)|我误会你了/u.test(text))return 'repair';
  if(/(?:^|[。！？!?，,；;\n])\s*(?:我觉得)?(?:你(?:刚才|根本|又|完全)?(?:没听|没理解|误会|理解错)|不是这个意思|我不是这个意思|(?:我(?:也|其实|还是|有点)?|也|其实)?不(?:太|完全|怎么)?(?:同意|赞成|认同)|别给我灌鸡汤|你这样说让我不舒服)/u.test(text))return 'disagreement';
  if(/^谢谢你(?:[，,。！!～~\s]|听我说|陪我|记得|帮我|理解|解释|$)|^多亏你/u.test(text)||/^你(?:真的|好|很|太|也|真)?(?:棒|厉害|靠谱|贴心|可爱|懂我|聪明)(?:[，,。！!～~\s]|呀|啊|了|$)/u.test(text))return 'praise';
  const signals=assessExpressionSignals(text);
  if(signals.emotionConfidence>=.8&&signals.situation==='tired')return 'tired';
  if(signals.emotionConfidence>=.8&&signals.situation==='celebration')return 'celebration';
  return 'ordinary';
}

const MOMENT_NAMES:Record<Exclude<InteractionMoment,'ordinary'>,string>={praise:'被夸或被感谢',affection:'直接的心意',disagreement:'意见不同或理解纠正',repair:'道歉与澄清',tired:'疲惫',celebration:'进展与开心'};
const STYLES:Array<[VoiceStyle,RegExp]>=[
  ['professional',/专业|理性|高冷|冷淡|寡言|冷静|外冷/u],
  ['partner',/搭档|随和|爽朗|直率|坦率/u],
  ['gentle',/温柔|体贴|耐心|治愈/u],
  ['energetic',/元气|活泼|开朗|热情|外向/u],
  ['playful',/俏皮|幽默|搞笑|毒舌|顽皮/u],
  ['guarded',/傲娇|嘴硬|别扭|慢热|含蓄/u],
];
const REACTIONS:Record<VoiceStyle,Record<Exclude<InteractionMoment,'ordinary'>,string>>={
  professional:{
    praise:'可以坦然接受夸奖，回应用户认可的具体一点，不用假谦虚或回赠一整段赞美。',
    affection:'把真实态度说清，允许短而认真；克制不等于敷衍，也不突然变成热烈告白。',
    disagreement:'先核对具体分歧，承认有依据的纠正；有不同判断就说明一点理由，不用冷漠或教训压过去。',
    repair:'回应澄清的内容，自己的误解就直接更正；不做道德评判，也不替对方宣布所有问题解决。',
    tired:'少增加交流负担，关心可以落在一个实际限制上；用户需要答案时先给答案。',
    celebration:'注意这次突破的具体难点，允许简洁地一起高兴，不立即安排下一项。',
  },
  partner:{
    praise:'自然接下认可，可以露出一点得意，不必把功劳全部推回去。',
    affection:'用熟悉的来回表达态度，认真时就认真，不用硬塞玩笑或解释关系。',
    disagreement:'把卡住的那一点摊开说，允许各有看法，不装作一切都对。',
    repair:'让对话有机会缓和，接住具体解释，再回到眼前的事，不开检讨会。',
    tired:'陪用户把眼前负担理顺，但没要求方案时不接管和列任务。',
    celebration:'回应一起在意的进展，允许分享开心，不抢着总结成经验教训。',
  },
  gentle:{
    praise:'回应这份认可里让你在意的具体心意，可以承认开心，不急着反过来夸用户。',
    affection:'语气可以更贴近，表达自己的态度；不反复解释自己如何珍藏、接住这句话。',
    disagreement:'认真听用户指出哪一句没被理解，不分析其心理、不急着证明自己的好意。',
    repair:'让澄清有落点，可以柔和地回应；自己的问题先认，不靠长篇安慰跳过分歧。',
    tired:'关注已经说出的负担，允许少说和停一会儿，不把疲惫解释成需要振作。',
    celebration:'看见这件事对用户的具体意义，跟着开心，不把喜悦重新讲成心理分析。',
  },
  energetic:{
    praise:'可以明显开心，接住夸奖就好，不把每次认可都演成夸张庆典。',
    affection:'允许快而直接的反应，认真时收住嬉闹；热情不等于升级关系或许诺未来。',
    disagreement:'先停下热闹，回应具体意见，不用玩笑、表情或强行乐观盖过去。',
    repair:'可以慢慢恢复轻快，先回应解释，不一秒切回撒娇或庆祝。',
    tired:'降低表达强度，给用户喘气余地，不用积极口号催行动。',
    celebration:'可以自然兴奋，重点仍是这次进展，不要求用户继续保持高能量。',
  },
  playful:{
    praise:'可以带一点小得意和共同的笑点，不每次都用相同反问讨更多夸奖。',
    affection:'有分寸地接这句话，认真与玩笑都可以；不拿用户的真心试探、嘲弄或逼其重复。',
    disagreement:'收住锋芒，说明自己的判断，吐槽不对准用户的脆弱。',
    repair:'先回应澄清，气氛真的缓和后才接梗，不拿道歉当笑料。',
    tired:'幽默可以减轻负担，用户没接梗就收住，不用段子挤掉关心。',
    celebration:'分享这个具体喜悦里的反差，不抢戏或把它变成自己的段子。',
  },
  guarded:{
    praise:'可以有一点不习惯被夸的含蓄，但别每次否认夸奖或硬演口是心非。',
    affection:'表达可以留余地，仍让态度可理解，不固定假结巴、否认或反问。',
    disagreement:'保留自己的立场，必要时坦白在意，不用赌气、沉默惩罚或挖苦拖住用户。',
    repair:'允许语气逐渐软下来，不必立刻亲昵，也不故意延长别扭。',
    tired:'关心可以少而具体，不用刻薄来证明嘴硬，也不突然变成温柔客服。',
    celebration:'允许真实开心，不为了维持冷淡人设始终否认在意。',
  },
};

const FIELD_NAMES:Partial<Record<InteractionMoment,string>>={praise:'被夸反应',disagreement:'分歧反应',repair:'道歉修复',affection:'亲密反应',tired:'疲惫回应',celebration:'庆祝反应'};
export function authoredReactionLines(prompt:string,message?:string):string[]{
  const field=message===undefined?undefined:FIELD_NAMES[interactionMoment(message)];
  return authoredVoiceFields(prompt,REACTION_FIELDS)
    .filter(row=>message===undefined||row.field==='情境反应'||row.field===field)
    .slice(0,3).map(row=>row.line.slice(0,180));
}

/** Choose relevant examples, never fabricate one or rewrite the original. */
export function voiceExampleUserText(line:string):string {
  const arrow=line.match(/用户(?:说|[：:]\s*)?\s*(.{1,120}?)\s*(?:→|->)\s*(?:你|角色|TA)(?:说|[：:])/iu);
  const labelled=line.match(/用户[：:]\s*(.{1,120}?)\s*(?:你|角色|TA)[：:]/iu);
  const text=(arrow?.[1]??labelled?.[1]??'').trim();
  // Quotation marks here delimit the authored example, rather than reporting
  // someone else's statement. Keep nested quotations inside the example.
  const quoted=text.match(/^[“「『"]([\s\S]*)[”」』"]\s*[。.]?$/u);
  return (quoted?.[1]??text).trim();
}

/** A narrow scene analogy for harmless mishaps, not an emotion diagnosis.
 * It only ranks the character's own existing examples; it generates no reply
 * and establishes no fact about either speaker.
 */
function isCasualMishap(message:string):boolean {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const signal=assessExpressionSignals(text);
  if(!text||interactionMoment(text)!=='ordinary'||signal.request||signal.emotionConfidence>=.8)return false;
  if(/^(?:如果|假如|假设|比如|例如)|(?:别|不要|不想).{0,6}(?:开玩笑|逗|笑)|(?:没|没有|不会|不是).{0,4}(?:忘|找)|(?:吃药|药物|医院|密码|银行卡|转账|开车|驾驶|受伤|着火|燃气|煤气|丢失|丢了|文件|报警)/u.test(text))return false;
  return /(?:忘了|忘记了?)(?:本来|自己|刚才)?(?:要|想)?(?:干嘛|干什么|拿什么|做什么|找什么)/u.test(text)
    || /(?:端着|拿着|握着|戴着)[^。！？!?]{1,12}(?:却|还|又|一直)?(?:在)?找[^。！？!?]{1,12}/u.test(text)
    || /袜子.{0,12}(?:不是一对|不成对|不一样|穿错)/u.test(text)
    || /(?:衣服|袜子|鞋|帽子).{0,6}(?:穿|戴)(?:错|反)|(?:穿|戴)(?:错|反).{0,6}(?:衣服|袜子|鞋|帽子)/u.test(text);
}

export function selectVoiceExamples(lines:string[],message?:string,options:{allowUnrelatedNeutral?:boolean}={}):string[]{
  if(message===undefined)return lines.slice(0,5);
  const moment=interactionMoment(message);
  const current=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const terms=topicTerms(current);
  const mishap=isCasualMishap(current);
  const ranked=lines.map((line,index)=>{
    const example=voiceExampleUserText(line);
    const exampleTerms=topicTerms(example.replace(/[“「『"][^”」』"]*[”」』"]/gu,''));
    const overlap=[...exampleTerms].filter(term=>terms.has(term)).length;
    const exact=example.trim().replace(/[。！？!?～~]+$/u,'')===current.replace(/[。！？!?～~]+$/u,'')&&current.length>=2;
    const sceneMatch=mishap&&isCasualMishap(example);
    return {line,index,moment:interactionMoment(example),general:!example,sceneMatch,relevance:exact?2:Math.max(sceneMatch ? 0.9 : 0,overlap/Math.max(1,exampleTerms.size))};
  })
    // A fatigue example is a poor voice reference for an explicit new subject.
    // Keep neutral examples as voice references, not unrelated emotional scripts.
    .filter(row=>row.moment==='ordinary'||row.moment===moment);
  ranked.sort((a,b)=>Number(b.moment===moment&&moment!=='ordinary')-Number(a.moment===moment&&moment!=='ordinary')||b.relevance-a.relevance||a.index-b.index);
  if (!current) return ranked.slice(0,3).map(row=>row.line);
  // Examples teach local response habits as well as a voice. A bookshop or
  // adventure example must not become a script for listening to a complaint.
  const applicable = ranked.filter(row => row.relevance > 0 || moment !== 'ordinary' && row.moment === moment);
  const general = ranked.filter(row => row.general).slice(0,1);
  if (applicable.length) return [...applicable.slice(0,2),...general].map(row=>row.line);
  // Keep one neutral reference for an unseen everyday topic. On an emotional
  // turn the authored reaction/judgment already supplies the voice; unrelated
  // neutral scenes add distraction rather than another personality signal.
  return (general.length ? general : moment === 'ordinary' && options.allowUnrelatedNeutral !== false ? ranked.slice(0,1) : []).map(row=>row.line);
}

export function emotionalExpressionGuidance(message:string,history:Array<{role:string;content:string}>,character?:ExpressionCharacter|null,recentReplyTurns?:string[][]):string{
  const users=history.filter(m=>m.role==='user').slice(-3).map(m=>m.content);
  if(allowsDramaticReply(message,users))return '';
  const moment=interactionMoment(message),lines:string[]=[];
  if(moment!=='ordinary'){
    const authored=authoredReactionLines(character?.systemPrompt??'',message);
    if(authored.length)lines.push(`本轮涉及${MOMENT_NAMES[moment]}，优先按人物写明的情境反应表达，不套通用性格标签。`);
    else if(character?.hasVoiceJudgment||authoredVoiceFields(character?.systemPrompt??'',JUDGMENT_FIELDS).length) {
      lines.push(`本轮涉及${MOMENT_NAMES[moment]}，按声音卡中这个人的具体判断习惯回应，不另套通用性格标签。`);
    } else{
      const styles=STYLES.filter(([,pattern])=>pattern.test((character?.tags??[]).join('、'))).slice(0,2);
      const choices=styles.map(([style])=>REACTIONS[style][moment]);
      lines.push(choices.length?`本轮${MOMENT_NAMES[moment]}：${choices.join(' ')}`:`本轮涉及${MOMENT_NAMES[moment]}，按人物自己的关注点回应具体内容，不替人物添加新的性格或亲密关系。`);
    }
  }
  if(moment==='disagreement'&&/(?:不是这个意思|我不是这个意思|你(?:刚才)?(?:没理解|误会|理解错))/u.test(message))lines.push('用户正在纠正理解，接这次具体澄清，不再给其用词另下一层心理定义；按其自己讲明的原因理解，不把否认的原因改写成新的疲惫或情绪解释。前文没说错的内容不用替自己认领，不补写未提供的场面、第三方态度或动机。');
  else if(moment==='disagreement')lines.push('这轮在交流不同看法，围绕用户明确说出的观点接话；情绪或遭遇由用户自己说明。自己刚才举的情况仍是自己的例子，不归到用户名下。给出你真正认同或不认同的具体一点，可以保持分歧或自然改口；不需要让用户认输或换成他的立场。');
  const prior=users.map(interactionMoment);
  if(moment==='repair'&&prior.slice(-2).includes('disagreement'))lines.push('前面有明确分歧，这轮是道歉或澄清。接住用户此刻说的歉意或解释，表达自己真正的态度；不替用户断言“你不是冲我”“你只是心情不好”，也不假定角色已经生气、突然撒娇或宣告关系完全修复。');
  else if(moment==='praise'&&prior[prior.length-1]==='repair'&&prior.includes('disagreement'))lines.push('刚从分歧转到澄清和感谢，可以自然放松一点，不再复盘，也不为了保持情绪继续追究。');
  const turns=recentReplyTurns??history.filter(m=>m.role==='assistant').slice(-4).map(m=>[m.content]);
  const questionDirection=recentQuestionDirection(turns);
  if(questionDirection)lines.push(questionDirection);
  const openings=['辛苦了','慢慢来','我懂你','我理解你','别太勉强','听见了','我在听','我听着','你慢慢说'];
  const repeated=openings.find(opening=>!character?.catchphrase?.trim().startsWith(opening)&&turns.slice(-4).filter(parts=>parts.join('').trim().startsWith(opening)).length>=3);
  if(repeated&&!message.includes(repeated))lines.push('最近多轮都以同类安慰开场。这轮直接接当前内容，不必换一个安慰词继续套同一结构；人物自己的口癖仍可自然保留。');
  return lines.slice(0,3).join('\n');
}
