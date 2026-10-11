import { db } from '../../src/db';
import { useChatStore } from '../../src/store/chat-store';
import { useAuthStore } from '../../src/store/auth-store';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { memoryLedgerRepo } from '../../src/db/memory-ledger-repo';
import { worldRepo } from '../../src/db/world-repo';
import { memorySourceTombstoneRepo, memorySourceTombstoneId } from '../../src/db/memory-source-tombstone-repo';
import { fakeCharacter } from './world-harness';

async function run(count = 10000) {
  await db.delete(); await db.open();
  useAuthStore.setState({ userId: 'delete-user', apiKey: '' });
  useChatStore.setState({ selectedCharacterId:null,currentSessionId:null,messages:[] });
  const now=Date.now();
  await db.characters.bulkAdd([fakeCharacter('delete-character','待删除角色','delete-user'),fakeCharacter('keep-character','保留角色','delete-user'),fakeCharacter('foreign-character','其他账户','foreign-user')]);
  await db.sessions.bulkAdd(['delete-session','keep-session','foreign-session'].map((id,index)=>({id,characterId:['delete-character','keep-character','foreign-character'][index],userId:index===2?'foreign-user':'delete-user',title:id,createdAt:now,updatedAt:now})));
  const content='用来检验长聊天删除时的数据库与界面响应。'.repeat(50);
  for(let start=0;start<count;start+=500)await db.messages.bulkAdd(Array.from({length:Math.min(500,count-start)},(_,i)=>({id:`delete-message-${start+i}`,sessionId:'delete-session',role:'user' as const,content,revision:start+i===0?7:1,createdAt:now+start+i,isProactive:false})));
  await db.messages.bulkAdd(['keep-session','foreign-session'].map(id=>({id:`${id}-message`,sessionId:id,role:'user' as const,content:'保留',createdAt:now,isProactive:false})));
  await db.memories.bulkAdd([
    {id:'deleted-memory',userId:'delete-user',characterId:'delete-character',content:'该角色的记忆',type:'auto',sourceMessageIds:['delete-message-0'],createdAt:now},
    {id:'dependent-other-memory',userId:'delete-user',characterId:'keep-character',content:'来源依赖待删除消息',type:'auto',sourceMessageIds:['delete-message-1'],createdAt:now},
    {id:'independent-other-memory',userId:'delete-user',characterId:'keep-character',content:'独立置顶事实仍保留',type:'auto',pinned:true,sourceMessageIds:['delete-message-2','keep-session-message'],sourceEvidenceMode:'independent',createdAt:now},
    {id:'foreign-memory',userId:'foreign-user',characterId:'foreign-character',content:'其他账户的事实',type:'auto',createdAt:now},
  ]);
  const summary='很多历史消息生成的聚合摘要';
  const sourceIds=Array.from({length:count},(_,i)=>`delete-message-${i}`);
  await db.memories.add({id:'large-summary',userId:'delete-user',characterId:'delete-character',content:summary,type:'summary',memoryKind:'summary',sourceSessionId:'delete-session',sourceMessageIds:sourceIds,createdAt:now});
  const summaryClaim=await memoryLedgerRepo.record({userId:'delete-user',memoryKind:'summary',value:summary,characterIds:['delete-character','keep-character'],source:{type:'chat',id:'delete-message-0'}});
  for(let start=1;start<count;start+=500)await db.memoryEvidence.bulkAdd(sourceIds.slice(start,start+500).map(sourceId=>({id:`summary-evidence:${sourceId}`,userId:'delete-user',claimId:summaryClaim,sourceType:'chat' as const,sourceId,sourceRevision:1,observedAt:now,confidence:1})));
  await memoryLedgerRepo.syncMemoryItem((await db.memories.get('independent-other-memory'))!);
  await memorySourceTombstoneRepo.record({userId:'delete-user',sourceType:'message',sourceId:'delete-message-0',sourceRevision:9,status:'withdrawn',characterId:'keep-character',suppressedMessageIds:['separate-source']});
  let requests=0,maxBulkRead=0,fullSessionRead=false;
  db.use({stack:'dbcore',name:'delete-performance-probe',create:(down:any)=>({...down,table:(name:string)=>{
    const table=down.table(name);return {...table,get:(req:any)=>{requests++;return table.get(req);},getMany:(req:any)=>{requests++;if(name==='messages')maxBulkRead=Math.max(maxBulkRead,req.keys.length);return table.getMany(req);},query:(req:any)=>{requests++;if(name==='messages'&&req.values&&req.limit===Infinity)fullSessionRead=true;return table.query(req);},mutate:(req:any)=>{requests++;return table.mutate(req);}};
  }})});
  // Install the probe before reopening so Dexie's middleware stack includes it.
  db.close(); await db.open();
  let ticks=0,maxFrameGap=0,lastFrame=performance.now(),watching=true;
  const frame=(time:number)=>{ticks++;maxFrameGap=Math.max(maxFrameGap,time-lastFrame);lastFrame=time;if(watching)requestAnimationFrame(frame);};
  requestAnimationFrame(frame);
  const started=performance.now();await useChatStore.getState().deleteCharacter('delete-character');
  const durationMs=Math.round(performance.now()-started);watching=false;
  const operations=requests;
  let checks=0;const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks++;};
  check(!(await db.characters.get('delete-character')),'character removed');
  check(!(await db.sessions.get('delete-session')),'session removed');
  check(await db.messages.where('sessionId').equals('delete-session').count()===0,'all history removed');
  check(await db.memorySourceTombstones.where('[userId+sourceType+sourceId]').equals(['delete-user','message','delete-message-9999']).count()===(count>=10000?1:0),'last deleted message has import protection');
  const tombstone=await db.memorySourceTombstones.get(memorySourceTombstoneId('delete-user','message','delete-message-0'));
  check(tombstone?.status==='deleted'&&tombstone.sourceRevision===9&&tombstone.characterId==='keep-character'&&tombstone.suppressedMessageIds?.includes('separate-source'),'tombstone merging preserves revision and suppression');
  check(!(await db.memories.get('deleted-memory')),'own memories deleted');
  check((await db.memories.get('dependent-other-memory'))?.status==='superseded','other role derived fact invalidated');
  check((await db.memories.get('independent-other-memory'))?.sourceMessageIds?.join() ==='keep-session-message','other role independently supported fact retained');
  check((await db.memoryClaims.get(summaryClaim))?.status==='superseded'&&!(await db.memoryEvidence.where('[userId+claimId]').equals(['delete-user',summaryClaim]).filter(row=>!row.withdrawnAt).count()),'large summary evidence revoked without per-source claim rescans');
  check((await db.memoryKnowledge.where('[userId+claimId]').equals(['delete-user',summaryClaim]).toArray()).every(row=>!row.canMention&&row.revokedAt),'summary cannot leak through surviving character knowledge');
  const liveClaim=await memoryLedgerRepo.findClaim('delete-user','fact','独立置顶事实仍保留');
  check(liveClaim?.status==='active'&&(await db.memoryEvidence.where('[userId+claimId]').equals(['delete-user',liveClaim!.id]).filter(row=>!row.withdrawnAt).toArray()).every(row=>row.sourceId==='keep-session-message'),'independent surviving evidence stays active');
  check(!!(await db.messages.get('keep-session-message'))&&!!(await db.sessions.get('keep-session')),'other role conversation intact');
  check(!!(await db.messages.get('foreign-session-message'))&&!!(await db.memories.get('foreign-memory')),'foreign account intact');
  check(ticks>0,'frames continue while deleting');
  await useChatStore.getState().deleteCharacter('foreign-character');
  check(!!(await db.characters.get('foreign-character')),'foreign role deletion rejected');
  db.unuse({name:'delete-performance-probe'});
  // A session removal still preserves source protections independently of role deletion.
  await sessionRepo.deleteById('keep-session');
  check(!(await db.messages.get('keep-session-message'))&&await memorySourceTombstoneRepo.blocksImport({userId:'delete-user',sourceType:'message',sourceId:'keep-session-message',sourceRevision:100}),'session deletion keeps permanent message tombstone');
  // Late failures and account changes must roll back the whole role operation.
  for(const switchAccount of [false,true]) {
    const char=fakeCharacter('rollback-character','回滚角色','delete-user');await db.characters.put(char);
    await db.sessions.put({id:'rollback-session',characterId:char.id,userId:'delete-user',title:'回滚',createdAt:now,updatedAt:now});
    await db.messages.put({id:'rollback-message',sessionId:'rollback-session',role:'user',content:'失败时仍应保留',createdAt:now,isProactive:false});
    const original=worldRepo.cleanupCharacter;
    worldRepo.cleanupCharacter=async(...args)=>{if(switchAccount){useAuthStore.setState({userId:'foreign-user'});return original.apply(worldRepo,args);}throw Error('injected cleanup failure');};
    let failed=false;try{await useChatStore.getState().deleteCharacter(char.id);}catch{failed=true;}finally{worldRepo.cleanupCharacter=original;useAuthStore.setState({userId:'delete-user'});}
    check(failed&&!!(await db.characters.get(char.id))&&!!(await db.messages.get('rollback-message'))&&!await db.memorySourceTombstones.get(memorySourceTombstoneId('delete-user','message','rollback-message')),switchAccount?'account switch aborts cleanup atomically':'cleanup failure restores conversation and tombstones atomically');
  }
  // Batch boundaries and duplicate source ids retain strongest suppression.
  await memorySourceTombstoneRepo.recordMany([
    ...Array.from({length:501},(_,i)=>({userId:'delete-user',sourceType:'message' as const,sourceId:`merge-${i}`,sourceRevision:2,status:'withdrawn' as const})),
    {userId:'delete-user',sourceType:'message',sourceId:'merge-0',sourceRevision:1,status:'deleted',suppressedMessageIds:['first']},
    {userId:'delete-user',sourceType:'message',sourceId:'merge-0',sourceRevision:4,status:'superseded',suppressedMessageIds:['second']},
  ]);
  const merged=await db.memorySourceTombstones.get(memorySourceTombstoneId('delete-user','message','merge-0'));
  check(merged?.status==='deleted'&&merged.sourceRevision===4&&merged.suppressedMessageIds?.join()==='first,second','batch merge crosses boundaries without losing permanent deletion');
  await db.sessions.update('rollback-session',{summary:'旧摘要',summaryUpdatedAt:now+1});
  await messageRepo.deleteBySession('rollback-session');
  check(!!(await db.sessions.get('rollback-session'))&&!(await db.sessions.get('rollback-session'))?.summary&&await db.messages.where('sessionId').equals('rollback-session').count()===0,'clear conversation keeps session while invalidating legacy summary');
  return {checks,count,durationMs,operations,maxBulkRead,fullSessionRead,frames:ticks,maxFrameGapMs:Math.round(maxFrameGap),paidCalls:0};
}
(window as any).characterDeleteTest={run};
