import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve,relative} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-continuity-sources-20261019',beforeRoot=root+'/before',runId=Date.now();mkdirSync(root,{recursive:true});
const output=root+'/performance-'+runId+'.json',fixturePath=root+'/performance-fixture-'+runId+'.json';
// A narrow source-guard comparison, not a reconstructed historical release.
const overlays=['src/db/continuity-repo.ts','src/lib/character-memory.ts','src/store/emotion-store.ts','src/db/index.ts','src/lib/memory-source-snapshot.ts'];
const files=['scripts/verify/chat-continuity-source-performance.ts','scripts/verify/chat-continuity-source-performance.mjs',...overlays,...overlays.map(file=>beforeRoot+'/'+file),'src/lib/continuity-sources.ts','src/lib/chat/send-service.ts','src/lib/world/world-recall.ts','src/lib/world/world-writer.ts','src/lib/world/world-context.ts','src/lib/chat-topic-replies.ts','src/db/chat-topic-state-repo.ts','src/db/message-repo.ts','src/db/chat-history-snapshot.ts','src/db/memory-source-tombstone-repo.ts','src/lib/chat-summary-evidence.ts','src/lib/chat-quality-metrics.ts','src/lib/chat-stream.ts','src/lib/chat/live-source-watch.ts'];
const hash=body=>createHash('sha256').update(body).digest('hex');
const hashes=()=>Object.fromEntries(files.map(file=>[file,hash(readFileSync(file))]));
const initialHashes=hashes(),fixedBase=Date.now()-10_000,buildOnly=process.argv.includes('--build-only');
const report={complete:false,scope:'Five saved per-file source-guard-stage files vs current; all other sources including world-recall remain current. One fixture is created by the current production repository and imported unchanged into both phases. Provenance attribution and system prompt packing may intentionally differ.',phases:[],checks:[],errors:[],paidCalls:0,sourceHashes:initialHashes,overlays,fixturePath};
const check=(ok,label)=>{if(!ok)throw Error(label);report.checks.push(label);};
const define={PERF_FIXED_BASE:String(fixedBase),LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"continuity-source-performance"'};
const common={bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define};
const diagnosticPlugins=[{name:'isolated-sender-catch-diagnostic',setup(builder){builder.onLoad({filter:/[\\/]chat[\\/]send-service\.ts$/},args=>{
 const body=readFileSync(args.path,'utf8'),needle='} catch (cause) {';
 if(body.split(needle).length!==2)throw Error('Expected one sender outer catch');
 return {loader:'ts',contents:body.replace(needle,needle+' (window as any).continuityPerformanceCaughtCause={name:(cause as any)?.name,message:(cause as any)?.message,stack:(cause as any)?.stack};')};
});}}];
async function compile(phase){
 const applied=[];
 const bundle=await build({...common,entryPoints:['scripts/verify/chat-continuity-source-performance.ts'],plugins:[...diagnosticPlugins,...(phase==='before'?[{name:'saved-five-continuity-source-files',setup(builder){builder.onLoad({filter:/[\\/]src[\\/].*\.ts$/},args=>{
  const file=relative(process.cwd(),args.path).replaceAll('\\','/');if(!overlays.includes(file))return;
  applied.push(file);return {contents:readFileSync(resolve(beforeRoot,file),'utf8'),loader:'ts'};
 });}}]:[])]});
 if(phase==='before')check(overlays.every(file=>applied.includes(file)),'before compilation overlays all five declared source files');
 return {code:bundle.outputFiles[0].text,applied};
}
let browser,blockedRequests=0;
async function withIsolatedPage(code,run){
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><script src="/test.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const context=await browser.newContext({permissions:[]});
 try{
  const origin='http://127.0.0.1:'+server.address().port;
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(blockedRequests++,route.abort()));
  await context.addInitScript(({calendarNow,skipReads})=>{const NativeDate=Date;class CalendarDate extends NativeDate{constructor(...args){if(args.length===0)super(calendarNow);else super(...args);}static now(){return NativeDate.now();}}window.Date=CalendarDate;window.continuitySkipReads=skipReads;},{calendarNow:fixedBase+10_000,skipReads:process.argv.includes('--skip-read-probe')});
  const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runContinuitySourcePerformance==='function');
  return await run(page);
 }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
}
const median=values=>{const ordered=[...values].sort((a,b)=>a-b);return(ordered[1]+ordered[2])/2;};
function summarize(data){return ['buffered-json','live-sse'].map(transport=>{
 const samples=data.samples.filter(sample=>sample.transport===transport);
 const timings=Object.fromEntries(['requestMs','firstTransportBodyMs','firstStreamSnapshotMs','fullSendMs'].map(key=>[key,median(samples.map(sample=>sample[key]))]));
 const reads=samples.map(sample=>{
  const stages={};
  for(const [name,row] of Object.entries(sample.reads)){
   const [stage,table]=name.split(':'),sum=stages[stage]??={calls:0,bodies:0,returnedKeys:0,requestedKeys:0,cursorVisits:0,indexedCountSum:0,messageBodies:0,threadBodies:0,tombstoneBodies:0,diaryBodies:0};
   sum.calls+=row.calls;sum.bodies+=row.returnedBodies;sum.returnedKeys+=row.returnedKeys;sum.requestedKeys+=row.requestedKeys;sum.cursorVisits+=row.cursorVisits;sum.indexedCountSum+=row.indexedCountSum;
   for(const [prefix,key] of [['messages.','messageBodies'],['continuityThreads.','threadBodies'],['memorySourceTombstones.','tombstoneBodies'],['diaries.','diaryBodies']])if(table.startsWith(prefix))sum[key]+=row.returnedBodies;
  }
  return stages;
 });
 return {transport,timings,reads};
});}
try{
 const after=await compile('after'),before=await compile('before');
 report.bundleHashes={fixturePreparationCurrent:hash(after.code),before:hash(before.code),after:hash(after.code)};
 if(buildOnly){report.complete=true;report.buildOnly=true;console.log(JSON.stringify({complete:true,buildOnly:true,overlays,bundleHashes:report.bundleHashes}));}
 else{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const prepared=await withIsolatedPage(after.code,page=>page.evaluate(()=>window.prepareContinuitySourcePerformance()));
  report.fixtureSha256=prepared.fixtureSha256;
  check(hash(JSON.stringify(prepared.fixtureData))===prepared.fixtureSha256,'preparation browser and node agree on complete native fixture hash');
  const fixtureBytes=JSON.stringify(prepared,null,2);writeFileSync(fixturePath,fixtureBytes,{flag:'wx'});report.fixtureFileSha256=hash(fixtureBytes);
  report.fixture={stockMessages:512,currentUsers:1,tombstones:8105,privateDiaries:40,characters:6,sourceBackedThreads:8,derivedEvents:8,topics:prepared.topicCount,threadIds:prepared.threadIds,derivedEventIds:prepared.derivedEventIds};
  for(const phase of (process.argv.includes('--after-only')?['after']:['before','after'])){
   const bundle=phase==='before'?before:after;
   const data=await withIsolatedPage(bundle.code,page=>page.evaluate(async prepared=>{try{return await window.runContinuitySourcePerformance(prepared);}catch(error){return {complete:false,error:{name:error.name,message:error.message,inner:error.inner?.message},progress:window.continuitySourcePerformanceProgress};}},prepared));
   const samples=data.samples??data.progress?.samples??[];
   const measured={phase,appliedOverlays:bundle.applied,...data,samples};report.phases.push(measured);
   for(const sample of samples){
    sample.messagesSha256=hash(JSON.stringify(sample.messages??null));sample.payloadSha256=hash(JSON.stringify(sample.payload??null));
    const messages=sample.messages??[];
    sample.historySha256=hash(JSON.stringify(messages.filter(message=>message.role!=='system').slice(0,-1)));
    sample.currentUserSha256=hash(JSON.stringify(messages.filter(message=>message.role!=='system').at(-1)??null));
    sample.systemSha256=hash(JSON.stringify(messages.filter(message=>message.role==='system')));
    sample.userFactsBeforeSha256=hash(JSON.stringify(sample.evidenceBefore?.userFacts??null));sample.userFactsAfterSha256=hash(JSON.stringify(sample.evidenceAfter?.userFacts??null));
   }
   measured.atomicRollback=await withIsolatedPage(bundle.code,page=>page.evaluate(prepared=>window.runContinuityAtomicRollback(prepared),prepared));
   if(!data.complete){
    const first=samples[0];
    if(phase!=='before'||samples.length!==1||first?.diagnosticCause?.name!=='PrematureCommitError'||first.completed||first.replyRows?.length!==2)throw Error(phase+': '+JSON.stringify(data.error));
    measured.expectedBaselineFailure='PrematureCommitError after durable writes; no healthy baseline latency comparison.';
   }else check(measured.atomicRollback.complete,'rich-context failed second bubble rolls back the whole current batch');
   console.log(JSON.stringify({phase,complete:data.complete,checks:data.checks?.length??data.progress?.checks?.length,sampleCount:samples.length,expectedBaselineFailure:measured.expectedBaselineFailure,atomicRollback:{complete:measured.atomicRollback.complete,injected:measured.atomicRollback.injected,remainingRows:measured.atomicRollback.rows.length},fixtureSha256:report.fixtureSha256,summary:data.complete?summarize(data).map(row=>({transport:row.transport,timings:row.timings,reads:row.reads[0]})):undefined}));
  }
  const old=report.phases.find(phase=>phase.phase==='before'),current=report.phases.find(phase=>phase.phase==='after');
  check(current?.complete&&current.samples.length===8,'four buffered and four SSE successful current samples retained');
  report.healthyBaselineComparison=!!old?.complete;
  report.diagnosticOverlay='Only copies the outer sender catch name/message/stack to an isolated test global; no production file mutation or altered control flow.';
  for(let index=0;index<current.samples.length;index++){
   const b=current.samples[index],a=old?.samples[index]??old?.samples[0]??b;
   check(a.fixtureSha256===report.fixtureSha256&&b.fixtureSha256===report.fixtureSha256,'exact full native imported fixture sample '+index);
   check(a.historySha256===b.historySha256&&a.currentUserSha256===b.currentUserSha256,'exact non-system history and current user sample '+index);
   check(a.userFactsBeforeSha256===b.userFactsBeforeSha256&&b.userFactsBeforeSha256===b.userFactsAfterSha256,'existing user facts and source references remain exact sample '+index);
   check(b.messages.filter(message=>message.role==='system').some(message=>message.content.includes('私聊')&&message.content.includes('未分类语境')),'after prompt carries continuity provenance attribution sample '+index);
  }
  check(blockedRequests===0,'no external request attempted');report.complete=true;
 }
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
 await browser?.close();const finalHashes=hashes();report.sourceHashesAtEnd=finalHashes;report.changedDuringRun=files.filter(file=>initialHashes[file]!==finalHashes[file]);report.blockedRequests=blockedRequests;
 if(report.changedDuringRun.length){report.complete=false;report.errors.push('Source changed during run; all samples retained as invalid.');process.exitCode=1;}
 const target=buildOnly?root+'/performance-buildcheck-'+runId+'.json':output;
 writeFileSync(target,JSON.stringify({...report,calendarControl:'new Date() without arguments fixed across phases; Date.now and performance.now real',cwd:process.cwd(),actualModel:'未确认',actualReasoningEffort:'未确认'},null,2),{flag:'wx'});
 console.log(JSON.stringify({complete:report.complete,buildOnly,errors:report.errors,changedDuringRun:report.changedDuringRun,output:target,paidCalls:0}));
}
