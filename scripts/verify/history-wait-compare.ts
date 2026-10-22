import {db} from '@release/db/index';
import {useAuthStore} from '@release/store/auth-store';
import {useChatStore} from '@release/store/chat-store';
import {useSettingsStore} from '@release/store/settings-store';
import {webApi} from '@release/lib/web-api';
import {sendRoleChatReply} from '@release/lib/chat/send-service';
import {ChatReplyStream} from '@release/lib/chat-stream';
import {chatQualityReport} from '@release/lib/chat-quality-metrics';

window.fetch=async()=>{throw Error('No external network allowed');};
webApi.context.summarize=async()=>({error:'server:error'});
webApi.context.settle=async()=>({error:'server:error'});
webApi.memory.extract=async()=>({memories:[]});
Object.assign(window,{releaseSpeed:async()=>{
 const samples=[];
 for(const count of [0,1000,5000]) {
  await db.delete();await db.open();
  const userId='isolated',characterId='ordinary',sessionId='current',now=Date.now();
  useAuthStore.getState().login(userId,'隔离测试','test-only-no-key','');
  useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false});
  const character={id:characterId,createdBy:userId,name:'林舟',avatar:'🌿',systemPrompt:'你是成年朋友林舟，说话自然直接。',tags:['直率'],isPreset:false,isCustom:true,published:false,proactivity:0.5,signature:'',greeting:'',createdAt:now};
  await db.characters.put(character as any);
  const rows=Array.from({length:count},(_,i)=>({id:'history-'+i,sessionId,role:i%2?'assistant':'user',content:'这是普通聊天的第'+i+'条。'+'今天工作还好，晚上一起聊聊。'.repeat(50),createdAt:now-count+i,revision:1,isProactive:false}));
  const covered=rows.slice(0,-18);
  await db.sessions.put({id:sessionId,userId,characterId,title:'测试',createdAt:now-count,updatedAt:now,modelAsked:true,model:{provider:'deepseek',model:'deepseek-flash'},...(count?{summary:'我们聊了日常工作和晚上的安排。',summaryUpdatedAt:now-19,summarySourceMessageIds:covered.map(m=>m.id),summarySourceMessageRevisions:Object.fromEntries(covered.map(m=>[m.id,1])),summarySourceMessageOffsets:Object.fromEntries(covered.map(m=>[m.id,m.content.length]))}:{})} as any);
  await db.messages.bulkPut(rows as any);
  // A reopened mobile session loads its last 200 records, not the whole archive.
  useChatStore.setState({characters:[character] as any,currentSessionId:sessionId,selectedCharacterId:characterId,messages:rows.slice(-200) as any,hasMoreMessages:count>200});
  for(const text of ['你好','今天有点累，想和你聊聊']) {
   const source={id:crypto.randomUUID(),sessionId,role:'user',content:text,createdAt:now+samples.length+1,isProactive:false,revision:1};
   await db.messages.put(source as any);useChatStore.getState().addMessage(source as any);
   let firstVisibleMs:number|undefined,preparationMs=0,calls=0,promptChars=0,historyChars=0;
   const reads:Record<string,{operations:number,rows:number,keyRows:number,bodyRows:number}>={};
   // Dexie's middleware core is per table; record materialized reads before the provider.
   const restores: (()=>void)[]=[];
   for(const table of db.tables) {
    const core=table.core,methods=['query','getMany','get'] as const;
    for(const method of methods) {
     const fn=core[method].bind(core);
     (core as any)[method]=async(...args:any[])=>{const result=await (fn as any)(...args);if(calls===0){const metric=reads[table.name]??={operations:0,rows:0,keyRows:0,bodyRows:0};metric.operations++;const length=method==='query'?(result.result?.length??0):method==='getMany'?result.filter(Boolean).length:Number(!!result);metric.rows+=length;if(method==='query'&&args[0]?.values===false)metric.keyRows+=length;else metric.bodyRows+=length;}return result;};
     restores.push(()=>{(core as any)[method]=fn;});
    }
   }
   const started=performance.now();
   webApi.chat.send=async params=>{calls++;preparationMs=performance.now()-started;promptChars=params.systemPrompt.length;historyChars=(params.history??[]).reduce((n,m)=>n+m.content.length,0);await new Promise(r=>setTimeout(r,100));params.onDelta?.('嗯，我在听。');return {content:'嗯，我在听。',modelId:'deepseek-flash'};};
   const stream=new ChatReplyStream(sessionId,()=>{firstVisibleMs??=performance.now()-started;});
   try{await sendRoleChatReply(character as any,source as any,{userId,controller:new AbortController(),stream,completed:false,stopped:false},{userId,text});}finally{stream.dispose();restores.forEach(fn=>fn());}
   const replies=(await db.messages.where('sessionId').equals(sessionId).toArray()).filter(m=>m.replyToUserMessageId===source.id&&m.role==='assistant');
   if(calls!==1||replies.length!==1||replies[0].content!=='嗯，我在听。'||firstVisibleMs===undefined)throw Error('Single real saved mock reply failed');
   const timing=chatQualityReport().events.at(-1);
   if(timing?.sendToFirstVisibleMs!==undefined&&(timing.sendToFirstVisibleMs<(timing.preparationMs??0)||Math.abs((timing.preparationMs??0)-preparationMs)>25))throw Error('Production timing omitted preparation/final verification');
   samples.push({count,text,preparationMs,firstVisibleMs,totalMs:performance.now()-started,promptChars,historyChars,calls,reads,timing});
  }
 }
 return {samples,modelCalls:0,scope:'actual send pipeline; isolated IndexedDB; CPU throttled 4x; transport simulated 100ms; no Android or real model'};
}});
