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
const output='docs/GLOBAL-CHAT-RETRIEVAL-LIVE-DEV-2026-10-12.json';
if(!keyFile||existsSync(output))throw Error('Explicit credential file and unused evidence path required');
const baseline=resolve('release/global-chat-baseline-2026-10-12');
if(!existsSync(join(baseline,'manifest.json')))throw Error('Saved source baseline required');
let credential=readFileSync(keyFile,'utf8');
const lines=credential.split(/\r?\n/u),start=lines.findIndex(line=>/deepseek/iu.test(line));
const end=lines.findIndex((line,index)=>index>start&&/silicon|硅基|openai|anthropic|qwen/iu.test(line));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
const apiKey=keys[Number(ordinal)-1];credential='';lines.fill('');keys.fill('');
if(!apiKey)throw Error('No configured DeepSeek credential');
const maxCalls=3,maxTotalTokens=16000,maxOutputTokens=500;
const ledger=createLiveUsageLedger({maxCalls,maxTotalTokens,maxOutputTokens});
const proxy=await startLiveTestProxy({apiKey,maxCalls,maxTokens:maxOutputTokens,fetchProvider:ledger.fetchProvider});
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const persona={name:'沈砚',tags:['克制','坦率'],greeting:'今天想聊什么？',signature:'先把问题看清楚。',systemPrompt:'你是沈砚，一位现代城市的普通读书会指导老师。许宁是参加读书会的成年学生，彼此是师生而非恋人。你说话清楚克制，有自己的意见，平等认真地对待许宁，不把每句话都变成训话或课程。许宁表达想念或信任可以自然回应，不强行变成恋爱，也不用每次声明关系规则。已有资料没有确认的经历或共同约定可以不知道。'};
const inputs=['还记得我们上次一起去书店时说好的事吗？'];
const seedCode=`
window.seedGlobalMemory=async()=>{
 const owner='isolated-live-expression-owner',characterId='isolated-live-role';
 const state=await stateRepo.getOrCreate(characterId,owner);
 await db.characterStates.put({...state,affinity:0,mood:70,tierNames:{'初识':'恋人'}});
 return {affinity:0,mood:70,tierNames:{'初识':'恋人'},sharedAgreementSeeded:false};
};`;
const report={date:new Date().toISOString(),split:'development',model:'deepseek-flash',scope:'One first-answer development probe through current production private send, with app-generated memory retrieval state. Same original mentor/student card, fresh isolated session, no seeded prior dialogue or bookstore agreement. A single unverified-past question, not long or held-out acceptance. Summaries/extraction/settlement mocked.',budget:{maxCalls,maxTotalTokens,maxOutputTokens},persona,inputs,configurationHash:createHash('sha256').update(JSON.stringify({persona,inputs,seedCode})).digest('hex'),versions:[],providerCalls:[],complete:false,errors:[]};
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [label,sourceRoot] of [['unverified-past-question',resolve('.')]]){
  const define={LIVE_PROXY:JSON.stringify(proxy.url),LIVE_TOKEN:JSON.stringify(proxy.token),LIVE_RESPONSES:'[]',LIVE_GENERATION_MODE:'"production"',LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_DEFER_DELIVERY:'false',LIVE_MINIMAL_TURN_GUIDANCE:'false',LIVE_COMPACT_REACT_GUIDANCE:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"test"'};
  const bundle=await build({stdin:{contents:`import ${JSON.stringify(join(sourceRoot,'scripts/verify/chat-human-live.ts'))}; import {db} from ${JSON.stringify(join(sourceRoot,'src/db/index.ts'))}; import {stateRepo} from ${JSON.stringify(join(sourceRoot,'src/db/state-repo.ts'))};${seedCode}`,resolveDir:resolve('.'),loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const context=await browser.newContext(),page=await context.newPage();
  const version={label,sourceRoot,rows:[],seed:undefined,errors:[]};report.versions.push(version);
  page.on('pageerror',error=>version.errors.push(error.message));
  try{
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression&&!!window.seedGlobalMemory);
   await page.evaluate(p=>window.liveExpression.setup(p),persona);
   version.seed=await page.evaluate(()=>window.seedGlobalMemory());
   for(const input of [inputs[0]]){
    const row=await page.evaluate(text=>window.liveExpression.turn(text),input);version.rows.push(row);
    report.providerCalls=proxy.getObservations();writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({label,turn:version.rows.length,replies:row.replies,failed:row.failed,calls:row.calls.length,totalTokens:ledger.snapshot().totalTokens}));
    if(row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length')||ledger.snapshot().usageMissing)break;
   }
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 report.complete=report.versions.length===1&&report.versions.every(v=>v.rows.length===1&&!v.errors.length&&v.rows.every(row=>!row.failed&&row.replies.length&&row.calls.every(call=>call.finish==='stop')));
}catch(error){report.errors.push(error.message);}finally{
 // Closing the proxy drains confirmed live upstream handlers before final accounting.
 await browser?.close();await proxy.close();await ledger.drain();
 report.providerCalls=proxy.getObservations();report.providerPayloads=ledger.records;report.usage=ledger.snapshot();
 writeFileSync(output,JSON.stringify(report,null,2));
}
if(report.usage.incomplete)report.complete=false;
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({complete:report.complete,usage:report.usage,evidence:output}));
if(!report.complete)process.exitCode=1;
