import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const sources=['scripts/verify/chat-summary-archive.ts','scripts/verify/chat-summary-archive.mjs','src/lib/chat/send-service.ts','src/db/message-repo.ts','src/db/chat-summary-archive.ts','src/db/chat-archive-reader.ts','src/lib/chat-summary-evidence.ts','src/lib/ai/summary-batches.ts','src/db/session-repo.ts','src/db/memory-source-tombstone-repo.ts'];
const hashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const before=hashes(),startedAt=new Date().toISOString();
const legacyStart=process.argv.includes('--legacy-start');
const bundle=await build({entryPoints:['scripts/verify/chat-summary-archive.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"summary-archive-verification"'},plugins:legacyStart?[{name:'isolated-before-segment-start',setup(b){b.onLoad({filter:/summary-batches\.ts$/},()=>({loader:'ts',contents:readFileSync('release/chat-archive-incremental-20261019/before/src/lib/ai/summary-batches.ts','utf8')}));}}]:[]});
const code=bundle.outputFiles[0].text,server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><script src="/test.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});let report,blockedRequests=0;
try{
 const context=await browser.newContext({permissions:[]}),origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
 const page=await context.newPage();await page.goto(origin);report=await page.evaluate(async()=>{try{return await window.runSummaryArchive();}catch(error){throw Error(JSON.stringify({name:error.name,message:error.message,inner:error.inner?.message}));}});if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.message};process.exitCode=1;}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));const after=hashes();
 const path='release/chat-archive-incremental-20261019/summary-'+Date.now()+'.json';mkdirSync('release/chat-archive-incremental-20261019',{recursive:true});
 writeFileSync(path,JSON.stringify({...report,legacyStart,startedAt,finishedAt:new Date().toISOString(),blockedRequests,stableSources:JSON.stringify(before)===JSON.stringify(after),sourceHashesBefore:before,sourceHashesAfter:after,model:'未确认',reasoning:'未确认'},null,2));
 console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures,error:report.error,paidCalls:0},null,2));
}
