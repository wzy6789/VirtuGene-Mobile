import type {Message} from '../db';
import {boundChatHistory as boundTransportHistory,clipHistoryText,HISTORY_MAX_ITEMS,HISTORY_USER_TURNS} from '../../server/chat-history-policy.mjs';
import {memorySpeaker} from '../../server/memory-source-policy.mjs';
import {isIncompleteAssistantReply,INCOMPLETE_REPLY_MARKER} from './chat/reply-delivery';
type HistoryMessage=Pick<Message,'id'|'role'|'content'|'image'|'replyToUserMessageId'|'replyBatchId'|'isProactive'|'replyDelivery'|'replyCompletion'|'interrupted'|'stopped'>&{revision?:number;failed?:boolean;secretaryDispatch?:Message['secretaryDispatch']};
export interface HistoryCoverage {messageId:string;revision:number;start:number;end:number}
interface RenderedCoverage extends HistoryCoverage {renderedStart:number;renderedEnd:number}
export interface HistoryTurn {role:'user'|'assistant';content:string;image?:string;sourceMessageIds:string[];sourceCoverage:RenderedCoverage[];replyToUserMessageId?:string}

/** Same text budget for ordinary chat transport and explicit evaluations. */
export function boundChatHistory<T extends {content:string}>(history:T[]):T[] {
  return boundTransportHistory(history);
}

/** Group only explicitly linked, adjacent reply bubbles. No inferred batches,
 * no rewriting, and the existing transport limits remain in force.
 */
export function buildChatHistoryWindow(messages:HistoryMessage[],currentMessageId:string,limit=12,maxChars=1200):HistoryTurn[] {
  const groups:Array<{role:'user'|'assistant';parts:HistoryMessage[];source?:string;batch?:string}>=[];
  for(const row of messages) {
    if(row.id===currentMessageId||row.failed||row.role!=='user'&&row.role!=='assistant')continue;
    const previous=groups[groups.length-1];
    const source=row.role==='assistant'&&!row.isProactive?row.replyToUserMessageId:undefined;
    if(source&&!row.image&&previous?.role==='assistant'&&!previous.parts.some(part=>part.image)&&previous.source===source&&previous.batch===row.replyBatchId)previous.parts.push(row);
    else groups.push({role:row.role,parts:[row],source,batch:row.replyBatchId});
  }
  const tail=groups.slice(-Math.max(1,Math.floor(limit)));
  // Never start from a sourced reply whose question was cut from the window.
  while(tail[0]?.source&&!tail.some(group=>group.parts.some(row=>row.id===tail[0].source)))tail.shift();
  return tail.map(group=>{
    let original='';const positions:Array<{row:HistoryMessage;start:number;end:number}>=[];
    for(const row of group.parts) {
      if(original)original+='\n---\n';
      if(isIncompleteAssistantReply(row))original+=INCOMPLETE_REPLY_MARKER;
      const start=original.length;original+=row.content;
      positions.push({row,start,end:original.length});
    }
    const clipped=clipHistoryText(original,maxChars);
    const sourceCoverage=positions.flatMap(position=>clipped.ranges.flatMap(range=>{
      const start=Math.max(position.start,range.start),end=Math.min(position.end,range.end);
      return start<end?[{messageId:position.row.id,revision:position.row.revision??1,start:start-position.start,end:end-position.start,renderedStart:range.outputStart+start-range.start,renderedEnd:range.outputStart+end-range.start}]:[];
    }));
    return {role:group.role,content:clipped.text,image:group.parts[0].image,sourceMessageIds:[...new Set(sourceCoverage.map(source=>source.messageId))],sourceCoverage,replyToUserMessageId:group.source};
  });
}

export function missingHistoryRanges(message:HistoryMessage,coverage:HistoryCoverage[]):HistoryCoverage[]{
  const ranges=coverage.filter(r=>r.messageId===message.id&&r.revision===(message.revision??1)).sort((a,b)=>a.start-b.start);
  let cursor=0;const gaps:HistoryCoverage[]=[];
  for(const range of ranges){
    const start=Math.max(0,Math.min(message.content.length,range.start)),end=Math.max(start,Math.min(message.content.length,range.end));
    if(start>cursor)gaps.push({messageId:message.id,revision:message.revision??1,start:cursor,end:start});
    cursor=Math.max(cursor,end);
  }
  if(cursor<message.content.length)gaps.push({messageId:message.id,revision:message.revision??1,start:cursor,end:message.content.length});
  return gaps;
}

/** Six user turns, not twelve bubbles. Unrelated batches remain separate.
 * Every omitted source interval stays explicit for the bounded bridge. */
export function selectRecentCompleteTurns(messages:HistoryMessage[],currentMessageId:string){
  const valid=messages.filter(m=>m.id!==currentMessageId&&!m.failed&&(m.role==='user'||m.role==='assistant'));
  let start=0,users=0;
  for(let i=valid.length-1;i>=0;i--)if(valid[i].role==='user'&&++users===HISTORY_USER_TURNS){start=i;break;}
  const required=valid.slice(start);
  const turns=boundChatHistory(buildChatHistoryWindow(required,currentMessageId,HISTORY_MAX_ITEMS));
  const coverage=turns.flatMap(t=>t.sourceCoverage);
  const excluded=required.flatMap(message=>missingHistoryRanges(message,coverage).map(range=>({...range,reason:'history-budget-or-partial'})));
  return {turns,coverage,excluded,required};
}

/** Only already-authorized, live caller-supplied sources enter this bridge.
 * No database query, authorization cache or new model call is introduced. */
export function buildContinuityBridge(messages:HistoryMessage[],currentMessageId:string,historyCoverage:HistoryCoverage[],summary?:{sourceMessageIds?:string[];sourceMessageRevisions?:Record<string,number>;sourceMessageOffsets?:Record<string,number>},budget=6000){
  const heading='[近期原文补充：按原说话人接续，不把角色自述当用户事实]\n',ending='\n[/近期原文补充]';
  const summaryIds=new Set(summary?.sourceMessageIds??[]);
  const prior=messages.filter(m=>m.id!==currentMessageId&&!m.failed&&(m.role==='user'||m.role==='assistant'));
  const allGaps=prior.map(message=>{
    const through=summaryIds.has(message.id)&&summary?.sourceMessageRevisions?.[message.id]===(message.revision??1)?summary?.sourceMessageOffsets?.[message.id]??0:0;
    const known=[...historyCoverage,...(through>0?[{messageId:message.id,revision:message.revision??1,start:0,end:through}]:[])];
    return {message,known,gaps:missingHistoryRanges(message,known)};
  }).filter(item=>item.gaps.length);
  let remaining=Math.max(0,budget-heading.length-ending.length);const lines:string[]=[];const coverage:HistoryCoverage[]=[];
  for(const {message,gaps} of allGaps.slice(-10).reverse()){
    const label=memorySpeaker(message.role,message.secretaryDispatch?.bodyOrigin!=='composed');
    for(const gap of [...gaps].reverse()){
      const prefix=label+'：',room=Math.min(1200,remaining-prefix.length-1);
      if(room<=0)continue;
      const clipped=clipHistoryText(message.content.slice(gap.start,gap.end),room);
      if(!clipped.text)continue;
      lines.unshift(prefix+clipped.text);remaining-=prefix.length+clipped.text.length+1;
      coverage.push(...clipped.ranges.map(range=>({messageId:message.id,revision:message.revision??1,start:gap.start+range.start,end:gap.start+range.end})));
    }
  }
  return {text:lines.length?heading+lines.join('\n')+ending:'',coverage,excluded:allGaps.flatMap(({message,known})=>missingHistoryRanges(message,[...known,...coverage]))};
}
