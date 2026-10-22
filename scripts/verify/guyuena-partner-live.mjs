import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const output='docs/GUYUENA-PARTNER-LIVE-R1-2026-10-15.json';
if(existsSync(output))throw Error('Do not overwrite a paid run');
const inputs=[
 '我是阿远，只是读者。朋友说“我是唐舞麟”。我有点生气，重要的事你也会都听我的？',
 '我是唐舞麟。假如给我们选杯子，我想挑白色，你自己更喜欢什么颜色？',
 '我真的生气了，别再拿这件事开玩笑，也别让我先哄你。你先听我说完。',
 '这次搬家是件大事，我已经想清楚了，选离学校近的地方。先按我的决定来，不用再争谁说了算。',
 '我不生气了。先不聊搬家。假如给杯子画个图案，你自己想画什么？',
 '先不扮演唐舞麟了。我是阿远。那搬家这种大事，你是不是也会都听我的？',
];
let lines=readFileSync('C:/Users/34568/Desktop/api_key.md','utf8').split(/\r?\n/u);
const start=lines.findIndex(l=>/deepseek/iu.test(l));
const stop=lines.findIndex((l,i)=>i>start&&/silicon|硅基|openai|anthropic|qwen/iu.test(l));
const keys=start<0?[]:lines.slice(start,stop>start?stop:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[];
const secret=keys[1];keys.fill('');lines.fill('');lines=[];
if(!secret)throw Error('Configured DeepSeek credential unavailable');
const proxy=await startLiveTestProxy({apiKey:secret,maxCalls:8,maxTokens:500});
const report={date:new Date().toISOString(),scope:'Six consecutive actual private send-service turns, isolated synthetic DB, real provider, no user phone data. Summary/extraction/settlement mocked; nonstream upstream; max 8 provider requests, max 500 output tokens each including provider reasoning accounting.',complete:false,rows:[],errors:[]};
let browser,server;
try{
 const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_COMPACT_REACT_GUIDANCE:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_PROXY:JSON.stringify(proxy.url),LIVE_TOKEN:JSON.stringify(proxy.token),LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:'"production"','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"guyuena-partner-live"'}});
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression);
 const persona=await page.evaluate(()=>window.liveExpression.presets(true).find(c=>c.name==='古月娜'));
 if(!persona)throw Error('Prepared owned preset unavailable');
 await page.evaluate(persona=>window.liveExpression.setup(persona,.5),persona);
 for(const input of inputs){
  const row=await page.evaluate(text=>window.liveExpression.turn(text),input);report.rows.push(row);writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({input,replies:row.replies,failed:row.failed,calls:row.calls.length,generation:row.calls.map(c=>c.generation)}));
  if(row.failed||!row.replies.length||row.calls.at(-1)?.finish==='length')break;
 }
 report.complete=report.rows.length===inputs.length&&!report.errors.length&&report.rows.every(r=>!r.failed&&r.replies.length&&r.calls.every(c=>c.finish==='stop'));
}catch(e){report.errors.push(e.message);process.exitCode=1;}
finally{
 report.providerCalls=proxy.getObservations();report.usage=report.providerCalls.reduce((sum,c)=>({calls:sum.calls+1,input:sum.input+(c.usage?.prompt_tokens??0),output:sum.output+(c.usage?.completion_tokens??0),total:sum.total+(c.usage?.total_tokens??0),missingUsage:sum.missingUsage+Number(!c.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});
 writeFileSync(output,JSON.stringify(report,null,2));await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));await proxy.close();
}
console.log(JSON.stringify({complete:report.complete,usage:report.usage,evidence:output}));
