import {assessExpressionSignals} from './chat-expression-guidance';
import {isDirectAffection,allowsDramaticReply} from './chat-expression-boundary';

export type InteractionMoment='praise'|'affection'|'disagreement'|'repair'|'tired'|'celebration'|'ordinary';
type VoiceStyle='professional'|'partner'|'gentle'|'energetic'|'playful'|'guarded';
type ExpressionCharacter={tags:string[];systemPrompt:string;catchphrase?:string};

/** A conversational clue about what was said, never a diagnosis or relationship change. */
export function interactionMoment(message:string):InteractionMoment {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(!text||/^(?:如果|假如|假设|比如|例如|他|她|朋友|同事|主角)/u.test(text))return 'ordinary';
  if(isDirectAffection(text))return 'affection';
  if(/^(?:对不起|抱歉|不好意思)(?:[，,。！!\s]|$)|(?:我刚才|刚才是我).{0,12}(?:说重了|太冲了|误会你|弄错了)|我误会你了/u.test(text))return 'repair';
  if(/(?:^|[。！？!?，,；;\n])\s*(?:我觉得)?(?:你(?:刚才|根本|又|完全)?(?:没听|没理解|误会|理解错)|不是这个意思|我不是这个意思|我不同意|我不赞成|别给我灌鸡汤|你这样说让我不舒服)/u.test(text))return 'disagreement';
  if(/^谢谢你(?:[，,。！!～~\s]|听我说|陪我|记得|帮我|理解|解释|$)|^多亏你/u.test(text)||/^你(?:真的|好|很|太|也|真)?(?:棒|厉害|靠谱|贴心|可爱|懂我|聪明)(?:[，,。！!～~\s]|呀|啊|了|$)/u.test(text))return 'praise';
  const signals=assessExpressionSignals(text);
  if(signals.emotionConfidence>=.8&&signals.situation==='tired')return 'tired';
  if(signals.emotionConfidence>=.8&&signals.situation==='celebration')return 'celebration';
  return 'ordinary';
}

const MOMENT_NAMES:Record<Exclude<InteractionMoment,'ordinary'>,string>={praise:'被夸或被感谢',affection:'直接的心意',disagreement:'分歧或表达落差',repair:'道歉与澄清',tired:'疲惫',celebration:'进展与开心'};
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

const AUTHORED_REACTION=/^(?:[-*]\s*)?(?:情境反应|被夸反应|分歧反应|道歉修复|亲密反应|疲惫回应|庆祝反应)[：:]/u;
const FIELD_NAMES:Partial<Record<InteractionMoment,string>>={praise:'被夸反应',disagreement:'分歧反应',repair:'道歉修复',affection:'亲密反应',tired:'疲惫回应',celebration:'庆祝反应'};
export function authoredReactionLines(prompt:string,message?:string):string[]{
  const field=message===undefined?undefined:FIELD_NAMES[interactionMoment(message)];
  return prompt.split(/\r?\n/u).map(s=>s.trim()).filter(s=>AUTHORED_REACTION.test(s))
    .filter(s=>message===undefined||s.replace(/^[-*]\s*/u,'').startsWith('情境反应：')||s.replace(/^[-*]\s*/u,'').startsWith('情境反应:')||!!field&&s.replace(/^[-*]\s*/u,'').startsWith(field))
    .slice(0,3).map(s=>s.slice(0,180));
}

/** Choose relevant examples, never fabricate one or rewrite the original. */
export function selectVoiceExamples(lines:string[],message?:string):string[]{
  if(message===undefined)return lines.slice(0,5);
  const moment=interactionMoment(message);
  const ranked=lines.map((line,index)=>({line,index,moment:interactionMoment(line.match(/用户说(.{1,80}?)\s*(?:→|->)/u)?.[1]??'')}));
  ranked.sort((a,b)=>Number(b.moment===moment&&moment!=='ordinary')-Number(a.moment===moment&&moment!=='ordinary')||a.index-b.index);
  return ranked.slice(0,3).map(row=>row.line);
}

export function emotionalExpressionGuidance(message:string,history:Array<{role:string;content:string}>,character?:ExpressionCharacter|null,recentReplyTurns?:string[][]):string{
  const users=history.filter(m=>m.role==='user').slice(-3).map(m=>m.content);
  if(allowsDramaticReply(message,users))return '';
  const moment=interactionMoment(message),lines:string[]=[];
  if(moment!=='ordinary'){
    const authored=authoredReactionLines(character?.systemPrompt??'',message);
    if(authored.length)lines.push(`本轮涉及${MOMENT_NAMES[moment]}，优先按人物写明的情境反应表达，不套通用性格标签。`);
    else{
      const styles=STYLES.filter(([,pattern])=>pattern.test((character?.tags??[]).join('、'))).slice(0,2);
      const choices=styles.map(([style])=>REACTIONS[style][moment]);
      lines.push(choices.length?`本轮${MOMENT_NAMES[moment]}：${choices.join(' ')}`:`本轮涉及${MOMENT_NAMES[moment]}，按人物自己的关注点回应具体内容，不替人物添加新的性格或亲密关系。`);
    }
  }
  const prior=users.map(interactionMoment);
  if(moment==='repair'&&prior.slice(-2).includes('disagreement'))lines.push('前面有明确分歧，这轮是道歉或澄清。先回应哪里得到解释，语气可以缓和；不假定角色已经生气，也不突然撒娇或宣告关系完全修复。');
  else if(moment==='praise'&&prior[prior.length-1]==='repair'&&prior.includes('disagreement'))lines.push('刚从分歧转到澄清和感谢，可以自然放松一点，不再复盘，也不为了保持情绪继续追究。');
  const turns=recentReplyTurns??history.filter(m=>m.role==='assistant').slice(-4).map(m=>[m.content]);
  const openings=['辛苦了','慢慢来','我懂你','我理解你','别太勉强'];
  const repeated=openings.find(opening=>!character?.catchphrase?.trim().startsWith(opening)&&turns.slice(-4).filter(parts=>parts.join('').trim().startsWith(opening)).length>=3);
  if(repeated&&!message.includes(repeated))lines.push('最近多轮都以同类安慰开场。这轮直接接当前内容，不必换一个安慰词继续套同一结构；人物自己的口癖仍可自然保留。');
  return lines.slice(0,3).join('\n');
}
