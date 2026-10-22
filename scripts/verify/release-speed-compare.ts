import {db} from '@release/db/index';
import * as service from '@release/lib/character-memory';
import {knowledgeRepo} from '@release/db/knowledge-repo';
let reads=0,rowsRead=0;
db.use({stack:'dbcore',name:'speed-read-counter',create:down=>({...down,table:name=>{
  const table=down.table(name);return {...table,
    get:async req=>{reads++;const row=await table.get(req);rowsRead+=Number(!!row);return row;},
    getMany:async req=>{reads++;const rows=await table.getMany(req);rowsRead+=rows.filter(Boolean).length;return rows;},
    query:async req=>{reads++;const result=await table.query(req);rowsRead+=result.result.length;return result;},
  };
}})});
Object.assign(window,{releaseSpeed:async()=>{
  await db.delete();await db.open();const now=Date.now();
  await db.characters.put({id:'a',createdBy:'u',name:'独立角色',systemPrompt:'简短认真表达',createdAt:now} as any);
  await db.diaries.bulkPut(Array.from({length:600},(_,index)=>({id:'diary-'+index,userId:'u',date:'2026-10-13',title:'性能日记标记 '+index,content:'真实授权的测试记录。'+'正文'.repeat(500),characterId:'a',visibility:index<6?'selected':'private',visibleTo:index<6?['a']:[],createdAt:now,updatedAt:now,revision:1,tags:[],mood:3})) as any);
  await db.characterKnowledge.bulkPut(Array.from({length:10000},(_,index)=>({id:'unrelated-knowledge-'+index,userId:'u',worldId:'w',characterId:'a',eventId:'other-'+index,knowledgeLevel:'full',canMention:true,learnedAt:now})) as any);
  for(let index=0;index<6;index++)await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'a',eventId:'diary:diary-'+index,knowledgeLevel:'full',canMention:true});
  const samples=[];
  for(let iteration=0;iteration<3;iteration++){
    reads=0;rowsRead=0;const started=performance.now();
    const request={userId:'u',characterId:'a',topic:'你好',sources:['diary' as const],budget:6000};
    let context=await service.buildCharacterMemoryContext(request);
    if('revalidateCharacterMemoryContext' in service)context=await (service as any).revalidateCharacterMemoryContext(request,context);
    const ids=context.references.map(ref=>ref.id);
    if(ids.length!==6||ids.some(id=>!/^diary-[0-5]$/.test(id)))throw Error('Authorized candidate set changed');
    const elapsedMs=performance.now()-started;
    const payload=JSON.stringify({text:context.text,sections:context.sections,references:context.references.map(ref=>({source:ref.source,id:ref.id,text:ref.text}))});
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
    const promptFingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    samples.push({iteration:iteration+1,elapsedMs,reads,rowsRead,ids,promptFingerprint});
  }
  return {diaries:600,unrelatedKnowledge:10000,samples,modelCalls:0,scope:'desktop Chrome CPU throttled 4x; actual IndexedDB and release source, not Android'};
}});
