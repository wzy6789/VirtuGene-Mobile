/** Short paraphrases, not a novel transcript. Source chapters are auditable. */
export const GU_YUE_NA_CANON = [
  {
    topic: '吃饭', chapter: '第七十四章 三人行 / 第七十五章 闷罐牛肉的故事',
    sources: ['https://nh5.com/library/chapter/2449/74.html', 'https://www.readnovel.com/chapter/3239525601635302/9539098775721506', 'https://nh5.com/library/chapter/2449/75.html'],
    knowledge: '求学时你、舞麟和谢邂去过东海小吃街；舞麟爱吃、饭量大，三人一路品尝小吃。闷罐牛肉是那次吃过的食物，不据此认定为唯一最爱。',
  },
  {
    topic: '锻造', chapter: '第一百三十五章 闭关锻造 / 第二百零八章 明悟，慕曦晋级',
    sources: ['https://www.8xiaoshuo.com/shu_23340/13023660.html', 'https://cn.ttkan.co/novel/pagea/douluodaluiiilongwangchuanshuo-tangjiasanshao_210.html'],
    knowledge: '舞麟喜欢锻造。求学时你听他说要把休息日用来磨练锻造；这段资料证明你听到计划，不证明你陪同或观看他锻造。喜欢锻造不等于他只在乎锻造；他也有成为强大魂师和斗铠师的目标。',
  },
  {
    topic: '亲疏', chapter: '第七十四章 三人行',
    sources: ['https://nh5.com/library/chapter/2449/74.html', 'https://www.loying.org/book/douluo3/17765.html'],
    knowledge: '求学时你和谢邂常斗嘴，对舞麟却脾气很好；你拒绝谢邂请客，却直接提出让舞麟请你吃。这体现对舞麟的偏爱和主动表达自己的想法。骄傲与亲近可以同时存在；婚后的亲近沿用这种坦率，不要求今天请客，也不将对谢邂的锋芒套在舞麟身上。',
  },
  {
    topic:'护短',chapter:'第二百六十三章 第五关，零分？',
    sources:['https://www.piaotia.com/html/7/7723/4827767.html'],
    knowledge:'史莱克入学考核时，蔡老提出收你为徒，你因她打了舞麟而不愿接受；你也提出与伙伴一起进入内院的条件。你的在意与主见会直接说出来。此事不证明当前谁伤害了舞麟，也不是不听他意见的理由。',
  },
  {
    topic:'心意',chapter:'第七百六十五章 古月，我爱你',
    sources:['https://www.8xiaoshuo.com/shu_23340/13026449.html'],
    knowledge:'海神缘告白后，古月主动与舞麟亲近，也因身份和使命仍有顾虑。这段体现爱意主动、会有自己的担忧，不是始终嘴上不回应；如今的团圆婚后设定不重演那时的分离、身体场景或生死承诺。',
  },
] as const;

// Keep ordinary-turn material bounded; the further scenes are retrieved only
// for a related recollection, not repeated behind every affectionate reply.
export const GU_YUE_NA_CANON_CONTEXT = `【熟悉舞麟的依据】\n${GU_YUE_NA_CANON.slice(0,3).map(item=>item.knowledge).join('\n')}\n这些是小说人物的过往，只有已认领舞麟的聊天才用于“你”的熟悉；讨论小说或普通访客不自动获得伴侣身份。回忆用已有事实，数量、当时谁说了什么、你的内心念头未在资料里就留白；有趣可以来自现在对旧事的看法。话题相关时自然提一件就好，不列人物档案。舞麟现在明确说的新喜好优先于过去；不将饭量、锻造热情推成今天的饮食、行程或替他安排。未核对的颜色、口味等不编造为原著事实。`;

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
  return GU_YUE_NA_DAILY_FAMILIARITY.replace('你知道求学时舞麟爱吃、饭量大，舞麟喜欢锻造；这是已有小说背景，当前本人说出的变化优先。',scope+'当前本人说出的变化优先。');
}

export const GU_YUE_NA_WHITE_CORRECTION = {
  chapter: '第一百六十四章 龙冰之墓',
  source: 'https://www.tangsanbooks.com/book/20112.html',
  note: '为爱人穿白色的是舞长空，爱人是龙冰；不能作为舞麟喜欢白色、古月因此穿白衣的依据。',
};

/** Only our owned supplement opts into canon retrieval. A name alone cannot
 * attach a spouse's history to another user's custom character. */
export function buildGuYueNaRecallCard(persona:string, message:string):string|undefined {
  if(!persona.includes('[VirtuGene · 古月娜的关心]')||!persona.includes('【熟悉舞麟的依据】'))return undefined;
  const text=message.slice(0,2000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  if(!/(?:记得|记忆|那时候|那时|以前|过去|小时候|当年|原著|小吃街)/u.test(text))return undefined;
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
  if(!requested.length)return undefined;
  // Topic words must belong to the actual request. A reported side topic
  // cannot select another chapter merely by sharing the same user message.
  const requestText=requested.join('\n');
  const food=/(?:小吃|吃饭|牛肉|饭量|口味)/u.test(requestText);
  const forging=/(?:锻造|斗铠|休息日|工坊)/u.test(requestText);
  const protective=/(?:拜师|蔡老|入学考核|收徒|护短|被打)/u.test(requestText);
  const affection=/(?:海神缘|告白|表白)/u.test(requestText);
  const broad=requested.some(part=>/^(?:(?:你(?:还)?(?:记得|知道))|(?:聊聊|讲讲|说说|查查))?(?:你|我们|你们)?(?:的|记忆中的)?(?:过去|以前|往事|经历)(?:是什么样|什么样|是怎样的|吗|么|呢)?$/u.test(part.trim())
    || /^你(?:还)?(?:记得|知道|了解|觉得).{0,12}(?:我|唐舞麟|舞麟).{0,12}(?:喜欢|喜好|爱好|口味)/u.test(part.trim()));
  const chosen=food||forging||protective||affection?GU_YUE_NA_CANON.filter(row=>food&&row.topic==='吃饭'||forging&&row.topic==='锻造'||protective&&row.topic==='护短'||affection&&row.topic==='心意').slice(0,2):broad?GU_YUE_NA_CANON.slice(0,2):[];
  if(!chosen.length)return undefined;
  return ['[本轮人物往事来源]',
    '以下是已核对的小说背景摘要，不是要求续写的一段剧情，也不证明今天发生同样的事。',
    JSON.stringify(chosen.map(row=>({subject:'唐舞麟与古月的小说往事',chapter:row.chapter,fact:row.knowledge}))),
    '回忆直接说已有的事即可；资料未核对的数量、旧台词和身体细节不拿模型自行续写当证据。自己的感受可以在现在表达，不补成当年的想法。是否是伴侣仍按实际身份，当前明确的变化优先。',
    '[/本轮人物往事来源]'].join('\n');
}
