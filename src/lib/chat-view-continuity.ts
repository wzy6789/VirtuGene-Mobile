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
  if(sharingAlternative)return `[相邻观点原话]\n对方上轮问：${JSON.stringify(previous)}\n你上轮答：${JSON.stringify(answer)}\n这只是刚才一次交流的原话，不是生活事实或永久喜好。对方现在接着说自己喜欢的地方，分清你刚才的选择与他这句的选择，再继续聊具体喜欢的内容。你可以保留自己的选择，把自己的理由说得让他听懂，不需要让他选一样，也不用替他解释为什么喜欢。真正好奇的内容仍可问；这句话本身不要求他证明自己的趣味。\n[/相邻观点原话]`;
  return `[相邻观点原话]\n对方上轮问：${JSON.stringify(previous)}\n你上轮答：${JSON.stringify(answer)}\n这只是刚才一次交流的原话，不是生活事实或永久喜好。现在追问的是你的理由，先分清你选的与对方选的；解释自己的原意，若改主意就说具体的新理由，不把对方的选择说成自己刚才的选择。\n[/相邻观点原话]`;
}
