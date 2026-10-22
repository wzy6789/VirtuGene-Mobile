// One character budget for browser and gateway. Item count is a safety cap,
// never a proxy for user turns (a turn may contain several reply batches).
export const HISTORY_TOTAL_CHARS=14_000;
export const HISTORY_ITEM_CHARS=1_200;
export const HISTORY_MAX_ITEMS=64;
export const HISTORY_USER_TURNS=6;
const OMITTED='\n[中间原文省略]\n';
function safeEnd(text,end){
 if(end>0&&end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1])&&/[\uDC00-\uDFFF]/u.test(text[end]))return end-1;
 return end;
}
function safeStart(text,start){
 if(start>0&&start<text.length&&/[\uD800-\uDBFF]/u.test(text[start-1])&&/[\uDC00-\uDFFF]/u.test(text[start]))return start+1;
 return start;
}
export function clipHistoryText(text,limit=HISTORY_ITEM_CHARS){
 const cap=Math.max(0,Math.floor(limit));
 if(text.length<=cap)return {text,ranges:text.length?[{start:0,end:text.length,outputStart:0,outputEnd:text.length}]:[]};
 if(cap<OMITTED.length+2){const end=safeEnd(text,cap);return {text:text.slice(0,end),ranges:end?[{start:0,end,outputStart:0,outputEnd:end}]:[]};}
 const head=safeEnd(text,Math.floor((cap-OMITTED.length)/2));
 const tail=safeStart(text,text.length-(cap-OMITTED.length-head));
 const out=text.slice(0,head)+OMITTED+text.slice(tail);
 return {text:out,ranges:[{start:0,end:head,outputStart:0,outputEnd:head},{start:tail,end:text.length,outputStart:head+OMITTED.length,outputEnd:out.length}]};
}
export function boundChatHistory(history){
 let from=0,users=0;
 for(let i=history.length-1;i>=0;i--)if(history[i]?.role==='user'&&++users===HISTORY_USER_TURNS){from=i;break;}
 const tail=history.slice(Math.max(from,history.length-HISTORY_MAX_ITEMS));
 let remaining=HISTORY_TOTAL_CHARS;const kept=[];
 for(let i=tail.length-1;i>=0&&remaining>0;i--){
  const item=tail[i],original=typeof item.content==='string'?item.content:'';
  const clipped=clipHistoryText(original,Math.min(HISTORY_ITEM_CHARS,remaining));
  const next={...item,content:clipped.text};
  if(Array.isArray(item.sourceCoverage)){
   next.sourceCoverage=item.sourceCoverage.flatMap(source=>clipped.ranges.flatMap(part=>{
    const start=Math.max(source.renderedStart,part.start),end=Math.min(source.renderedEnd,part.end);
    return start<end?[{...source,start:source.start+start-source.renderedStart,end:source.start+end-source.renderedStart,renderedStart:part.outputStart+start-part.start,renderedEnd:part.outputStart+end-part.start}]:[];
   }));
   next.sourceMessageIds=[...new Set(next.sourceCoverage.map(source=>source.messageId))];
  }
  kept.push(next);remaining-=clipped.text.length;
 }
 const result=kept.reverse();
 // A budget cut must not leave a linked answer without its question.
 while(result[0]?.role==='assistant'&&result[0]?.replyToUserMessageId&&!result.some(item=>item.sourceMessageIds?.includes(result[0].replyToUserMessageId)))result.shift();
 return result;
}
