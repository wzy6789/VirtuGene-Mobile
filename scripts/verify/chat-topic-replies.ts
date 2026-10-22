import './chat-human-live';
import {db, type Message} from '../../src/db';
import {sendRoleChatReply,type ChatRequest,type RoleChatObserver} from '../../src/lib/chat/send-service';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {withChatSessionLock} from '../../src/lib/chat/request-coordinator';
import {useChatStore} from '../../src/store/chat-store';
import {readValidatedConversation,updateConversationIfCurrent} from '../../src/db/chat-topic-state-repo';
import {sessionRepo} from '../../src/db/session-repo';

type Check={name:string;ok:boolean;detail?:unknown};
const checks:Check[]=[];
type Synthetic={raw:string;finish?:string;mode?:'interrupted'|'failure';duringFetch?:()=>Promise<void>};
type ProviderObservation={input:string;raw:string;finish:string;mode?:string;systemPrompt:string;messages:Array<{role:string;content:unknown}>};
const observations:ProviderObservation[]=[];
let planned:Synthetic[]=[];
let activeFailure:Synthetic|undefined;
let unexpectedRequests=0;
const unexpectedInputs:string[]=[];
const scenarios:any[]=[];
window.fetch=async(url,init)=>{
  if(!String(url).includes('/chat/completions'))throw Error('Unexpected network request in topic reply isolation');
  const body=JSON.parse(String(init?.body));
  const next=planned.shift()??activeFailure;
  if(!next){unexpectedRequests++;unexpectedInputs.push(body.messages.at(-1)?.content??'unknown');throw Error('Unexpected model request: synthetic response queue exhausted');}
  const input=body.messages.at(-1)?.content;
  observations.push({input,raw:next.raw,finish:next.finish??'stop',mode:next.mode,systemPrompt:body.messages.filter((row:any)=>row.role==='system').map((row:any)=>row.content).join('\n'),messages:structuredClone(body.messages)});
  await next.duringFetch?.();
  if(next.mode==='failure')return new Response(JSON.stringify({error:{message:'Synthetic provider failure'}}),{status:500,headers:{'Content-Type':'application/json'}});
  if(next.mode==='interrupted')return new Response('data: '+JSON.stringify({choices:[{delta:{content:next.raw},finish_reason:null}]})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
  return new Response(JSON.stringify({choices:[{message:{content:next.raw},finish_reason:next.finish??'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
const harness=(window as any).liveExpression;
const persona={name:'隔离话题测试角色',tags:[],systemPrompt:'你是自然简短的聊天角色。只回答当前话题，不编造事实。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好',signature:'隔离测试'};
const sessionId='isolated-live-session';
const principal={sessionId,userId:'isolated-live-expression-owner',characterId:'isolated-live-role'};
function check(name:string,ok:unknown,detail?:unknown){checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});}
const allResponses=(conversation:any)=>conversation?.topics?.flatMap((topic:any)=>topic.responses??[])??[];
async function send(input:string,raw:string,finish='stop',extra:Partial<Synthetic>&{observer?:RoleChatObserver;source?:Message}={}){
  const started=performance.now();
  const plannedResponse={raw,finish,...extra};
  planned.push(plannedResponse);
  activeFailure=extra.mode==='failure'?{raw,finish,...extra}:undefined;
  const character=(await db.characters.get(principal.characterId))!;
  const source=extra.source??{id:crypto.randomUUID(),sessionId,role:'user' as const,content:input,createdAt:Date.now(),isProactive:false};
  if(!extra.source){await db.messages.add(source);useChatStore.getState().addMessage(source);}
  const stream=new ChatReplyStream(sessionId,()=>undefined);
  const request:ChatRequest={userId:principal.userId,controller:new AbortController(),stream,completed:false,stopped:false};
  let error:string|undefined;
  try{await withChatSessionLock(sessionId,()=>sendRoleChatReply(character,source,request,{userId:principal.userId,text:input,observer:extra.observer}));}
  catch(cause){error=String(cause);}
  finally{stream.dispose();activeFailure=undefined;const unused=planned.indexOf(plannedResponse);if(unused>=0)planned.splice(unused,1);}
  const replies=await db.messages.where('sessionId').equals(sessionId).filter(message=>message.role==='assistant'&&message.replyToUserMessageId===source.id).sortBy('createdAt');
  const conversation=(await db.sessions.get(sessionId))?.conversation;
  const result={source,replies,conversation,error,completed:request.completed,failed:(await db.messages.get(source.id))?.failed};
  scenarios.push({input,raw,syntheticFinish:finish,syntheticMode:extra.mode,durationMs:performance.now()-started,...result});
  return result;
}
const targetResponse=(conversation:any,source:Message)=>allResponses(conversation).find((response:any)=>response.userSource?.messageId===source.id);
const answeredSlots=(response:any)=>response?.acts?.filter((act:any)=>act.kind==='answered-slot')??[];
async function basePlan(){
  await harness.setup(persona);
  return send('周六14点去博物馆，坐地铁。','好，周六见。');
}
function responseRefs(response:any){return [response?.userSource,...(response?.replySources??[]),...(response?.acts??[]).flatMap((act:any)=>[...(act.source??[]),...(act.slotSource??[])]),response?.excerpt?.source].filter(Boolean);}
async function guardRejected(name:string,mutate:(state:any)=>void){
  const state=structuredClone((await db.sessions.get(sessionId))!.conversation!);
  mutate(state);
  check(name,!await updateConversationIfCurrent(principal,state.version??0,state));
}
function actualRef(ref:any,rows:Message[]){
  const row=rows.find(row=>row.id===ref?.messageId);
  return !!row&&(row.revision??1)===ref.revision&&Number.isInteger(ref.start)&&Number.isInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&ref.end<=row.content.length;
}
const topicBlock=(prompt:string)=>prompt.match(/\[当前事项与结论\]([\s\S]*?)\[\/当前事项与结论\]/u)?.[0]??'';
const answerAnnotation=(prompt:string,excerpt:string)=>{
  const block=topicBlock(prompt);
  return block.includes('角色回应记录')&&block.includes('已答槽位')&&block.includes('"字段":"time","值":"14点"')&&block.includes(excerpt);
};
const providerHistoryHas=(observation:ProviderObservation|undefined,text:string)=>observation?.messages.some(row=>row.role!=='system'&&typeof row.content==='string'&&row.content.includes(text));
type ReloadExpectation={questionId:string;recordId?:string;replyId:string;excerpt:string;query:string};
/** A fresh same-origin page imports the production modules into a new JS heap,
 * then resumes the already isolated fixture through actual persisted DB rows. */
(window as any).runTopicReplyReload=async(expected:ReloadExpectation)=>{
  const before=await harness.resume();
  const prior=allResponses(before).find((record:any)=>record.userSource.messageId===expected.questionId);
  check('fresh-page-resume-retains-durable-response-id',!!prior&&prior.id===expected.recordId,{prior,expected});
  const first=await send(expected.query,'是14点。');
  const captured=observations.at(-1);
  check('fresh-page-next-provider-receives-persisted-answer-annotation',!!captured&&answerAnnotation(captured.systemPrompt,expected.excerpt),captured);
  check('fresh-page-provider-history-excludes-old-answer',!!captured&&!providerHistoryHas(captured,expected.excerpt),captured?.messages);
  await db.messages.delete(expected.replyId);
  const deleted=await send(expected.query,'是14点。');
  const after=observations.at(-1),block=topicBlock(after?.systemPrompt??'');
  check('deleted-reply-next-provider-drops-that-answer-annotation',!!after&&!block.includes(expected.excerpt)&&!block.includes('"字段":"time","值":"14点"'),after);
  check('deleted-reply-next-provider-keeps-user-confirmed-time',block.includes('"time":{"value":"14点"')&&deleted.conversation?.topics?.some((topic:any)=>topic.kind==='plan'&&topic.slots.time?.value==='14点'),deleted.conversation);
  check('deleted-reply-next-send-prunes-only-dependent-response',deleted.conversation?.topics?.some((topic:any)=>topic.kind==='plan')&&!allResponses(deleted.conversation).some((record:any)=>record.userSource.messageId===expected.questionId),deleted.conversation);
  check('fresh-page-only-planned-synthetic-requests',observations.length===2&&planned.length===0&&unexpectedRequests===0,{observations:observations.length,remaining:planned.length,unexpectedRequests});
  return {checks,observations,scenarios,before,resumedResponseId:prior?.id,first,deleted,apiCalls:0,isolation:'new page and new JS heap in the same isolated browser context/origin; native IndexedDB shared only with this fixture'};
};

(window as any).runTopicReplies=async()=>{
  checks.length=0;observations.length=0;scenarios.length=0;planned=[];activeFailure=undefined;unexpectedRequests=0;unexpectedInputs.length=0;
  await basePlan();
  const answered=await send('刚才安排是几点？','回答：\r\n```text\r\n14点。\r\n---\r\n要带上水吗？\r\n```');
  const topic=answered.conversation?.topics?.find((topic:any)=>topic.kind==='plan');
  const response=allResponses(answered.conversation).find((response:any)=>response.userSource?.messageId===answered.source.id);
  const claim=response?.acts?.find((act:any)=>act.kind==='answered-slot'&&act.field==='time');
  check('actual-send-stores-final-answer',answered.replies.length>=1&&answered.replies.some((reply:Message)=>reply.content.includes('14点')),answered.replies);
  check('actual-send-records-answered-time',claim?.value==='14点',{response,topic});
  check('answered-user-source-is-question',response?.userSource?.messageId===answered.source.id&&actualRef(response?.userSource,[answered.source]));
  check('reply-sources-match-final-stored-parts',!!response?.replySources?.length&&response.replySources.every((ref:any)=>actualRef(ref,answered.replies)));
  check('polished-text-differs-from-model-raw',answered.replies.every((reply:Message)=>!reply.content.includes('```')&&!reply.content.includes('回答：')));
  check('two-final-bubbles-have-one-batch',answered.replies.length===2&&!!answered.replies[0].replyBatchId&&answered.replies.every((reply:Message)=>reply.replyBatchId===answered.replies[0].replyBatchId));
  check('every-complete-bubble-is-marked',answered.replies.length>0&&answered.replies.every((reply:any)=>reply.replyCompletion==='complete'));
  check('answered-slot-points-at-literal-final-text',claim?.source?.some((ref:any)=>answered.replies.find((row:Message)=>row.id===ref.messageId)?.content.slice(ref.start,ref.end).includes('14点')));
  check('asked-act-is-stored-followup',response?.acts?.some((act:any)=>act.kind==='asked'&&act.source?.every((ref:any)=>actualRef(ref,answered.replies)&&ref.messageId===answered.replies[1]?.id&&answered.replies[1].content.slice(ref.start,ref.end).includes('要带上水吗'))));
  check('excerpt-is-final-row-slice',!!response?.excerpt&&answered.replies.find((row:Message)=>row.id===response.excerpt.source.messageId)?.content.slice(response.excerpt.source.start,response.excerpt.source.end)===response.excerpt.text);
  check('reply-does-not-resolve-user-plan',topic?.outcome==='pending',topic?.outcome);
  const rows=await db.messages.toArray();
  check('facts-keep-user-only-slot-sources',Object.values(topic?.slots??{}).every((slot:any)=>slot.source.every((ref:any)=>rows.find(row=>row.id===ref.messageId)?.role==='user')));
  check('all-response-evidence-is-actual-row-range',!!response&&responseRefs(response).every(ref=>actualRef(ref,rows)));

  // The persisted validation boundary must independently reject forged reply
  // evidence, even when the sender supplied a valid native CAS version.
  if(response){
    const state=(await db.sessions.get(sessionId))!.conversation!;
    check('owner-mismatch-rejected',!await updateConversationIfCurrent({...principal,userId:'foreign-owner'},state.version??0,state));
    check('character-mismatch-rejected',!await updateConversationIfCurrent({...principal,characterId:'foreign-role'},state.version??0,state));
    check('session-mismatch-rejected',!await updateConversationIfCurrent({...principal,sessionId:'foreign-session'},state.version??0,state));
    await guardRejected('forged-reply-range-rejected',state=>{targetResponse(state,answered.source).replySources[0].end=4000;});
    await guardRejected('forged-answered-value-rejected',state=>{answeredSlots(targetResponse(state,answered.source))[0].value='19点';});
    await guardRejected('forged-answer-question-link-rejected',state=>{targetResponse(state,answered.source).userSource={...state.topics[0].anchorSource};});
    await guardRejected('assistant-cannot-be-slot-fact-source',state=>{const topic=state.topics.find((topic:any)=>topic.kind==='plan');topic.slots.time.source=[...targetResponse(state,answered.source).replySources];topic.source.push(...topic.slots.time.source);});
    const reply=answered.replies[0];
    await db.messages.update(reply.id,{role:'user'});
    check('reply-row-role-change-rejected',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    await db.messages.update(reply.id,{sessionId:'foreign-session'});
    check('reply-row-session-change-rejected',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    await db.messages.update(reply.id,{replyBatchId:'forged-other-batch'});
    check('mixed-batch-reply-evidence-rejected',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    await db.messages.update(reply.id,{replyToUserMessageId:topic.anchorSource.messageId});
    check('different-user-link-rejected',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    await db.messages.update(reply.id,{isProactive:true});
    check('proactive-reply-cannot-support-answer',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    await db.messages.update(reply.id,{replyCompletion:'truncated'} as any);
    check('one-truncated-part-invalidates-batch-evidence',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    await db.messages.update(reply.id,{replyBatchIndex:1});
    check('duplicate-batch-index-rejected',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    await db.messages.update(reply.id,{replyBatchSize:3});
    check('wrong-batch-size-rejected',!await updateConversationIfCurrent(principal,state.version??0,state));
    await db.messages.put(reply);
    for(const [name,content]of [['negative','不是14点。'],['quoted','你说“14点”，我听见了。'],['question','是14点吗？'],['hypothetical','如果是14点，就早点出发。']]){
      const forged=structuredClone(state) as any;
      const record=targetResponse(forged,answered.source);
      const visit=(value:any)=>{
        if(!value||typeof value!=='object')return;
        if(value.messageId===reply.id){value.start=0;value.end=content.length;}
        for(const child of Object.values(value))visit(child);
      };
      visit(record);
      if(record.excerpt.source.messageId===reply.id)record.excerpt.text=content;
      const start=content.indexOf('14点');
      answeredSlots(record).find((act:any)=>act.field==='time').source=[{messageId:reply.id,revision:reply.revision??1,start,end:start+3}];
      await db.messages.update(reply.id,{content});
      check('forged-'+name+'-substring-cannot-hide-clause-context',!await updateConversationIfCurrent(principal,state.version??0,forged));
      await db.messages.put(reply);
    }
    await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,index)=>({id:'unrelated-'+index,userId:principal.userId,characterId:'foreign-role',sourceType:'message',sourceId:'absent-'+index,status:'deleted',sourceRevision:1,updatedAt:1,suppressedMessageIds:['absent-'+index]})) as any);
    const reads:Record<string,{calls:number;rows:number;cursorVisits:number;requestedKeys:number;countTotal:number}>={};
    const restore:Array<()=>void>=[];
    try{
      for(const table of [db.messages,db.memorySourceTombstones])for(const method of ['query','get','getMany','openCursor','count']){
        const core=table.core as any,original=core[method];
        core[method]=function(...args:any[]){
          const item=reads[table.name+'.'+method]??={calls:0,rows:0,cursorVisits:0,requestedKeys:0,countTotal:0};item.calls++;
          item.requestedKeys+=method==='getMany'?(args[0]?.keys?.length??0):method==='get'?1:0;
          return original.apply(this,args).then((result:any)=>{
            if(method==='get')item.rows+=result?1:0;
            if(method==='getMany')item.rows+=result.filter(Boolean).length;
            if(method==='query'&&args[0]?.values!==false)item.rows+=result.result.length;
            if(method==='count')item.countTotal+=Number(result)||0;
            if(method==='openCursor'&&result){
              const start=result.start;result.start=function(callback:()=>void){return start.call(this,()=>{item.cursorVisits++;callback();});};
              let object=result,descriptor:PropertyDescriptor|undefined;
              while(object&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(object,'value');object=Object.getPrototypeOf(object);}
              if(descriptor?.get){
                const getValue=descriptor.get,seen=new Set<string>();
                Object.defineProperty(result,'value',{configurable:true,get(){const row=getValue.call(result),key=JSON.stringify([result.key,result.primaryKey]);if(row&&!seen.has(key)){seen.add(key);item.rows++;}return row;}});
              }else throw Error('Native cursor lacks inspectable value getter; cannot report body reads');
            }
            return result;
          });
        };restore.push(()=>{core[method]=original;});
      }
      check('native-valid-response-guard-accepts',await updateConversationIfCurrent(principal,state.version??0,state));
    }finally{restore.reverse().forEach(fn=>fn());}
    const suppressionRows=Object.entries(reads).filter(([name])=>name.startsWith('memorySourceTombstones.')).reduce((sum,[,read])=>sum+read.rows,0);
    const messageRows=Object.entries(reads).filter(([name])=>name.startsWith('messages.')).reduce((sum,[,read])=>sum+read.rows,0);
    check('selected-response-guard-skips-unrelated-8105-suppressions',suppressionRows===0&&messageRows>0&&messageRows<=25&&!reads['messages.query']&&!reads['messages.openCursor'],{suppressionRows,messageRows,unrelatedSuppressionRows:8105,reads});
  }else check('guard-fixture-has-real-persisted-response',false);

  await basePlan();
  const second=await send('刚才安排是几点？','先按这个安排。\n---\n14点。');
  const secondClaim=answeredSlots(targetResponse(second.conversation,second.source)).find((act:any)=>act.field==='time');
  check('answer-in-second-bubble-has-second-row-source',second.replies.length===2&&secondClaim?.source?.some((ref:any)=>ref.messageId===second.replies[1].id));
  const beforeRepeat=observations.length;
  const retried=await send(second.source.content,'14点。','stop',{source:second.source});
  check('same-source-retry-does-not-duplicate-response',allResponses(retried.conversation).filter((record:any)=>record.userSource.messageId===second.source.id).length===1);
  check('same-complete-source-does-not-generate-or-duplicate-bubbles',observations.length===beforeRepeat&&JSON.stringify(retried.replies.map(reply=>reply.id))===JSON.stringify(second.replies.map(reply=>reply.id)));

  await basePlan();
  const failedSource:Message={id:crypto.randomUUID(),sessionId,role:'user',content:'刚才安排是几点？',createdAt:Date.now(),isProactive:false,failed:true};
  await db.messages.add(failedSource);useChatStore.getState().addMessage(failedSource);
  const failedRetry=await send(failedSource.content,'14点。','stop',{source:failedSource});
  const freshRetrySource=await db.messages.get(failedSource.id);
  check('failed-source-retry-clears-db-failure-and-delivers',failedSource.failed===true&&freshRetrySource?.failed===false&&failedRetry.completed&&failedRetry.replies.some(reply=>reply.content==='14点。'),{originalInput:failedSource,freshRetrySource,replies:failedRetry.replies,error:failedRetry.error});
  const retriedRecord=targetResponse(failedRetry.conversation,failedSource);
  check('failed-source-successful-retry-records-answer-evidence',!!retriedRecord&&answeredSlots(retriedRecord).some((act:any)=>act.field==='time'&&act.value==='14点'&&act.source.every((ref:any)=>actualRef(ref,failedRetry.replies))),{originalInput:failedSource,freshRetrySource,response:retriedRecord,conversation:failedRetry.conversation});

  await basePlan();
  const four=await send('刚才安排是几点？','就按原来的。\n---\n14点。\n---\n坐地铁。\n---\n别赶得太急。');
  const fourResponse=targetResponse(four.conversation,four.source);
  check('four-bubble-fixture-stores-all-final-parts',four.replies.length===4,four.replies);
  check('four-bubble-record-declares-all-stored-part-ids',four.replies.length===4&&fourResponse?.replySources?.length===4&&four.replies.every((reply:Message)=>fourResponse.replySources.some((ref:any)=>ref.messageId===reply.id)));
  check('four-bubble-claim-uses-exact-answer-row',answeredSlots(fourResponse).some((act:any)=>act.field==='time'&&act.source.some((ref:any)=>ref.messageId===four.replies[1]?.id)));
  if(fourResponse){
    await guardRejected('omitting-last-declared-bubble-cannot-bypass-batch-size',state=>{
      const record=targetResponse(state,four.source),removed=record.replySources.pop();
      record.acts[0].source=record.acts[0].source.filter((ref:any)=>ref.messageId!==removed.messageId);
    });
  }

  for(const [name,raw]of [
    ['question','是14点吗？'],['negative','不是14点。'],['hypothetical','如果是14点，就早点出发。'],['quoted','你说“14点”，我听见了。'],['wrong-value','19点。'],
  ]){
    await basePlan();const result=await send('刚才安排是几点？',raw);
    check(name+'-classifier-has-actual-durable-response',result.replies.length>0&&!!targetResponse(result.conversation,result.source),result);
    check(name+'-does-not-claim-answered-slot',answeredSlots(targetResponse(result.conversation,result.source)).length===0,{raw,replies:result.replies,response:targetResponse(result.conversation,result.source)});
    check(name+'-does-not-change-user-slot',result.conversation?.topics?.find((topic:any)=>topic.kind==='plan')?.slots.time?.value==='14点');
  }

  for(const mode of ['interrupted','truncated','failure'] as const){
    await basePlan();
    const result=await send('刚才安排是几点？','先确认一下。\n---\n14点。',mode==='truncated'?'length':'stop',{mode:mode==='truncated'?undefined:mode});
    check(mode+'-does-not-store-answer-claim',answeredSlots(targetResponse(result.conversation,result.source)).length===0,{replies:result.replies,response:targetResponse(result.conversation,result.source),error:result.error});
    if(mode==='failure'){
      check('provider-failure-has-no-assistant-reply',result.replies.length===0&&!!result.failed);
      const attempts=observations.filter(row=>row.mode==='failure').length;
      check('provider-failure-has-bounded-synthetic-retry-attempts',attempts>=1&&attempts<=3,attempts);
    }
    else check(mode+'-marker-on-every-saved-bubble',result.replies.length>0&&result.replies.every((reply:any)=>reply.replyCompletion===mode));
  }

  for(const mutation of ['delete-reply','edit-reply','delete-question','edit-question','suppress-reply'] as const){
    await basePlan();const result=await send('刚才安排是几点？','14点。');
    const record=targetResponse(result.conversation,result.source);
    check(mutation+'-fixture-recorded-before-invalidation',!!record);
    if(mutation==='delete-reply')await db.messages.delete(result.replies[0].id);
    if(mutation==='edit-reply')await db.messages.update(result.replies[0].id,{content:'19点。',revision:2});
    if(mutation==='delete-question')await db.messages.delete(result.source.id);
    if(mutation==='edit-question')await db.messages.update(result.source.id,{content:'刚才安排是几号？',revision:2});
    if(mutation==='suppress-reply')await db.memorySourceTombstones.put({id:'synthetic-reply-suppression',userId:principal.userId,characterId:principal.characterId,sourceType:'message',sourceId:result.replies[0].id,status:'deleted',sourceRevision:1,updatedAt:Date.now(),suppressedMessageIds:[result.replies[0].id]} as any);
    const validated=await readValidatedConversation(principal);
    check(mutation+'-prunes-response-only',!!validated?.conversation?.topics?.some((topic:any)=>topic.kind==='plan'&&topic.slots.time?.value==='14点')&&!allResponses(validated?.conversation).some((record:any)=>record.userSource.messageId===result.source.id),validated);
  }

  await basePlan();
  const oldAnswer=await send('刚才安排是几点？','14点。');
  const correction=await send('更正，是15点。','好，15点。');
  const oldRecord=targetResponse(correction.conversation,oldAnswer.source);
  check('user-correction-invalidates-old-current-slot-claim',!answeredSlots(oldRecord).some((act:any)=>act.field==='time'&&act.value==='14点'),correction.conversation);
  check('corrected-slot-stays-user-authored',correction.conversation?.topics?.find((topic:any)=>topic.kind==='plan')?.slots.time.value==='15点');

  await basePlan();
  const observed=await send('刚才安排是几点？','14点。','stop',{observer:{onComplete(){throw Error('Synthetic observer failure after commit');}}});
  check('observer-failure-preserves-durable-reply-evidence',observed.completed&&observed.replies.length>0&&!!targetResponse(observed.conversation,observed.source)&&!observed.failed);

  await basePlan();
  let racingVersion=0;
  const raced=await send('刚才安排是几点？','14点。','stop',{duringFetch:async()=>{const session=(await db.sessions.get(sessionId))!;racingVersion=(session.conversation?.version??0)+1;await db.sessions.update(sessionId,{conversation:{...session.conversation!,version:racingVersion}});}});
  const raceState=(await db.sessions.get(sessionId))?.conversation;
  check('commit-cas-conflict-rolls-back-replies',raced.replies.length===0,raced);
  check('commit-cas-conflict-preserves-racing-state',raceState?.version===racingVersion&&!allResponses(raceState).some((record:any)=>record.userSource.messageId===raced.source.id),raceState);

  await basePlan();
  const originalCas=sessionRepo.updateConversationIfCurrent;
  let casRejectedAfterInsert=false;
  let falseCas:any;
  try{
    sessionRepo.updateConversationIfCurrent=async(principal,version,state)=>{
      const questionResponses=allResponses(state).filter((record:any)=>record.userSource?.messageId!==state.topics?.[0]?.anchorSource?.messageId);
      if(questionResponses.length){
        casRejectedAfterInsert=(await db.messages.where('sessionId').equals(sessionId).toArray()).some(row=>row.role==='assistant'&&row.content==='14点。');
        return false;
      }
      return originalCas(principal,version,state);
    };
    falseCas=await send('刚才安排是几点？','14点。');
  }finally{sessionRepo.updateConversationIfCurrent=originalCas;}
  check('cas-false-seam-executes-after-native-reply-insert',casRejectedAfterInsert);
  check('cas-false-rolls-back-native-reply-and-state',falseCas.replies.length===0&&!allResponses(falseCas.conversation).some((record:any)=>record.userSource?.messageId===falseCas.source.id),falseCas);

  await basePlan();
  let failedAfterReplyInsert=false;
  const originalSessionUpdate=db.sessions.update;
  let rollback:any;
  try{
    db.sessions.update=(async (...args:any[])=>{
      const conversation=args[1]?.conversation;
      if(allResponses(conversation).some((record:any)=>record.userSource?.messageId!==conversation?.topics?.[0]?.anchorSource?.messageId)){
        failedAfterReplyInsert=(await db.messages.where('sessionId').equals(sessionId).toArray()).some(row=>row.role==='assistant'&&row.content==='14点。');
        throw Error('Synthetic conversation write failure after reply insert');
      }
      return (originalSessionUpdate as any).apply(db.sessions,args);
    }) as any;
    rollback=await send('刚才安排是几点？','14点。');
  }finally{db.sessions.update=originalSessionUpdate;}
  check('atomic-state-failure-was-after-reply-insert',failedAfterReplyInsert);
  check('atomic-state-failure-rolls-back-message-and-response',rollback.replies.length===0&&!allResponses(rollback.conversation).some((record:any)=>record.userSource?.messageId===rollback.source.id),rollback);

  await basePlan();
  for(const raw of ['14点。','14点，不变。','还是14点。'])await send('刚才安排是几点？',raw);
  let bounded=(await db.sessions.get(sessionId))?.conversation;
  check('per-topic-response-bound-two',bounded?.topics?.every((topic:any)=>(topic.responses?.length??0)<=2)&&allResponses(bounded).length===2,bounded);
  for(const [input,raw]of [['周日15点面试。','15点。'],['周一16点开会。','16点。'],['午饭吃的是面条。','面条听着不错。']])await send(input,raw);
  bounded=(await db.sessions.get(sessionId))?.conversation;
  check('global-response-bound-four',allResponses(bounded).length===4,bounded);
  check('bounded-response-budget-records-diagnostic',!!(bounded as any)?.topicRepliesLimited);
  check('bounded-user-facts-remain',bounded?.topics?.some((topic:any)=>topic.kind==='plan'&&topic.slots.time.value==='14点'));

  // Move the original answer beyond both the recent six complete turns and
  // the continuity bridge's last ten uncovered rows. Inspect the final provider
  // payload, which distinguishes persisted annotations from surviving history.
  await basePlan();
  const loopAnswer=await send('刚才安排是几点？','14点。那个时间不用改。');
  const loopRecord=targetResponse(loopAnswer.conversation,loopAnswer.source);
  const excerpt=loopAnswer.replies[0]?.content??'missing-original-answer';
  for(let index=1;index<=12;index++)await send('窗外的云像第'+index+'只小鸭子。','第'+index+'句我接住了。');
  const query='博物馆安排是几点？';
  const next=await send(query,'是14点。');
  const captured=observations.at(-1);
  check('next-send-fixture-has-persisted-original-answer',!!loopRecord&&loopRecord.excerpt.text===excerpt,loopRecord);
  check('next-provider-history-excludes-old-answer-after-twelve-fillers',!!captured&&!providerHistoryHas(captured,excerpt),captured?.messages);
  check('next-provider-raw-bridge-excludes-old-answer',!!captured&&!captured.systemPrompt.replace(topicBlock(captured.systemPrompt),'').includes(excerpt),captured?.systemPrompt);
  check('next-provider-receives-persisted-answer-and-db-excerpt',!!captured&&answerAnnotation(captured.systemPrompt,excerpt),captured);
  check('twelve-fillers-create-no-new-topic',next.conversation?.topics?.length===1,next.conversation);
  let reload:any;
  try{
    reload=await (window as any).topicReplyReloadProbe({questionId:loopAnswer.source.id,recordId:loopRecord?.id,replyId:loopAnswer.replies[0].id,excerpt,query});
    checks.push(...reload.checks);
  }catch(cause){check('fresh-page-reload-probe-executes',false,String(cause));}
  check('no-unplanned-model-calls',planned.length===0&&unexpectedRequests===0,{remaining:planned.length,calls:observations.length,unexpectedRequests,unexpectedInputs});
  return {complete:checks.every(check=>check.ok),checks,failures:checks.filter(check=>!check.ok),observations,scenarios,reload,unexpectedRequests,apiCalls:0,microphone:false,network:'synthetic fetch only; browser blocks requests outside temporary localhost origin',model:'未确认',reasoning:'未确认'};
};
