import {db} from '@release/db/index';
import {messageHistoryProjection} from '@release/db/message-history-index';
import {recallHistoricalPrivateChat} from '@release/lib/character-history-recall';
import {withChatSessionLock} from '@release/lib/chat/request-coordinator';
import {backfillHistorySearchIndex} from '@release/lib/chat-history-index';

window.fetch=async()=>{throw Error('No external calls in partial-index benchmark');};
window.requestIdleCallback=callback=>window.setTimeout(()=>callback({didTimeout:false,timeRemaining:()=>50}),0);
Object.assign(window,{releaseSpeed:async()=>{
 const samples=[];
 for(const count of [1000,5000]) {
  await db.delete();await db.open();
  const now=Date.now();
  const rows=Array.from({length:count},(_,i)=>({id:'m-'+i,sessionId:'s',role:i%2?'assistant':'user',content:'桂花糕是买给奶奶的。'.repeat(50),createdAt:now-count+i,revision:1}));
  await db.sessions.put({id:'s',userId:'u',characterId:'c',title:'isolated',createdAt:now,updatedAt:now});
  await db.messages.bulkPut(rows as any);
  await withChatSessionLock('pause-backfill',async()=>{
    await db.messageHistorySearch.clear();
    await db.messageHistorySearch.bulkPut(rows.slice(0,count*0.9).map(row=>messageHistoryProjection(row)));
    const core=db.messages.core,query=core.query.bind(core),getMany=core.getMany.bind(core);
    let bodyRows=0;
    core.query=request=>query(request).then(result=>{if(request.values)bodyRows+=result.result.length;return result;});
    core.getMany=request=>getMany(request).then(result=>{bodyRows+=result.filter(Boolean).length;return result;});
    const started=performance.now();
    let hits;
    try{hits=await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'桂花糕',limit:3});}
    finally{core.query=query;core.getMany=getMany;}
    const durationMs=performance.now()-started;
    const expected=rows.filter(row=>row.role==='user').slice(-3).reverse().map(row=>row.id);
    if(JSON.stringify(hits.map(hit=>hit.messageId))!==JSON.stringify(expected))throw Error('Partial index changed exact best candidates');
    samples.push({count,indexed:count*0.9,missing:count*0.1,durationMs,bodyRows,recallMatches:true});
  });
  await backfillHistorySearchIndex();
 }
 return {samples,modelCalls:0,scope:'real isolated IndexedDB; 90% coverage; exact recalled originals verified; CPU throttled 4x; no model/Android'};
}});
