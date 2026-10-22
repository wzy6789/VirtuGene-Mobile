import './chat-human-live';
import {db} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {continuityFixtures} from './chat-continuity-fixtures';
const api=globalThis as any,sessionId='isolated-live-session';
let calls:any[]=[];
window.fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))throw Error('Unexpected external request');
 const body=JSON.parse(String(init?.body));
 calls.push({body,conversation:(await db.sessions.get(sessionId))?.conversation});
 return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
api.runTopicReopening=async()=>{
 const checks:Array<{name:string;ok:boolean}>=[],rows:any[]=[];
 const check=(name:string,ok:unknown)=>checks.push({name,ok:!!ok});
 const setup=async()=>{
  await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'本地隔离验收角色。',greeting:'你好。',signature:''},0);
  await api.liveExpression.turn('周六14点去博物馆，坐地铁。');
  await api.liveExpression.turn('博物馆计划取消，不去了。');
  return (await db.sessions.get(sessionId))!.conversation!;
 };
 const cases=[
  {text:'恢复刚才那个博物馆计划吗？',outcome:'cancelled'},
  {text:'恢复刚才那个博物馆计划？',outcome:'cancelled'},
  {text:'恢复刚才那个博物馆计划是什么意思？',outcome:'cancelled'},
  {text:'现在不要恢复博物馆计划。',outcome:'cancelled'},
  {text:'继续刚才那个博物馆计划也不合适。',outcome:'cancelled'},
  {text:'继续听歌吧。',outcome:'cancelled'},
  {text:'上次为什么取消博物馆计划？只是问过去。',outcome:'cancelled'},
  {text:'帮我恢复刚才那个博物馆计划。',outcome:'pending'},
  {text:'把刚才那个博物馆计划恢复一下。',outcome:'pending'},
  {text:'我们继续刚才那个博物馆计划吧。',outcome:'pending'},
  {text:'继续刚才那个博物馆计划，出发前准备什么？',outcome:'pending'},
 ];
 for(const scenario of cases){
  const before=await setup();calls=[];
  const result=await api.liveExpression.turn(scenario.text);
  const after=(await db.sessions.get(sessionId))!.conversation!;
  const plan=after.topics?.find(t=>t.kind==='plan');
  check('actual sender outcome: '+scenario.text,!result.failed&&plan?.outcome===scenario.outcome);
  check('same identity and known slots: '+scenario.text,after.topics?.length===1&&plan?.id===before.topics![0].id&&plan?.slots.date?.value==='周六'&&plan.slots.time?.value==='14点'&&plan.slots.transport?.value==='地铁');
  check('state is effective before model request: '+scenario.text,calls.length===1&&calls[0].conversation?.topics?.find((topic:any)=>topic.id===plan?.id)?.outcome===scenario.outcome);
  rows.push({scenario,before,after,calls,result});
 }
 // Original C08 is a complete cancelled-then-reopened invitation trajectory,
 // not merely a check that the original words remain somewhere in history.
 await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'本地隔离验收角色。',greeting:'你好。',signature:''},0);
 let invitationId:string|undefined;
 const invitation=continuityFixtures.find(fixture=>fixture.id==='C08')!;
 for(let index=0;index<invitation.users.length;index++){
  const text=invitation.users[index];calls=[];await api.liveExpression.turn(text);
  const state=(await db.sessions.get(sessionId))!.conversation!;
  const plan=state.topics?.find(topic=>topic.kind==='plan');
  invitationId??=plan?.id;
  const outcome=index===0||index===5?'pending':'cancelled';
  check('original C08 typed outcome at turn '+index,plan?.outcome===outcome);
  check('original C08 retains same invitation and original weekend at turn '+index,!!plan&&plan.id===invitationId&&plan.slots.date?.value==='周末');
  check('original C08 conclusion reaches request at turn '+index,calls.length===1&&calls[0].conversation?.topics?.some((topic:any)=>topic.id===invitationId&&topic.outcome===outcome));
  rows.push({scenario:'original-C08',index,text,state,calls});
 }
 for(const text of ['我不想约朋友。','周末想约朋友吗？','如果周末想约朋友就再说。','“周末本来想约朋友”是什么意思？']){
  await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'本地隔离验收角色。',greeting:'你好。',signature:''},0);
  await api.liveExpression.turn(text);
  const state=(await db.sessions.get(sessionId))?.conversation;
  check('invitation mention is not automatically a plan: '+text,!state?.topics?.length);
  rows.push({scenario:'invitation-negative',text,state});
 }
 // Reload native storage in a new page before restoring, preserving the exact
 // source IDs rather than creating a fresh plan from a short continuation.
 const beforeReload=await setup();
 if(typeof api.reopeningReloadProbe==='function'){
  const fresh=await api.reopeningReloadProbe();
  check('fresh JavaScript reload restores same sourced plan and slots',fresh.outcome==='pending'&&fresh.id===beforeReload.topics![0].id&&fresh.date==='周六'&&fresh.time==='14点'&&fresh.transport==='地铁');
  rows.push({scenario:'reload',beforeReload,fresh});
 }
 await setup();
 const cancellation=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(message=>message.role==='user'&&message.content==='博物馆计划取消，不去了。')!;
 await messageRepo.deleteById(cancellation.id);calls=[];
 await api.liveExpression.turn('刚才那个计划现在是什么情况？');
 const invalidated=(await db.sessions.get(sessionId))?.conversation;
 check('deleting outcome source does not silently revive a pending plan',!invalidated?.topics?.some(topic=>topic.kind==='plan'&&topic.outcome==='pending'));
 return {complete:checks.every(check=>check.ok),checks,failures:checks.filter(check=>!check.ok),rows,apiCalls:0};
};
