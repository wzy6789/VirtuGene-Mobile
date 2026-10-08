import type {Message} from '../db';
type HistoryMessage=Pick<Message,'id'|'role'|'content'|'image'|'replyToUserMessageId'|'replyBatchId'|'isProactive'>;
export interface HistoryTurn {role:'user'|'assistant';content:string;image?:string;sourceMessageIds:string[]}

/** Same text budget for ordinary chat transport and explicit evaluations. */
export function boundChatHistory<T extends {content:string}>(history:T[]):T[] {
  const tail=history.slice(-12),kept:T[]=[];
  let remaining=14_000;
  for(let index=tail.length-1;index>=0&&remaining>0;index--) {
    const item=tail[index],content=typeof item.content==='string'?item.content:'';
    const take=Math.min(1_200,remaining);
    kept.push({...item,content:content.slice(0,take)});
    remaining-=Math.min(content.length,take);
  }
  return kept.reverse();
}

/** Group only explicitly linked, adjacent reply bubbles. No inferred batches,
 * no rewriting, and the existing transport limits remain in force.
 */
export function buildChatHistoryWindow(messages:HistoryMessage[],currentMessageId:string,limit=12,maxChars=1200):HistoryTurn[] {
  const groups:Array<{role:'user'|'assistant';parts:HistoryMessage[];source?:string;batch?:string}>=[];
  for(const row of messages) {
    if(row.id===currentMessageId||row.role!=='user'&&row.role!=='assistant')continue;
    const previous=groups[groups.length-1];
    const source=row.role==='assistant'&&!row.isProactive?row.replyToUserMessageId:undefined;
    if(source&&!row.image&&previous?.role==='assistant'&&!previous.parts.some(part=>part.image)&&previous.source===source&&previous.batch===row.replyBatchId)previous.parts.push(row);
    else groups.push({role:row.role,parts:[row],source,batch:row.replyBatchId});
  }
  const tail=groups.slice(-Math.max(1,Math.floor(limit)));
  // Never start from a sourced reply whose question was cut from the window.
  while(tail[0]?.source&&!tail.some(group=>group.parts.some(row=>row.id===tail[0].source)))tail.shift();
  return tail.map(group=>{
    let content='';const sourceMessageIds:string[]=[];
    for(const row of group.parts) {
      const separator=content?'\n---\n':'';
      const room=Math.max(0,Math.floor(maxChars)-content.length-separator.length);
      if(!room)break;
      const part=row.content.slice(0,room);
      if(!part&&content)continue;
      content+=separator+part;sourceMessageIds.push(row.id);
    }
    return {role:group.role,content,image:group.parts[0].image,sourceMessageIds};
  });
}
