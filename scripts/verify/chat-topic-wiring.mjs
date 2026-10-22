import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-topic-wiring.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"topic-wiring"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
let report;
try{const context=await browser.newContext({permissions:[]});const origin=`http://127.0.0.1:${server.address().port}`;await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();
 await page.exposeFunction('topicReloadProbe',async()=>{
  const fresh=await context.newPage();
  try{
   await fresh.goto(origin);await fresh.waitForFunction(()=>!!window.liveExpression?.resume);
   return await fresh.evaluate(async()=>{
    await window.liveExpression.resume();
    await window.liveExpression.turn('继续刚才的博物馆安排，时间和交通是什么？');
    const state=await window.liveExpression.resume();const plan=state.topics.find(t=>t.kind==='plan');
    const prompt=window.topicReloadCalls()[0].body.messages[0].content;
    return {date:plan.slots.date.value,time:plan.slots.time.value,transport:plan.slots.transport.value,promptSuppliedKnownSlots:prompt.includes('周六')&&prompt.includes('14点')&&prompt.includes('地铁')&&prompt.includes('[当前事项与结论]')};
   });
  }finally{await fresh.close();}
 });
 await page.goto(origin);await page.waitForFunction(()=>!!window.runTopicWiring);report=await page.evaluate(()=>window.runTopicWiring());console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,rows:report.rows.length,paidCalls:0}));}
catch(error){report={complete:false,error:error.message};process.exitCode=1;console.log(JSON.stringify(report));}
finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync('release/chat-topic-wiring-20261018/wiring-'+Date.now()+'.json',JSON.stringify(report,null,2));}
