import {db, type Message, type Session} from '../../src/db';
import {captureChatSummaryArchive, type ChatSummaryArchive} from '../../src/db/chat-summary-archive';
import {messageEvidenceKey} from '../../src/db/message-evidence-key';

const owner='covered-prefix-synthetic-owner',actor='covered-prefix-synthetic-actor',sessionId='covered-prefix-synthetic-session';
const summary='Synthetic verified summary; contains no private material.';
const api=window as any;
interface Metric {calls:number;keyRows:number;bodyRows:number;countedRows:number;maxBodyRows:number;indexNames:string[];byIndex:Record<string,{calls:number;keyRows:number;bodyRows:number}>}

/** Preserve Dexie's promise zone: an async wrapper changes transaction lifetime. */
function probeReads(){
 const reads:Record<string,Metric>={},restores:Array<()=>void>=[];
 for(const table of [db.messages,db.memorySourceTombstones,db.sessions]){
  const core=table.core as any;
  for(const method of ['query','get','getMany','openCursor','count']){
   const original=core[method];
   core[method]=function(...args:any[]){return original.apply(this,args).then((result:any)=>{
    const metric=reads[table.name+'.'+method]??={calls:0,keyRows:0,bodyRows:0,countedRows:0,maxBodyRows:0,indexNames:[],byIndex:{}};
    metric.calls++;
    const index=args[0]?.query?.index?.name;
    if(index&&!metric.indexNames.includes(index))metric.indexNames.push(index);
    const indexed=metric.byIndex[index??':id']??={calls:0,keyRows:0,bodyRows:0};indexed.calls++;
    if(method==='query'){
     const n=result.result.length;
     if(args[0]?.values===false){metric.keyRows+=n;indexed.keyRows+=n;}
     else{metric.bodyRows+=n;indexed.bodyRows+=n;metric.maxBodyRows=Math.max(metric.maxBodyRows,n);}
    }else if(method==='get'||method==='getMany'){
     const n=method==='get'?Number(result!==undefined):result.filter((row:any)=>row!==undefined).length;
     metric.bodyRows+=n;indexed.bodyRows+=n;metric.maxBodyRows=Math.max(metric.maxBodyRows,n);
    }else if(method==='count'){metric.countedRows+=typeof result==='number'?result:0;
    }else if(result){
     const seenKeys=new Set<string>(),seenBodies=new Set<string>();
     const descriptor=(name:string)=>{let obj=result;while(obj){const d=Object.getOwnPropertyDescriptor(obj,name);if(d)return d;obj=Object.getPrototypeOf(obj);}};
     const keyDescriptor=descriptor('key'),primaryDescriptor=descriptor('primaryKey'),valueDescriptor=descriptor('value');
     const read=(d:PropertyDescriptor|undefined)=>d?.get?d.get.call(result):d?.value;
     const position=()=>JSON.stringify([read(keyDescriptor),read(primaryDescriptor)]);
     for(const name of ['key','primaryKey']){
      const d=name==='key'?keyDescriptor:primaryDescriptor;
      if(d?.get)Object.defineProperty(result,name,{configurable:true,get(){const token=position();if(!seenKeys.has(token)){seenKeys.add(token);metric.keyRows++;indexed.keyRows++;}return read(d);}});
     }
     if(valueDescriptor?.get&&args[0]?.values!==false)Object.defineProperty(result,'value',{configurable:true,get(){
      const token=position();if(!seenBodies.has(token)){seenBodies.add(token);metric.bodyRows++;indexed.bodyRows++;metric.maxBodyRows=Math.max(metric.maxBodyRows,1);}return read(valueDescriptor);
     }});
    }
    return result;
   });};
   restores.push(()=>{core[method]=original;});
  }
 }
 return {reads,restore:()=>restores.reverse().forEach(fn=>fn())};
}

const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');
const segmentValues=(archive:ChatSummaryArchive|undefined)=>archive?.segments.map(s=>({id:s.message.id,role:s.message.role,revision:s.message.revision??1,content:s.content,endOffset:s.endOffset}))??[];
const expectedSegments=(messages:Message[])=>messages.map(message=>({id:message.id,role:message.role,revision:message.revision??1,content:message.content,endOffset:message.content.length}));

/** Synthetic setup bypasses production search tokenization only. It writes the
 * exact current source evidence projection natively and is never timed as capture. */
async function nativeWrite(rows:Partial<Record<'messages'|'sessions'|'memorySourceTombstones',any[]>>,clear=false){
 const names=clear?['messages','sessions','memorySourceTombstones','messageHistorySearch']:Object.keys(rows);
 const tx=db.backendDB().transaction(names,'readwrite');
 const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('native fixture aborted'));tx.onerror=()=>reject(tx.error??Error('native fixture failed'));});
 if(clear)for(const name of names)tx.objectStore(name).clear();
 for(const [name,values] of Object.entries(rows))for(const raw of values!){
  const row=name==='messages'?{...raw,sourceEvidenceKey:messageEvidenceKey(raw),historySearchReadyKey:raw.sessionId}:raw;
  tx.objectStore(name).put(row);
 }
 await done;
}

api.runCoveredPrefix=async()=>{
 await db.open();
 const checks:string[]=[],failures:string[]=[],rows:any[]=[];
 const check=(ok:unknown,label:string)=>(ok?checks:failures).push(label);
 const lengthReads=(result:any)=>Object.values(result.reads as Record<string,Metric>).reduce((sum,metric)=>sum+(metric.byIndex['[sessionId+revision+content.length]']?.calls??0),0);
 // Preserve the old first 64-original page so nearby backfills never add a
 // whole-archive key scan. Edge cases may need recent 64 + probe 64 + 2*64
 // original bodies; dense coverage has only 12 remaining originals (140 total).
 const optimized=(result:any,label:string,maxBodies=256)=>{
  // The frozen baseline must still run these correctness cases. The new-index
  // branch is required only once production schema v43 is really installed.
  if(db.verno>=43){check(lengthReads(result)>0,label+' actually queries the native revision/length index');check(result.messageBodyRows<=maxBodies,label+' bounds original-body reads while bypassing the covered prefix');check((result.reads['messages.query']?.maxBodyRows??Infinity)<=64,label+' each native body page remains at most 64');}
 };
 let currentSession:Session;
 const setup=async(size=40,tied=false)=>{
  const messages:Message[]=Array.from({length:size},(_,i)=>({id:'covered-'+String(i).padStart(6,'0'),sessionId,role:i%2?'assistant':'user',content:'Synthetic covered-prefix original '+String(i).padStart(6,'0')+'.',revision:1,createdAt:tied?1000:1000+i,isProactive:false}));
  currentSession={id:sessionId,userId:owner,characterId:actor,type:'single',title:'Synthetic isolated capture fixture',createdAt:1,updatedAt:1,unreadCount:0};
  await nativeWrite({messages,sessions:[currentSession]},true);
  return messages;
 };
 const cover=async(messages:Message[],extra:Partial<Session>={})=>{
  currentSession={...currentSession,summary,summaryRevision:1,summaryCoveragePolicy:'lossless-segments-v1',summaryUpdatedAt:2,summarySourceMessageIds:messages.map(m=>m.id),summarySourceMessageRevisions:Object.fromEntries(messages.map(m=>[m.id,m.revision??1])),summarySourceMessageOffsets:Object.fromEntries(messages.map(m=>[m.id,m.content.length])),...extra};
  await nativeWrite({sessions:[currentSession]});
 };
 const capture=async(scenario:string,input:Message[],expected?:unknown,guard:()=>boolean=()=>true,userId=owner,characterId=actor)=>{
  const inputHash=await hash({session:currentSession,messages:input});
  const probe=probeReads(),heapBefore=(performance as any).memory?.usedJSHeapSize??null,start=performance.now();
  let archive:ChatSummaryArchive|undefined;
  try{archive=await captureChatSummaryArchive(userId,characterId,sessionId,guard);}finally{probe.restore();}
  const elapsedMs=performance.now()-start,heapAfter=(performance as any).memory?.usedJSHeapSize??null;
  const values=segmentValues(archive),messageReads=Object.entries(probe.reads).filter(([key])=>key.startsWith('messages.'));
  const result={scenario,inputHash,modelInputHash:await hash({previousSummary:archive?.previousSummary,history:values.map(v=>({role:v.role,content:v.content}))}),segmentsHash:await hash(values),expectedSegmentsHash:expected===undefined?undefined:await hash(expected),cursorHash:await hash(archive?.cursor??null),previousSummaryHash:await hash(archive?.previousSummary??null),returned:!!archive,segmentCount:values.length,segmentIds:values.map(v=>v.id),segmentEndOffsets:values.map(v=>v.endOffset),previousSummaryUsed:!!archive?.previousSummary,elapsedMs,heapBefore,heapAfter,heapMeasurement:'before/after usedJSHeapSize; not peak; no forced GC',messageBodyRows:messageReads.reduce((sum,[,m])=>sum+m.bodyRows,0),messageKeyRows:messageReads.reduce((sum,[,m])=>sum+m.keyRows,0),reads:probe.reads};
  rows.push(result);
  if(expected!==undefined)check(result.segmentsHash===result.expectedSegmentsHash,scenario+' exact ordered original segments and offsets');
  return {archive,result};
 };
 for(const size of [1000,10000,50000]){
  const originals=await setup(size);await cover(originals.slice(0,size-30));
  await nativeWrite({memorySourceTombstones:Array.from({length:8105},(_,i)=>({id:'irrelevant-'+i,userId:owner,characterId:i%2?actor:'other-actor',sourceType:'message',sourceId:'unrelated-source-'+i,sourceRevision:1,status:'deleted',updatedAt:1,suppressedMessageIds:['unrelated-source-'+i]}))});
  const expected=expectedSegments(originals.slice(size-30,size-18));
  const {archive,result}=await capture('scale-'+size,originals,expected);
  check(result.messageBodyRows<=140,'scale-'+size+' covered-prefix capture reads at most 140 message bodies (64 recent + 64 original probe + 12 remaining)');
  check(archive?.previousSummary===summary,'scale-'+size+' freshly verified prior summary stays available');
  check(JSON.stringify(archive?.cursor)===JSON.stringify({sourceMessageIds:currentSession.summarySourceMessageIds,sourceMessageRevisions:currentSession.summarySourceMessageRevisions,sourceMessageOffsets:currentSession.summarySourceMessageOffsets}),'scale-'+size+' capture retains exact previously transmitted coverage');
  check(!Object.entries(result.reads).some(([key,m])=>key.startsWith('memorySourceTombstones.')&&m.bodyRows>0),'scale-'+size+' no unrelated suppression body reads');
 }
 {
  const originals=await setup(320);await cover(originals.slice(0,200));
  const inserted={...originals[0],id:'backfilled-before-covered-prefix',createdAt:999,content:'Synthetic earlier insertion.'};await nativeWrite({messages:[inserted]});
  const {result}=await capture('backfilled-old-prefix',[inserted,...originals],expectedSegments([inserted,...originals.slice(200,211)]));optimized(result,'backfilled-old-prefix',192);
 }
 {
  const originals=await setup(320,true);await cover(originals.slice(0,200));
  const {result}=await capture('tied-timestamp-across-page',originals,expectedSegments(originals.slice(200,212)));optimized(result,'tied-timestamp-across-page',192);
 }
 {
  const originals=await setup();await cover(originals.slice(0,12),{summarySourceMessageRevisions:undefined});
  const {archive}=await capture('legacy-missing-source-revisions',originals,expectedSegments(originals.slice(0,12)));
  check(!archive?.previousSummary,'legacy-missing-source-revisions rebuilds without unverified old summary');
 }
 {
  const originals=await setup(360);const content='A'.repeat(1200)+'B'.repeat(1200)+'C'.repeat(16000);
  originals[100]={...originals[100],content,revision:3};await nativeWrite({messages:[originals[100]]});await cover(originals.slice(0,201),{summarySourceMessageOffsets:{...Object.fromEntries(originals.slice(0,201).map(m=>[m.id,m.content.length])),[originals[100].id]:1200}});
  const expected=Array.from({length:12},(_,i)=>({id:originals[100].id,role:originals[100].role,revision:3,content:content.slice(1200+i*1200,2400+i*1200),endOffset:2400+i*1200}));
  const {archive,result}=await capture('partial-long-source-offset',originals,expected);optimized(result,'partial-long-source-offset',192);
  check(archive?.previousSummary===summary&&archive.cursor.sourceMessageOffsets?.[originals[100].id]===1200,'partial-long-source-offset retains verified summary and original cursor');
 }
 {
  const originals=await setup(360);await cover(originals.slice(0,200));const offset=originals[100].content.length;
  originals[100]={...originals[100],content:originals[100].content+' Synthetic appended tail.'};await nativeWrite({messages:[originals[100]]});
  const tail={...expectedSegments([originals[100]])[0],content:originals[100].content.slice(offset)};
  const {archive,result}=await capture('same-revision-grown-tail',originals,[tail,...expectedSegments(originals.slice(200,211))]);optimized(result,'same-revision-grown-tail');
  check(archive?.previousSummary===summary,'same-revision-grown-tail is discovered without discarding verified summary');
 }
 {
  const originals=await setup(360);await cover(originals.slice(0,200));originals[100]={...originals[100],content:'Short.'};await nativeWrite({messages:[originals[100]]});
  const {archive,result}=await capture('same-revision-shortened-invalid-offset',originals,expectedSegments(originals.slice(0,12)));optimized(result,'same-revision-shortened-invalid-offset');
  check(!archive?.previousSummary&&!archive?.cursor.sourceMessageIds?.length,'same-revision-shortened-invalid-offset rebuilds instead of accepting impossible coverage');
 }
 {
  const originals=await setup(24);
  const invalid=Array.from({length:96},(_,i)=>({...originals[i%24],id:'later-ineligible-'+String(i).padStart(3,'0'),createdAt:5000+i,failed:i%2===0}));
  await nativeWrite({messages:invalid,memorySourceTombstones:invalid.filter(m=>!m.failed).map((m,i)=>({id:'later-hidden-'+i,userId:owner,characterId:actor,sourceType:'message',sourceId:m.id,sourceRevision:1,status:'withdrawn',updatedAt:1,suppressedMessageIds:[m.id]}))});
  await capture('recent-eighteen-ignores-failed-and-suppressed',[...originals,...invalid],expectedSegments(originals.slice(0,6)));
 }
 {
  const originals=await setup();await cover(originals.slice(0,12));originals[0]={...originals[0],content:'Synthetic revised original.',revision:4};await nativeWrite({messages:[originals[0]]});
  const {archive}=await capture('edited-prior-source',originals,expectedSegments(originals.slice(0,12)));
  check(!archive?.previousSummary,'edited-prior-source invalidates old summary');
 }
 {
  const originals=await setup(320);await cover(originals.slice(0,200));
  const old=originals[100];originals[100]={...old,content:'X'.repeat(old.content.length),revision:4};
  const tx=db.backendDB().transaction('messages','readwrite');const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  // Keep a deliberately stale derived source key. A native compound index must
  // use the actual source revision/length rather than this cached projection.
  tx.objectStore('messages').put({...originals[100],sourceEvidenceKey:messageEvidenceKey(old),historySearchReadyKey:sessionId});await done;
  const {result}=await capture('native-revision-change-stale-projection',originals,expectedSegments([originals[100],...originals.slice(200,211)]));optimized(result,'native-revision-change-stale-projection');
 }
 {
  const originals=await setup();await cover(originals.slice(0,12));
  await nativeWrite({memorySourceTombstones:[{id:'prior-withdrawn',userId:owner,characterId:actor,sourceType:'message',sourceId:originals[0].id,sourceRevision:1,status:'withdrawn',updatedAt:1,suppressedMessageIds:[originals[0].id]}]});
  const {archive}=await capture('withdrawn-prior-source',originals,expectedSegments(originals.slice(1,13)));
  check(!archive?.previousSummary,'withdrawn-prior-source invalidates old summary and excludes revoked original');
 }
 {
  const originals=await setup();await cover(originals.slice(0,12));
  const tx=db.backendDB().transaction('messages','readwrite');const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});tx.objectStore('messages').delete(originals[0].id);await done;
  const {archive}=await capture('deleted-prior-source',originals.slice(1),expectedSegments(originals.slice(1,13)));
  check(!archive?.previousSummary,'deleted-prior-source invalidates old summary');
 }
 for(const stopAfter of [0,1,2,3]){
  const originals=await setup();let calls=0;
  const cancelled=await capture('cancel-after-'+stopAfter,originals,[],()=>++calls<=stopAfter);
  check(!cancelled.archive,'cancel-after-'+stopAfter+' returns no archive after account callback expires');
  const resumed=await capture('cancel-after-'+stopAfter+'-fresh-retry',originals,expectedSegments(originals.slice(0,12)));
  check(!!resumed.archive,'cancel-after-'+stopAfter+' does not poison the following readonly transaction');
 }
 {
  const originals=await setup();await cover(originals.slice(0,12));
  for(const [kind,userId,characterId] of [['wrong-owner','another-owner',actor],['wrong-character',owner,'another-actor']] as const){
   const {archive,result}=await capture(kind,originals,[],()=>true,userId,characterId);
   check(!archive&&result.messageBodyRows===0,kind+' rejects before reading message bodies');
  }
  currentSession={...currentSession,type:'group',groupId:'synthetic-group'};await nativeWrite({sessions:[currentSession]});
  const {archive,result}=await capture('group-isolation',originals,[]);
  check(!archive&&result.messageBodyRows===0,'group-isolation rejects private capture before reading message bodies');
 }
 {
  const originals=await setup();await cover(originals.slice(0,12));
  await nativeWrite({memorySourceTombstones:[{id:'other-owner-revocation',userId:'another-owner',characterId:actor,sourceType:'message',sourceId:originals[0].id,sourceRevision:1,status:'deleted',updatedAt:1,suppressedMessageIds:[originals[0].id]},{id:'other-character-revocation',userId:owner,characterId:'another-actor',sourceType:'message',sourceId:originals[0].id,sourceRevision:1,status:'deleted',updatedAt:1,suppressedMessageIds:[originals[0].id]}]});
  const {archive}=await capture('foreign-revocation-isolation',originals,expectedSegments(originals.slice(12,22)));
  check(archive?.previousSummary===summary,'foreign-revocation-isolation does not revoke the owned summary');
 }
 {
  const originals=await setup();const foreign={...originals[0],id:'foreign-session-source',sessionId:'foreign-session'};await nativeWrite({messages:[foreign]});await cover([foreign]);
  const {archive}=await capture('foreign-source-session-isolation',[...originals,foreign],expectedSegments(originals.slice(0,12)));
  check(!archive?.previousSummary,'foreign-source-session-isolation refuses sources from another session');
 }
 {
  const originals=await setup(340);
  for(let i=0;i<300;i++)originals[i]={...originals[i],content:'D'.repeat(30+i)};
  await nativeWrite({messages:originals.slice(0,300)});await cover(originals.slice(0,300));
  const {result}=await capture('diverse-offsets-fallback',originals,expectedSegments(originals.slice(300,312)));
  check(lengthReads(result)===0,'diverse-offsets-fallback avoids per-source length seeks and keeps bounded body pages');
  check((result.reads['messages.query']?.maxBodyRows??Infinity)<=64,'diverse-offsets-fallback each body page remains at most 64');
 }
 {
  const originals=await setup(1000);await cover(originals.slice(0,200));
  const {result}=await capture('mostly-unprocessed-fallback',originals,expectedSegments(originals.slice(200,212)));
  check(lengthReads(result)===0,'mostly-unprocessed-fallback does not query a broad same-length bucket');
  check((result.reads['messages.query']?.maxBodyRows??Infinity)<=64,'mostly-unprocessed-fallback each body page remains at most 64');
 }
 {
  const originals=await setup(360);await cover(originals.slice(0,200));
  originals[100]={...originals[100],revision:undefined};await nativeWrite({messages:[originals[100]]});
  const {archive,result}=await capture('mixed-legacy-row-missing-native-revision',originals,expectedSegments(originals.slice(200,212)));optimized(result,'mixed-legacy-row-missing-native-revision');
  check(archive?.previousSummary===summary,'mixed-legacy-row-missing-native-revision conservatively reads the original and keeps the still-live version-1 source');
 }
 {
  const originals=await setup(1000);await cover(originals.slice(0,970));
  const unrelated=Array.from({length:20000},(_,i)=>({...originals[i%1000],id:'foreign-same-length-'+String(i).padStart(6,'0'),sessionId:'foreign-same-length-session-'+i%3}));
  await nativeWrite({messages:unrelated});
  const {result}=await capture('irrelevant-same-length-session-buckets',[...originals,...unrelated],expectedSegments(originals.slice(970,982)));optimized(result,'irrelevant-same-length-session-buckets',140);
  const lengthKeyRows=Object.values(result.reads as Record<string,Metric>).reduce((sum,metric)=>sum+(metric.byIndex['[sessionId+revision+content.length]']?.keyRows??0),0);
  check(lengthKeyRows<=1000,'irrelevant-same-length-session-buckets never returns foreign-session keys from the length index');
 }
 {
  const originals=await setup(400);await cover(originals.slice(0,200));
  const hidden:any[]=[];
  for(let i=200;i<264;i++){
   originals[i]={...originals[i],...(i%3===0?{failed:true}:i%3===1?{content:' \n\t '}:{})};
   if(i%3===2)hidden.push({id:'fully-ineligible-page-'+i,userId:owner,characterId:actor,sourceType:'message',sourceId:originals[i].id,sourceRevision:1,status:'withdrawn',updatedAt:1,suppressedMessageIds:[originals[i].id]});
  }
  await nativeWrite({messages:originals.slice(200,264),memorySourceTombstones:hidden});
  const {result}=await capture('ineligible-entire-page-then-originals',originals,expectedSegments(originals.slice(264,276)));optimized(result,'ineligible-entire-page-then-originals');
 }
 {
  const originals=await setup(10000);await cover(originals.slice(0,9970));
  const inserted=Array.from({length:12},(_,i)=>({...originals[i],id:'early-backfill-'+String(i).padStart(3,'0'),createdAt:10+i,content:'Synthetic early complete-batch insertion '+i+'.'}));await nativeWrite({messages:inserted});
  const {result}=await capture('early-backfill-full-batch',[...inserted,...originals],expectedSegments(inserted));
  check(lengthReads(result)===0,'early-backfill-full-batch finishes without querying the covered length buckets');
  const chronologicalKeys=Object.values(result.reads as Record<string,Metric>).reduce((sum,metric)=>sum+(metric.byIndex['[sessionId+createdAt+id]']?.keyRows??0),0);
  check(chronologicalKeys===0,'early-backfill-full-batch finishes without loading whole-archive chronological keys');
  check(result.messageBodyRows<=128,'early-backfill-full-batch uses at most 128 original bodies');
 }
 {
  const originals=await setup(360),content='A'.repeat(1200)+'L'.repeat(16000);originals[0]={...originals[0],content};await nativeWrite({messages:[originals[0]]});
  await cover(originals.slice(0,201),{summarySourceMessageOffsets:{...Object.fromEntries(originals.slice(0,201).map(m=>[m.id,m.content.length])),[originals[0].id]:1200}});
  const expected=Array.from({length:12},(_,i)=>({id:originals[0].id,role:originals[0].role,revision:1,content:content.slice(1200+i*1200,2400+i*1200),endOffset:2400+i*1200}));
  const {result}=await capture('early-long-source-full-batch',originals,expected);
  check(lengthReads(result)===0,'early-long-source-full-batch finishes without querying covered length buckets');
  check(result.messageBodyRows<=128,'early-long-source-full-batch sends twelve exact tail segments with bounded original reads');
 }
 {
  const originals=await setup(320);await cover(originals.slice(0,302));const sessionBeforeHash=await hash(currentSession);
  const {archive,result}=await capture('all-archive-originals-covered',originals,[]);optimized(result,'all-archive-originals-covered',128);
  check(!archive,'all-archive-originals-covered returns no false empty archive');
  check(await hash(await db.sessions.get(sessionId))===sessionBeforeHash,'all-archive-originals-covered leaves the original session unchanged');
 }
 {
  const originals=await setup(320);await cover(originals.slice(0,302));const sessionBeforeHash=await hash(currentSession);
  const inserted=Array.from({length:3},(_,i)=>({...originals[i],id:'short-backfill-'+i,createdAt:10+i,content:'Synthetic short backfill original '+i+'.'}));await nativeWrite({messages:inserted});
  const {archive,result}=await capture('partial-probe-three-then-covered-tail',[...inserted,...originals],expectedSegments(inserted));optimized(result,'partial-probe-three-then-covered-tail',128);
  check(archive?.segments.length===3&&new Set(archive.segments.map(segment=>segment.message.id)).size===3,'partial-probe-three-then-covered-tail returns exactly the three originals once despite no full batch');
  check(await hash(await db.sessions.get(sessionId))===sessionBeforeHash,'partial-probe-three-then-covered-tail leaves the original session unchanged');
 }
 {
  const originals=await setup(10000);await cover(originals.slice(0,9970));
  const inserted=Array.from({length:12},(_,i)=>({...originals[i],id:'near-prefix-backfill-'+String(i).padStart(3,'0'),createdAt:1012+i*.001,content:'Synthetic near-prefix complete-batch insertion '+i+'.'}));await nativeWrite({messages:inserted});
  const {result}=await capture('near-prefix-backfill-full-batch',[...originals,...inserted],expectedSegments(inserted));
  check(lengthReads(result)===0,'near-prefix-backfill-full-batch finishes without querying covered length buckets');
  const chronologicalKeys=Object.values(result.reads as Record<string,Metric>).reduce((sum,metric)=>sum+(metric.byIndex['[sessionId+createdAt+id]']?.keyRows??0),0);
  check(chronologicalKeys===0,'near-prefix-backfill-full-batch finishes without loading whole-archive chronological keys');
  check(result.messageBodyRows<=128,'near-prefix-backfill-full-batch uses at most the old two 64-body pages');
 }
 return {complete:failures.length===0,checks,failures,rows,paidCalls:0,realModelCalls:0,model:'未确认',reasoning:'未确认',scope:'Actual captureChatSummaryArchive, fresh isolated desktop Chromium native IndexedDB, readonly capture only; no complete sender, commit, model, microphone, Android, APK or publishing.',fixture:'Deterministic synthetic originals only. Native bulk fixtures bypass production history-search tokenization and write current sourceEvidenceKey/historySearchReadyKey projections. Fixture setup and hashing excluded from capture timing; not a production-write benchmark.',limits:['Heap reports before/after samples, never peak memory.','Summary source commit remains covered by separate existing suites; this suite does not modify it.','Key/body counts are instrumented at Dexie dbcore query/get/getMany/openCursor boundaries; no private source bodies are saved.']};
};

function nativeSchema(){
 const native=db.backendDB(),stores=Array.from(native.objectStoreNames),tx=native.transaction(stores,'readonly');
 return {version:native.version,stores:stores.map(name=>{const store=tx.objectStore(name);return {name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:Array.from(store.indexNames).map(indexName=>{const index=store.index(indexName);return {name:indexName,keyPath:index.keyPath,unique:index.unique,multiEntry:index.multiEntry};})};})};
}

/** Called from the frozen v42 bundle, then reloaded at the same origin using
 * the current production bundle. This exercises Dexie's real native upgrade. */
api.prepareCoveredPrefixMigration=async()=>{
 await db.open();
 const messages:Message[]=[
  {id:'migration-alpha',sessionId,role:'user',content:'Synthetic migration alpha.',revision:1,createdAt:1,isProactive:false,image:'synthetic-image-data'},
  {id:'migration-no-revision',sessionId,role:'assistant',content:'Synthetic legacy original.',createdAt:2,isProactive:false},
  {id:'migration-failed',sessionId,role:'user',content:'Synthetic failed original.',revision:1,failed:true,createdAt:3,isProactive:false},
  ...Array.from({length:50000},(_,i)=>({id:'migration-scale-'+String(i).padStart(6,'0'),sessionId,role:i%2?'assistant' as const:'user' as const,content:'Synthetic migration scale '+String(i).padStart(6,'0')+'.',revision:1,createdAt:1000+i,isProactive:false})),
 ];
 await nativeWrite({messages,sessions:[{id:sessionId,userId:owner,characterId:actor,type:'single',title:'Synthetic schema fixture',createdAt:1,updatedAt:1,unreadCount:0}]},true);
 const schema=nativeSchema(),originalRows=await db.messages.toArray(),sessions=await db.sessions.toArray();
 db.close();
 return {schema,originalRows,sessions};
};

api.verifyCoveredPrefixMigration=async(before:any)=>{
 const checks:string[]=[],failures:string[]=[];
 const check=(ok:unknown,label:string)=>(ok?checks:failures).push(label);
 const heapBefore=(performance as any).memory?.usedJSHeapSize??null,started=performance.now();
 await db.open();
 const upgradeElapsedMs=performance.now()-started,heapAfter=(performance as any).memory?.usedJSHeapSize??null;
 const schema=nativeSchema(),indexName='[sessionId+revision+content.length]';
 check(before.schema.version===420,'migration fixture really begins at native version 420 / Dexie v42');
 check(schema.version===430,'actual production upgrade opens native version 430 / Dexie v43');
 const beforeMessages=before.schema.stores.find((store:any)=>store.name==='messages'),afterMessages=schema.stores.find(store=>store.name==='messages');
 check(!beforeMessages.indexes.some((index:any)=>index.name===indexName),'migration v42 fixture has no new compound length index');
 check(!!afterMessages?.indexes.some(index=>index.name===indexName&&JSON.stringify(index.keyPath)===JSON.stringify(['sessionId','revision','content.length'])),'migration v43 creates a native compound identity/revision/length index');
 for(const oldStore of before.schema.stores){
  const newStore=schema.stores.find(store=>store.name===oldStore.name);
  check(!!newStore&&JSON.stringify([newStore.keyPath,newStore.autoIncrement])===JSON.stringify([oldStore.keyPath,oldStore.autoIncrement])&&oldStore.indexes.every((oldIndex:any)=>newStore.indexes.some(newIndex=>JSON.stringify(newIndex)===JSON.stringify(oldIndex))),'migration preserves old store and every index: '+oldStore.name);
 }
 const afterRows=await db.messages.toArray();
 check(JSON.stringify(afterRows)===JSON.stringify(before.originalRows),'migration retains all original message fields byte-for-byte in JSON representation');
 check(JSON.stringify(await db.sessions.toArray())===JSON.stringify(before.sessions),'migration retains all original session fields');
 const keys=async(session:string,revision:number,length:number)=>{
  const tx=db.backendDB().transaction('messages','readonly');
  const request=tx.objectStore('messages').index(indexName).getAllKeys(IDBKeyRange.only([session,revision,length]));
  return new Promise<IDBValidKey[]>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 };
 if(afterMessages?.indexes.some(index=>index.name===indexName)){
  const alpha=before.originalRows.find((row:any)=>row.id==='migration-alpha'),failed=before.originalRows.find((row:any)=>row.id==='migration-failed');
  const stock=before.originalRows.filter((row:any)=>row.id.startsWith('migration-scale-')),stockKeys=new Set(await keys(sessionId,1,stock[0].content.length));
  check(stock.length===50000&&stock.every((row:any)=>stockKeys.has(row.id)),'migration native length index includes every one of 50000 retained stock source IDs');
  check((await keys(sessionId,1,alpha.content.length)).includes(alpha.id),'migration indexes a preexisting explicit-revision original without rewriting it');
  check((await keys(sessionId,1,failed.content.length)).includes(failed.id),'native length index does not pretend to authorize failed sources');
  check(!(await keys(sessionId,1,before.originalRows.find((row:any)=>row.id==='migration-no-revision').content.length)).includes('migration-no-revision'),'legacy missing revision remains absent from the new exact native index');
  const edited={...alpha,revision:2,content:alpha.content+' New synthetic text.'};
  await nativeWrite({messages:[edited]});
  check(!(await keys(sessionId,1,alpha.content.length)).includes(alpha.id)&&(await keys(sessionId,2,edited.content.length)).includes(alpha.id),'native edit moves revision and length entries atomically');
  const moved={...edited,sessionId:'migration-other-session'};await nativeWrite({messages:[moved]});
  check(!(await keys(sessionId,2,moved.content.length)).includes(alpha.id)&&(await keys(moved.sessionId,2,moved.content.length)).includes(alpha.id),'native source transfer updates session isolation in the compound index');
  const native=db.backendDB(),rollback=native.transaction('messages','readwrite');
  const rolledBack=new Promise<void>((resolve,reject)=>{rollback.onabort=()=>resolve();rollback.oncomplete=()=>reject(Error('expected rollback did not abort'));});
  rollback.objectStore('messages').put({...moved,revision:9,content:'Rollback synthetic replacement.'});rollback.abort();await rolledBack;
  check((await keys(moved.sessionId,2,moved.content.length)).includes(alpha.id)&&!(await keys(moved.sessionId,9,'Rollback synthetic replacement.'.length)).includes(alpha.id),'aborted native edit rolls source and compound index back together');
  const deletion=native.transaction('messages','readwrite');const deleted=new Promise<void>((resolve,reject)=>{deletion.oncomplete=()=>resolve();deletion.onabort=()=>reject(deletion.error);});deletion.objectStore('messages').delete(alpha.id);await deleted;
  check(!(await keys(moved.sessionId,2,moved.content.length)).includes(alpha.id),'native deletion removes the indexed source');
 }
 return {complete:failures.length===0,checks,failures,rows:[],stockMessages:50000,totalMessagesBefore:before.originalRows.length,totalMessagesAfter:afterRows.length,upgradeElapsedMs,heapBefore,heapAfter,heapMeasurement:'before/after usedJSHeapSize around db.open upgrade; not peak; no forced GC',schemaBefore:before.schema,schemaAfter:schema,originalRowsHash:await hash(before.originalRows),migratedRowsHash:await hash(afterRows),paidCalls:0,realModelCalls:0,scope:'Frozen real production v42 Dexie database with 50000 synthetic stock originals plus three representative legacy rows, upgraded at the same isolated Chromium origin by current production schema; source/index edit/transfer/delete/rollback checks; no model or Android claim.'};
};
