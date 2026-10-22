import './chat-human-live';
import {db,type Message} from '../../src/db';
import {webApi} from '../../src/lib/web-api';
import {summarizeRoleChat} from '../../src/lib/chat/send-service';

const api=window as any,owner='isolated-live-expression-owner',sessionId='isolated-live-session';
interface Metric {calls:number;bodyRows:number;maxBodyRows:number;indexNames:string[]}
function probeReads(){
 const reads:Record<string,Metric>={},restore:Array<()=>void>=[];
 for(const table of [db.messages,db.memorySourceTombstones])for(const method of ['query','get','getMany','openCursor','count']){
  const core=table.core as any,original=core[method];
  core[method]=function(...args:any[]){return original.apply(this,args).then((result:any)=>{
   const metric=reads[table.name+'.'+method]??={calls:0,bodyRows:0,maxBodyRows:0,indexNames:[]};metric.calls++;
   const index=args[0]?.query?.index?.name;if(index&&!metric.indexNames.includes(index))metric.indexNames.push(index);
   const n=method==='query'?args[0]?.values===false?0:result.result.length:method==='get'?Number(result!==undefined):method==='getMany'?result.filter(Boolean).length:0;
   metric.bodyRows+=n;metric.maxBodyRows=Math.max(metric.maxBodyRows,n);
   if(method==='openCursor'&&result){
    const getter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(result),'value')?.get;
    if(getter){const seen=new Set<string>();Object.defineProperty(result,'value',{configurable:true,get(){const key=JSON.stringify([result.key,result.primaryKey]);if(!seen.has(key)){seen.add(key);metric.bodyRows++;metric.maxBodyRows=Math.max(metric.maxBodyRows,1);}return getter.call(result);}});}
   }
   return result;
  });};restore.push(()=>{core[method]=original;});
 }
 return {reads,restore:()=>restore.forEach(fn=>fn())};
}

api.runSummaryArchive=async()=>{
 const checks:string[]=[],failures:string[]=[],rows:any[]=[];
 const check=(ok:unknown,label:string)=>{(ok?checks:failures).push(label);};
 let lastActor:any;
 const setup=async(size=26,options:{tied?:boolean;tombstones?:number}={})=>{
  lastActor=await api.liveExpression.setup({name:'合成角色',tags:[],systemPrompt:'合成连续性资料。',greeting:'合成问候。',signature:''},.5);
  const messages=Array.from({length:size},(_,i)=>({id:'archive-'+String(i).padStart(6,'0'),sessionId,role:i%2?'assistant':'user',content:'synthetic archive body '+i,revision:1,createdAt:options.tied?1000:1000+i,isProactive:false})) as Message[];
  await db.messages.bulkAdd(messages);
  if(options.tombstones)await db.memorySourceTombstones.bulkPut(Array.from({length:options.tombstones},(_,i)=>({id:'irrelevant-suppression-'+i,userId:owner,characterId:lastActor.id,sourceType:'message',sourceId:'not-present-'+i,status:'deleted',sourceRevision:1,updatedAt:1,suppressedMessageIds:['not-present-'+i]})) as any);
  return messages;
 };
 const existingSummary=async(messages:Message[],withOffsets=true)=>{
  await db.sessions.update(sessionId,{summary:'已经存在且有原文依据的旧摘要。',summaryCoveragePolicy:'lossless-segments-v1',summaryRevision:1,summaryUpdatedAt:2000,summarySourceMessageIds:messages.map(m=>m.id),summarySourceMessageRevisions:Object.fromEntries(messages.map(m=>[m.id,m.revision??1])),...(withOffsets?{summarySourceMessageOffsets:Object.fromEntries(messages.map(m=>[m.id,m.content.length]))}:{})} as any);
 };
 const run=async(complete=true)=>{
  const calls:any[]=[];
  webApi.context.summarize=async params=>{calls.push(JSON.parse(JSON.stringify(params)));return {summary:'经过实际来源压缩的合成摘要。',complete};};
  const probe=probeReads(),started=performance.now();
  try{await summarizeRoleChat(sessionId,owner,lastActor,'synthetic-not-a-credential');}
  finally{probe.restore();}
  return {calls,reads:probe.reads,elapsedMs:performance.now()-started,session:await db.sessions.get(sessionId)};
 };
 for(const size of [1000,10000,50000]){
  const originals=await setup(size,{tombstones:8105});const result=await run(false);
  check(result.calls.length===1&&result.calls[0].history.length===12,size+' source archive still prepares exactly twelve real original segments');
  check((result.reads['messages.query']?.bodyRows??Infinity)<=128,size+' initial summary candidate selection reads at most 128 message bodies');
  check(!Object.entries(result.reads).some(([key,m])=>key.startsWith('memorySourceTombstones.')&&m.bodyRows>0),size+' unrelated actor tombstones do not deserialize into summary preparation');
  check(!result.session?.summarySourceMessageIds?.length,size+' incomplete model substitute does not advance coverage');
  const expected=originals.slice(0,12).map(message=>({role:message.role,content:message.content,userAuthored:true}));
  check(JSON.stringify(result.calls[0]?.history)===JSON.stringify(expected),size+' selected history equals the frozen before-policy twelve-original payload exactly');
  rows.push({scenario:'scale-'+size,...result});
 }
 {
  const messages=await setup(40);
  await db.sessions.update(sessionId,{summary:'没有来源的旧摘要不得变成新事实。',summaryUpdatedAt:Date.now(),summaryRevision:1});
  const result=await run();
  check(result.calls.length===1&&!result.calls[0].previousSummary,'source-less legacy summary is rebuilt without forwarding unverified previous text');
  check(result.calls[0]?.history[0]?.content===messages[0].content,'legacy rebuild begins with actual earliest original content');
  check(JSON.stringify(result.session?.summarySourceMessageIds)===JSON.stringify(messages.slice(0,12).map(m=>m.id)),'legacy replacement provenance contains only the twelve actually transmitted originals');
  rows.push({scenario:'legacy-no-sources',...result});
 }
 {
  await setup(40);await db.sessions.update(sessionId,{summary:'无来源但仍保留的旧文本。',summaryUpdatedAt:Date.now(),summaryRevision:3});
  const result=await run(false);
  check(!result.calls[0]?.previousSummary&&result.session?.summary==='无来源但仍保留的旧文本。'&&result.session.summaryRevision===3&&!result.session.summarySourceMessageIds?.length,'incomplete legacy rebuild keeps stored text without authorizing or inventing its sources');
  rows.push({scenario:'legacy-no-sources-incomplete',...result});
 }
 for(const explicit of [false,true]){
  const messages=await setup(),content='A'.repeat(1199)+'🙂'+'原文尾段';messages[0]={...messages[0],content};await db.messages.put(messages[0]);
  await existingSummary([messages[0]],false);if(explicit)await db.sessions.update(sessionId,{summarySourceMessageOffsets:{[messages[0].id]:1200}});
  const result=await run(false);
  check(result.calls[0]?.history[0]?.content==='🙂原文尾段','legacy surrogate boundary is replayed as a complete pair with '+(explicit?'explicit':'missing')+' offset');
  rows.push({scenario:'surrogate-legacy-start-'+explicit,...result});
 }
 for(const explicit of [false,true]){
  const messages=await setup(),content='前'.repeat(1000)+'旧网关漏掉的两百字'.repeat(30)+'结尾';messages[0]={...messages[0],content};await db.messages.put(messages[0]);
  await existingSummary([messages[0]],false);await db.sessions.update(sessionId,{summaryCoveragePolicy:undefined,...(explicit?{summarySourceMessageOffsets:{[messages[0].id]:1200}}:{})} as any);
  const result=await run();const start=explicit?1000:0;
  check(result.calls[0]?.history[0]?.content===content.slice(start,start+1200),'pre-lossless '+(explicit?'known':'missing')+' offset conservatively replays possibly untransmitted originals');
  check((result.session as any)?.summaryCoveragePolicy==='lossless-segments-v1','successful legacy replay records the lossless coverage policy for '+explicit);
  rows.push({scenario:'old-wire-coverage-'+explicit,...result});
 }
 {
  const messages=await setup(60);for(let i=0;i<20;i++){messages[i]={...messages[i],content:String(i).padStart(2,'0').repeat(1000)};await db.messages.put(messages[i]);}
  await existingSummary(messages.slice(0,20));await db.sessions.update(sessionId,{summaryCoveragePolicy:undefined} as any);
  const first=await run();
  check(first.calls[0]?.history.every((part:any,i:number)=>part.content===messages[i].content.slice(1000))&&first.calls[0]?.history.length===12,'old clipped multi-source replay spends only twelve segments on uncertain tails');
  check(first.session?.summarySourceMessageOffsets?.[messages[12].id]===1000,'untouched old sources retain conservative explicit offsets when adopting the new policy');
  const second=await run();
  check(second.calls[0]?.history[0]?.content===messages[12].content.slice(1000),'next successful batch resumes the first unreplayed old-source tail without restoring its old false offset');
  rows.push({scenario:'old-wire-multi-batch',first,second});
 }
 {
  const messages=await setup();const content='P'.repeat(1200)+'尾'.repeat(26800);
  messages[0]={...messages[0],content,revision:3};await db.messages.put(messages[0]);
  await existingSummary([messages[0]]);await db.sessions.update(sessionId,{summarySourceMessageOffsets:{[messages[0].id]:1200}});
  const result=await run();
  check(result.calls[0]?.history.length===12&&result.calls[0].history.every((part:any,i:number)=>part.content===content.slice(1200+i*1200,2400+i*1200)),'partly covered long message continues from exact original offset for twelve segments');
  check(result.session?.summarySourceMessageOffsets?.[messages[0].id]===15600&&result.session.summarySourceMessageRevisions?.[messages[0].id]===3,'partial batch advances only transmitted original end offset and preserves revision');
  const second=await run();
  check(second.calls[0]?.history[0]?.content===content.slice(15600,16800),'next successful batch resumes the same long original tail');
  rows.push({scenario:'long-source-partial',first:result,second});
 }
 {
  const messages=await setup();const content='P'.repeat(1200)+'Q'.repeat(1200)+'原文尾段';
  messages[0]={...messages[0],content,revision:3};await db.messages.put(messages[0]);
  await existingSummary([messages[0]],false);const result=await run();
  check(result.calls[0]?.previousSummary==='已经存在且有原文依据的旧摘要。','known valid source IDs and revisions retain the legacy summary independently of missing offsets');
  check(result.calls[0]?.history[0]?.content===content.slice(1200,2400)&&result.calls[0]?.history[1]?.content==='原文尾段','known source without offset resumes after its historically clipped 1200-character prefix');
  check(result.session?.summarySourceMessageOffsets?.[messages[0].id]===content.length,'known legacy partial source records the real complete tail after summarizing it');
  rows.push({scenario:'known-source-no-offset',...result});
 }
 {
  const messages=await setup(40);await existingSummary(messages.slice(0,12));
  const inserted={...messages[0],id:'backfilled-original',content:'比已覆盖前缀更早插入的原文。',createdAt:999};await db.messages.put(inserted);
  const result=await run();
  check(result.calls[0]?.history[0]?.content===inserted.content&&result.session?.summarySourceMessageIds?.includes(inserted.id),'backfilled older original is discovered despite a later valid summary prefix');
  rows.push({scenario:'backfilled-prefix',...result});
 }
 {
  const messages=await setup(24);
  await db.messages.bulkAdd(Array.from({length:96},(_,i)=>({...messages[i%24],id:'later-ineligible-'+String(i).padStart(3,'0'),createdAt:5000+i,failed:i%2===0})));
  await db.memorySourceTombstones.bulkPut(Array.from({length:48},(_,i)=>({id:'later-source-suppression-'+i,userId:owner,characterId:lastActor.id,sourceType:'message',sourceId:'later-ineligible-'+String(i*2+1).padStart(3,'0'),status:'deleted',sourceRevision:1,updatedAt:1,suppressedMessageIds:['later-ineligible-'+String(i*2+1).padStart(3,'0')]})) as any);
  const result=await run(false);
  check(JSON.stringify(result.calls[0]?.history.map((part:any)=>part.content))===JSON.stringify(messages.slice(0,6).map(m=>m.content)),'latest eighteen boundary counts eligible messages beyond more than eighteen failed and suppressed rows');
  rows.push({scenario:'recent-eighteen-eligibility',...result});
 }
 {
  const messages=await setup(160,{tied:true});await existingSummary(messages.slice(0,70));const result=await run(false);
  check(JSON.stringify(result.calls[0]?.history.map((part:any)=>part.content))===JSON.stringify(messages.slice(70,82).map(m=>m.content)),'tied timestamps and covered first page retain chronological id order without skipping the next page');
  check((result.reads['messages.query']?.maxBodyRows??Infinity)<=64,'summary forward and backward body pages remain independently bounded through covered-prefix scanning');
  rows.push({scenario:'tied-pages-covered-prefix',...result});
 }
 {
  const messages=await setup(160),suppressed=messages.slice(0,-18);
  await db.memorySourceTombstones.bulkPut(suppressed.map((message,i)=>({id:'all-candidate-suppression-'+i,userId:owner,characterId:lastActor.id,sourceType:'message',sourceId:message.id,status:'deleted',sourceRevision:1,updatedAt:1,suppressedMessageIds:[message.id]})) as any);
  const result=await run(false);
  check(result.calls.length===0&&!result.session?.summaryAttemptedAt,'all suppressed archive candidates terminate without a model call or false coverage');
  check((result.reads['messages.query']?.maxBodyRows??Infinity)<=64,'all-suppressed archive still uses bounded body pages');
  rows.push({scenario:'all-old-candidates-suppressed',...result});
 }
 for(const offset of [-1,Number.MAX_SAFE_INTEGER]){
  const messages=await setup(40);await existingSummary([messages[0]]);
  await db.sessions.update(sessionId,{summarySourceMessageOffsets:{[messages[0].id]:offset}});
  const result=await run();
  check(!result.calls[0]?.previousSummary&&result.calls[0]?.history[0]?.content===messages[0].content,'malformed old offset '+offset+' rebuilds from exact original instead of trusting unseen coverage');
  check(result.session?.summarySourceMessageOffsets?.[messages[0].id]===messages[0].content.length,'rebuilt old offset '+offset+' is replaced by the actual transmitted end');
  rows.push({scenario:'malformed-old-offset-'+offset,...result});
 }
 {
  const messages=await setup(40);await existingSummary(messages.slice(0,12));
  const corrected={...messages[0],content:'更正后存活的原文。',revision:4};await db.messages.put(corrected);
  const result=await run();
  check(!result.calls[0]?.previousSummary&&result.calls[0]?.history[0]?.content===corrected.content,'invalid prior source revision rebuilds without the stale summary');
  check(result.session?.summarySourceMessageRevisions?.[corrected.id]===4,'rebuilt summary stores the current original revision rather than preserving the invalid cursor');
  rows.push({scenario:'prior-source-revised',...result});
 }
 {
  const messages=await setup(40);await existingSummary(messages.slice(0,12));
  await db.memorySourceTombstones.put({id:'prior-source-revocation',userId:owner,characterId:lastActor.id,sourceType:'message',sourceId:messages[0].id,status:'withdrawn',sourceRevision:1,updatedAt:1,suppressedMessageIds:[messages[0].id]} as any);
  const result=await run();
  check(!result.calls[0]?.previousSummary&&result.calls[0]?.history[0]?.content===messages[1].content,'withdrawn previous source invalidates the old summary before generation');
  check(!result.session?.summarySourceMessageIds?.includes(messages[0].id),'rebuilt cumulative provenance drops the withdrawn original instead of copying the old source list');
  rows.push({scenario:'prior-source-withdrawn',...result});
 }
 {
  const messages=await setup(26);await db.messages.update(messages[0].id,{secretaryDispatch:{taskId:'synthetic-dispatch',assistantName:'合成助理',bodyOrigin:'composed'}});
  const result=await run(false);
  check(result.calls[0]?.history[0]?.content===messages[0].content&&result.calls[0]?.history[0]?.userAuthored===false,'summary preserves a composed dispatch as non-user-authored context rather than dropping or relabelling it');
  rows.push({scenario:'composed-dispatch-source-policy',...result});
 }
 return {complete:failures.length===0,checks,failures,rows,paidCalls:0,realModelCalls:0,scope:'Actual production summarizeRoleChat and native isolated desktop DB, deterministic summarizer substitute; no real model or Android claim',remaining:['Previously covered prefixes may still require repeated bounded page scans.','Successful cumulative summary commit can still bulk-read all cumulative source bodies.']};
};
