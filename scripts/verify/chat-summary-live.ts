import './chat-human-live';
import {db,type Message} from '../../src/db';
import {webApi} from '../../src/lib/web-api';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {summarizeRoleChat} from '../../src/lib/chat/send-service';
import {messageRepo} from '../../src/db/message-repo';
const api=window as any,sessionId='isolated-live-session',owner='isolated-live-expression-owner';
let providerRequests=0,failAndMutate:(()=>Promise<void>)|undefined,lastPayload:any;
window.fetch=async(url,init)=>{if(!String(url).includes('/chat/completions'))throw Error('Unexpected external request');providerRequests++;lastPayload=JSON.parse(String(init?.body));if(failAndMutate){const mutate=failAndMutate;failAndMutate=undefined;await mutate();return new Response('{}',{status:500,headers:{'Content-Type':'application/json'}});}return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
api.runSummaryLive=async()=>{
 const checks:string[]=[],rows:any[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const setup=async()=>{
  const character=await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟。\n判断习惯：先接眼前的话。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好。',signature:''},.5);
  const stock=Array.from({length:26},(_,i)=>({id:'summary-live-'+i,sessionId,role:i%2?'assistant':'user',content:i===0?'原定周五15点面试。':'合成旧对话'+i,revision:1,createdAt:1000+i,isProactive:false})) as Message[];
  await db.messages.bulkAdd(stock);useChatStore.setState({messages:stock});providerRequests=0;failAndMutate=undefined;
  return character;
 };
 for(const scenario of ['valid','incomplete','provider-failure','correction','delete-source','change-account','transfer-session','switch-to-group']){
  const character=await setup();let release!:(value:any)=>void,started!:(value:any)=>void;
  const gate=new Promise<any>(resolve=>{release=resolve;}),entered=new Promise<any>(resolve=>{started=resolve;});
  let summaryCalls=0;
  webApi.context.summarize=async(params)=>{summaryCalls++;started(params);return gate;};
  const task=summarizeRoleChat(sessionId,owner,character,'synthetic-not-a-credential');
  const request=await entered;
  if(scenario==='correction')await api.liveExpression.turn('更正，面试改到周四15点。');
  if(scenario==='delete-source')await messageRepo.deleteById('summary-live-0');
  if(scenario==='change-account')useAuthStore.setState({userId:'other-owner'});
  if(scenario==='transfer-session')await db.sessions.update(sessionId,{userId:'other-owner'});
  if(scenario==='switch-to-group')await db.sessions.update(sessionId,{type:'group',groupId:'g'});
  release(scenario==='provider-failure'?{error:'server:error'}:{summary:'迟到摘要：原定周五15点面试。',complete:scenario!=='incomplete'});await task;
  const session=await db.sessions.get(sessionId),memories=await db.memories.toArray();
  check(summaryCalls===1,'actual summarizer uses one generation and no replacement on '+scenario);
  if(scenario==='valid'){
   check(session?.summary?.includes('迟到摘要')&&session.summaryRevision===1,'unchanged actual background task commits summary and independent revision');
   check(memories.some(memory=>memory.type==='summary'&&memory.sourceMessageIds?.includes('summary-live-0')),'accepted actual summary creates its same-revision memory projection');
  }else{
   check(!session?.summary,'actual late summarizer does not commit after '+scenario);
   check(!memories.some(memory=>memory.type==='summary'&&(memory.status??'active')==='active'),'actual late summary cannot create an active projection after '+scenario);
  }
  if(scenario==='correction')check(session?.conversation?.topics?.some(topic=>topic.slots.date?.value==='周四'),'latest user correction remains persisted after delayed old summary returns');
  if(scenario==='incomplete'||scenario==='provider-failure'){
   check(!session?.summarySourceMessageIds?.length,'incomplete/failing actual summary does not advance coverage on '+scenario);
   await summarizeRoleChat(sessionId,owner,character,'synthetic-not-a-credential');
   check(summaryCalls===1,'failed actual summary remains throttled instead of spending another generation on '+scenario);
  }
  rows.push({scenario,request,session,memories,providerRequests,summaryCalls});
 }
 const character=await setup();let preparedCalls=0;
 webApi.context.summarize=async()=>{preparedCalls++;return {summary:'不得写入',complete:true};};
 const changeAccount=(changes:any)=>{if(changes.summaryAttemptedAt!==undefined)useAuthStore.setState({userId:'other-owner'});};
 db.sessions.hook('updating',changeAccount);
 try{await summarizeRoleChat(sessionId,owner,character,'synthetic-not-a-credential');}finally{db.sessions.hook('updating').unsubscribe(changeAccount);}
 check(preparedCalls===0,'account change during preparation skips actual summary generation');
 check(!(await db.sessions.get(sessionId))?.summaryAttemptedAt,'account change during preparation rolls back attempt metadata');
 await setup();
 await db.sessions.update(sessionId,{summary:'面试原定周五15点。',summaryRevision:1,summaryUpdatedAt:1,summarySourceMessageIds:['summary-live-0'],summarySourceMessageRevisions:{'summary-live-0':1},summarySourceMessageOffsets:{'summary-live-0':'原定周五15点面试。'.length}});
 failAndMutate=async()=>{await db.sessions.update(sessionId,{summaryRevision:2});};
 const invalidated=await api.liveExpression.turn('之前面试安排是什么？').catch((error:Error)=>({replies:[],rejected:error.message}));
 check(lastPayload.messages[0].content.includes('早前对话摘要'),'retry ABA scenario actually injected a live summary');
 check(providerRequests===1&&!invalidated.replies.length,'physical recovery rejects same-text summary generation changes before resending');
 return {complete:true,checks,rows,paidCalls:0,scope:'Actual private background summarizer plus actual correction send; manually released synthetic summary response; not real model quality or Android'};
};
