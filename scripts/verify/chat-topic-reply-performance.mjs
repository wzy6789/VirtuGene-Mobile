import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve,relative} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-topic-replies-20261019',beforeRoot=root+'/before';mkdirSync(root,{recursive:true});
const output=root+'/performance-'+Date.now()+'.json';
const overlays=['src/db/index.ts','src/db/chat-topic-state-repo.ts','src/lib/chat-conversation-state.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat/send-service.ts'];
const files=['scripts/verify/chat-topic-reply-performance.ts','scripts/verify/chat-topic-reply-performance.mjs',...overlays,...overlays.map(file=>beforeRoot+'/'+file),'src/lib/chat-topic-replies.ts','src/db/message-repo.ts','src/db/chat-history-snapshot.ts','src/db/memory-source-tombstone-repo.ts','src/lib/character-memory.ts','src/lib/chat-summary-evidence.ts','src/lib/chat-quality-metrics.ts','src/lib/chat-stream.ts','src/lib/chat/live-source-watch.ts'];
const hash=body=>createHash('sha256').update(body).digest('hex');
const hashes=()=>Object.fromEntries(files.map(file=>[file,hash(readFileSync(file))]));
const initialHashes=hashes(),fixedBase=Date.now()-10_000;
const report={complete:false,scope:'Five saved pre-topic-reply production sources vs current production; identical current fixture-only seed helpers, native synthetic stock and local transport. System annotation is intentionally different; history/current-user/user facts must be identical.',phases:[],checks:[],errors:[],paidCalls:0,sourceHashes:initialHashes};
const check=(ok,label)=>{if(!ok)throw Error(label);report.checks.push(label);};
const define={PERF_FIXED_BASE:String(fixedBase),LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"topic-reply-performance"'};
const common={bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define};
// Separate compilation graph: these current functions only seed/check fixtures.
// The before sender and its dependencies still use the five saved snapshots.
const helperBundle=await build({...common,stdin:{contents:"import {updateChatConversationState} from './src/lib/chat-conversation-state';import {appendTopicReplyEvidence,replyRecordSources,supportsTopicReply} from './src/lib/chat-topic-replies';window.topicPerformanceSeed={updateChatConversationState,appendTopicReplyEvidence,replyRecordSources,supportsTopicReply};",resolveDir:process.cwd(),sourcefile:'fixture-current-helpers.ts'}});
report.fixtureHelperBundleSha256=hash(helperBundle.outputFiles[0].text);
let browser,blockedRequests=0;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const phase of ['before','after']){
  const applied=[];
  const bundle=await build({...common,entryPoints:['scripts/verify/chat-topic-reply-performance.ts'],plugins:phase==='before'?[{name:'saved-five-topic-reply-sources',setup(builder){builder.onLoad({filter:/[\\/]src[\\/].*\.ts$/},args=>{
   const file=relative(process.cwd(),args.path).replaceAll('\\','/');
   if(!overlays.includes(file))return;
   applied.push(file);return {contents:readFileSync(resolve(beforeRoot,file),'utf8'),loader:'ts'};
  });}}]:[]});
  check(phase!=='before'||overlays.every(file=>applied.includes(file)),'before compilation overlays all five saved source files');
  const script=helperBundle.outputFiles[0].text+'\n'+bundle.outputFiles[0].text;
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?script:'<!doctype html><script src="/test.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const context=await browser.newContext({permissions:[]});
  try{
   const origin='http://127.0.0.1:'+server.address().port;
   await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(blockedRequests++,route.abort()));
   await context.addInitScript(({calendarNow})=>{const NativeDate=Date;class CalendarDate extends NativeDate{constructor(...args){if(args.length===0)super(calendarNow);else super(...args);}static now(){return NativeDate.now();}}window.Date=CalendarDate;},{calendarNow:fixedBase+10_000});
   const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runTopicReplyPerformance==='function');
   const data=await page.evaluate(async()=>{try{return await window.runTopicReplyPerformance();}catch(error){return {complete:false,error:{name:error.name,message:error.message,inner:error.inner?.message},progress:window.topicReplyPerformanceProgress};}});
   report.phases.push({phase,appliedOverlays:applied,...data});
   const samples=data.samples??data.progress?.samples??[];
   for(const sample of samples){
    sample.fixtureSha256=hash(JSON.stringify(sample.fixtureData));
    sample.messagesSha256=hash(JSON.stringify(sample.messages??null));sample.payloadSha256=hash(JSON.stringify(sample.payload??null));
    const messages=sample.messages??[];
    sample.historySha256=hash(JSON.stringify(messages.filter(message=>message.role!=='system').slice(0,-1)));
    sample.currentUserSha256=hash(JSON.stringify(messages.filter(message=>message.role!=='system').at(-1)??null));
    sample.systemSha256=hash(JSON.stringify(messages.filter(message=>message.role==='system')));
    sample.userFactsBeforeSha256=hash(JSON.stringify(sample.evidenceBefore?.userFacts??null));
    sample.userFactsAfterSha256=hash(JSON.stringify(sample.evidenceAfter?.userFacts??null));
   }
   if(!data.complete)throw Error(phase+': '+JSON.stringify(data.error));
   console.log(JSON.stringify({phase,checks:data.checks.length,samples:samples.map(sample=>({transport:sample.transport,iteration:sample.iteration,requestMs:sample.requestMs,firstTransportBodyMs:sample.firstTransportBodyMs,firstStreamSnapshotMs:sample.firstStreamSnapshotMs,fullSendMs:sample.fullSendMs,fixtureSha256:sample.fixtureSha256,historySha256:sample.historySha256}))}));
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 const [old,current]=report.phases;
 check(old.samples.length===8&&current.samples.length===8,'four buffered and four SSE samples retained for each phase');
 for(let i=0;i<old.samples.length;i++){
  const a=old.samples[i],b=current.samples[i];
  check(a.transport===b.transport&&a.iteration===b.iteration,'matched transport and iteration sample '+i);
  check(a.fixtureSha256===b.fixtureSha256,'exact complete seeded fixture sample '+i);
  check(a.historySha256===b.historySha256&&a.currentUserSha256===b.currentUserSha256,'exact non-system history and current user sample '+i);
  check(a.userFactsBeforeSha256===b.userFactsBeforeSha256&&a.userFactsAfterSha256===b.userFactsAfterSha256&&a.userFactsBeforeSha256===a.userFactsAfterSha256,'all existing user slots, outcomes and evidence exact sample '+i);
  check(!a.messages.filter(message=>message.role==='system').some(message=>message.content.includes('角色回应记录'))&&b.messages.filter(message=>message.role==='system').some(message=>message.content.includes('角色回应记录')),'only after system carries cached role response annotation sample '+i);
 }
 check(new Set([...old.samples,...current.samples].map(sample=>sample.fixtureSha256)).size===1,'all sixteen samples use one exact seeded fixture hash');
 check(blockedRequests===0,'no external request attempted');
 report.complete=true;
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
 await browser?.close();const finalHashes=hashes();report.sourceHashesAtEnd=finalHashes;report.changedDuringRun=files.filter(file=>initialHashes[file]!==finalHashes[file]);
 report.blockedRequests=blockedRequests;
 if(report.changedDuringRun.length){report.complete=false;report.errors.push('Source changed during run; samples retained as invalid.');process.exitCode=1;}
 writeFileSync(output,JSON.stringify({...report,calendarControl:'new Date() without arguments fixed across phases; Date.now and performance.now real',cwd:process.cwd(),actualModel:'未确认',actualReasoningEffort:'未确认'},null,2),{flag:'wx'});
 console.log(JSON.stringify({complete:report.complete,errors:report.errors,changedDuringRun:report.changedDuringRun,output,paidCalls:0}));
}
