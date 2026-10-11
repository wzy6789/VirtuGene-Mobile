import {hasExplicitTopicShift,requestsCharacterPerspective,requestsCharacterChoice} from './chat-turn-cues';
import {isViewExchange} from './chat-expression-boundary';
import {isTopicRelated} from './chat-conversation-state';

/** Re-read adjacent dialogue, not stored inferred preferences. These quotes
 * establish who just said what, never that an invented event really occurred. */
export function buildViewContinuityContext(message:string,history:Array<{role:string;content:string}>):string {
  if(!requestsCharacterPerspective(message)||requestsCharacterChoice(message)||hasExplicitTopicShift(message))return '';
  const replies:string[]=[];
  let previous='';
  for(let index=history.length-1;index>=0;index--){
    const turn=history[index];
    if(turn.role==='assistant')replies.unshift(turn.content);
    else if(turn.role==='user'){previous=turn.content;break;}
  }
  const answer=replies.join(' --- ');
  if(!previous||!answer||previous.length>260||answer.length>320
    ||(!requestsCharacterChoice(previous)&&!isViewExchange(previous)))return '';
  const adjacentQuestion=message.split(/[。！？!?，,；;\n]/u).some(part=>/^你(?:自己|个人)?的(?:看法|想法|观点|理由)(?:是什么|呢)?$/u.test(part.trim()));
  if(!adjacentQuestion&&!isTopicRelated(message,previous))return '';
  return `[相邻观点原话]\n对方上轮问：${JSON.stringify(previous)}\n你上轮答：${JSON.stringify(answer)}\n这只是刚才一次交流的原话，不是生活事实或永久喜好。现在追问的是你的理由，先分清你选的与对方选的；解释自己的原意，若改主意就说具体的新理由，不把对方的选择说成自己刚才的选择。\n[/相邻观点原话]`;
}
