import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-topic-reopening-20261019',source='src/lib/chat-topic-outcomes.ts',hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),beforeHash=hash();
const built=await build({entryPoints:['scripts/verify/chat-topic-reopening.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"topic-reopening"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?built.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{
 const context=await browser.newContext({permissions:[]}),origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();
 await page.exposeFunction('reopeningReloadProbe',async()=>{const fresh=await context.newPage();try{await fresh.goto(origin);await fresh.waitForFunction(()=>!!window.liveExpression?.resume);return await fresh.evaluate(async()=>{await window.liveExpression.resume();await window.liveExpression.turn('继续刚才那个博物馆计划，出发前准备什么？');const state=await window.liveExpression.resume(),plan=state.topics.find(topic=>topic.kind==='plan');return {id:plan.id,outcome:plan.outcome,date:plan.slots.date?.value,time:plan.slots.time?.value,transport:plan.slots.transport?.value};});}finally{await fresh.close();}});
 await page.goto(origin);await page.waitForFunction(()=>!!window.runTopicReopening);report=await page.evaluate(()=>window.runTopicReopening());if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.stack??String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const afterHash=hash(),path=root+'/checks-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({...report,source,sourceHashBefore:beforeHash,sourceHashAfter:afterHash,stableSource:beforeHash===afterHash},null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,apiCalls:0}));}
