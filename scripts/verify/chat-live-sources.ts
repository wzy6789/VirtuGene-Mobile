import './chat-human-live';
import Dexie,{RangeSet,rangesOverlap,type ObservabilitySet} from 'dexie';
import {db,type Message} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {useChatStore} from '../../src/store/chat-store';
import {useAuthStore} from '../../src/store/auth-store';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
const api=window as any,owner='isolated-live-expression-owner',sessionId='isolated-live-session',actor='isolated-live-role';
const deferred=()=>{let resolve!:(value?:any)=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
api.changeLiveHistoryFromWriter=()=>messageRepo.update('live-history',{content:'另一个页面已更正原话。'});
api.runLiveSources=async()=>{
 const checks:string[]=[],rows:any[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 api.liveSourceProgress={checks,rows};
 for(const scenario of ['unchanged','unrelated-write','rollback-write','edit-history','cross-page-history','edit-before-first','delete-history','suppress-history','edit-current','edit-image','delete-memory','edit-summary','change-account','account-round-trip','transfer-character','transfer-session']){
  await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟，简短自然接话。',greeting:'你好。',signature:''},.5);
  const old:Message={id:'live-history',sessionId,role:'user',content:'路边那朵花是白色的。',createdAt:1000,isProactive:false};
  const source:Message={id:'live-current',sessionId,role:'user',content:'接着聊聊刚才看到的。',createdAt:2000,isProactive:false};
  await messageRepo.create(old);await messageRepo.create(source);useChatStore.setState({messages:[old,source]});
  if(scenario==='delete-memory')await db.memories.put({id:'live-private-memory',userId:owner,characterId:actor,content:'LIVE_PRIVATE_MEMORY 用户喜欢薄荷。',type:'manual',pinned:true,confidence:1,createdAt:100});
  if(scenario==='edit-summary'){
   await messageRepo.create({id:'live-summary-source',sessionId,role:'user',content:'摘要的原始来源。',createdAt:100,isProactive:false});
   await db.sessions.update(sessionId,{summary:'LIVE_SUMMARY 用户偏好白色花。',summaryUpdatedAt:100,summarySourceMessageIds:['live-summary-source'],summarySourceMessageRevisions:{'live-summary-source':1}});
  }
  const first=deferred(),second=deferred(),aborted=deferred();let calls=0;
  window.fetch=async(_url,init)=>{
   const payload=JSON.parse(String(init?.body));
   if(!payload.messages?.some((item:any)=>item.content===source.content))return Response.json({choices:[{message:{content:'[]'}}]});
   if(scenario==='delete-memory')check(JSON.stringify(payload).includes('LIVE_PRIVATE_MEMORY'),'memory fixture is actually injected');
   if(scenario==='edit-summary')check(JSON.stringify(payload).includes('LIVE_SUMMARY'),'summary fixture is actually injected');
   calls++;const encoder=new TextEncoder(),frame=(content:string)=>encoder.encode('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');
   return new Response(new ReadableStream({start(controller){
    const cancel=()=>{aborted.resolve();try{controller.error(init?.signal?.reason??new DOMException('Aborted','AbortError'));}catch{}};
    init?.signal?.addEventListener('abort',cancel,{once:true});
    void (async()=>{
     if(scenario==='edit-before-first')await messageRepo.update(old.id,{content:'首段到达前来源已改。'});
     if(init?.signal?.aborted)return;
     controller.enqueue(frame('嗯。'));
     await Promise.race([first.promise,aborted.promise]);
     if(init?.signal?.aborted)return;
     if(scenario==='edit-history')await messageRepo.update(old.id,{content:'刚才看错了，是黄色的。'});
     if(scenario==='cross-page-history'){
      const received=deferred(),target=new RangeSet(old.id);
      const listener=(parts:ObservabilitySet)=>{const range=parts['idb://'+db.name+'/messages/'];if(range&&rangesOverlap(range,target))received.resolve();};
      Dexie.on.storagemutated.subscribe(listener);
      try{await api.mutateLiveSourceFromOtherPage();await received.promise;}finally{Dexie.on.storagemutated.unsubscribe(listener);}
     }
     if(scenario==='delete-history')await messageRepo.deleteById(old.id);
     if(scenario==='suppress-history')await db.memorySourceTombstones.put({id:'live-history-suppression',userId:owner,characterId:actor,sourceType:'memory',sourceId:'old-derived-memory',sourceRevision:1,status:'withdrawn',updatedAt:1,suppressedMessageIds:[old.id]});
     if(scenario==='edit-current')await messageRepo.update(source.id,{content:'用户已改问。'});
     if(scenario==='edit-image')await messageRepo.update(source.id,{image:'data:image/png;base64,synthetic'});
     if(scenario==='delete-memory')await db.memories.delete('live-private-memory');
     if(scenario==='edit-summary')await messageRepo.update('live-summary-source',{content:'摘要来源已改。'});
     if(scenario==='change-account')useAuthStore.setState({userId:'other-owner'});
     if(scenario==='account-round-trip'){useAuthStore.setState({userId:'other-owner'});useAuthStore.setState({userId:owner});}
     if(scenario==='transfer-character')await db.characters.update(actor,{createdBy:'other-owner'});
     if(scenario==='transfer-session')await db.sessions.update(sessionId,{userId:'other-owner'});
     if(scenario==='unrelated-write')await db.diaries.put({id:'live-unrelated-diary',userId:owner,date:'2026-10-19',title:'无关私密合成记录',content:'NOT_IN_SELECTED_EVIDENCE',mood:3,tags:[],createdAt:1,updatedAt:1,visibility:'private'} as any);
     if(scenario==='rollback-write')await db.transaction('rw',db.messages,async()=>{await db.messages.update(old.id,{content:'这个改动会回滚。'});throw Error('Synthetic rollback');}).catch(()=>undefined);
     if(init?.signal?.aborted)return;
     controller.enqueue(frame('\n---\n后面那段旧稿。'));
     await Promise.race([second.promise,aborted.promise]);
     if(init?.signal?.aborted)return;
     controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();
    })().catch(error=>{try{controller.error(error);}catch{}});
   }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  const stream=new ChatReplyStream(sessionId,()=>undefined),visible:string[][]=[];
  const unsubscribe=stream.subscribe(()=>{const value=[...stream.getSnapshot()];visible.push(value);if(value.length)first.resolve();if(value.length>1)second.resolve();});
  const request:ChatRequest={controller:new AbortController(),stream,userId:owner,stopped:false,completed:false};
  let rejected='';
  try{await sendRoleChatReply((await db.characters.get(actor))!,source,request,{userId:owner,text:source.content});}
  catch(error){rejected=(error as Error).message;}
  finally{unsubscribe();stream.dispose();}
  const replies=(await db.messages.where('sessionId').equals(sessionId).toArray()).filter(message=>message.role==='assistant');
  const result={scenario,calls,visible,replies,rejected,completed:request.completed};rows.push(result);
  check(calls===1,'one physical model request without retry on '+scenario);
  if(scenario==='edit-before-first')check(visible.length===0,'source changed before first body never flashes an invalid first prefix');
  else check(visible.some(parts=>parts.includes('嗯。')),'actual stream publishes its first prefix on '+scenario);
  if(['unchanged','unrelated-write','rollback-write'].includes(scenario))check(replies.length===2&&request.completed,'valid stream resumes and commits both bubbles on '+scenario);
  else{
   check(visible.every(parts=>!parts.join('').includes('后面那段旧稿')),'committed source change freezes publication before a later SSE delta');
   check(!request.completed&&replies.length===0,'source-invalidated stream never commits or advances successful delivery');
  }
 }
 return {complete:true,checks,rows,paidCalls:0,scope:'Actual sender, native isolated DB and controlled SSE; no external model or Android claim'};
};
