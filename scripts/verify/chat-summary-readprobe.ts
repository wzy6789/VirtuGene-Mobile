import {db,type Session,type Message} from '../../src/db';
import {sessionRepo} from '../../src/db/session-repo';
(window as any).runSummaryReadProbe=async()=>{
 await db.delete();await db.open();
 await db.sessions.add({id:'s',userId:'owner',characterId:'actor',type:'private',createdAt:1,updatedAt:1} as Session);
 const messages=Array.from({length:512},(_,i)=>({id:'source-'+i,sessionId:'s',role:i%2?'assistant':'user',content:'合成资料'+i,revision:1,createdAt:i,isProactive:false})) as Message[];
 await db.messages.bulkAdd(messages);
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'suppression-'+i,userId:'owner',characterId:'actor',sourceType:'message',sourceId:'absent-'+i,status:'deleted',sourceRevision:1,updatedAt:1,suppressedMessageIds:['absent-'+i]})) as any);
 const selected=messages.slice(0,12),reads:Record<string,{calls:number;returned:number;cursorVisits?:number;valueTracking?:boolean}>= {},restore:Array<()=>void>=[];
 for(const table of [db.messages,db.memorySourceTombstones])for(const method of ['query','get','getMany','openCursor']){
  const core=table.core as any,original=core[method];
  core[method]=async function(...args:any[]){const result=await original.apply(this,args);const entry=reads[table.name+'.'+method]??={calls:0,returned:0};entry.calls++;
   if(method==='openCursor'){
    if(result){const start=result.start;entry.cursorVisits??=0;result.start=function(callback:()=>void){return start.call(this,()=>{entry.cursorVisits!++;callback();});};
     const getter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(result),'value')?.get;
     if(getter){const seen=new Set<string>();Object.defineProperty(result,'value',{configurable:true,get(){const identity=JSON.stringify([result.key,result.primaryKey]);if(!seen.has(identity)){seen.add(identity);entry.returned++;}return getter.call(result);}});entry.valueTracking=true;}else entry.valueTracking=false;
    }
    return result;
   }
   entry.returned+=method==='get'?Number(result!==undefined):method==='getMany'?result.filter(Boolean).length:result.result.length;return result;};
  restore.push(()=>{core[method]=original;});
 }
 let written;const start=performance.now();
 try{written=await sessionRepo.updateSummary('s','真实来源范围的合成摘要',undefined,selected.map(m=>m.id),Object.fromEntries(selected.map(m=>[m.id,1])),Object.fromEntries(selected.map(m=>[m.id,m.content.length])),{previousSummary:undefined,expectedSummaryRevision:0,expectedConversationVersion:0,principal:{userId:'owner',characterId:'actor'}});}finally{restore.forEach(fn=>fn());}
 return {complete:written===1,elapsedMs:performance.now()-start,reads,fixture:{messages:512,selectedSources:12,tombstones:8105,matchingTombstones:0},paidCalls:0,scope:'Actual background summary commit only, not foreground preparation/visible/model/Android latency'};
};
