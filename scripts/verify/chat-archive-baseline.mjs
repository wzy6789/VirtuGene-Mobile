import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const sources=['scripts/verify/chat-archive-baseline.ts','scripts/verify/chat-archive-baseline.mjs','src/lib/chat/send-service.ts','src/db/chat-auxiliary-guard.ts','src/db/message-repo.ts','src/lib/ai/summary-batches.ts','src/lib/ai/history-window.ts','src/db/session-repo.ts','src/db/memory-source-tombstone-repo.ts'];
const hashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashesBefore=hashes(),startedAt=new Date().toISOString();
const bundle=await build({entryPoints:['scripts/verify/chat-archive-baseline.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"readonly-archive-baseline"'}});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});let result,blockedRequests=0;
try{
 const context=await browser.newContext({permissions:[]}),origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
 const page=await context.newPage();await page.goto(origin);
 result=await page.evaluate(async()=>{try{return await window.auditArchiveBaseline();}catch(error){throw Error(JSON.stringify({name:error.name,message:error.message,inner:error.inner?.message}));}});
}catch(error){result={complete:false,error:error.message};process.exitCode=1;}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
 const sourceHashesAfter=hashes(),stableSources=JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter);
 const report={...result,startedAt,finishedAt:new Date().toISOString(),environment:{platform:process.platform,node:process.version,browser:'local Chrome headless',model:'未确认',reasoning:'未确认'},blockedRequests,stableSources,sourceHashesBefore,sourceHashesAfter,limits:['Single observation per size and operation, not a timing distribution.','Synthetic source bodies only; no credentials or real private records.','Candidate selection is measured; no UI or Android claim.']};
 mkdirSync('release/chat-archive-incremental-20261019',{recursive:true});
 const path='release/chat-archive-incremental-20261019/baseline-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(report,null,2));
 console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,stableSources,paidCalls:0,rows:report.rows},null,2));
}
