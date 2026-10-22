import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync,readFileSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const legacyErrors=process.argv.includes('--legacy-guard-errors');
const legacyPartial=process.argv.includes('--legacy-partial-completion');
const summaryLive=process.argv.includes('--summary-live');
const settlementLive=process.argv.includes('--settlement-live');
const memoryWorker=process.argv.includes('--memory-worker');
const replyCommit=process.argv.includes('--reply-commit');
const liveSources=process.argv.includes('--live-sources');
const entry=liveSources?'scripts/verify/chat-live-sources.ts':replyCommit?'scripts/verify/chat-reply-commit.ts':memoryWorker?'scripts/verify/chat-memory-worker.ts':settlementLive?'scripts/verify/chat-settlement-live.ts':summaryLive?'scripts/verify/chat-summary-live.ts':'scripts/verify/chat-request-recovery.ts';
const method=liveSources?'runLiveSources':replyCommit?'runReplyCommit':memoryWorker?'runMemoryWorker':settlementLive?'runSettlementLive':summaryLive?'runSummaryLive':'runRequestRecovery';
const gatewayEnv=JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/isolated-gateway'});
const bundle=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':gatewayEnv,__APP_VERSION__:'"request-recovery"'},plugins:legacyPartial?[{name:'legacy-partial-completion-only',setup(b){b.onLoad({filter:/[\\/]chat[\\/]send-service\.ts$/},args=>{const source=readFileSync(args.path,'utf8'),needle=", replyCompletion:'interrupted'";if(source.split(needle).length!==2)throw Error('Expected exactly one catch-partial metadata stamp');return {loader:'ts',contents:source.replace(needle,'')};});}}]:legacyErrors?[{name:'legacy-error-classification-only',setup(b){b.onLoad({filter:/web-api\.ts$/},args=>({loader:'ts',contents:readFileSync(args.path,'utf8').replace("if(err instanceof Error&&err.message.startsWith('chat:'))return {error:err.message,usageEvents};",'')}));}}]:[]});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{
 const context=await browser.newContext({permissions:[]}),origin=`http://127.0.0.1:${server.address().port}`;
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();await page.goto(origin);await page.waitForFunction(name=>typeof window[name]==='function',method);
 if(liveSources){
  const writer=await context.newPage();await writer.goto(origin);await writer.waitForFunction(()=>typeof window.changeLiveHistoryFromWriter==='function');
  await page.exposeFunction('mutateLiveSourceFromOtherPage',()=>writer.evaluate(()=>window.changeLiveHistoryFromWriter()));
 }
 report=await page.evaluate(async name=>{try{return await window[name]();}catch(error){throw Error(JSON.stringify({name:error.name,message:error.message,inner:error.inner?.message,lastPassed:window.settlementProgress??window.liveSourceProgress?.checks?.slice(-1)}));}},method);
 console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,paidCalls:0}));
}
catch(error){report={complete:false,error:error.message};process.exitCode=1;console.log(JSON.stringify(report));}
finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync((liveSources?'release/chat-live-source-20261019/live-':replyCommit?'release/chat-reply-commit-20261018/commit-':memoryWorker?'release/chat-memory-worker-20261018/worker-':settlementLive?'release/chat-settlement-guard-20261018/live-':summaryLive?'release/chat-summary-cas-20261018/live-':'release/chat-request-recovery-20261018/recovery-')+Date.now()+'.json',JSON.stringify({...report,faultInjection:legacyPartial?'legacy missing catch-partial completion':legacyErrors?'legacy provider-error classification':'none'},null,2));}
