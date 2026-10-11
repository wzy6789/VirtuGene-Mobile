import {hasExplicitTopicShift,requestsCharacterPerspective,requestsCharacterChoice} from './chat-turn-cues';
import {isViewExchange,isDirectAffection} from './chat-expression-boundary';
import {isTopicRelated} from './chat-conversation-state';

/** An immediately adjacent choice is a conversational contribution, not a
 * stable preference or an executed arrangement. Reports and questions do not
 * establish the user's own choice. Keep the original for compound details. */
function sharesOwnChoice(message:string):boolean {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(/^(?:朋友|同事|他|她|如果|假如|假设|比如|例如|翻译|解释|改写)/u.test(text)
    ||/[?？]|(?:帮我|替我|给我).{0,10}(?:写|改|查|安排|推荐)/u.test(text))return false;
  return /^我(?:倒|反而|更|也|还)?(?:更)?(?:想(?:让|把|选|要|添|加|试)|喜欢|偏爱|倾向|选)[^。！？!?，,；;\n]{1,60}/u.test(text)
    &&!isDirectAffection(text);
}

function acknowledgesChoiceConversation(message:string):boolean {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(isDirectAffection(message)||/[?？]/u.test(text)
    ||/^(?:朋友|同事|他|她|如果|假如|假设|翻译|解释|改写)/u.test(text)
    ||/(?:帮我|替我|给我).{0,10}(?:写|改|查|安排|推荐)/u.test(text))return false;
  return /^(?:你(?:这么|这样)说|(?:刚才|你刚才)(?:那个|这个)?(?:想法|说法))(?=$|[，,。！!])/u.test(text)
    &&/(?:开心|高兴|有意思|喜欢|挺好|很好)/u.test(text);
}

/** Re-read adjacent dialogue, not stored inferred preferences. These quotes
 * establish who just said what, never that an invented event really occurred. */
export function buildViewContinuityContext(message:string,history:Array<{role:string;content:string}>):string {
  if(requestsCharacterChoice(message)||hasExplicitTopicShift(message))return '';
  const plain=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const sharingAlternative=!isDirectAffection(message)
    &&!/^我(?:倒|反而|更)(?:更)?(?:喜欢|偏爱)你(?=$|[。！？!?，,；;\n呀啊呢啦\s])/u.test(plain)
    &&/^我(?:倒|反而|更)(?:更)?(?:喜欢|偏爱|倾向)[^。！？!?，,；;\n]{1,60}(?:[。！!，,；;\n]|$)/u.test(plain)
    &&!/[?？]|(?:帮我|替我|给我).{0,10}(?:写|改|查|安排|推荐)/u.test(plain);
  const sharingLinkedChoice=!isDirectAffection(message)
    &&! /^(?:朋友|同事|他|她|如果|假如|假设|比如|例如|翻译|解释)/u.test(plain)
    &&! /[?？]|(?:帮我|替我|给我).{0,10}(?:写|改|查|安排|推荐)/u.test(plain)
    &&plain.split(/[。！!，,；;\n]/u).some(part=>
      /^我(?:也|还|同样)(?:想(?:添|加|选|要|试)|喜欢|不喜欢|偏爱)[^。！？!?，,；;\n]{1,60}$/u.test(part.trim())
      ||/^(?:那|看来)?(?:我们|咱们)(?:这次|刚才)?(?:想到一块(?:儿)?(?:去)?了|想到一起了|想得一样|选得一样|选了一样的)[呀啊吧呢啦\s]*$/u.test(part.trim()));
  const acknowledgesChoice=acknowledgesChoiceConversation(message);
  if(!requestsCharacterPerspective(message)&&!sharingAlternative&&!sharingLinkedChoice&&!acknowledgesChoice)return '';
  const replies:string[]=[];
  let previous='';
  for(let index=history.length-1;index>=0;index--){
    const turn=history[index];
    if(turn.role==='assistant')replies.unshift(turn.content);
    else if(turn.role==='user'){previous=turn.content;break;}
  }
  const answer=replies.join(' --- ');
  if(acknowledgesChoice&&previous&&answer&&previous.length<=260&&answer.length<=320&&sharesOwnChoice(previous)&&!hasExplicitTopicShift(previous))
    return `[接续刚才的选择]\n对方刚才的原话：${JSON.stringify(previous)}\n你刚才的回应：${JSON.stringify(answer)}\n他这次分享的是与你聊天的开心。你也可以享受这次来回，说自己的开心或喜欢怎样与你说话；回应本身就让交流继续，不需要马上确定细节。原话里的选择照常保留；上一条你问过而他未说明的细节可以先留白，不催他想好了没。你仍可说新的不同想法、回应改口，真正的新问题照常交流。这只是相邻交流原话，不是永久喜好、已执行安排或共同现场；当前明确换话题和事实范围仍优先。\n[/接续刚才的选择]`;
  if(!previous||!answer||previous.length>260||answer.length>320
    ||(!requestsCharacterChoice(previous)&&!isViewExchange(previous)&&!requestsCharacterPerspective(previous)))return '';
  const adjacentQuestion=message.split(/[。！？!?，,；;\n]/u).some(part=>/^你(?:自己|个人)?的(?:看法|想法|观点|理由)(?:是什么|呢)?$/u.test(part.trim()));
  if(!sharingAlternative&&!sharingLinkedChoice&&!adjacentQuestion&&!isTopicRelated(message,previous))return '';
  const sourceFrame=`[相邻观点原话]\n对方上轮问：${JSON.stringify(previous)}\n你上轮答：${JSON.stringify(answer)}\n这只是刚才一次交流的原话，不是生活事实或永久喜好。自己的理由落在正在聊的事物有什么特点、你此刻想要怎样的体验。合得来或意见不同，就从双方这几句实际说的话接；熟悉与亲近也可以是现在的心意、好奇或一起做某事的意愿，不需要补成双方从前一向如此。独立的人设与作品往事仍按其原有来源使用。`;
  if(sharingLinkedChoice)return `${sourceFrame}\n对方这轮接着说：${JSON.stringify(message)}\n先对照双方实际选了什么。“也”或“想到一块”是对方的接话方式，不是应用已判定选择相同；确实一样就自然高兴，不一样也可以轻松接两种想法，不必争输赢或要求一致。他回忆的一次旧事仍是那一次，不据此补成过去常有的喜好。若此刻改主意就直接说，不把新选择说成刚才已经选过；这句转到新事时也接新事。\n[/相邻观点原话]`;
  if(sharingAlternative)return `${sourceFrame}\n对方接着讲对这件事的喜好，分清你刚才的选择与他这句的选择，再聊具体喜欢哪里。保留自己的选择，不需要让他选一样，也不用替他解释为什么喜欢。真正好奇的内容仍可问；这句话本身不要求他证明自己的趣味。\n[/相邻观点原话]`;
  return `${sourceFrame}\n现在追问的是你的理由，分清你选的与对方选的；解释自己的原意，若改主意就说具体的新理由，不把对方的选择说成自己刚才的选择。\n[/相邻观点原话]`;
}
