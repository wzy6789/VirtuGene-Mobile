import {db} from '@release/db/index';
import {useAuthStore} from '@release/store/auth-store';
import {useChatStore} from '@release/store/chat-store';
import {useSettingsStore} from '@release/store/settings-store';
import {webApi} from '@release/lib/web-api';
import {sendRoleChatReply} from '@release/lib/chat/send-service';
import {ChatReplyStream} from '@release/lib/chat-stream';
import {knowledgeRepo} from '@release/db/knowledge-repo';
import {chatQualityReport} from '@release/lib/chat-quality-metrics';

window.fetch=async()=>{throw Error('Unexpected network: zero-network release comparison');};
webApi.context.summarize=async()=>({error:'server:error'});
webApi.context.settle=async()=>({error:'server:error'});
webApi.memory.extract=async()=>({memories:[]});
Object.assign(window,{releaseSpeed:async()=>{
  await db.delete();await db.open();
  const userId='u',characterId='a',now=Date.now();
  useAuthStore.getState().login(userId,'隔离速度测试','test-only-no-provider-key','');
  useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false});
  const character={id:characterId,createdBy:userId,name:'林舟',avatar:'🌙',systemPrompt:'你是林舟，成年朋友，说话自然直率，有自己的想法。\n对话样本：对方说今天下雨，你说：鞋没湿吧？',tags:['直率'],isPreset:false,isCustom:true,published:false,proactivity:0.5,signature:'',greeting:'',createdAt:now};
  await db.characters.put(character as any);
  await db.diaries.bulkPut(Array.from({length:600},(_,index)=>({id:'diary-'+index,userId,date:'2026-10-13',title:'性能日记标记 '+index,content:'真实授权的测试记录。'+'正文'.repeat(500),characterId,visibility:index<6?'selected':'private',visibleTo:index<6?[characterId]:[],createdAt:now,updatedAt:now,revision:1,tags:[],mood:3})) as any);
  await db.characterKnowledge.bulkPut(Array.from({length:10000},(_,index)=>({id:'unrelated-knowledge-'+index,userId,worldId:'w',characterId,eventId:'other-'+index,knowledgeLevel:'full',canMention:true,learnedAt:now})) as any);
  for(let index=0;index<6;index++)await knowledgeRepo.upsert({userId,worldId:'w',characterId,eventId:'diary:diary-'+index,knowledgeLevel:'full',canMention:true});
  const samples=[];
  for(let iteration=0;iteration<3;iteration++){
    const sessionId='speed-session-'+iteration;
    await db.sessions.put({id:sessionId,userId,characterId,title:'测试',createdAt:now,updatedAt:now,modelAsked:true,model:{provider:'deepseek',model:'deepseek-flash'}} as any);
    useChatStore.setState({characters:[character] as any,currentSessionId:sessionId,selectedCharacterId:characterId,messages:[],hasMoreMessages:false});
    const source={id:'speed-message-'+iteration,sessionId,role:'user',content:'你好',createdAt:now+iteration,isProactive:false};
    await db.messages.put(source as any);useChatStore.getState().addMessage(source as any);
    let firstVisibleMs:number|undefined,preparationMs:number|undefined,calls=0,outgoingPrompt='';
    const started=performance.now();
    webApi.chat.send=async params=>{
      calls++;preparationMs=performance.now()-started;outgoingPrompt=params.systemPrompt;
      await new Promise(resolve=>setTimeout(resolve,100));
      params.onDelta?.('嗨，今天怎么样？');
      return {content:'嗨，今天怎么样？',modelId:'deepseek-flash'};
    };
    const stream=new ChatReplyStream(sessionId,()=>{firstVisibleMs??=performance.now()-started;});
    const request={userId,controller:new AbortController(),stream,completed:false,stopped:false};
    try {await sendRoleChatReply(character as any,source as any,request,{userId,text:source.content});}
    finally {stream.dispose();}
    const elapsedMs=performance.now()-started;
    const saved=await db.messages.where('sessionId').equals(sessionId).toArray();
    const replies=saved.filter(row=>row.role==='assistant'&&row.replyToUserMessageId===source.id);
    if(calls!==1||replies.length!==1||replies[0].content!=='嗨，今天怎么样？'||firstVisibleMs===undefined)throw Error('Actual send did not preserve the single mocked reply');
    const ids=(replies[0].contextTrace?.crossChannelReferences??[]).filter(ref=>ref.source==='diary').map(ref=>ref.id);
    // The normal private prompt's 2600-character budget admits five of these
    // six long authorized entries. Keep that existing budget in every version.
    if(ids.length!==5||ids.some(id=>!/^diary-[0-4]$/.test(id)))throw Error('Actual send changed the authorized diary candidate set: '+ids.join(','));
    if(outgoingPrompt.includes('性能日记标记 6'))throw Error('Private diary leaked into the outgoing prompt');
    samples.push({iteration:iteration+1,elapsedMs,preparationMs,firstVisibleMs,ids,calls,savedReply:replies[0].content,quality:chatQualityReport().events.at(-1)});
  }
  return {diaries:600,unrelatedKnowledge:10000,samples,modelCalls:0,mockedReplyDelayMs:100,scope:'actual sendRoleChatReply and ChatReplyStream, isolated IndexedDB, desktop Chrome CPU throttled 4x; mocked transport, not real model or Android'};
}});
