import {db,type Session} from '../../src/db';
import {sessionRepo} from '../../src/db/session-repo';
import {updateChatConversationState,type ChatConversationState} from '../../src/lib/chat-conversation-state';
const api=globalThis as any;
api.runTopicStateRaces=async()=>{
 await db.delete();await db.open();
 const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 await db.sessions.add({id:'s',userId:'owner',characterId:'actor',type:'private',createdAt:1,updatedAt:1} as Session);
 const source={id:'u1',sessionId:'s',role:'user' as const,content:'周五15点面试。',revision:1,createdAt:1,isProactive:false};
 await db.messages.add(source);
 const principal={sessionId:'s',userId:'owner',characterId:'actor'};
 const stateA=updateChatConversationState(undefined,source.content,'',undefined,1,'',{message:source,domain:'user-reality'});
 const u2={...source,id:'u2',content:'更正，是周四15点。',createdAt:2};await db.messages.add(u2);
 const stateB=updateChatConversationState(stateA,u2.content,'',undefined,2,'',{message:u2,domain:'user-reality'});
 const guarded=(sessionRepo as any).updateConversationIfCurrent;
 // RED reproduces the currently used unguarded session update if the new CAS
 // interface is absent, rather than passing a mock that always rejects.
 if(!guarded){await sessionRepo.update('s',{conversation:stateB});await sessionRepo.update('s',{conversation:stateA});check((await db.sessions.get('s'))?.conversation?.topics?.[0].slots.date.value==='周四','late derived snapshot must not overwrite the newer actual stored date');}
 check(typeof guarded==='function','conversation has a versioned source-checked storage interface');
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'unrelated-'+i,userId:'owner',characterId:'other-actor',sourceType:'message',sourceId:'absent-'+i,status:'deleted',sourceRevision:1,updatedAt:1,suppressedMessageIds:['unrelated-source-'+i]})) as any);
 let suppressionBodies=0,sourceBodies=0;
 const suppressionCore=db.memorySourceTombstones.core as any,sourceCore=db.messages.core as any;
 const oldQuery=suppressionCore.query,oldGetMany=sourceCore.getMany;
 try{
  // DBCore must retain Dexie's transaction-aware promise. Returning a native
  // async wrapper can itself end the transaction before the next keyed read.
  suppressionCore.query=function(...args:any[]){return oldQuery.apply(this,args).then((result:any)=>{suppressionBodies+=result.result.length;return result;});};
  sourceCore.getMany=function(...args:any[]){return oldGetMany.apply(this,args).then((result:any)=>{sourceBodies+=result.filter((row:any)=>row!==undefined).length;return result;});};
  check(await guarded(principal,0,stateB),'newer source-backed state commits');
 }finally{suppressionCore.query=oldQuery;sourceCore.getMany=oldGetMany;}
 check(suppressionBodies===0&&sourceBodies===2,'selected-source guard reads two sources and zero unrelated bodies from 8105 suppressions');
 check(!await guarded(principal,0,stateA),'stale version rejects late result');
 check((await db.sessions.get('s'))?.conversation?.topics?.[0].slots.date.value==='周四','rejected stale write leaves latest date intact');
 const latest=(await db.sessions.get('s'))!.conversation!;
 check(latest.version===1,'successful CAS increments version');
 check(!await guarded({...principal,userId:'other-account'},1,stateB),'wrong account cannot update the session');
 check(!await guarded({...principal,characterId:'other-actor'},1,stateB),'wrong character cannot update the session');
 check(!await guarded({...principal,isCurrent:()=>false},1,stateB),'changed active account rejects derived write');
 await db.messages.update('u2',{content:'更正，是周六15点。',revision:2});
 check(!await guarded(principal,1,stateB),'source revision edit rejects old derived state with even a current CAS version');
 await db.messages.put(u2);
 await db.memorySourceTombstones.put({id:'revoke',userId:'owner',characterId:'actor',sourceType:'message',sourceId:'u2',status:'deleted',sourceRevision:1,updatedAt:3,suppressedMessageIds:['u2']} as any);
 check(!await guarded(principal,1,stateB),'indexed suppression rejects revoked live body');
 await db.memorySourceTombstones.delete('revoke');
 await db.messages.delete('u2');
 check(!await guarded(principal,1,stateB),'deleted source cannot be revived by current-version write');
 await db.messages.put({...u2,failed:true});
 check(await guarded(principal,1,stateB),'user facts survive a provider failure without marking assistant completion');
 const failedState=(await db.sessions.get('s'))!.conversation!;
 await db.messages.update('u2',{role:'assistant'});
 check(!await guarded(principal,failedState.version!,stateB),'assistant text cannot become user-fact evidence');
 await db.messages.put(u2);
 const forged=structuredClone(stateB);forged.topics![0].slots.date.value='从未说过的日期';
 check(!await guarded(principal,failedState.version!,forged),'slot value without literal user evidence is rejected');
 const unrelated={...source,id:'foreign',sessionId:'other-session'};await db.messages.add(unrelated);
 const foreign=updateChatConversationState(undefined,unrelated.content,'',undefined,1,'',{message:unrelated,domain:'user-reality'});
 check(!await guarded(principal,failedState.version!,foreign),'cross-session references cannot enter topic state');
 const malformed={...stateB,topics:[{...stateB.topics![0],outcomeSource:undefined}]} as any;
 check(!await guarded(principal,failedState.version!,malformed),'malformed imported source metadata fails closed without throwing');
 const expected=failedState.version!;
 const writes=await Promise.all([guarded(principal,expected,stateB),guarded(principal,expected,stateB)]);
 check(writes.filter(Boolean).length===1,'native transactions allow only one of two same-version competing writers');
 const finalVersion=(await db.sessions.get('s'))!.conversation!.version!;
 let accountCurrent=true;const originalUpdate=db.sessions.update;
 try{
   db.sessions.update=(async (...args:any[])=>{const result=await (originalUpdate as any).apply(db.sessions,args);accountCurrent=false;return result;}) as any;
   check(!await guarded({...principal,isCurrent:()=>accountCurrent},finalVersion,stateB),'account change after async write aborts the transaction');
 }finally{db.sessions.update=originalUpdate;}
 check((await db.sessions.get('s'))!.conversation!.version===finalVersion,'aborted account-change transaction does not commit a version');
 const badLabel=structuredClone(stateB) as any;badLabel.topics[0].label={not:'a string'};
 check(!await guarded(principal,finalVersion,badLabel),'malformed topic values cannot be imported as valid conversation state');
 const badClock=structuredClone(stateB);badClock.topics![0].slots.date.observedAt=NaN;
 check(!await guarded(principal,finalVersion,badClock),'invalid slot observation clock cannot reach date projection');
 badClock.topics![0].slots.date.observedAt=1e308;
 check(!await guarded(principal,finalVersion,badClock),'finite but unrepresentable date cannot reach projection');
 const badOffset=structuredClone(stateB);badOffset.topics![0].slots.date.utcOffsetMinutes=900;
 check(!await guarded(principal,finalVersion,badOffset),'out-of-range timezone cannot change relative-date interpretation');
 return {complete:true,checks,paidCalls:0,state:(await db.sessions.get('s'))!.conversation as ChatConversationState};
};
