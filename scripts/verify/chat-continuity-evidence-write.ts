import {db,type Character,type Message,type ContinuityThread} from '../../src/db';
import {continuityRepo} from '../../src/db/continuity-repo';
import {messageRepo} from '../../src/db/message-repo';
import {ipc} from '../../src/lib/ipc-client';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useEmotionStore} from '../../src/store/emotion-store';
import {collectSyncData,importSyncData} from '../../src/lib/sync';
import {buildCharacterMemoryContext,revalidateCharacterMemoryContext,type CharacterMemoryRequest} from '../../src/lib/character-memory';

type Ref={sessionId:string;messageId:string;revision:number;start:number;end:number};
type Evidence={kind:'private-chat';domain:'unclassified';sources:Ref[]};
type Check={name:string;ok:boolean;detail?:unknown};
const owner='continuity-evidence-owner',actor='continuity-evidence-role',sessionId='continuity-evidence-session';
const checks:Check[]=[],rows:any[]=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
let modelStubCalls=0,networkAttempts=0;
window.fetch=async()=>{networkAttempts++;throw Error('No external calls in continuity evidence fixture');};
const dimensions={valence:6,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5};
const baseOutput={dimensions,dominantEmotion:'平静',summary:'合成安排已整理。',memories:[]};
const request:CharacterMemoryRequest={userId:owner,characterId:actor,mode:'private-chat',sources:['chat'],topic:'海盐灯塔',excludeSessionId:'continuity-current-other-session',budget:4000};
const evidence=(source:Message):Evidence=>({kind:'private-chat',domain:'unclassified',sources:[{sessionId:source.sessionId,messageId:source.id,revision:source.revision??1,start:0,end:Math.min(source.content.length,1200)}]});
const json=(value:unknown)=>JSON.stringify(value);
const proof=(thread:ContinuityThread|undefined):Evidence|undefined=>(thread as any)?.sourceEvidence;

async function seed(long=false){
  await db.delete();await db.open();
  useAuthStore.getState().login(owner,'合成资料验收','isolated-no-paid-token','');
  useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
  const character:Character={id:actor,name:'合成连续性角色',avatar:'🌙',systemPrompt:'仅用于隔离本地验收。',tags:[],isPreset:false,isCustom:true,published:false,createdBy:owner,createdAt:1000,proactivity:0,signature:'',greeting:'你好'};
  await db.characters.add(character);
  await db.sessions.add({id:sessionId,userId:owner,characterId:actor,type:'private',title:character.name,createdAt:1000,updatedAt:1000});
  const contents=['周六14点去海盐灯塔。'+(long?'合成背景'.repeat(400):''),'知道了。','请带上地铁卡。','好。','可以按这个安排。'];
  const messages=contents.map((content,i):Message=>({id:'continuity-evidence-'+i,sessionId,role:i%2?'assistant':'user',content,revision:i===0?3:1,createdAt:1001+i,isProactive:false}));
  await db.messages.bulkAdd(messages);
  useChatStore.setState({characters:[character],currentSessionId:sessionId,selectedCharacterId:actor,messages});
  useEmotionStore.getState().clearCurrent();useEmotionStore.getState().clearSettleNotice();
  return messages;
}
function modelThread(evidenceIndexes:number[]=[0]){
  return {action:'create',kind:'plan',title:'海盐灯塔约定',detail:'周六14点去海盐灯塔。',evidence:evidenceIndexes,
    // Deliberately untrusted extra fields must not replace the actual capture.
    sourceEvidence:{kind:'private-chat',domain:'user-reality',sources:[{sessionId:'forged-session',messageId:'forged-message',revision:999,start:500,end:9000}]}};
}
async function settleOutput(output:any){
  const inputs:any[]=[];
  ipc.context.settle=async(input:any)=>{modelStubCalls++;inputs.push(structuredClone(input));return output;};
  await useEmotionStore.getState().settle(actor,sessionId,'合成连续性角色');
  return {inputs,threads:await db.continuityThreads.toArray(),session:await db.sessions.get(sessionId),snapshots:await db.emotionSnapshots.toArray()};
}
const newInput=(title:string,source:Message,overrides:Record<string,unknown>={})=>({characterId:actor,userId:owner,kind:'plan' as const,title,detail:'合成前提'+source.id,sourceMessageIds:[source.id],origin:'ai' as const,sourceEvidence:evidence(source),...overrides});

(window as any).runContinuityEvidenceWrite=async()=>{
  checks.length=0;rows.length=0;modelStubCalls=0;networkAttempts=0;
  const longMessages=await seed(true);
  const normal=await settleOutput({...baseOutput,threads:[modelThread([0,1,0,-1,99])]});
  const created=normal.threads[0],createdProof=proof(created);
  check('actual-settlement-creates-one-thread',normal.threads.length===1&&normal.snapshots.length===1,normal);
  check('runtime-feature-settlement-persists-source-evidence',!!createdProof,created);
  check('actual-capture-user-only-source-id-not-model-forgery',createdProof?.sources.length===1&&createdProof.sources[0].messageId===longMessages[0].id&&createdProof.sources[0].sessionId===sessionId,createdProof);
  check('actual-capture-revision-comes-from-source',createdProof?.sources[0]?.revision===3,createdProof);
  check('long-source-evidence-proves-only-shown-prefix',normal.inputs.length===1&&normal.inputs[0].history[0].content.length===1200&&createdProof?.sources[0]?.start===0&&createdProof.sources[0].end===1200&&longMessages[0].content.length>1200,{inputLength:normal.inputs[0]?.history[0]?.content.length,sourceLength:longMessages[0].content.length,createdProof});
  check('private-chat-domain-remains-unclassified',createdProof?.kind==='private-chat'&&createdProof.domain==='unclassified',createdProof);
  check('settlement-keeps-user-message-ids-only',json(created?.sourceMessageIds)===json([longMessages[0].id]),created?.sourceMessageIds);
  rows.push({scenario:'actual-settlement-long-prefix',inputs:normal.inputs,threads:normal.threads});

  await seed();
  const onlyAssistant=await settleOutput({...baseOutput,threads:[modelThread([1])]});
  check('assistant-only-model-evidence-creates-no-thread',onlyAssistant.threads.length===0&&onlyAssistant.snapshots.length===1,onlyAssistant);

  const lateMessages=await seed();
  let release!:(output:any)=>void,entered!:()=>void;
  const pendingResult=new Promise<any>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  ipc.context.settle=async()=>{modelStubCalls++;entered();return pendingResult;};
  const pending=useEmotionStore.getState().settle(actor,sessionId,'合成连续性角色');
  await started;
  await messageRepo.update(lateMessages[0].id,{content:'改成周日去别处。'});
  release({...baseOutput,threads:[modelThread()]});await pending;
  check('late-settlement-rejects-edited-source-with-zero-derivatives',await db.continuityThreads.count()===0&&await db.emotionSnapshots.count()===0&&await db.memories.count()===0,{threads:await db.continuityThreads.toArray(),snapshots:await db.emotionSnapshots.toArray()});
  check('late-edit-really-advanced-source-revision',(await db.messages.get(lateMessages[0].id))?.revision===4);

  const sources=await seed();
  await continuityRepo.createMany([newInput('海盐灯塔约定',sources[0]) as any]);
  const selectedMerge=(await db.continuityThreads.toArray())[0];
  await continuityRepo.createMany([newInput('海盐灯塔约定',sources[2],{targetId:selectedMerge.id,expectedThread:selectedMerge}) as any]);
  let merged=(await db.continuityThreads.toArray())[0];
  check('duplicate-merge-keeps-one-record',await db.continuityThreads.count()===1);
  check('duplicate-merge-preserves-all-premise-references',proof(merged)?.sources.length===2&&proof(merged)!.sources.some(ref=>ref.messageId===sources[0].id)&&proof(merged)!.sources.some(ref=>ref.messageId===sources[2].id),merged);
  check('duplicate-merge-preserves-both-legacy-source-ids',merged.sourceMessageIds?.includes(sources[0].id)&&merged.sourceMessageIds.includes(sources[2].id));
  rows.push({scenario:'duplicate-merge',merged});

  // Equal titles cannot move details between independently sourced events.
  for(const scenario of ['different-scenes','different-world-events','private-vs-world'] as const){
    const source=await seed();
    const worldInput=(detail:string,scope:Record<string,string>)=>({characterId:actor,userId:owner,kind:'plan' as const,title:'海盐灯塔约定',detail,origin:'ai' as const,sourceMessageIds:[],...scope});
    const first=scenario==='private-vs-world'?newInput('海盐灯塔约定',source[0],{detail:'私聊原安排'}):worldInput('第一场景原安排',scenario==='different-scenes'?{sourceSceneId:'scene-first'}:{sourceWorldEventId:'world-event-first'});
    const second=worldInput('另一来源新安排',scenario==='different-world-events'?{sourceWorldEventId:'world-event-second'}:{sourceSceneId:'scene-second'});
    await continuityRepo.createMany([first as any,second]);
    const distinct=await db.continuityThreads.toArray();
    check(scenario+'-same-title-retains-two-independent-records',distinct.length===2,distinct);
    check(scenario+'-does-not-attach-new-details-to-old-provenance',distinct.some(row=>row.detail===first.detail)&&distinct.some(row=>row.detail===second.detail),distinct);
    rows.push({scenario,threads:distinct});
  }

  const completionSources=await seed();
  const initialSettle=await settleOutput({...baseOutput,threads:[modelThread([0])]});
  const completing:Message={id:'continuity-explicit-completion',sessionId,role:'user',content:'海盐灯塔约定已经完成了。',revision:1,createdAt:2000,isProactive:false};
  await db.messages.add(completing);useChatStore.getState().addMessage(completing);
  const completedSettle=await settleOutput({...baseOutput,threads:[{...modelThread([5]),action:'complete'}]});
  const done=completedSettle.threads.find(row=>row.id===initialSettle.threads[0]?.id),doneProof=proof(done);
  check('actual-second-settlement-marks-existing-thread-done',initialSettle.threads.length===1&&completedSettle.threads.length===1&&done?.status==='done',completedSettle);
  check('completion-new-model-input-contains-explicit-user-evidence',completedSettle.inputs.length===1&&completedSettle.inputs[0].history[5]?.role==='user'&&completedSettle.inputs[0].history[5]?.content===completing.content,completedSettle.inputs);
  check('completion-preserves-old-and-new-source-message-ids',done?.sourceMessageIds?.includes(completionSources[0].id)&&done.sourceMessageIds.includes(completing.id),done);
  check('completion-preserves-old-and-new-source-evidence',doneProof?.sources.length===2&&doneProof.sources.some(ref=>ref.messageId===completionSources[0].id&&ref.revision===3)&&doneProof.sources.some(ref=>ref.messageId===completing.id&&ref.revision===1&&ref.end===completing.content.length),doneProof);
  const doneEvents=(await db.worldEvents.toArray()).filter(event=>event.sourceType==='continuity'&&event.sourceId===done?.id);
  check('completed-event-is-real-durable-world-record',doneEvents.length===1&&doneEvents[0].resolved===true,doneEvents);
  const worldRequest:CharacterMemoryRequest={...request,sources:['world'],topic:'还记得海盐灯塔约定已经完成了吗？',budget:6000};
  const worldContext=await buildCharacterMemoryContext(worldRequest),worldReference=worldContext.references.find(ref=>ref.id===doneEvents[0]?.id);
  check('completed-thread-actually-recalled-through-world-entrance',!!worldReference,worldContext);
  check('completed-recall-exposes-completed-status-to-model',!!worldReference&&/已完成|已经完成/u.test(worldReference.text)&&!worldReference.text.includes('尚未完成'),worldReference);
  const finalWorld=await revalidateCharacterMemoryContext(worldRequest,{...worldContext,references:worldReference?[worldReference]:[]});
  check('completed-world-reference-survives-fresh-final-validation',!!worldReference&&finalWorld.references.some(ref=>ref.id===worldReference.id),finalWorld);
  rows.push({scenario:'actual-two-settlement-completion',initialSettle,completedSettle,doneEvents,worldReference,finalWorld:finalWorld.references});

  for(const scenario of ['overflow','conflicting-revision','unproven-merge'] as const){
    const initial=await seed();
    const extra=Array.from({length:6},(_,i):Message=>({id:'continuity-extra-'+i,sessionId,role:'user',content:'合成补充前提'+i,revision:1,createdAt:1100+i,isProactive:false}));
    await db.messages.bulkAdd(extra);
    const prior=[initial[0],...extra.slice(0,5)];
    const full:Evidence={kind:'private-chat',domain:'unclassified',sources:prior.map(row=>evidence(row).sources[0])};
    const first=newInput('海盐灯塔约定',initial[0],scenario==='overflow'?{sourceEvidence:full,sourceMessageIds:prior.map(row=>row.id)}:{});
    await continuityRepo.createMany([first as any]);
    const initialProof=proof((await db.continuityThreads.toArray())[0]);
    check(scenario+'-starts-with-nonempty-complete-evidence',initialProof?.sources.length===(scenario==='overflow'?6:1),initialProof);
    const incoming=scenario==='overflow'?newInput('海盐灯塔约定',extra[5]):scenario==='conflicting-revision'?newInput('海盐灯塔约定',{...initial[0],revision:4}):newInput('海盐灯塔约定',initial[2],{sourceEvidence:undefined});
    const selected=(await db.continuityThreads.toArray())[0];
    await continuityRepo.createMany([{...incoming,targetId:selected.id,expectedThread:selected} as any]);
    const result=(await db.continuityThreads.toArray())[0];
    check(scenario+'-preserves-record-without-pretending-partial-evidence',await db.continuityThreads.count()===1&&proof(result)===undefined,result);
    rows.push({scenario,result});
  }

  const manualSources=await seed();
  await continuityRepo.create({characterId:actor,userId:owner,kind:'plan',title:'海盐灯塔约定',detail:'用户手工安排，下午到。',dueAt:1800000000000,origin:'user'});
  const manual=(await db.continuityThreads.toArray())[0];
  await continuityRepo.createMany([newInput('海盐灯塔约定',manualSources[0],{detail:'模型改成早上到。',dueAt:1800000000000}) as any]);
  check('ai-duplicate-cannot-silently-rewrite-user-maintained-record',json(await db.continuityThreads.get(manual.id))===json(manual),{before:manual,after:await db.continuityThreads.get(manual.id)});
  const completionCases=[
    ['thanks','谢谢。',false],
    ['unrelated','海盐灯塔约定挺好的。',false],
    ['quoted','他说：“把海盐灯塔约定标记为已完成。”',false],
    ['hypothetical','如果把海盐灯塔约定标记为已完成，会怎样？',false],
    ['negative','不要把海盐灯塔约定标记为已完成。',false],
    ['question','海盐灯塔约定已经完成了吗？',false],
    ['statement','海盐灯塔约定已经完成了。',false],
    ['explicit-control','请把海盐灯塔约定标记为已完成。',true],
    ['quoted-title-control','帮我把“海盐灯塔约定”标记为已完成。',true],
  ] as const;
  for(const [name,content,allowed] of completionCases){
    await continuityRepo.reopen(manual.id);
    const before=await db.continuityThreads.get(manual.id);
    const command:Message={id:'manual-command-'+name,sessionId,role:'user',content,revision:1,createdAt:3000,isProactive:false};
    await db.messages.add(command);
    const changed=await continuityRepo.completeByTitle(actor,owner,manual.title,[command.id],manual.kind,evidence(command));
    const after=await db.continuityThreads.get(manual.id);
    check('manual-completion-'+name,allowed?changed&&after?.status==='done':!changed&&json(after)===json(before),{before,after,changed});
  }
  await continuityRepo.reopen(manual.id);
  const stale:Message={id:'manual-command-stale',sessionId,role:'user',content:'把海盐灯塔约定标记为已完成。',revision:1,createdAt:4000,isProactive:false};
  await db.messages.add(stale);await messageRepo.update(stale.id,{content:'先不要修改。'});
  check('manual-completion-rejects-stale-revision',!await continuityRepo.completeByTitle(actor,owner,manual.title,[stale.id],manual.kind,evidence(stale))&&(await db.continuityThreads.get(manual.id))?.status==='open');
  await continuityRepo.complete(manual.id);
  check('manual-direct-ui-completion-still-works',(await db.continuityThreads.get(manual.id))?.status==='done');
  for(const [name,content,allowed] of [['unrelated','谢谢。',false],['explicit','把海盐灯塔约定标记为已完成。',true]] as const){
    await seed();
    await continuityRepo.create({characterId:actor,userId:owner,kind:'plan',title:'海盐灯塔约定',origin:'user'});
    const command:Message={id:'manual-settle-'+name,sessionId,role:'user',content,revision:1,createdAt:5000,isProactive:false};
    await db.messages.add(command);useChatStore.getState().addMessage(command);
    const settled=await settleOutput({...baseOutput,threads:[{...modelThread([5]),action:'complete'}]});
    check('actual-manual-settlement-'+name,settled.threads.length===1&&settled.threads[0].status===(allowed?'done':'open'),settled);
  }
  await seed();
  await continuityRepo.create({characterId:actor,userId:owner,kind:'plan',title:'海盐灯塔约定',origin:'user'});
  await continuityRepo.createMany([{characterId:actor,userId:owner,kind:'plan',title:'海盐灯塔约定',origin:'user',sourceSceneId:'another-scene'}]);
  const ambiguous:Message={id:'manual-ambiguous',sessionId,role:'user',content:'把海盐灯塔约定标记为已完成。',revision:1,createdAt:6000,isProactive:false};
  await db.messages.add(ambiguous);
  check('automatic-title-completion-does-not-guess-between-distinct-records',!await continuityRepo.completeByTitle(actor,owner,'海盐灯塔约定',[ambiguous.id],'plan',evidence(ambiguous))&&(await db.continuityThreads.toArray()).every(row=>row.status==='open'));
  await db.continuityThreads.clear();
  await continuityRepo.createMany([newInput('海盐灯塔约定',manualSources[0]) as any]);
  const beforeEdit=(await db.continuityThreads.toArray())[0];
  check('manual-edit-fixture-starts-with-machine-evidence',proof(beforeEdit)?.sources.length===1&&beforeEdit.origin==='ai',beforeEdit);
  await continuityRepo.update(beforeEdit.id,{detail:'由用户维护的新安排。'});
  const afterEdit=await db.continuityThreads.get(beforeEdit.id);
  check('manual-content-edit-transfers-maintenance-to-user',afterEdit?.origin==='user'&&proof(afterEdit)===undefined&&afterEdit.detail==='由用户维护的新安排。',afterEdit);
  await continuityRepo.createMany([newInput('海盐灯塔约定',manualSources[2],{detail:'旧模型再次覆盖。'}) as any]);
  check('subsequent-ai-duplicate-cannot-overwrite-manual-edit',json(await db.continuityThreads.get(beforeEdit.id))===json(afterEdit));

  for(const change of ['edit','delete'] as const){
    const source=await seed();
    await continuityRepo.createMany([newInput('海盐灯塔约定',source[0],{detail:'周六14点去海盐灯塔。'}) as any]);
    const original=(await db.continuityThreads.toArray())[0];
    const serialized=json(await collectSyncData(owner,'合成资料验收'));
    const wire=JSON.parse(serialized);
    check(change+'-real-sync-collect-serializes-complete-evidence',!!proof(original)&&json(wire.continuityThreads?.[0]?.sourceEvidence)===json(proof(original)),wire.continuityThreads);
    await db.delete();await db.open();
    const restored=await importSyncData(wire);
    const imported=await db.continuityThreads.get(original.id);
    check(change+'-real-sync-import-preserves-optional-field',restored.ok&&!!proof(original)&&json(proof(imported))===json(proof(original)),{restored,imported});
    const context=await buildCharacterMemoryContext(request),selected=context.references.find(row=>row.id===original.id);
    check(change+'-imported-live-thread-selected-before-mutation',!!selected,context.references);
    if(change==='edit')await messageRepo.update(source[0].id,{content:'取消旧约定，改去别处。'});
    else await messageRepo.deleteById(source[0].id);
    const validated=await revalidateCharacterMemoryContext(request,{...context,references:selected?[selected]:[]});
    const fresh=await buildCharacterMemoryContext(request);
    check(change+'-imported-source-change-removes-selected-thread',!validated.references.some(row=>row.id===original.id),validated);
    check(change+'-imported-source-change-removes-fresh-thread',!fresh.references.some(row=>row.id===original.id),fresh);
    check(change+'-source-invalidation-retains-raw-thread',!!await db.continuityThreads.get(original.id));
    rows.push({scenario:'sync-'+change,original,imported,sourceAfter:await db.messages.get(source[0].id),validated:validated.references,fresh:fresh.references});
  }
  check('only-seven-local-settlement-stubs-used',modelStubCalls===7,modelStubCalls);
  check('zero-network-or-paid-api-calls',networkAttempts===0,networkAttempts);
  const result={complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),rows,modelStubCalls,networkAttempts,apiCalls:0,model:'未确认',reasoning:'未确认',scope:'Native isolated Chromium IndexedDB; actual useEmotionStore.settle / ipc.context.settle locally stubbed; real continuityRepo createMany/update; real sync collection+JSON+import; real memory selection/revalidation. No real model/secret/account/audio/Android.'};
  await db.delete();return result;
};
