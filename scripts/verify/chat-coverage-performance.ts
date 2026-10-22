import './chat-human-live';
import {db} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';
import {updateChatConversationState,type ChatConversationState} from '../../src/lib/chat-conversation-state';
declare const PERF_SEED_TOPICS:boolean;
declare const PERF_FIXED_BASE:number|undefined;
const global=globalThis as any;
let started=0,requestAt=0,outgoing:unknown,auxiliaryRequests=0;
window.fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))throw Error('Unexpected network');
 const payload=JSON.parse(String(init?.body));
 if(payload.messages.at(-1)?.content==='之前安排的最新时间是什么？'){requestAt=performance.now();outgoing=payload.messages;}
 else auxiliaryRequests++;
 return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
global.runCoveragePerformance=async()=>{
 const owner='isolated-live-expression-owner',characterId='isolated-live-role',sessionId='isolated-live-session';
 await global.liveExpression.setup({name:'林舟',tags:['直率'],systemPrompt:'你是林舟，成年朋友，表达自然，重视对方说过的内容。\n称呼：你。\n判断习惯：先听清具体情况。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好。',signature:''},.5);
 const now=typeof PERF_FIXED_BASE!=='undefined'?PERF_FIXED_BASE:Date.now()-10000;
 await db.messages.bulkPut(Array.from({length:512},(_,i)=>({id:'perf-'+i,sessionId,role:i%2?'assistant':'user',content:i===508?'最初约周五。'+'前情说明。'.repeat(245)+'最后纠正：周四15点。':'合成旧对话'+i,createdAt:now+i,revision:1,isProactive:false,...(i%2?{replyToUserMessageId:'perf-'+(i-1),replyBatchId:'perf-b'+i}:{})})) as any);
 let seededTopicCount=0;
 if(typeof PERF_SEED_TOPICS!=='undefined'&&PERF_SEED_TOPICS){
  let conversation:ChatConversationState|undefined;
  for(const index of [492,494,496,498,500,502,506,508]){
   const source=(await db.messages.get('perf-'+index))!;
   source.content=index===506?'周五15点面试。':index===508?'面试原先周五。'+'前情说明。'.repeat(245)+'最后纠正：周四15点。':`学科${index}考试周一。`;
   await db.messages.put(source);
   conversation=updateChatConversationState(conversation,source.content,'',undefined,source.createdAt,'',{message:source,domain:'user-reality'});
  }
  seededTopicCount=conversation?.topics?.length??0;
  if(seededTopicCount<7)throw Error('Insufficient source-backed topic stock in performance fixture');
  await db.sessions.update(sessionId,{conversation});
 }
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'perf-t'+i,userId:owner,characterId:i<2?characterId:'unrelated-'+i%5,sourceType:'message',sourceId:'removed-'+i,sourceRevision:1,status:'deleted',updatedAt:now,suppressedMessageIds:['removed-'+i]})) as any);
 await db.diaries.bulkPut(Array.from({length:40},(_,i)=>({id:'perf-private-'+i,userId:owner,date:'2026-10-18',title:'不可见合成日记'+i,content:'PRIVATE-SYNTHETIC-MUST-NOT-APPEAR',visibility:'private',visibleTo:[],createdAt:now,updatedAt:now,revision:1,tags:[]})) as any);
 // The active send uses the store's loaded page. Seeding IndexedDB alone
 // would accidentally time an empty-history chat and hide this regression.
 useChatStore.setState({messages:(await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt')).slice(-200),hasMoreMessages:true});
 const samples=[];
 for(let iteration=0;iteration<4;iteration++){
  const reads:Record<string,{calls:number;returned:number;requested?:number;cursorVisits?:number;valueTracking?:boolean}>= {};const restore:Array<()=>void>=[];
  for(const table of db.tables){
   const core=table.core as any;
   for(const method of ['query','getMany','get','openCursor']){
    const old=core[method];if(typeof old!=='function')continue;
    core[method]=async function(...args:any[]){
     const result=await old.apply(this,args);const key=table.name+'.'+method;
     const item=reads[key]??={calls:0,returned:0,requested:0};item.calls++;
     if(method==='openCursor'){
      if(result){
       const start=result.start;item.cursorVisits??=0;
       result.start=function(callback:()=>void){return start.call(this,()=>{item.cursorVisits!++;callback();});};
       const getValue=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(result),'value')?.get;
       if(getValue){const seen=new Set<string>();Object.defineProperty(result,'value',{configurable:true,get(){const rowKey=JSON.stringify([result.key,result.primaryKey]);if(!seen.has(rowKey)){seen.add(rowKey);item.returned++;}return getValue.call(result);}});item.valueTracking=true;}
       else item.valueTracking=false;
      }
      return result;
     }
     item.returned+=method==='query'?(result?.result?.length??0):method==='getMany'?result.filter((row:any)=>row!==undefined).length:Number(result!==undefined);
     if(method==='getMany')item.requested!+=args[0]?.keys?.length??0;
     return result;
    };
    restore.push(()=>{core[method]=old;});
   }
  }
  started=performance.now();requestAt=0;outgoing=undefined;auxiliaryRequests=0;
  let turn:any;
  try{turn=await global.liveExpression.turn('之前安排的最新时间是什么？');}finally{restore.forEach(fn=>fn());}
  if(turn.failed||!requestAt)throw Error('Simulated performance turn failed');
  if(JSON.stringify(outgoing).includes('PRIVATE-SYNTHETIC-MUST-NOT-APPEAR'))throw Error('Private synthetic diary leaked');
  samples.push({iteration,prepareMs:Math.round(requestAt-started),endMs:Math.round(performance.now()-started),firstBodyMs:null,firstVisibleMs:null,reads,inputChars:JSON.stringify(outgoing).length,latestCorrectionKept:JSON.stringify(outgoing).includes('最后纠正：周四15点。'),auxiliaryRequests,messages:outgoing});
 }
 return {scope:'Desktop Chrome isolated DB, mocked nonstream transport, sequential warm samples; not Android, decoded UI or real model latency',fixture:{messages:512,tombstones:8105,privateDiaries:40,matchingTombstones:2,seededTopicCount},samples,paidCalls:0};
};
