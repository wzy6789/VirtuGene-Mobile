import './chat-human-live';
import {db} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {webApi} from '../../src/lib/web-api';
import {sendMessage} from '../../src/lib/ai/deepseek';
import {setGatewayAccessToken} from '../../src/lib/ai/gateway-session';
const api=window as any,sessionId='isolated-live-session';
let calls:any[]=[],mutate:(()=>Promise<void>)|undefined,failNext=false,qualityDraft=false;
const realSend=webApi.chat.send;
let deliveries:any[]=[];
webApi.chat.send=async params=>{const result=await realSend(qualityDraft?{...params,onDelta:undefined}:params);deliveries.push(result);return result;};
window.fetch=async(url,init)=>{
 const gateway=String(url).endsWith('/v1/chat');
 if(!gateway&&!String(url).includes('/chat/completions'))throw Error('Unexpected external request');
 const body=JSON.parse(String(init?.body));calls.push(body);
 if(qualityDraft&&calls.length===1)return new Response(JSON.stringify({choices:[{message:{content:'花是什么颜色的？你在哪看到的？旁边还有什么植物？'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
 if(failNext){failNext=false;await mutate?.();return new Response('{}',{status:500,headers:{'Content-Type':'application/json'}});}
 if(gateway)return new Response(JSON.stringify({content:'嗯。',modelId:'deepseek-flash'}),{headers:{'Content-Type':'application/json'}});
 return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
api.runRequestRecovery=async()=>{
 const checks:string[]=[],rows:any[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const setup=async()=>{mutate=undefined;failNext=false;qualityDraft=false;calls=[];await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟，认真接话。\n判断习惯：先听清具体问题。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好。',signature:''},.5);};
 await setup();failNext=true;
 const normal=await api.liveExpression.turn('刚刚看到一朵花。');
 check(calls.length===2&&normal.replies.length>0&&!normal.failed,'unchanged sources still allow exactly one provider recovery');rows.push({case:'unchanged',calls,result:normal});
 for(const scenario of ['edit-current','delete-current','transfer-session','change-account','edit-topic-source','edit-history-source']){
  await setup();
  if(scenario==='edit-topic-source'||scenario==='edit-history-source')await api.liveExpression.turn(scenario==='edit-topic-source'?'周四15点面试。':'路边那朵花是白色的。');
  const old=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(m=>m.role==='user');
  calls=[];failNext=true;
  mutate=async()=>{
   const all=await db.messages.where('sessionId').equals(sessionId).toArray();
   const current=all.filter(m=>m.role==='user').sort((a,b)=>a.createdAt-b.createdAt).at(-1)!;
   if(scenario==='edit-current')await messageRepo.update(current.id,{content:'用户已改写这条消息。'});
   if(scenario==='delete-current')await messageRepo.deleteById(current.id);
   if(scenario==='transfer-session')await db.sessions.update(sessionId,{userId:'other-owner'});
   if(scenario==='change-account')useAuthStore.setState({userId:'other-owner'});
   if(scenario==='edit-topic-source'||scenario==='edit-history-source')await messageRepo.update(old!.id,{content:'这条旧记录已经改写。'});
  };
  const result=await api.liveExpression.turn('现在接着说吧。').catch((error:Error)=>({replies:[],rejected:error.message}));
  check(calls.length===1,scenario+' never retransmits stale context after provider error');
  check(result.replies.length===0,scenario+' commits no obsolete reply');
  const edited=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(m=>m.content==='用户已改写这条消息。');
  if(scenario==='edit-current')check(edited&&!edited.failed,'late recovery failure does not mark edited replacement failed');
  rows.push({case:scenario,calls,result});
 }
 await setup();await api.liveExpression.turn('路边那朵花是白色的。');
 const historySource=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(m=>m.role==='user')!;
 calls=[];deliveries=[];qualityDraft=true;failNext=true;mutate=()=>messageRepo.update(historySource.id,{content:'旧原文已变更。'}).then(()=>undefined);
 const afterQuality=await api.liveExpression.turn('接着说说刚才的花。').catch((error:Error)=>({replies:[],rejected:error.message}));
 check(calls.length===2,'source revocation on quality retry blocks its internal third request: '+JSON.stringify({requests:calls.length,result:afterQuality,deliveries}));
 check(afterQuality.replies.length===0,'source-invalidated quality retry cannot resurrect a previous best draft');
 rows.push({case:'quality-then-edit-history',calls,result:afterQuality});
 await setup();await api.liveExpression.turn('路边那朵花是白色的。');
 const stale=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(m=>m.role==='user')!;
 await messageRepo.update(stale.id,{content:'刚才看错了，那朵花是黄色的。'});
 calls=[];const refreshed=await api.liveExpression.turn('接着说说刚才的花。');
 check(refreshed.replies.length>0&&calls[0].messages.some((m:any)=>m.role==='user'&&m.content==='刚才看错了，那朵花是黄色的。'),'normal send refreshes a stale loaded revision without asking the user to resend');
 check(!calls[0].messages.some((m:any)=>m.role==='user'&&m.content==='路边那朵花是白色的。'),'old loaded revision is absent from actual outgoing history');
 await setup();
 const saved=await api.liveExpression.turn('周四15点面试。');
 check(saved.replies.length>0,'ordinary first request still works after invalidation scenarios');
 check(useChatStore.getState().currentSessionId===sessionId,'isolated fixture remains on expected session');
 for(const route of ['byok','gateway']){
  await setup();setGatewayAccessToken(route==='gateway'?'synthetic-session-token':undefined);
  const params={apiKey:route==='byok'?'synthetic-not-a-credential':'',systemPrompt:'你是林舟。',message:'你好。',history:[]};
  let guardCalls=0;
  const denied=await sendMessage({...params,beforeRequest:async()=>{guardCalls++;throw new TypeError('Synthetic local validation failure');}}).then(()=>'',(e:Error)=>e.message);
  check(guardCalls===1&&calls.length===0&&denied==='chat:request_invalidated',route+' local guard TypeError never becomes a provider retry');
  failNext=true;const attempts:boolean[]=[];
  const result=await sendMessage({...params,beforeRequest:async({recovery})=>{attempts.push(recovery);}});
  check(result.content==='嗯。'&&JSON.stringify(attempts)==='[false,true]'&&calls.length===2,route+' both physical attempts run the guard and preserve ordinary recovery');
  check(!JSON.stringify(calls).includes('beforeRequest'),route+' callback is never serialized into provider payload');
  calls=[];const stopped=new AbortController();stopped.abort();
  const cancelled=await sendMessage({...params,signal:stopped.signal}).then(()=>'',(e:Error)=>e.message);
  check(calls.length===0&&cancelled==='chat:request_cancelled',route+' aborted request sends nothing and performs no recovery');
 }
 return {complete:true,checks,rows,paidCalls:0,scope:'Actual private sender, browser client and isolated IndexedDB; mocked transport, no model quality claim'};
};
