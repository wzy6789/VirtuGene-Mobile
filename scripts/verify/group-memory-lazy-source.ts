import { db } from '../../src/db';
import { useGroupStore } from '../../src/store/group-store';
import { useAuthStore } from '../../src/store/auth-store';
import { messageRepo } from '../../src/db/message-repo';
import { memorySourceTombstoneRepo } from '../../src/db/memory-source-tombstone-repo';
import { memoryLedgerRepo } from '../../src/db/memory-ledger-repo';
import { subscribeMemoryWrites } from '../../src/lib/memory-write-events';
import { fakeCharacter } from './world-harness';
const userId='group-lazy-owner';
let fullReads=0,primaryReads=0,tombstoneBodies=0,receipts=0;
subscribeMemoryWrites(()=>{receipts++;});
const originalFull=messageRepo.getBySession,originalGet=messageRepo.getById;
messageRepo.getBySession=async(...args)=>{fullReads++;return originalFull(...args);};
messageRepo.getById=async(...args)=>{primaryReads++;return originalGet(...args);};
(window as any).groupLazySource={
 setup:async()=>{
  await db.delete();await db.open();useAuthStore.setState({userId,apiKey:null});
  await db.characters.bulkPut([fakeCharacter('a','甲',userId),fakeCharacter('b','乙',userId)]);
  const group={id:'g',name:'本地群聊',userId,characterIds:['a','b'],createdAt:1,updatedAt:1};await db.groups.put(group);
  await db.sessions.put({id:'s',characterId:'a',userId,groupId:'g',type:'group',title:'本地群聊',createdAt:1,updatedAt:1});
  await db.messages.put({id:'m',sessionId:'s',role:'user',content:'这句话是用户选择记住的原文。',revision:1,witnessedBy:['a','b'],createdAt:1,isProactive:false});
  await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'group-noise-'+i,userId,characterId:i%2?'a':'b',sourceType:'message' as const,sourceId:'unrelated-source-'+i,sourceRevision:1,status:'deleted' as const,suppressedMessageIds:['unrelated-message-'+i],updatedAt:1})));
  const core=db.memorySourceTombstones.core,query=core.query.bind(core);
  core.query=async request=>{const result=await query(request);tombstoneBodies+=result.result.length;return result;};tombstoneBodies=0;
  useGroupStore.setState({currentGroup:group,currentGroupId:'g',currentSessionId:'s'});fullReads=0;primaryReads=0;
 },
 start:()=>useGroupStore.getState().rememberGroupMessage('m'),
 mutate:async(mode:string)=>{
  if(mode==='edit')await db.messages.update('m',{content:'这句话已经被编辑。',revision:2});
  if(mode==='delete')await messageRepo.deleteById('m');
  if(mode==='witness')await db.messages.update('m',{witnessedBy:['a']});
  if(mode==='member')await db.groups.update('g',{characterIds:['a']});
  if(mode==='suppress')await memorySourceTombstoneRepo.record({userId,sourceType:'message',sourceId:'m',characterId:'b',sourceRevision:1,status:'withdrawn',suppressedMessageIds:['m']});
  if(mode==='account')useAuthStore.setState({userId:'another-owner'});
  if(mode==='navigate')useGroupStore.setState({currentSessionId:'another-session'});
  if(mode==='failed')await db.messages.update('m',{failed:true});
  if(mode==='role-owner')await db.characters.update('b',{createdBy:'another-owner'});
  if(['rollback','mid-commit-account','mid-commit-navigation'].includes(mode)){
   const sync=memoryLedgerRepo.syncMemoryItem;let calls=0;
   memoryLedgerRepo.syncMemoryItem=async(...args)=>{
    if(mode==='rollback'&&++calls===2)throw Error('Controlled second memory failure');
    const id=await sync.apply(memoryLedgerRepo,args);
    if(mode==='mid-commit-account')useAuthStore.setState({userId:'another-owner'});
    if(mode==='mid-commit-navigation')useGroupStore.setState({currentSessionId:'another-session'});
    return id;
   };
  }
 },
 resetProbe:()=>{tombstoneBodies=0;},
 inspect:async()=>({memories:await db.memories.where('userId').equals(userId).toArray(),claims:await db.memoryClaims.where('userId').equals(userId).count(),receipts,fullReads,primaryReads,tombstoneBodies,unrelatedTombstoneRows:8105}),
};
