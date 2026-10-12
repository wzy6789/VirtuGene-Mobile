import {createLiveUsageLedger} from './live-usage-ledger.mjs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {startLiveTestProxy} from './live-test-proxy.mjs';

// Development comparison only. Never add these conversations to production examples.
const [keyFile,ordinal='2']=process.argv.slice(2);
const output='docs/GLOBAL-CHAT-MEMORY-LIVE-DEV-2026-10-12.json';
if(!keyFile||existsSync(output))throw Error('Explicit credential file and unused evidence path required');
const baseline=resolve('release/global-chat-baseline-2026-10-12');
if(!existsSync(join(baseline,'manifest.json')))throw Error('Saved source baseline required');
let credential=readFileSync(keyFile,'utf8');
const lines=credential.split(/\r?\n/u),start=lines.findIndex(line=>/deepseek/iu.test(line));
const end=lines.findIndex((line,index)=>index>start&&/silicon|硅基|openai|anthropic|qwen/iu.test(line));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
const apiKey=keys[Number(ordinal)-1];credential='';lines.fill('');keys.fill('');
if(!apiKey)throw Error('No configured DeepSeek credential');
const maxCalls=12,maxTotalTokens=80000,maxOutputTokens=500;
const ledger=createLiveUsageLedger({maxCalls,maxTotalTokens,maxOutputTokens});
const proxy=await startLiveTestProxy({apiKey,maxCalls,maxTokens:maxOutputTokens,fetchProvider:ledger.fetchProvider});
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const persona={name:'林舟',tags:['直率'],greeting:'来啦。',signature:'先弄清楚，再决定。',systemPrompt:'你是林舟，一位现代城市里的普通摄影爱好者。陈若是与你平等相处的朋友，不是恋人。你说话直率，喜欢具体的小事，有自己的选择，不把朋友当需要管理的人。没有告诉你的事情可以不知道，不编共同经历。'};
const inputs=['陈若：还记得我们北港散步的约定吗？具体是几点、在哪儿碰面？','我是有点想出去透口气，不用给我排什么计划。','你自己呢，更想慢慢走，还是沿路拍些照片？','那先这样，周五再聊。'];
const seedCode=`
window.seedGlobalMemory=async()=>{
 const owner='isolated-live-expression-owner',characterId='isolated-live-role',now=Date.now();
 const unrelated=Array.from({length:2},(_,i)=>({id:'legacy-long-pin-'+i,userId:owner,characterId,content:'陈若分享的工具收纳笔记'+i+'：'+'螺丝零件按尺寸存放，透明袋需要标记，抽屉标签记录盒子编号。'.repeat(40),type:'auto',pinned:true,createdAt:now,stability:'stable',memoryKind:'fact'}));
 const agreement={id:'older-north-port-agreement',userId:owner,characterId,content:'已确认的北港散步约定：陈若和林舟周五下午三点在北港旧钟楼碰面，沿岸慢慢走。'+ '这是已经约好的未来安排，不是已经发生的旅行；需要以原来的时间地点为准，不编出新的行程。'.repeat(3),type:'auto',memoryKind:'promise',createdAt:now-86400000,status:'active'};
 await db.memories.bulkPut([...unrelated,agreement]);return {ids:unrelated.map(m=>m.id).concat(agreement.id),contents:unrelated.map(m=>m.content).concat(agreement.content)};
};`;
const report={date:new Date().toISOString(),split:'development',model:'deepseek-flash',scope:'One untuned original friend, four consecutive turns per version; paired saved baseline/current production private send and isolated IndexedDB. Legacy long pinned records stress packing. Summaries/extraction/settlement mocked. Not full human-quality or held-out acceptance.',budget:{maxCalls,maxTotalTokens,maxOutputTokens},persona,inputs,configurationHash:createHash('sha256').update(JSON.stringify({persona,inputs,seedCode})).digest('hex'),versions:[],providerCalls:[],complete:false,errors:[]};
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [label,sourceRoot] of [['baseline',baseline],['candidate',resolve('.')]]){
  const define={LIVE_PROXY:JSON.stringify(proxy.url),LIVE_TOKEN:JSON.stringify(proxy.token),LIVE_RESPONSES:'[]',LIVE_GENERATION_MODE:'"production"',LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_DEFER_DELIVERY:'false',LIVE_MINIMAL_TURN_GUIDANCE:'false',LIVE_COMPACT_REACT_GUIDANCE:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"test"'};
  const bundle=await build({stdin:{contents:`import ${JSON.stringify(join(sourceRoot,'scripts/verify/chat-human-live.ts'))}; import {db} from ${JSON.stringify(join(sourceRoot,'src/db/index.ts'))};${seedCode}`,resolveDir:resolve('.'),loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const context=await browser.newContext(),page=await context.newPage();
  const version={label,sourceRoot,rows:[],seed:undefined,errors:[]};report.versions.push(version);
  page.on('pageerror',error=>version.errors.push(error.message));
  try{
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression&&!!window.seedGlobalMemory);
   await page.evaluate(p=>window.liveExpression.setup(p),persona);
   version.seed=await page.evaluate(()=>window.seedGlobalMemory());
   for(const input of inputs){
    const row=await page.evaluate(text=>window.liveExpression.turn(text),input);version.rows.push(row);
    report.providerCalls=proxy.getObservations();writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({label,turn:version.rows.length,replies:row.replies,failed:row.failed,calls:row.calls.length,totalTokens:ledger.snapshot().totalTokens}));
    if(row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length')||ledger.snapshot().usageMissing)break;
   }
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 report.complete=report.versions.length===2&&report.versions.every(v=>v.rows.length===inputs.length&&!v.errors.length&&v.rows.every(row=>!row.failed&&row.replies.length&&row.calls.every(call=>call.finish==='stop')));
}catch(error){report.errors.push(error.message);}finally{
 report.providerCalls=proxy.getObservations();report.providerPayloads=ledger.records;report.usage=ledger.snapshot();
 await browser?.close();await proxy.close();await ledger.drain();report.providerCalls=proxy.getObservations();report.providerPayloads=ledger.records;report.usage=ledger.snapshot();writeFileSync(output,JSON.stringify(report,null,2));
}
if(report.usage.incomplete)report.complete=false;
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({complete:report.complete,usage:report.usage,evidence:output}));
if(!report.complete)process.exitCode=1;
