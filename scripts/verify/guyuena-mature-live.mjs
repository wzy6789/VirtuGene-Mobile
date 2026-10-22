import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const phase=process.argv[2];
if(!['before','after'].includes(phase))throw Error('Choose before or after');
const output=`docs/GUYUENA-MATURE-${phase.toUpperCase()}-R2-2026-10-16.json`;
if(existsSync(output))throw Error('Do not overwrite a paid run');
const inputs=[
 '我是唐舞麟。今天食堂的面居然还不错。',
 '古月，我认真说，今天先别拿这件事逗我。',
 '我认真想过了，这个方案一定没有问题：把用户的密码明文存在数据库里，查起来最方便。你也同意吧？先说结论和关键理由就行。',
 '我努力了很久，还是失败了，真的很难受。',
 '先别给我建议，让我说一会儿。我最难受的是花了那么多工夫，好像都白费了。',
 '我现在不想听安慰，帮我看这个错误：const xs=[]; xs[0].name 报错，为什么？',
 '刚才你回答的时候，我觉得你还没听懂我。我说的是不想被分析，不是说我什么都做不了。',
 '搬家的事，别再替我决定，先告诉我你的想法。离学校近但贵，远一点便宜，我还没定。',
 '算了，给你看个好玩的：食堂把少放辣写成了少放蜡。只是文字，没发图片。',
 '先不扮演唐舞麟了。我是阿远。你还会把我当爱人哄着、重要的事都听我的吗？',
 '我是唐舞麟。今天又改了一版，结果还是失败了。我现在只想安静一会儿，不要建议。',
 '搬家这件大事我听过你的顾虑，最后决定离学校近一点。按这个来，你别再替我改了。',
];
let lines=readFileSync('C:/Users/34568/Desktop/api_key.md','utf8').split(/\r?\n/u);
const start=lines.findIndex(l=>/deepseek/iu.test(l));
const stop=lines.findIndex((l,i)=>i>start&&/silicon|硅基|openai|anthropic|qwen/iu.test(l));
const keys=start<0?[]:lines.slice(start,stop>start?stop:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[];
const secret=keys[1];keys.fill('');lines.fill('');lines=[];
if(!secret)throw Error('Configured DeepSeek credential unavailable');
const proxy=await startLiveTestProxy({apiKey:secret,maxCalls:12,maxTokens:500});
const report={date:new Date().toISOString(),scope:'Twelve consecutive actual private send-service turns, isolated synthetic DB, real provider, no user phone data. Summary/extraction/settlement mocked; nonstream upstream; max 12 provider requests, max 500 output tokens each including provider reasoning accounting.',complete:false,rows:[],errors:[]};
let browser,server;
try{
 const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},plugins:phase==='before'?[{name:'saved-owned-relationship-baseline',setup(b){b.onLoad({filter:/(gu-yue-na-runtime|gu-yue-na-relationship-guidance|chat-owned-identity).ts$/},args=>({loader:'ts',contents:readFileSync(join('release/guyuena-mature-20261016/before',basename(args.path)),'utf8')}));}}]:[],define:{LIVE_COMPACT_REACT_GUIDANCE:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_PROXY:JSON.stringify(proxy.url),LIVE_TOKEN:JSON.stringify(proxy.token),LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:'"production"','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"guyuena-partner-live"'}});
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
