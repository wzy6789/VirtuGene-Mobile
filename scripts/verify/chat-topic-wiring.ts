import './chat-human-live';
import {db} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {sessionRepo} from '../../src/db/session-repo';
import {updateChatConversationState} from '../../src/lib/chat-conversation-state';
const api=globalThis as any;
api.topicReloadCalls=()=>calls;
const sessionId='isolated-live-session';
let calls:any[]=[],fail=false,action:'edit-current'|'edit-evidence'|'newer-state'|undefined;
window.fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))throw Error('Unexpected external request');
 const body=JSON.parse(String(init?.body));
 calls.push({body,storedAtRequest:(await db.sessions.get(sessionId))?.conversation});
 if(action==='edit-current'){
  action=undefined;
  const source=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(row=>row.role==='user'&&row.content===body.messages[body.messages.length-1].content)!;
  await messageRepo.update(source.id,{content:'用户已经改写这条消息。'});
 }
 if(action==='newer-state'){
  action=undefined;
  const session=(await db.sessions.get(sessionId))!;
  const source={id:'other-window-current',sessionId,role:'user' as const,content:'更正，是周五16点。',revision:1,createdAt:Date.now()+1,isProactive:false};await db.messages.add(source);
  const next=updateChatConversationState(session.conversation,source.content,'',undefined,Date.now()+1,'',{message:source,domain:'user-reality'});
  if(!await sessionRepo.updateConversationIfCurrent({sessionId,userId:session.userId,characterId:session.characterId},session.conversation?.version??0,next))throw Error('Concurrent state fixture was not written');
 }
 if(action==='edit-evidence'){
  action=undefined;
  const source=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(row=>row.role==='user'&&row.content==='周四15点面试。')!;
  await messageRepo.update(source.id,{content:'周五16点面试。'});
 }
 if(fail)return new Response(JSON.stringify({error:{message:'synthetic provider failure'}}),{status:500,headers:{'Content-Type':'application/json'}});
 return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
api.runTopicWiring=async()=>{
 const checks:string[]=[];const rows:any[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const setup=async()=>{fail=false;await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟，认真接话。\n判断习惯：先听清具体问题。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好。',signature:''},.5);};
 await setup();
 const inputs=['周日去博物馆吧。','刚才口误，是周六14点。','坐地铁，具体哪家馆还没选。','周末这个先放一放。','最近有首歌很好听。','继续刚才那个周末安排，出发前准备什么？','这次博物馆计划取消，不去了。','上次为什么取消？只是问过去。','现在恢复刚才那个博物馆计划。'];
 for(let i=0;i<inputs.length;i++){
  calls=[];const result=await api.liveExpression.turn(inputs[i]);
  const state=(await db.sessions.get(sessionId))?.conversation;
  rows.push({input:inputs[i],state,calls,result});
  const plan=state?.topics?.find(t=>t.kind==='plan');
  check(!result.failed&&!!plan,'actual sender persists a sourced plan at turn '+(i+1));
  check(calls.some(call=>call.storedAtRequest?.topics?.some((topic:any)=>topic.kind==='plan')),'user fact already stored before transport at turn '+(i+1));
  if(i===1)check(plan!.slots.date.value==='周六'&&plan!.slots.time.value==='14点','actual correction merges date and time');
  if(i===3||i===4)check(plan!.outcome==='deferred','pause survives unrelated song without cancellation');
  if(i===5){const prompt=calls[0].body.messages[0].content;check(plan!.outcome==='pending'&&prompt.includes('[当前事项与结论]')&&prompt.includes('周六')&&prompt.includes('14点')&&prompt.includes('地铁'),'reopening supplies known slots to actual final prompt');}
  if(i===6||i===7)check(plan!.outcome==='cancelled','historical inquiry does not resume cancelled plan');
 }
 let reload;
 if(typeof api.topicReloadProbe==='function'){
  reload=await api.topicReloadProbe();
  check(reload.date==='周六'&&reload.time==='14点'&&reload.transport==='地铁'&&reload.promptSuppliedKnownSlots,'fresh JavaScript page restores and uses the same persisted plan sources');
 }
 const oldDateSource=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(row=>row.role==='user'&&row.content===inputs[1])!;
 await messageRepo.deleteById(oldDateSource.id);
 calls=[];const afterDeletion=await api.liveExpression.turn('刚才安排现在几点？');
 const deletedState=(await db.sessions.get(sessionId))?.conversation;
 check(!deletedState?.topics?.some(t=>t.slots.date?.value==='周六'),'deleted date source is not revived into current state');
 check(calls[0].body.messages[0].content.includes('来源已失效'),'final prompt marks unknown current fields rather than restoring old values');
 rows.push({input:'刚才安排现在几点？',state:deletedState,calls,result:afterDeletion});
 await setup();fail=true;calls=[];
 const failed=await api.liveExpression.turn('考试已经结束了，成绩也不担心。');
 const failedState=(await db.sessions.get(sessionId))?.conversation;
 check(failed.failed&&failedState?.topics?.some(t=>t.kind==='exam'&&t.outcome==='resolved'),'provider failure does not retract already recorded user conclusion');
 const failedProvider={result:failed,state:failedState,calls};
 fail=false;calls=[];
 await api.liveExpression.turn('那考试还没结束吗？');
 check(calls[0].body.messages[0].content.includes('resolved'),'next turn still receives the user conclusion after a failed provider response');
 await setup();action='edit-current';calls=[];
 const edited=await api.liveExpression.turn('周四15点面试。').catch((error:Error)=>({replies:[],rejected:error.message}));
 const changed=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(row=>row.content==='用户已经改写这条消息。')!;
 check(changed?.revision===2&&!changed.failed&&!edited.replies.length&&edited.rejected==='chat:source_changed','late failure does not mark or overwrite the edited user revision');
 await setup();action='newer-state';calls=[];
 const superseded=await api.liveExpression.turn('周四15点面试。').catch((error:Error)=>({replies:[],rejected:error.message}));
 const latest=(await db.sessions.get(sessionId))?.conversation;
 check(latest?.topics?.find(t=>t.kind==='plan')?.slots.date.value==='周五'&&!superseded.replies.length&&superseded.rejected==='chat:topic_changed','newer native state is not overwritten by an old request response');
 await setup();await api.liveExpression.turn('周四15点面试。');action='edit-evidence';
 const staleEvidence=await api.liveExpression.turn('出发前要准备什么？').catch((error:Error)=>({replies:[],rejected:error.message}));
 check(!staleEvidence.replies.length&&['chat:topic_source_changed','chat:history_changed'].includes(staleEvidence.rejected??''),'source edit during transport rejects the stale history or topic source before saving a reply');
 return {complete:true,checks,rows,reload,failedProvider,edited,superseded,latest,staleEvidence,paidCalls:0,scope:'Actual sender and isolated DB; synthetic transport; not model-language acceptance'};
};
