import './chat-human-live';
import {db,type Message} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {sessionRepo} from '../../src/db/session-repo';
import {useChatStore} from '../../src/store/chat-store';
import {useAuthStore} from '../../src/store/auth-store';
import {webApi} from '../../src/lib/web-api';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
const api=window as any,owner='isolated-live-expression-owner',sessionId='isolated-live-session',actor='isolated-live-role';
const nativeSend=webApi.chat.send;
let buffered=true,throwAfterTransport=false,onVisible:(()=>void)|undefined;
webApi.chat.send=async params=>{
 const result=await nativeSend(buffered?{...params,onDelta:undefined}:params);
 if(throwAfterTransport)throw Error('Synthetic outer transport interruption after visible text');
 return result;
};
api.runReplyCommit=async()=>{
 const checks:string[]=[],rows:any[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const setup=async()=>{
  await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟，简短自然地接话。',greeting:'你好。',signature:''},.5);
  const history:Message={id:'reply-history-source',sessionId,role:'user',content:'路边那朵花是白色的。',createdAt:1000,isProactive:false};
  await messageRepo.create(history);useChatStore.getState().addMessage(history);
 };
 const turn=async(throwAfterCommit=false)=>{
  const source:Message={id:'reply-current-source',sessionId,role:'user',content:'接着聊聊刚才看到的。',createdAt:2000,isProactive:false};
  await messageRepo.create(source);useChatStore.getState().addMessage(source);
  const stream=new ChatReplyStream(sessionId,()=>undefined),visible:string[][]=[];
  const unsubscribe=stream.subscribe(()=>{visible.push([...stream.getSnapshot()]);if(stream.published)onVisible?.();});
  const request:ChatRequest={controller:new AbortController(),stream,userId:owner,stopped:false,completed:false};
  let rejected='';
  try{await sendRoleChatReply((await db.characters.get(actor))!,source,request,{userId:owner,text:source.content,observer:{onComplete:()=>{if(throwAfterCommit)throw Error('Synthetic completed observer failure');}}});}
  catch(error){rejected=(error as Error).message;}
  finally{unsubscribe();stream.dispose();}
  const replies=(await db.messages.where('sessionId').equals(sessionId).toArray()).filter(message=>message.role==='assistant');
  return {replies,userFailed:(await db.messages.get(source.id))?.failed===true,storeReplies:useChatStore.getState().messages.filter(message=>message.role==='assistant'),visible,rejected,completed:request.completed,conversation:(await db.sessions.get(sessionId))?.conversation};
 };
 for(const scenario of ['valid','post-commit-observer-error','post-commit-state-error','edit-history','delete-history','suppress-history','edit-current','delete-current','edit-image','transfer-session','transfer-character','group-session','account-round-trip','edit-summary','delete-memory','second-bubble-fails']){
  await setup();let calls=0,stateWrites=0;const savedCreate=messageRepo.create,savedState=sessionRepo.updateConversationIfCurrent;
  if(scenario==='post-commit-state-error')sessionRepo.updateConversationIfCurrent=async()=>{stateWrites++;throw Error('Synthetic completed state write failure');};
  if(scenario==='edit-summary'){
   await messageRepo.create({id:'reply-summary-source',sessionId,role:'user',content:'最初的摘要来源。',createdAt:100,isProactive:false});
   await db.sessions.update(sessionId,{summary:'REPLY_SUMMARY_MARKER 用户喜欢白花。',summaryUpdatedAt:100,summarySourceMessageIds:['reply-summary-source'],summarySourceMessageRevisions:{'reply-summary-source':1}});
  }
  if(scenario==='delete-memory')await db.memories.put({id:'reply-private-memory',userId:owner,characterId:actor,content:'REPLY_PRIVATE_MEMORY 用户喜欢薄荷。',type:'manual',pinned:true,confidence:1,createdAt:100});
  if(scenario==='second-bubble-fails')messageRepo.create=async message=>{if(message.role==='assistant'&&message.replyBatchIndex===1)throw Error('Synthetic second bubble failure');return savedCreate.call(messageRepo,message);};
  window.fetch=async(_url,init)=>{
   const payload=JSON.parse(String(init?.body));
   if(!payload.messages?.some((message:any)=>message.content==='接着聊聊刚才看到的。'))return Response.json({choices:[{message:{content:'[]'}}]});
   calls++;
   if(!payload.messages?.some((message:any)=>message.content==='路边那朵花是白色的。'))throw Error('Expected history missing from actual request');
   if(scenario==='edit-history')await messageRepo.update('reply-history-source',{content:'刚才看错了，是黄色的。'});
   if(scenario==='delete-history')await messageRepo.deleteById('reply-history-source');
   if(scenario==='suppress-history')await db.memorySourceTombstones.put({id:'reply-history-suppression',userId:owner,characterId:actor,sourceType:'memory',sourceId:'old-derived-memory',sourceRevision:1,status:'withdrawn',updatedAt:1,suppressedMessageIds:['reply-history-source']});
   if(scenario==='edit-current')await messageRepo.update('reply-current-source',{content:'用户已改问其他内容。'});
   if(scenario==='delete-current')await messageRepo.deleteById('reply-current-source');
   if(scenario==='edit-image')await messageRepo.update('reply-current-source',{image:'data:image/png;base64,synthetic'});
   if(scenario==='transfer-session')await db.sessions.update(sessionId,{userId:'other-owner'});
   if(scenario==='transfer-character')await db.characters.update(actor,{createdBy:'other-owner'});
   if(scenario==='group-session')await db.sessions.update(sessionId,{type:'group'});
   if(scenario==='account-round-trip'){useAuthStore.setState({userId:'other-owner'});useAuthStore.setState({userId:owner});}
   if(scenario==='edit-summary'){
    check(JSON.stringify(payload.messages).includes('REPLY_SUMMARY_MARKER'),'summary revocation fixture actually injects the summary into the model request');
    await messageRepo.update('reply-summary-source',{content:'摘要来源已经更正。'});
   }
   if(scenario==='delete-memory'){
    check(JSON.stringify(payload.messages).includes('REPLY_PRIVATE_MEMORY'),'memory revocation fixture actually injects the memory into the model request');
    await db.memories.delete('reply-private-memory');
   }
   return Response.json({choices:[{message:{content:'嗯。\n---\n花的颜色挺特别。'}}]});
  };
  let result;try{result=await turn(scenario==='post-commit-observer-error');}finally{messageRepo.create=savedCreate;sessionRepo.updateConversationIfCurrent=savedState;}
  if(scenario==='valid'||scenario.startsWith('post-commit-'))check(result.replies.length===2&&result.storeReplies.length===2&&result.completed&&!result.userFailed,'complete reply stays successfully delivered on '+scenario);
  else{
   check(result.replies.length===0&&result.storeReplies.length===0,'no stale or partial saved batch on '+scenario);
   if(scenario!=='second-bubble-fails')check(result.visible.length===0,'invalid buffered draft never becomes visible on '+scenario);
   check(!result.completed,'invalid/incomplete batch is never marked completed on '+scenario);
  }
  check(calls===1,'commit failure never spends another generation on '+scenario);
  if(scenario==='post-commit-state-error')check(stateWrites===1,'post-commit state-failure fixture actually reaches the auxiliary update');
  rows.push({scenario,result,calls});
 }
 buffered=false;
 for(const streamCase of ['complete','interrupted','transport-throws','late-history']){
  throwAfterTransport=streamCase==='transport-throws';
  await setup();let calls=0,releaseVisible!:()=>void;
  const visibleGate=new Promise<void>(resolve=>{releaseVisible=resolve;});onVisible=releaseVisible;
  window.fetch=async(_url,init)=>{
   const payload=JSON.parse(String(init?.body));
   if(!payload.messages?.some((message:any)=>message.content==='接着聊聊刚才看到的。'))return Response.json({choices:[{message:{content:'[]'}}]});
   calls++;const encode=new TextEncoder(),frame=(text:string)=>encode.encode('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');
   return new Response(new ReadableStream({start(controller){
    controller.enqueue(frame('嗯。'));
    void visibleGate.then(async()=>{
     if(streamCase==='late-history')await messageRepo.update('reply-history-source',{content:'原来的花色已经更正。'});
     if(streamCase==='interrupted'){controller.error(new TypeError('Synthetic stream interruption'));return;}
     controller.enqueue(frame('\n---\n接着说吧。'));controller.enqueue(encode.encode('data: [DONE]\n\n'));controller.close();
    }).catch(error=>controller.error(error));
   }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  const result=await turn();onVisible=undefined;
  check(calls===1&&result.visible.length>0,'actual incremental stream publishes without a second generation on '+streamCase);
  if(streamCase==='complete'){
   check(result.replies.length===2&&result.storeReplies.length===2&&result.replies.every(message=>message.replyBatchSize===2&&message.replyBatchId===result.replies[0].replyBatchId&&message.replyCompletion==='complete'),'complete streamed batch has consistent DB/store/batch metadata');
  }else if(streamCase==='interrupted'){
   check(result.replies.length===1&&result.replies[0].content==='嗯。'&&result.replies[0].interrupted&&!result.conversation?.turnCount,'interruption preserves only visible prefix without successful-reply state advancement');
  }else if(streamCase==='transport-throws'){
   const shown=result.visible.at(-1)??[];
   check(shown.length>0&&result.replies.length===shown.length&&result.replies.every((message,index)=>message.replyCompletion==='interrupted'&&message.content===shown[index])&&!result.completed&&!result.conversation?.turnCount,'outer transport interruption stamps the persisted visible prefix incomplete');
   check(JSON.stringify(result.storeReplies)===JSON.stringify(result.replies),'interrupted UI messages match the actual persisted batch');
  }else{
   check(result.replies.length===0&&result.storeReplies.length===0&&!result.completed,'source changed after first visible stream cannot persist an obsolete reply or completed state');
  }
  rows.push({streamCase,calls,result});
 }
 throwAfterTransport=false;
 return {complete:true,checks,rows,paidCalls:0,scope:'Actual private sender and isolated native IndexedDB, buffered response local substitute; no live-model/Android claim'};
};
