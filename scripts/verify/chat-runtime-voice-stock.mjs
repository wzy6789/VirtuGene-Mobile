import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='release/chat-runtime-voice-echo-20261019',files=['src/lib/chat-owned-judgment-compaction.ts','src/lib/gu-yue-na-runtime.ts'];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),hashes=()=>Object.fromEntries(files.map(p=>[p,hash(p)])),beforeHashes=hashes();
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const compile=frozen=>build({entryPoints:['scripts/verify/chat-runtime-voice-stock.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"runtime-voice-stock"'},plugins:frozen?[{name:'frozen-runtime-voice',setup(builder){for(const p of files)builder.onLoad({filter:new RegExp(p.replaceAll('/','[\\\\/]')+'$')},()=>({loader:'ts',contents:readFileSync(join(root,'before',p),'utf8')}));}}]:[]});
const before=await compile(true),current=await compile(false);let active=current.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?active:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const open=async()=>{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.prepareRuntimeVoiceStock);return {context,page};};
const report={complete:false,scope:'Same entire synthetic native database and original user input; only the app-owned exact judgment echo compactor changes. Fixed local transport, not Android/TTFT/presented-frame measurement.',phases:[],checks:[],paidCalls:0,sourceHashesBefore:beforeHashes};
const check=(name,value)=>{assert.ok(value,name);report.checks.push({name,ok:true});};
try{
 const prep=await open();let fixture;try{fixture=await prep.page.evaluate(()=>window.prepareRuntimeVoiceStock());}finally{await prep.context.close();}
 const path=root+'/stock-fixture-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(fixture));report.fixture={path,sha256:fixture.sha256,counts:Object.fromEntries(Object.entries(fixture.data.tables).filter(([,rows])=>rows.length).map(([name,rows])=>[name,rows.length]))};
 for(const [phase,bundle]of [['before',before],['current',current]]){
  active=bundle.outputFiles[0].text;const run=await open();
  try{const data=await run.page.evaluate(fixture=>window.runResumeStock(fixture,false,false,'古月，我是唐舞麟。今天的锻造总算忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？'),fixture);report.phases.push({phase,...data});check(phase+' three actual sends use identical complete native stock',data.samples.length===3&&data.samples.every(s=>!s.failed&&!s.error&&s.replies.length&&s.fixtureSha256===fixture.sha256));}
  finally{await run.context.close();}
 }
 for(let i=0;i<3;i++){
  const a=report.phases[0].samples[i],b=report.phases[1].samples[i];
  check('sample'+i+' exact non-system history and user input preserved',JSON.stringify(a.messages.map(ms=>ms.filter(m=>m.role!=='system')))===JSON.stringify(b.messages.map(ms=>ms.filter(m=>m.role!=='system'))));
  check('sample'+i+' native body/key/query/index read counts unchanged',JSON.stringify(a.reads)===JSON.stringify(b.reads));
  check('sample'+i+' auxiliary local request count unchanged',a.auxiliaryLocalCalls===b.auxiliaryLocalCalls);
  const sa=a.messages[0].find(m=>m.role==='system').content,sb=b.messages[0].find(m=>m.role==='system').content;
  const card=s=>s.match(/\[人物声音卡\][\s\S]*?\[\/人物声音卡\]/u)?.[0];
  check('sample'+i+' final complete voice card remains byte-identical',card(sa)===card(sb));
  check('sample'+i+' actual system becomes shorter',sb.length<sa.length);
 }
 const median=v=>v.toSorted((a,b)=>a-b)[1];report.timing=report.phases.map(p=>({phase:p.phase,firstRequestMs:p.samples.map(s=>s.firstRequestMs),medianMs:median(p.samples.map(s=>s.firstRequestMs)),wholeMs:p.samples.map(s=>s.wholeMs),systemChars:p.samples.map(s=>s.messages[0].find(m=>m.role==='system').content.length)}));report.complete=true;
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));report.sourceHashesAfter=hashes();report.stableSources=JSON.stringify(beforeHashes)===JSON.stringify(report.sourceHashesAfter);const path=root+'/stock-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks.length,error:report.error,timing:report.timing,paidCalls:0}));}
