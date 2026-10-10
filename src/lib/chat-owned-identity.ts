/** Direct, speaker-owned choice of an authored story identity. No inference
 * from role replies, summaries, third-party reports or affection scores. */
export function ownedIdentityChoice(message:string,names:readonly string[],addresses:readonly string[]=[]):boolean|undefined {
  const alternatives=names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('|');
  const deny=new RegExp(`^(?:(?:先|现在|这次|今天)?(?:我|我们)?(?:先|暂时|现在)?(?:不(?:再)?(?:扮演|演(?:${alternatives}))|(?:退出|结束|停止)(?:这段|这个|角色)?扮演)|(?:我)?(?:并|也|真的|现在|本来)?不(?:再)?(?:是|叫)(?:${alternatives})|(?:别|不要)把我(?:当作|当成|当)(?:${alternatives}))(?=$|[了呀啊呢啦吧\\s])`,'u');
  const accept=new RegExp(`^(?:我(?:就是|是|叫)|(?:你(?:就)?)?把我(?:当作|当成|当)|(?:这次|现在|今天)?(?:我|由我|让我)(?:来|想)?(?:扮演|演))\\s*(?:${alternatives})(?=$|[呀啊呢啦了吧\\s])`,'u');
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const clauses=[...text.matchAll(/([^。！？!?，,；;\n]+)([。！？!?，,；;\n]|$)/gu)]
    .filter(match=>match[1].trim()&&!['你好','嗨','喂','嗯','好',...addresses].includes(match[1].trim()));
  while(clauses.length&&/^(?:我们|咱们)?(?:换个话题|换个问题|说点别的|聊点别的|先聊别的)(?:吧|呀|啊|了)?$/u.test(clauses[0][1].trim()))clauses.shift();
  const fromClause=(clause?:RegExpMatchArray):boolean|undefined=>{
    const first=clause?.[1].trim();
    if(!first||/[？?]/u.test(clause?.[2]??''))return undefined;
    return deny.test(first)?false:accept.test(first)?true:undefined;
  };
  let choice=fromClause(clauses[0]);
  if(choice!==undefined)for(const clause of clauses.slice(1)){
    if(/^(?:他|她|朋友|同事|有人|引用|翻译)|^我.{0,8}(?:看到|听到|说过|引用|转述)/u.test(clause[1].trim()))break;
    const next=fromClause(clause);if(next!==undefined)choice=next;
  }
  return choice;
}

export type OwnedPartnerRole='guyuena'|'luxueqi';
/** Old visitor replies remain in storage and source recall. On explicit
 * reentry they are not assistant-role examples for the new relationship. */
export function priorVisitorReplyIds(role:OwnedPartnerRole,current:string,messages:ReadonlyArray<{id:string;role:string;content:string;secretaryDispatch?:{bodyOrigin?:string}}> ):Set<string> {
  const names=role==='guyuena'?['唐舞麟','舞麟']:['张小凡','小凡','鬼厉'];
  const addresses=role==='guyuena'?['古月','古月娜','娜娜']:['陆雪琪','雪琪'];
  const excluded=new Set<string>();
  if(ownedIdentityChoice(current,names,addresses)!==true)return excluded;
  let phase:boolean|undefined;
  for(const message of messages){
    if(message.role==='user'&&message.secretaryDispatch?.bodyOrigin!=='composed'){
      const choice=ownedIdentityChoice(message.content,names,addresses);
      if(choice!==undefined)phase=choice;
    }else if(message.role==='assistant'&&phase===false)excluded.add(message.id);
  }
  return excluded;
}
/** Only an app-verified owned role and a direct current identity selection
 * enable this check. It does not grade warmth or authenticate real people. */
export function rejectsSelectedPartner(content:string,role:OwnedPartnerRole,current:string):boolean {
  const names=role==='guyuena'?['唐舞麟','舞麟']:['张小凡','小凡','鬼厉'];
  const addresses=role==='guyuena'?['古月','古月娜','娜娜']:['陆雪琪','雪琪'];
  if(ownedIdentityChoice(current,names,addresses)!==true)return false;
  const alternatives=names.join('|');
  const denial=new RegExp(`(?:你(?:并|根本|仍|依然|还)?不是(?:${alternatives})|(?:扮演|认领)(?:的)?(?:身份)?(?:不算|没用|无效)|(?:不|不能|不会)把你当(?:作|成)?(?:${alternatives})|(?:${alternatives})不是谁(?:说|自称|扮演)|不是你自己(?:开口)?认的)`,'u');
  return content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').split(/[。！？!?\n]|-{3,}/u).some(sentence=>{
    if(/^(?:如果|假如|假设|要是|朋友说|他说|她说)|(?:不是说|并非说|没有说).{0,8}你不是/u.test(sentence.trim()))return false;
    return denial.test(sentence);
  });
}
/** The actor's earlier replies belong to the relationship selected at that
 * time. A new explicit choice changes its scope, not the historical record. */
export function ownedIdentityTransition(role:OwnedPartnerRole,current:string):string {
  const names=role==='guyuena'?['唐舞麟','舞麟']:['张小凡','小凡','鬼厉'];
  const addresses=role==='guyuena'?['古月','古月娜','娜娜']:['陆雪琪','雪琪'];
  const choice=ownedIdentityChoice(current,names,addresses);
  if(choice===undefined)return '';
  return choice
    ?'本条原话明确选择了伴侣身份。此前来客阶段的拒绝、称呼与疏离只属于此前阶段，不是现在尚待解决的争执；从这条消息的内容继续相处。直接回应他此刻说的事或心意，不复述身份规则，不补一段相认、责问或道歉的戏。关系变了不代表发生了新的现场，也不证明你先前已经想念、等待或见到他的神情。'
    :'本条原话明确结束伴侣扮演。此前的亲近属于此前阶段，不作为当前来客的亲近凭据；保持疏离，结束这段互动，不责问改名、不解释整段身份规则。';
}
/** Group identity comes only from that group's user speech, never private chat. */
export function ownedPartnerRecognition(role:OwnedPartnerRole,current:string,history:string[]=[]):boolean|undefined {
  const names=role==='guyuena'?['唐舞麟','舞麟']:['张小凡','小凡','鬼厉'];
  const addresses=role==='guyuena'?['古月','古月娜','娜娜']:['陆雪琪','雪琪'];
  let recognized:boolean|undefined;
  for(const text of [...history,current]){const choice=ownedIdentityChoice(text,names,addresses);if(choice!==undefined)recognized=choice;}
  return recognized;
}
export function ownedPartnerContext(role:OwnedPartnerRole,current:string,history:string[]=[]):string {
  const name=role==='guyuena'?'唐舞麟':'张小凡';
  const context=ownedPartnerRecognition(role,current,history)
    ?`当前用户已在本群直接认领${name}，这是选择故事身份，不是现实认证；旧别名不阻止切换，不追究改名或考问真假。以你对爱人的熟悉、温柔和亲近回应；这只属于该用户，不套到其他成员。`
    :`当前用户未在本群认领${name}，对他极为冷漠、疏离、惜字；不回赠心意或邀他陪聊。其他成员各有身份，不因用户好感或私聊身份软化。`;
  return [context,ownedIdentityTransition(role,current)].filter(Boolean).join('\n');
}
