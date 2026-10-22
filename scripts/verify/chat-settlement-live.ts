import './chat-human-live';
import {db,type Message} from '../../src/db';
import {webApi} from '../../src/lib/web-api';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {useEmotionStore} from '../../src/store/emotion-store';
import {useCharacterStateStore} from '../../src/store/character-state-store';
import {messageRepo} from '../../src/db/message-repo';
import {memoryRepo} from '../../src/db/memory-repo';
import {captureChatAuxiliary,commitChatAuxiliary,validateChatAuxiliary} from '../../src/db/chat-auxiliary-guard';
import {continuityRepo} from '../../src/db/continuity-repo';
import {collectSyncData,importSyncData} from '../../src/lib/sync';
const api=window as any,sessionId='isolated-live-session',owner='isolated-live-expression-owner',characterId='isolated-live-role';
const output={dimensions:{valence:6,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5},dominantEmotion:'平静',summary:'在认真整理安排。',memories:[{content:'用户喜欢薄荷味。',evidence:[2]}],threads:[{action:'create' as const,kind:'plan' as const,title:'周五面试',detail:'周五15点',evidence:[0]}]};
api.runSettlementLive=async()=>{
 const checks:string[]=[],rows:any[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);api.settlementProgress=label;};
 const setup=async()=>{
  await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟。',greeting:'你好。',signature:''},.5);
  const contents=['周五15点面试。','知道了。','我喜欢薄荷味。','嗯。','今天想聊点轻松的。'];
  const messages=contents.map((content,i)=>({id:'settlement-'+i,sessionId,role:i%2?'assistant':'user',content,revision:1,createdAt:1000+i,isProactive:false})) as Message[];
  await db.messages.bulkAdd(messages);useChatStore.setState({messages});
  useEmotionStore.getState().clearCurrent();useEmotionStore.getState().clearSettleNotice();
  useCharacterStateStore.setState({characterId,affinity:0,mood:70,milestones:[],affinityByCharacter:{},milestone:null});
 };
 for(const scenario of ['valid','correction','new-message','edit-source','delete-source','revoke-source','change-account','transfer-session','change-character','switch-to-group','newer-checkpoint','account-during-write','restore','memory-write-failure']){
  await setup();let release!:(value:any)=>void,started!:()=>void,calls=0;
  const gate=new Promise<any>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  webApi.context.settle=async()=>{calls++;started();return gate;};
  const pending=useEmotionStore.getState().settle(characterId,sessionId,'林舟');await entered;
  if(scenario==='correction')await db.sessions.update(sessionId,{conversation:{version:1}} as any);
  if(scenario==='new-message')await db.messages.add({id:'new-direct-input',sessionId,role:'user',content:'刚才那件事取消，先别分析了。',revision:1,createdAt:9000,isProactive:false});
  if(scenario==='edit-source')await messageRepo.update('settlement-0',{content:'不是周五，已经改到周四。'});
  if(scenario==='delete-source')await messageRepo.deleteById('settlement-0');
  if(scenario==='revoke-source')await db.memorySourceTombstones.add({id:'revoked-source',userId:owner,characterId,sourceType:'message',sourceId:'settlement-0',sourceRevision:1,status:'deleted',updatedAt:2,suppressedMessageIds:['settlement-0']} as any);
  if(scenario==='change-account')useAuthStore.setState({userId:'other-owner'});
  if(scenario==='transfer-session')await db.sessions.update(sessionId,{userId:'other-owner'});
  if(scenario==='change-character')await db.sessions.update(sessionId,{characterId:'other-actor'});
  if(scenario==='switch-to-group')await db.sessions.update(sessionId,{type:'group',groupId:'group'});
  if(scenario==='newer-checkpoint')await db.sessions.update(sessionId,{lastSettledUserMessageCount:3,auxiliaryRevision:1} as any);
  if(scenario==='restore')check((await importSyncData(JSON.parse(JSON.stringify(await collectSyncData(owner,'隔离测试'))))).ok,'real same-record restore succeeds while a settlement is waiting');
  const accountFlip=()=>{useAuthStore.setState({userId:'other-owner'});};
  const saveMemory=memoryRepo.createMany;
  if(scenario==='memory-write-failure')memoryRepo.createMany=async()=>{throw Error('Synthetic local write failure');};
  if(scenario==='account-during-write')db.emotionSnapshots.hook('creating',accountFlip);
  release(output);
  try{await pending;}finally{if(scenario==='account-during-write')db.emotionSnapshots.hook('creating').unsubscribe(accountFlip);memoryRepo.createMany=saveMemory;}
  const [snapshots,memories,threads,states,events,claims,session]=await Promise.all([db.emotionSnapshots.toArray(),db.memories.toArray(),db.continuityThreads.toArray(),db.characterStates.toArray(),db.worldEvents.toArray(),db.memoryClaims.toArray(),db.sessions.get(sessionId)]);
  check(calls===1,'actual settlement uses one generation with no replacement on '+scenario);
  if(scenario==='valid'){
   check(snapshots.length===1&&memories.length===1&&threads.length===1&&states.length===1&&events.length>=1,'valid actual settlement retains all existing local outputs and world derivation');
   check(session?.lastSettledUserMessageCount===3,'successful actual settlement advances user checkpoint');
   await useEmotionStore.getState().settle(characterId,sessionId,'林舟');
   check(calls===1&&(await db.emotionSnapshots.count())===1,'same successful source batch cannot add affinity/snapshot twice or spend another generation');
  }else{
   check(snapshots.length===0&&memories.length===0&&threads.length===0&&states.length===0&&events.length===0&&claims.length===0,'stale actual settlement creates no derived state on '+scenario);
   check(!useEmotionStore.getState().settleNotice&&Object.keys(useCharacterStateStore.getState().affinityByCharacter).length===0,'rejected settlement publishes no success or relationship UI on '+scenario);
  }
  rows.push({scenario,calls,snapshots,memories,threads,states,events,claims,session});
 }
 for(const scenario of ['analysis-valid','analysis-account','analysis-edit']){
  await setup();let release!:(value:any)=>void,started!:()=>void,calls=0;
  const gate=new Promise<any>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  webApi.emotion.analyze=async()=>{calls++;started();return gate;};
  const pending=useEmotionStore.getState().analyzeCurrentSession(characterId,sessionId,'林舟');await entered;
  if(scenario==='analysis-account')useAuthStore.setState({userId:'other-owner'});
  if(scenario==='analysis-edit')await messageRepo.update('settlement-0',{content:'原话已经更正。'});
  release({dimensions:output.dimensions,summary:output.summary,dominantEmotion:'平静'});await pending;
  check(calls===1&&(await db.emotionSnapshots.count())===(scenario==='analysis-valid'?1:0),'manual analysis respects account and source snapshot on '+scenario);
  check(!useEmotionStore.getState().isAnalyzing,'manual analysis does not leave a stale spinner on '+scenario);
 }
 await setup();
 const source=await captureChatAuxiliary(owner,characterId,sessionId,'settlement',()=>true);
 check(!!source,'concurrent fixture captures actual selected sources');
 const concurrent=await Promise.all([0,1].map(i=>commitChatAuxiliary(source!,()=>true,async()=>db.emotionSnapshots.add({id:'competing-'+i,characterId,sessionId,dimensions:output.dimensions,dominantEmotion:'平静',summary:'并发派生',messageCount:5,createdAt:2000+i}))));
 check(concurrent.filter(Boolean).length===1&&(await db.emotionSnapshots.count())===1,'two independent native commits with the same source/version have one winner');
 await setup();let releaseAnalysis!:(value:any)=>void,analysisEntered!:()=>void,analysisCalls=0;
 const analysisGate=new Promise<any>(resolve=>{releaseAnalysis=resolve;}),analysisStarted=new Promise<void>(resolve=>{analysisEntered=resolve;});
 webApi.emotion.analyze=async()=>{analysisCalls++;analysisEntered();return analysisGate;};
 const firstAnalysis=useEmotionStore.getState().analyzeCurrentSession(characterId,sessionId,'林舟');await analysisStarted;
 await useEmotionStore.getState().analyzeCurrentSession(characterId,sessionId,'林舟');
 releaseAnalysis({dimensions:output.dimensions,dominantEmotion:'平静',summary:'重复点击仍显示原任务'});await firstAnalysis;
 check(analysisCalls===1&&useEmotionStore.getState().currentSnapshot?.summary==='重复点击仍显示原任务','duplicate manual click neither spends a second generation nor hides the first valid result');
 await setup();await continuityRepo.create({userId:owner,characterId,kind:'plan',title:'周五面试',sourceMessageIds:['settlement-0']});
 const thread=(await db.continuityThreads.toArray())[0];let releaseThread!:(value:any)=>void,threadEntered!:()=>void;
 const threadGate=new Promise<any>(resolve=>{releaseThread=resolve;}),threadStarted=new Promise<void>(resolve=>{threadEntered=resolve;});
 webApi.context.settle=async()=>{threadEntered();return threadGate;};
 const oldThreadTask=useEmotionStore.getState().settle(characterId,sessionId,'林舟');await threadStarted;
 await continuityRepo.drop(thread.id);releaseThread(output);await oldThreadTask;
 check((await db.continuityThreads.toArray()).every(t=>t.status!=='open')&&(await db.continuityThreads.get(thread.id))?.status==='dropped','old settlement cannot recreate a thread manually set aside while it was waiting');
 check((await db.emotionSnapshots.count())===0&&!useEmotionStore.getState().settleNotice,'manual continuity change rejects the whole stale settlement');
 await db.characterStates.update([characterId,owner],{affinity:47,mood:61,lifeFocus:'用户手动关注点'});
 const operations=[()=>continuityRepo.reopen(thread.id),()=>continuityRepo.update(thread.id,{detail:'用户修改过时间'}),()=>continuityRepo.complete(thread.id),()=>continuityRepo.remove(thread.id),()=>continuityRepo.create({userId:owner,characterId,kind:'plan',title:'另一项安排'}),()=>continuityRepo.deleteByCharacter(characterId,owner),()=>continuityRepo.create({userId:owner,characterId,kind:'topic',title:'再聊一件事'}),()=>continuityRepo.clearForUser(owner)];
 for(let i=0;i<operations.length;i++){
  const previous=(await db.characterStates.get([characterId,owner]))?.continuityRevision??0;await operations[i]();
  check((await db.characterStates.get([characterId,owner]))?.continuityRevision===previous+1,'continuity mutation atomically advances its owner-scoped fence '+i);
 }
 const preserved=await db.characterStates.get([characterId,owner]);
 check(preserved?.affinity===47&&preserved.mood===61&&preserved.lifeFocus==='用户手动关注点','continuity bookkeeping preserves user relationship and life-focus values');
 await setup();const isolated=await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>true);
 await db.characters.add({...await db.characters.get(characterId),id:'same-name-other-role',createdBy:owner} as any);
 await continuityRepo.create({userId:owner,characterId:'same-name-other-role',kind:'topic',title:'同名角色的独立事项'});
 check(!!await commitChatAuxiliary(isolated!,()=>true,async()=>true),'same-name other character continuity does not invalidate this private source scope');
 await setup();await db.messages.update('settlement-2',{failed:true});await db.messages.update('settlement-1',{failed:true});
 const failedUser=await captureChatAuxiliary(owner,characterId,sessionId,'settlement',()=>true);
 check(failedUser?.messages.some(message=>message.id==='settlement-2')&&!failedUser.messages.some(message=>message.id==='settlement-1'),'provider-failed user utterance remains evidence while failed assistant text stays excluded');
 check(!!failedUser&&await validateChatAuxiliary(failedUser,()=>true),'fresh source validation does not retract a user fact because delivery failed');
 await setup();
 await db.messages.bulkAdd(Array.from({length:507},(_,i)=>({id:'stock-'+i,sessionId,role:i%2?'assistant':'user',content:'合成存量消息'+i,revision:1,createdAt:2000+i,isProactive:false})) as Message[]);
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'irrelevant-'+i,userId:owner,characterId,sourceType:'message',sourceId:'absent-'+i,sourceRevision:1,status:'deleted',updatedAt:1,suppressedMessageIds:['absent-'+i]})) as any);
 api.settlementProgress='stock fixture inserted; capturing';
 let stock=await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>true);
 check(!!await commitChatAuxiliary(stock!,()=>true,async()=>true),'uninstrumented 48-source stock commit succeeds');
 stock=await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>true);
 api.settlementProgress='stock capture complete; starting instrumented guards';
 const reads:Record<string,{calls:number;returned:number;countedKeys?:number}>= {},restore:Array<()=>void>=[];
 for(const table of [db.messages,db.memorySourceTombstones,db.continuityThreads])for(const method of ['query','get','getMany','openCursor','count']){
  const core=table.core as any,original=core[method];
  // Preserve the backend's promise/transaction scope; an async wrapper here
  // changes scheduling and can manufacture a PrematureCommitError.
  core[method]=function(...args:any[]){return original.apply(this,args).then((result:any)=>{const metric=reads[table.name+'.'+method]??={calls:0,returned:0};metric.calls++;
   if(method==='openCursor'){if(result)throw Error('Stock guard unexpectedly visited a cursor record');return result;}
   if(method==='count'){metric.countedKeys=(metric.countedKeys??0)+result;return result;}
   metric.returned+=method==='query'?result.result.length:method==='get'?Number(result!==undefined):result.filter(Boolean).length;return result;});};
  restore.push(()=>{core[method]=original;});
 }
 try{const validated=await validateChatAuxiliary(stock!,()=>true);api.settlementProgress='stock readonly validation complete; starting commit';check(validated&&!!await commitChatAuxiliary(stock!,()=>true,async()=>true),'stock preflight and commit both revalidate actual selected evidence');}finally{restore.forEach(fn=>fn());}
 check(stock?.messages.length===48&&reads['messages.getMany']?.returned===96&&reads['messages.count']?.calls===2&&!reads['messages.query']&&!Object.keys(reads).some(key=>key.startsWith('continuityThreads.'))&&!Object.entries(reads).some(([key,value])=>key.startsWith('memorySourceTombstones.')&&value.returned>0),'512-message/8105-suppression guard reads only two selected batches, indexed counts and no continuity history');
 rows.push({scenario:'stock-guard-only',fixture:{messages:512,suppressions:8105},reads});
 return {complete:true,checks,rows,paidCalls:0,scope:'Actual emotion-store settlement and native isolated DB, manually released model substitute; no live API or UI naturalness claim'};
};
