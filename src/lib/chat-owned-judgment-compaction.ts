import {GU_YUE_NA_CARE} from './gu-yue-na-personality';
import {LU_XUE_QI_PRESET} from './lu-xue-qi-preset';

/** Remove an exact app-owned head line only if its complete
 * text is already in the final judgment card. Never weaken a truncated field,
 * mutate the stored persona, or compact a user's edited Lu persona. */
export function compactOwnedJudgmentEcho(prompt:string,character:{sourcePresetId?:string;systemPrompt:string}):string {
 const owned=character.sourcePresetId==='preset-guyuena'&&character.systemPrompt.includes(GU_YUE_NA_CARE)?GU_YUE_NA_CARE
   :character.sourcePresetId===LU_XUE_QI_PRESET.id&&character.systemPrompt===LU_XUE_QI_PRESET.systemPrompt?LU_XUE_QI_PRESET.systemPrompt:undefined;
 if(!owned)return prompt;
 const cards=[...prompt.matchAll(/\[人物声音卡\][\s\S]*?\[\/人物声音卡\]/gu)];
 if(cards.length!==1)return prompt;
 const card=cards[0],head=prompt.slice(0,card.index);
 const judgment=card[0].split('\n').find(line=>line.startsWith('人物判断依据（具体设定优先于通用标签）：'));
 if(!judgment)return prompt;
 const copied=new Set(judgment.split('：').slice(1).join('：').split(' / '));
 const fields=owned.split(/\r?\n/u).filter(line=>/^(?:判断习惯|在意的事)：/u.test(line));
 const headLines=head.split('\n');
 const removable=new Set(fields.filter(line=>copied.has(line)&&headLines.filter(row=>row.replace(/\r$/u,'')===line).length===1));
 if(!removable.size)return prompt;
 return headLines.filter(line=>!removable.has(line.replace(/\r$/u,''))).join('\n')+prompt.slice(card.index);
}
