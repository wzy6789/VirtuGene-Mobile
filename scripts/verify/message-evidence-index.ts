import Dexie from 'dexie';
import {db} from '../../src/db/index';
import {messageEvidenceKey} from '../../src/db/message-evidence-key';
import {hasLivePrivateSummarySources} from '../../src/lib/chat-summary-evidence';

const report=window.fetch.bind(window);
async function run() {
 let checks=0;
 const check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks++;};
 await db.delete();
 const legacy=new Dexie(db.name);
 // Reproduce an existing pre-index database; keep every other current table.
 legacy.version(35).stores(Object.fromEntries(db.tables.map(table=>[table.name,[table.schema.primKey.src,...table.schema.indexes.filter(index=>index.name!=='sourceEvidenceKey').map(index=>index.src)].join(',')])));
 await legacy.open();
 const originals=Array.from({length:1000},(_,i)=>({id:'source-'+i,sessionId:'owned',role:'user',content:'原始消息-'+i+'正文'.repeat(500),createdAt:i,revision:i%2?2:1}));
 await legacy.table('messages').bulkPut(originals);
 legacy.close();
 await db.open();
 check(await db.messages.count()===originals.length,'upgrade preserves message count');
 const migrated=await db.messages.toArray();
 check(migrated.every(m=>m.sourceEvidenceKey===messageEvidenceKey(m)),'upgrade populates evidence keys for every old row');
 check(migrated.every(m=>m.content===originals.find(row=>row.id===m.id)!.content),'upgrade preserves every original body');
 const ids=originals.map(m=>m.id), revisions=Object.fromEntries(originals.map(m=>[m.id,m.revision]));
 const session={id:'owned',userId:'u',characterId:'a',title:'验证',createdAt:0,updatedAt:0,summary:'有来源的摘要',summarySourceMessageIds:ids,summarySourceMessageRevisions:revisions};
 check(await hasLivePrivateSummarySources(session,'u','a'),'large mixed-version migrated sources validate');
 const getMany=db.messages.core.getMany.bind(db.messages.core);
 db.messages.core.getMany=async()=>{throw Error('Summary verifier must not load bodies');};
 try {check(await hasLivePrivateSummarySources(session,'u','a'),'summary check uses index only');}finally{db.messages.core.getMany=getMany;}
 await db.messages.update('source-0',{failed:true});
 check(!await hasLivePrivateSummarySources(session,'u','a'),'direct failure immediately denies summary');
 await db.messages.update('source-0',{failed:false});
 check(await hasLivePrivateSummarySources(session,'u','a'),'clear failure restores exact original source');
 await db.messages.update('source-0',{revision:3});
 check(!await hasLivePrivateSummarySources(session,'u','a'),'revision edit invalidates old evidence');
 await db.messages.update('source-0',{revision:1});
 await db.messages.update('source-0',{sessionId:'foreign'});
 check(!await hasLivePrivateSummarySources(session,'u','a'),'moving source to another session denies summary');
 await db.messages.update('source-0',{sessionId:'owned'});
 await db.messages.bulkPut([{...originals[0],failed:true,sourceEvidenceKey:messageEvidenceKey(originals[0])}] as any);
 check(!await hasLivePrivateSummarySources(session,'u','a'),'bulk import cannot forge a valid evidence key');
 await db.messages.put({...originals[0],sourceEvidenceKey:'forged'} as any);
 check(await hasLivePrivateSummarySources(session,'u','a'),'put recomputes projection instead of trusting imported key');
 await db.messages.where(':id').equals('source-0').modify({failed:true});
 check(!await hasLivePrivateSummarySources(session,'u','a'),'collection modify maintains source status');
 await db.messages.update('source-0',{failed:false});
 await db.messages.where(':id').equals('source-0').modify(row=>{delete row.sourceEvidenceKey;});
 check(await hasLivePrivateSummarySources(session,'u','a'),'projection cannot be stripped by direct modify');
 try {await db.transaction('rw',db.messages,async()=>{await db.messages.update('source-0',{failed:true});throw Error('rollback');});}catch{}
 check(await hasLivePrivateSummarySources(session,'u','a'),'rollback restores original row and evidence atomically');
 check(!await hasLivePrivateSummarySources(session,'u','a',new Set(['source-0'])),'forgetting still overrides live index');
 check(!await hasLivePrivateSummarySources({...session,userId:'foreign'},'u','a'),'account ownership is preserved');
 check(!await hasLivePrivateSummarySources({...session,characterId:'foreign'},'u','a'),'character ownership is preserved');
 check(!await hasLivePrivateSummarySources({...session,summarySourceMessageRevisions:{}},'u','a'),'unversioned provenance is not invented');
 check(!await hasLivePrivateSummarySources({...session,summarySourceMessageIds:[ids[0],ids[0]]},'u','a'),'duplicate provenance denied');
 check(await hasLivePrivateSummarySources({...session,summarySourceMessageIds:ids.slice(0,2)},'u','a'),'small exact-source path validates');
 await db.messages.delete('source-0');
 check(!await hasLivePrivateSummarySources(session,'u','a'),'source deletion invalidates large index path');
 check(!await hasLivePrivateSummarySources({...session,summarySourceMessageIds:ids.slice(0,2)},'u','a'),'source deletion invalidates small exact path');
 return 'ok '+checks+' assertions: source index migration/write/rollback/security ALL PASS';
}
run().then(result=>report('/result',{method:'POST',body:result})).catch(error=>report('/result',{method:'POST',body:'FAIL '+error.stack}));
