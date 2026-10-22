import {hasExplicitTopicShift,setsAsideNamedTopic,requestsCharacterWording} from './chat-turn-cues';
import {conversationalHypothesis} from './chat-hypothesis';

const FAMILY_NAMING_TOPIC=/六字斗铠|银龙舞轩秀麟|金龙月轩寰语|斗铠.{0,8}(?:取名|命名|名字)/u;

import { GU_YUE_NA_CANON, GU_YUE_NA_CANON_CONTEXT } from './gu-yue-na-canon-data';
export { GU_YUE_NA_CANON, GU_YUE_NA_CANON_CONTEXT } from './gu-yue-na-canon-data';

/** Ordinary familiarity retains the established preferences, without making
 * an old scene the suggested subject of every present-day reply. Full source
 * facts remain stored and available to explicit recollection. */
export const GU_YUE_NA_DAILY_FAMILIARITY = '【熟悉舞麟的依据】\n你知道求学时舞麟爱吃、饭量大，舞麟喜欢锻造；这是已有小说背景，当前本人说出的变化优先。求学时对谢邂爱斗嘴，对舞麟却好脾气；婚后对已认领的舞麟亲近且信任，愿意坦率说自己的心意、兴趣和选择。明确问往事时可查相关小说资料，普通聊天从眼前的话继续；偏好不证明今天的活动，也不证明未核对的旧台词、反应或内心。普通访客不因此获得伴侣身份。';

/** Familiarity is a relationship, not a reason to introduce another hobby.
 * Stored canon stays intact; supply known preferences for the present subject
 * or a direct preference query, rather than seeding them behind every reply. */
export function buildGuYueNaDailyFamiliarity(message:string,recentUserMessages:string[]=[]):string {
  const unquote=(text:string)=>text.replace(/[“「『"][^”」』"]*[”」』"]|《[^》]*》/gu,'').trim();
  let text=unquote(message);
  if(/^(?:那|然后|后来)?(?:还有|那个|这个)(?:呢|吗|怎么样|是什么|还有什么)?[。！？!?\s]*$/u.test(text))
    text += '\n'+recentUserMessages.slice(-2).map(unquote).join('\n');
  text=text.split(/[。！？!?，,；;\n]/u).filter(part=>! /^(?:今天|现在|那|我们|我)?(?:先|就)?(?:(?:不(?:再)?|不要|不用|别)(?:聊|说|提)|不是(?:要|想)?(?:说|聊|提))/u.test(part.trim())
    && !/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写)/u.test(part.trim())
    && !/^(?:我)?(?:不是|并非|不)(?:很|太|真的)?(?:饿|饥饿)(?:了|的)?$/u.test(part.trim())).join('\n');
  const broad=text.split(/[。！？!?，,；;\n]/u).some(part=>{
    if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写)/u.test(part.trim()))return false;
    return /^(?:你(?:还|真的|是不是)?(?:知道|记得|了解)|(?:告诉我|说说|讲讲)).{0,24}(?:我|舞麟|唐舞麟).{0,12}(?:喜欢|喜好|爱好|口味)/u.test(part.trim())
      || /^你(?:真的|是不是)?了解我(?:吗|么|多少|什么)?$/u.test(part.trim());
  });
  const facts:string[]=[];
  // Ordinary shared wishes can mention a sourced place without asking for a
  // lore recital. Supply the small known episode so the model does not need
  // to reconstruct a whole outing from the place name alone.
  const streetTopic=unquote(message).split(/(?<=[。！？!?])|\n/u).some(sentence=>
    !/^(?:朋友|同事|他|她|有人|我听(?:说|见|到)?|翻译|解释|帮我写)/u.test(sentence.trim())
    &&!/(?:不要|不用|别|不再).{0,8}(?:聊|说|提).{0,8}小吃街/u.test(sentence)
    &&/(?:东海)?小吃街/u.test(sentence));
  const streetKnowledge=streetTopic?'本轮相关往事（不是长期口味）：东海小吃街的求学往事：你、舞麟与谢邂曾一起去，尝过闷罐牛肉；提供的是这段往事，不由它推出别的店铺、旧约定或照料经过':'';
  // A single “吃” or “饭” is not an eating subject (吃惊、吃亏、饭圈).
  // Present food language or an explicit familiarity query can retrieve the
  // old preference; no inferred current hunger, menu or appetite is added.
  const foodTopic=/(?:食物|食材|小吃|口味|牛肉|早餐|午餐|晚餐|早饭|午饭|晚饭|米饭|白饭|饭量|饭菜|饭馆|吃饭|吃东西|吃饱|吃撑|好吃|难吃|面包|蛋糕|面条|饺子|火锅|甜食|零食|汤(?=$|[。！？!?，,；;\n])|饿了|饿得|很饿|挺饿|有点饿|饿不饿|饿(?=$|[。！？!?，,；;\n])|(?:^|[。！？!?，,；;\n])饭(?:呢|吗|么|呀|啊|吧)?(?=$|[。！？!?，,；;\n]))/u;
  const forgingTopic=/锻造|锻打|锻锤|千锻|灵锻|魂锻|神锻/u;
  // Read only direct, current speaker updates. Never retire canon or turn a
  // single message into permanent memory. Report/condition scope spans commas.
  const updates=unquote(message).split(/(?<=[。！？!?])|\n/u).filter(sentence=>
    !/^(?:朋友|同事|他|她|有人|如果|假如|假设|要是|翻译|解释|帮我写)/u.test(sentence.trim())&&!/[?？]/u.test(sentence))
    .flatMap(sentence=>sentence.split(/[，,；;]/u).map(clause=>clause.trim()).filter(clause=>
      /^(?:不过|但是|其实|而且)?我(?:现在|如今|最近|这阵子)(?:已经|也|还|反而)?(?:更|不太|不再|只|比较|还是)?(?:喜欢|爱吃|偏爱|讨厌|饭量)/u.test(clause)));
  const foodUpdate=updates.some(clause=>foodTopic.test(clause));
  const forgingUpdate=updates.some(clause=>forgingTopic.test(clause));
  const asksPast=/(?:你(?:还)?(?:记得|知道|了解).{0,20}(?:以前|求学|当年|原来|过去)|(?:以前|求学|当年|原来|过去).{0,20}(?:吗|呢|[?？]))/u.test(unquote(message));
  if((broad||foodTopic.test(text))&&(!foodUpdate||asksPast))facts.push('求学时舞麟爱吃、饭量大');
  if((broad||forgingTopic.test(text))&&(!forgingUpdate||asksPast))facts.push('舞麟喜欢锻造');
  const forgingKnowledge=facts.includes('舞麟喜欢锻造')
    ? '\n关于锻造，你掌握的是：他喜欢锻造；求学时你听他说想把休息日用来磨练锻造。他也有成为强大魂师和斗铠师的目标，不能因这个爱好认定他不在意成果或别的事情。你现在对这份喜欢的理解可以直接表达。这里提供的是喜好和听到的计划，未提供你亲眼观看某次锻造的经过。'
    : '';
  let scope=facts.length?'已核对的喜好：'+facts.join('；')+'。具体时长、频率与场面仍需对应来源。'+forgingKnowledge
    :'喜好资料在相关话题或明确询问时提供；普通分享从眼前的内容继续。';
  if(foodUpdate||forgingUpdate)scope+='\n本条本人明确说明：'+JSON.stringify(updates.filter(clause=>foodTopic.test(clause)||forgingTopic.test(clause)))+'。沿本人此刻的说法了解他。';
  if(streetKnowledge)scope+='\n'+streetKnowledge;
  return GU_YUE_NA_DAILY_FAMILIARITY.replace('你知道求学时舞麟爱吃、饭量大，舞麟喜欢锻造；这是已有小说背景，当前本人说出的变化优先。',scope+'当前本人说出的变化优先。');
}

export const GU_YUE_NA_WHITE_CORRECTION = {
  chapter: '第一百六十四章 龙冰之墓',
  source: 'https://www.tangsanbooks.com/book/20112.html',
  note: '为爱人穿白色的是舞长空，爱人是龙冰；不能作为舞麟喜欢白色、古月因此穿白衣的依据。',
};

/** Only our owned supplement opts into canon retrieval. A name alone cannot
 * attach a spouse's history to another user's custom character. */
export function buildGuYueNaRecallCard(persona:string, message:string,recentUserMessages:string[]=[]):string|undefined {
  if(!persona.includes('[VirtuGene · 古月娜的关心]')||!persona.includes('【熟悉舞麟的依据】'))return undefined;
  const text=message.slice(0,2000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  // A direct closing correction applies to the requested recollection, not
  // just its own comma-delimited clause. Quotes/reports are not this control.
  const clauses=text.split(/[。！？!?，,；;\n]/u).map(part=>part.trim()).filter(Boolean);
  const lastClause=clauses[clauses.length-1]??'';
  if(/^(?:那|不过|但是|但|现在|这次)?(?:先)?(?:不用|不要|别|不必)(?:再)?(?:回忆|讲|说|查)(?:这个|这些|这件事|那件事)(?:了|吧)?$/u.test(lastClause))return undefined;
  // An artifact name quoted inside the speaker's own reminiscence remains a
  // relevant named entity. A whole quoted request, a report, a writing task,
  // or a declined topic still cannot turn into current recall. Supply sources,
  // not an obligation to explain the lore when the user is sharing affection.
  const namedReminiscence=message.split(/(?<=[。！？!?])|\n/u).some(sentence=>{
    const body=sentence.trim();
    if(!/^(?:想到|我(?:还|还是|很|真的)?(?:记得|喜欢)|你(?:当年|那时)|记得你)/u.test(body))return false;
    const own=body.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
    return /银龙舞轩秀麟|金龙月轩寰语/u.test(body)
      &&!/(?:不要|不用|别|不必|不再).{0,8}(?:聊|说|提|讲|回忆)/u.test(own);
  });
  if(namedReminiscence)return renderGuYueNaRecallRows(GU_YUE_NA_CANON.filter(row=>row.topic==='家人命名'));
  // A quoted question inside an explicitly requested hypothetical reply can
  // query existing canon without becoming a real event or a spouse identity.
  // Ordinary reports/quoted tasks and present-day meals still do not recall lore.
  if(requestsCharacterWording(message)&&conversationalHypothesis(message,[])===message.trim()
    &&!/(?:不要|不用|别|不必).{0,6}(?:回忆|讲|说|查)/u.test(text)) {
    const question=[...message.matchAll(/[“「『"]([^”」』"]*)[”」』"]/gu)].map(m=>m[1])
      .filter(part=>/[？?]|(?:谁|是不是|为什么|多少|吗|哪)/u.test(part)).join('\n');
    if(/当年|那时候|那时|以前|后来|小吃街|海神缘|入学考核|蔡老|银龙舞轩秀麟|金龙月轩寰语/u.test(question)) {
      const quotedRows=GU_YUE_NA_CANON.filter(row=>row.topic==='吃饭'&&/小吃街|牛肉|吃饭|饭量/u.test(question)
        ||row.topic==='锻造'&&!FAMILY_NAMING_TOPIC.test(question)&&/锻造|斗铠|休息日|工坊/u.test(question)
        ||row.topic==='护短'&&/拜师|蔡老|入学考核|收徒/u.test(question)
        ||row.topic==='心意'&&/海神缘|告白|表白/u.test(question)
        ||row.topic==='家人命名'&&FAMILY_NAMING_TOPIC.test(question)).slice(0,2);
      if(quotedRows.length)return renderGuYueNaRecallRows(quotedRows);
    }
  }
  // A short follow-up can name a person or refer to the same shop/order.
  // Only original user recall requests establish this bounded source focus;
  // generated replies and ordinary present-day meals never establish history.
  const mealFollowup=!hasExplicitTopicShift(text)&&!setsAsideNamedTopic(text)
    &&text.split(/(?<=[。！？!?])|\n/u).some(sentence=>{
      const clause=sentence.trim();
      if(/^(?:朋友|同事|他|她|有人|如果|假如|假设|比如|例如|帮我写|翻译)/u.test(clause)||/(?:不要|不用|别|不必).{0,6}(?:回忆|记得|讲|说|查)/u.test(clause)
        ||/^(?:谢邂|古月|李叔)(?:现在|今天|昨天|刚才|明天)/u.test(clause))return false;
      return /^(?:谢邂|古月|李叔|那(?:家店|次|时候)|后来|当时)/u.test(clause)
        &&/(?:那家店|这家店|加点|追加|几份|多少份|谁点|谁叫|谁要)/u.test(clause)
        &&/(?:为什么|怎么|哪|谁|几|多少|吗|[?？])/u.test(clause);
    });
  let carriedMeal=false;
  if(mealFollowup)for(const previous of recentUserMessages.slice(-2).reverse()){
    if(hasExplicitTopicShift(previous)||setsAsideNamedTopic(previous))break;
    if(buildGuYueNaRecallCard(persona,previous)?.includes(GU_YUE_NA_CANON[0].chapter)){carriedMeal=true;break;}
  }
  if(!carriedMeal&&!/(?:记得|记忆|那时候|那时|以前|过去|小时候|当年|原著|小吃街)/u.test(text))return undefined;
  if(/(?:昨天|前天|刚才|刚刚|上次聊天|我(?:前面|之前|刚)(?:说|讲|提))/u.test(text)&&!/(?:原著|小说|小吃街|海神缘|入学考核|蔡老)/u.test(text))return undefined;
  let lorePreface=false;
  const requested=[...text.matchAll(/([^。！？!?，,；;\n]+)([。！？!?，,；;\n]|$)/gu)].flatMap(match=>{
    const clause=match[1].trim();
    const inheritedPreface=lorePreface;
    lorePreface=/[。！？!?；;\n]/u.test(match[2])?false:/^(?:原著|小说)(?:里|中)$/u.test(clause)||lorePreface;
    if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|帮我写|翻译)/u.test(clause)||/(?:不要|不用|别|不必).{0,6}(?:回忆|记得|讲|说|查)/u.test(clause)){
      lorePreface=false;return [];
    }
    const ownRequest=/^(?:你(?:还)?(?:记得|知道|觉得)|(?:还)?记得|(?:聊聊|讲讲|说说|查查).{0,8}(?:以前|过去|往事|原著)|原著(?:里|中)|小说(?:里|中))/u.test(clause)
      || /你.{0,20}(?:以前|过去|小时候|当年|那时).{0,20}(?:吗|么|什么|哪|怎么|为什么)/u.test(clause);
    return ownRequest||inheritedPreface&&/(?:为什么|怎么|哪|谁|吗|么)|[？?]/u.test(clause+match[2])?[clause]:[];
  });
  if(!requested.length&&!carriedMeal)return undefined;
  // Topic words must belong to the actual request. A reported side topic
  // cannot select another chapter merely by sharing the same user message.
  const requestText=requested.join('\n');
  const food=/(?:小吃|吃饭|牛肉|饭量|口味)/u.test(requestText);
  const forging=/(?:锻造|斗铠|休息日|工坊)/u.test(requestText);
  const familyNaming=FAMILY_NAMING_TOPIC.test(requestText);
  const protective=/(?:拜师|蔡老|入学考核|收徒|护短|被打)/u.test(requestText);
  const affection=/(?:海神缘|告白|表白)/u.test(requestText);
  const broad=requested.some(part=>/^(?:(?:你(?:还)?(?:记得|知道))|(?:聊聊|讲讲|说说|查查))?(?:你|我们|你们)?(?:的|记忆中的)?(?:过去|以前|往事|经历)(?:是什么样|什么样|是怎样的|吗|么|呢)?$/u.test(part.trim())
    || /^你(?:还)?(?:记得|知道|了解|觉得).{0,12}(?:我|唐舞麟|舞麟).{0,12}(?:喜欢|喜好|爱好|口味)/u.test(part.trim()));
  const chosen=food||forging||protective||affection||familyNaming?GU_YUE_NA_CANON.filter(row=>food&&row.topic==='吃饭'||forging&&!familyNaming&&row.topic==='锻造'||protective&&row.topic==='护短'||affection&&row.topic==='心意'||familyNaming&&row.topic==='家人命名').slice(0,2):broad?GU_YUE_NA_CANON.slice(0,2):carriedMeal?GU_YUE_NA_CANON.slice(0,1):[];
  if(!chosen.length)return undefined;
  return renderGuYueNaRecallRows(chosen);
}

function renderGuYueNaRecallRows(chosen:Array<(typeof GU_YUE_NA_CANON)[number]>):string {
  return ['[本轮人物往事来源]',
    '以下是已核对的小说背景摘要，不是要求续写的一段剧情，也不证明今天发生同样的事。',
    JSON.stringify(chosen.map(row=>({subject:'唐舞麟与古月的小说往事',chapter:row.chapter,fact:row.knowledge,...('details'in row?{details:row.details}:{}),...('unresolvedDetails'in row?{unresolvedInTheseSources:row.unresolvedDetails}:{})}))),
    ...(chosen.some(row=>'unresolvedDetails'in row)?['unresolvedInTheseSources是本轮资料尚未核对的细节，不是已经确认没发生。被问到时可以用人物自己的口语坦白不确定，接着说已知的事；不将未知分配改成三人平分、某个人最多或一人没有吃完。']:[]),
    '回忆直接说已有的事即可；资料未核对的数量、旧台词和身体细节不拿模型自行续写当证据。自己的感受可以在现在表达，不补成当年的想法。是否是伴侣仍按实际身份，当前明确的变化优先。',
    '[/本轮人物往事来源]'].join('\n');
}
