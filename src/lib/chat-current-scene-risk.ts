/** Narrow textual risk: a newly asserted current light entering a room.
 * This is not a general truth checker. Likes, metaphors, quotes and past
 * events do not establish a present scene. No rewrite happens here.
 */
export function findCurrentSceneRisk(content:string,userMessage='',hasCurrentImage=false):string|undefined {
  const clauses=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').split(/([。！？!?，,；;\n]|-{3,})/u);
  const light=/(?:月光|阳光|日光)/u;
  const entering=/(?:照进|洒进|照到|落在)/u;
  const room=/(?:窗子|窗户|窗边|窗台|房间|屋里)/u;
  let sentencePrefix='';
  for(let i=0;i<clauses.length;i+=2){
    const raw=clauses[i],delimiter=clauses[i+1]??'';
    const clause=raw.trim();
    const prefix=sentencePrefix;
    sentencePrefix=/[。！？!?\n]|-{3,}/u.test(delimiter)?'':sentencePrefix+raw+delimiter;
    if(/[？?]/u.test(delimiter)||/(?:如果|假如|假设|比如|例如|要是|的话)/u.test(prefix))continue;
    if(!light.test(clause)||!entering.test(clause)||!room.test(clause))continue;
    if(/^(?:如果|假如|假设|比如|例如|要是|像|仿佛|好像|就像|如同)|(?:的话|要是|如果)|(?:喜欢|希望|想象|想要|盼着|没有|没能|不会|别说|不要说|并不是)|(?:昨天|昨晚|前天|以前|从前|小时候|曾经|去年)/u.test(clause))continue;
    // Require a present cue, rather than banning the mention of moonlight.
    if(!/(?:现在|此刻|刚好|正好|正在|已经|这会儿)|(?:照进|洒进|照到|落在).{0,16}了$/u.test(clause))continue;
    const own=/(?:我(?:的|这边|这里)|这边|我房间|我窗)/u.test(clause);
    if(!own){
      if(hasCurrentImage)continue;
      const current=userMessage.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
      if(!/(?:昨天|昨晚|前天|以前|如果|假如|假设|没有|不会)/u.test(current)
        && current.match(light)?.[0]===clause.match(light)?.[0]&&entering.test(current)&&room.test(current))continue;
    }
    return clause;
  }
  return undefined;
}
