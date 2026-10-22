import {db} from '@release/db/index';
import {useAuthStore} from '@release/store/auth-store';
import {useChatStore} from '@release/store/chat-store';
import {useSettingsStore} from '@release/store/settings-store';
import {webApi} from '@release/lib/web-api';
import {sendRoleChatReply} from '@release/lib/chat/send-service';
import {ChatReplyStream} from '@release/lib/chat-stream';
window.fetch=async()=>{throw Error('External calls disabled');};
webApi.context.summarize=async()=>({error:'server:error'});
webApi.context.settle=async()=>({error:'server:error'});
webApi.memory.extract=async()=>({memories:[]});
Object.assign(window,{releaseSpeed:async(data:any)=>{
 const samples=[];
 for(const sessionIndex of [6,8,16]){
  await db.delete();await db.open();
  for(const [key,rows] of Object.entries(data)){
   const table=db.tables.find(t=>t.name===(key==='sourceTombstones'?'memorySourceTombstones':key));
   if(table&&Array.isArray(rows)&&key!=='users')await table.bulkPut(rows);
  }
  const session=data.sessions[sessionIndex],character=data.characters.find((c:any)=>c.id===session.characterId),userId=session.userId;
  useAuthStore.getState().login(userId,'isolated','test-no-key','');
  useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false});
  const messages=(await db.messages.where('sessionId').equals(session.id).sortBy('createdAt')).slice(-200);
  useChatStore.setState({characters:data.characters,currentSessionId:session.id,selectedCharacterId:character.id,messages});
  const source={id:crypto.randomUUID(),sessionId:session.id,role:'user',content:'你好',createdAt:Date.now(),revision:1,isProactive:false};
  await db.messages.put(source as any);useChatStore.getState().addMessage(source as any);
  let calls=0,preparationMs=0,firstVisibleMs:number|undefined,promptChars=0,requestDigest='',disableThinking:boolean|undefined;
  const started=performance.now();(window as any).__phaseTimes=[];
  webApi.chat.send=async p=>{calls++;preparationMs=performance.now()-started;promptChars=p.systemPrompt.length;disableThinking=p.disableThinking;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({systemPrompt:p.systemPrompt,history:p.history,message:p.message})));requestDigest=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');await new Promise(r=>setTimeout(r,100));p.onDelta?.('嗯。');return {content:'嗯。',modelId:'test-mock'};};
  const stream=new ChatReplyStream(session.id,()=>{firstVisibleMs??=performance.now()-started;});
  try{await sendRoleChatReply(character,source as any,{userId,controller:new AbortController(),stream,completed:false,stopped:false},{userId,text:source.content});}
  finally{stream.dispose();}
  samples.push({sessionIndex,role:character.name,messageCount:messages.length,preparationMs,firstVisibleMs,totalMs:performance.now()-started,promptChars,requestDigest,disableThinking,calls,phaseTimes:(window as any).__phaseTimes});
 }
 return {samples,modelCalls:0,scope:'Actual OPPO backup data in isolated desktop IndexedDB; mocked provider; no production records altered'};
}});
