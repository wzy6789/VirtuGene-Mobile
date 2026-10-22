import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const evidenceDir='release/chat-memory-worker-20261018';
mkdirSync(evidenceDir,{recursive:true});
const reportPath=evidenceDir+'/worker-performance-'+Date.now()+'.json';
const files=['scripts/verify/chat-memory-worker-performance.ts','scripts/verify/chat-memory-worker-performance.mjs','src/lib/memory-jobs.ts','src/db/memory-job-sources.ts','src/db/memory-job-lease.ts','src/db/memory-ledger-repo.ts','src/db/message-repo.ts','release/chat-memory-worker-20261018/before/memory-jobs.ts','release/chat-memory-worker-20261018/before/memory-ledger-repo.ts'];
const hashSources=()=>Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashes=hashSources();
const bundle=await build({entryPoints:['scripts/verify/chat-memory-worker-performance.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"worker-performance"'}});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let report,blockedRequests=0;
try{
 const context=await browser.newContext({permissions:[]});
 const origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>{
  if(route.request().url().startsWith(origin+'/'))return route.continue();
  blockedRequests++;return route.abort();
 });
 const page=await context.newPage();
 await page.goto(origin);
 await page.waitForFunction(()=>typeof window.runMemoryWorkerPerformance==='function');
 report=await page.evaluate(async()=>{
  try{return await window.runMemoryWorkerPerformance();}
  catch(error){return {complete:false,error:{name:error.name,message:error.message,inner:error.inner?.message},progress:window.memoryWorkerPerfProgress};}
 });
 if(!report.complete||blockedRequests)process.exitCode=1;
 console.log(JSON.stringify({complete:report.complete,checks:report.checks?.length??report.progress?.checks?.length,blockedRequests,paidCalls:0,error:report.error,reportPath}));
}catch(error){report={complete:false,error:{name:error.name,message:error.message}};process.exitCode=1;console.log(JSON.stringify(report));}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
 const sourceHashesAtEnd=hashSources();
 const changedDuringRun=files.filter(path=>sourceHashes[path]!==sourceHashesAtEnd[path]);
 if(changedDuringRun.length)process.exitCode=1;
 writeFileSync(reportPath,JSON.stringify({...report,sourceHashes,sourceHashesAtEnd,changedDuringRun,blockedRequests,cwd:process.cwd(),paidCalls:0},null,2));
}
