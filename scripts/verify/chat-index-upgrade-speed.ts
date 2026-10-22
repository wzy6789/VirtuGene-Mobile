import Dexie from 'dexie';
import {db} from '@release/db/index';
import {backfillHistorySearchIndex} from '@release/lib/chat-history-index';
import {withChatSessionLock} from '@release/lib/chat/request-coordinator';

window.fetch=async()=>{throw Error('No external requests in upgrade benchmark');};
// Equal scheduling for both implementations: measure actual batch work,
// excluding variable browser idle gaps. This is not the end-user idle duration.
window.requestIdleCallback=callback=>window.setTimeout(()=>callback({didTimeout:false,timeRemaining:()=>50}),0);
Object.assign(window,{releaseSpeed:async()=>{
 const samples=[];
 for(const count of [1000,5000]){
  await db.delete();
  const legacy=new Dexie(db.name);
  legacy.version(36).stores(Object.fromEntries(db.tables.filter(t=>t.name!=='messageHistorySearch').map(t=>[t.name,
    [t.schema.primKey.src,...t.schema.indexes.filter(i=>!['historySearchReadyKey','[sessionId+role]','type','[characterId+userId+type]'].includes(i.name)).map(i=>i.src)].join(',')])));
  await legacy.open();
  const content='这是原始聊天的内容，桂花糕是买给奶奶的。'.repeat(30);
  await legacy.table('sessions').put({id:'s',userId:'u',characterId:'c',title:'isolated',createdAt:1,updatedAt:1});
  await legacy.table('messages').bulkPut(Array.from({length:count},(_,i)=>({id:'old-'+i,sessionId:'s',role:i%2?'assistant':'user',content,createdAt:i,revision:1})));
  legacy.close();
  await withChatSessionLock('pause-automatic-backfill',async()=>{await db.open();});
  const originalPut=IDBObjectStore.prototype.put;let originalWrites=0,indexWrites=0;
  IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='messages')originalWrites++;if(this.name==='messageHistorySearch')indexWrites++;return (originalPut as any).apply(this,args);};
  const started=performance.now();
  try{await backfillHistorySearchIndex();}finally{IDBObjectStore.prototype.put=originalPut;}
  const durationMs=performance.now()-started;
  if(await db.messages.count()!==count||await db.messageHistorySearch.count()!==count)throw Error('Upgrade lost rows/coverage');
  const originals=await db.messages.toArray();
  if(originals.some(m=>m.content!==content||m.revision!==1))throw Error('Upgrade changed original content');
  samples.push({count,durationMs,originalWrites,indexWrites});
 }
 return {samples,modelCalls:0,scope:'actual v36 upgrade and backfill; isolated IndexedDB; identical controlled idle scheduling; not Android upgrade duration'};
}});
