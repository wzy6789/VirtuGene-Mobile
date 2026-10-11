import {hasExplicitTopicShift,requestsCharacterPerspective,requestsCharacterChoice} from './chat-turn-cues';
import {isViewExchange,isDirectAffection} from './chat-expression-boundary';
import {isTopicRelated} from './chat-conversation-state';

/** Re-read adjacent dialogue, not stored inferred preferences. These quotes
 * establish who just said what, never that an invented event really occurred. */
export function buildViewContinuityContext(message:string,history:Array<{role:string;content:string}>):string {
  if(requestsCharacterChoice(message)||hasExplicitTopicShift(message))return '';
  const plain=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const sharingAlternative=!isDirectAffection(message)
    &&!/^我(?:倒|反而|更)(?:更)?(?:喜欢|偏爱)你(?=$|[。！？!?，,；;\n呀啊呢啦\s])/u.test(plain)
    &&/^我(?:倒|反而|更)(?:更)?(?:喜欢|偏爱|倾向)[^。！？!?，,；;\n]{1,60}(?:[。！!，,；;\n]|$)/u.test(plain)
    &&!/[?？]|(?:帮我|替我|给我).{0,10}(?:写|改|查|安排|推荐)/u.test(plain);
  if(!requestsCharacterPerspective(message)&&!sharingAlternative)return '';
  const replies:string[]=[];
  let previous='';
  for(let index=history.length-1;index>=0;index--){
    const turn=history[index];
    if(turn.role==='assistant')replies.unshift(turn.content);
    else if(turn.role==='user'){previous=turn.content;break;}
  }
  const answer=replies.join(' --- ');
  if(!previous||!answer||previous.length>260||answer.length>320
    ||(!requestsCharacterChoice(previous)&&!isViewExchange(previous)&&!requestsCharacterPerspective(previous)))return '';
  const adjacentQuestion=message.split(/[。！？!?，,；;\n]/u).some(part=>/^你(?:自己|个人)?的(?:看法|想法|观点|理由)(?:是什么|呢)?$/u.test(part.trim()));
  if(!sharingAlternative&&!adjacentQuestion&&!isTopicRelated(message,previous))return '';
  const sourceFrame=`[相邻观点原话]\n对方上轮问：${JSON.stringify(previous)}\n你上轮答：${JSON.stringify(answer)}\n这只是刚才一次交流的原话，不是生活事实或永久喜好。自己的理由落在正在聊的事物有什么特点、你此刻想要怎样的体验。合得来或意见不同，就从双方这几句实际说的话接；熟悉与亲近也可以是现在的心意、好奇或一起做某事的意愿，不需要补成双方从前一向如此。独立的人设与作品往事仍按其原有来源使用。`;
  if(sharingAlternative)return `${sourceFrame}\n对方接着讲对这件事的喜好，分清你刚才的选择与他这句的选择，再聊具体喜欢哪里。保留自己的选择，不需要让他选一样，也不用替他解释为什么喜欢。真正好奇的内容仍可问；这句话本身不要求他证明自己的趣味。\n[/相邻观点原话]`;
  return `${sourceFrame}\n现在追问的是你的理由，分清你选的与对方选的；解释自己的原意，若改主意就说具体的新理由，不把对方的选择说成自己刚才的选择。\n[/相邻观点原话]`;
}
