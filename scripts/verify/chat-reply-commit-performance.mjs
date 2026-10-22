import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const liveSources=process.argv.includes('--live-sources');
const root=liveSources?'release/chat-live-source-20261019':'release/chat-reply-commit-20261018',before=root+'/before/send-service.ts';mkdirSync(root,{recursive:true});
const output=root+'/performance-'+Date.now()+'.json';
const files=['scripts/verify/chat-reply-commit-performance.ts','scripts/verify/chat-reply-commit-performance.mjs',before,'src/lib/chat/send-service.ts','src/db/message-repo.ts','src/db/chat-history-snapshot.ts','src/db/chat-topic-state-repo.ts','src/db/memory-source-tombstone-repo.ts','src/lib/character-memory.ts','src/lib/chat-summary-evidence.ts','src/lib/chat-quality-metrics.ts',...(liveSources?['src/lib/chat-stream.ts','src/lib/chat/live-source-watch.ts',root+'/before/chat-stream.ts']:[])];
const hash=body=>createHash('sha256').update(body).digest('hex');
const hashes=()=>Object.fromEntries(files.map(file=>[file,hash(readFileSync(file))]));
const initialHashes=hashes(),fixedBase=Date.now()-10_000;
const report={complete:false,scope:'Saved pre-reply-commit sender vs current sender; all other current source and identical synthetic distribution. Exact final messages/payload hashes are compared.',phases:[],checks:[],errors:[],paidCalls:0,sourceHashes:initialHashes};
if(liveSources)report.scope='Saved pre-live-source-watch sender/stream vs current, native synthetic stock and local transport; exact full provider payload compared, no context reduction.';
let browser,blockedRequests=0;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const phase of ['before','after']){
  const bundle=await build({entryPoints:['scripts/verify/chat-reply-commit-performance.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{PERF_FIXED_BASE:String(fixedBase),LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"reply-commit-performance"'},plugins:phase==='before'?[{name:'saved-before-reply-commit-sender',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]lib[\\/]chat[\\/]send-service\.ts$/},()=>({contents:readFileSync(before,'utf8'),loader:'ts'}));if(liveSources)builder.onLoad({filter:/[\\/]src[\\/]lib[\\/]chat-stream\.ts$/},()=>({contents:readFileSync(root+'/before/chat-stream.ts','utf8'),loader:'ts'}));}}]:[]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const context=await browser.newContext({permissions:[]});
  try{
   const origin='http://127.0.0.1:'+server.address().port;
   await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(blockedRequests++,route.abort()));
   // Keep calendar-only prompt wording identical across a minute boundary.
   // Date.now/performance.now remain real for per-turn latency measurements.
   await context.addInitScript(({calendarNow})=>{
    const NativeDate=Date;
    class CalendarDate extends NativeDate{constructor(...args){if(args.length===0)super(calendarNow);else super(...args);}static now(){return NativeDate.now();}}
    window.Date=CalendarDate;
   },{calendarNow:fixedBase+10_000});
   const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runReplyCommitPerformance==='function');
   const data=await page.evaluate(async()=>{try{return await window.runReplyCommitPerformance();}catch(error){return {complete:false,error:{name:error.name,message:error.message,inner:error.inner?.message},progress:window.replyCommitPerformanceProgress};}});
   report.phases.push({phase,...data});
   if(!data.complete)throw Error(phase+': '+JSON.stringify(data.error));
   for(const sample of data.samples){sample.messagesSha256=hash(JSON.stringify(sample.messages));sample.payloadSha256=hash(JSON.stringify(sample.payload));}
   console.log(JSON.stringify({phase,checks:data.checks.length,samples:data.samples.map(sample=>({transport:sample.transport,iteration:sample.iteration,requestMs:sample.requestMs,firstStreamSnapshotMs:sample.firstStreamSnapshotMs,fullSendMs:sample.fullSendMs,sha:sample.messagesSha256}))}));
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 const [old,current]=report.phases;
 for(let i=0;i<old.samples.length;i++){
  if(old.samples[i].messagesSha256!==current.samples[i].messagesSha256)throw Error('Final messages payload differs at sample '+i);
  if(old.samples[i].payloadSha256!==current.samples[i].payloadSha256)throw Error('Complete provider payload differs at sample '+i);
  report.checks.push('identical final messages and full provider payload sample '+i);
 }
 if(blockedRequests)throw Error('Unexpected external requests blocked: '+blockedRequests);
 report.complete=true;
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
 await browser?.close();const finalHashes=hashes();report.sourceHashesAtEnd=finalHashes;report.changedDuringRun=files.filter(file=>initialHashes[file]!==finalHashes[file]);
 report.blockedRequests=blockedRequests;
 if(report.changedDuringRun.length){report.complete=false;report.errors.push('Source changed during run; samples retained as invalid.');process.exitCode=1;}
 writeFileSync(output,JSON.stringify({...report,calendarControl:'new Date() with no arguments fixed across phases; Date.now and performance.now real',cwd:process.cwd()},null,2));
 console.log(JSON.stringify({complete:report.complete,errors:report.errors,changedDuringRun:report.changedDuringRun,output,paidCalls:0}));
}
