import {GU_YUE_NA_CARE} from './gu-yue-na-personality';

/** Conservative ablation: remove duplicate app-owned voice guidance from the
 * persona head only when the original owned supplement and final voice card
 * are both present. Never edit stored text or fact/identity paragraphs. */
export function compactGuYueNaOwnedVoice(prompt:string,character:{sourcePresetId?:string;systemPrompt:string}):string {
  if(character.sourcePresetId!=='preset-guyuena'||!character.systemPrompt.includes(GU_YUE_NA_CARE))return prompt;
  const cards=prompt.match(/\[人物声音卡\][\s\S]*?\[\/人物声音卡\]/gu);
  if(cards?.length!==1)return prompt;
  const card=cards[0],at=prompt.indexOf(card),head=prompt.slice(0,at);
  const begin='[VirtuGene · 古月娜的关心]',end='[/VirtuGene · 古月娜的关心]';
  const start=head.indexOf(begin),stop=head.indexOf(end,start);
  if(start<0||stop<0||head.indexOf(begin,start+begin.length)>=0)return prompt;
  const authored=GU_YUE_NA_CARE.split('\n').filter(line=>/^(?:在意的事|判断习惯|亲密反应|分歧反应|疲惫回应|受挫回应|庆祝反应)：/u.test(line));
  const removable=new Set(authored.filter(line=>!line.startsWith('在意的事：')&&!line.startsWith('判断习惯：')||card.includes(line)));
  const block=head.slice(start,stop).split('\n').filter(line=>!removable.has(line)).join('\n');
  return head.slice(0,start)+block+head.slice(stop)+prompt.slice(at);
}
