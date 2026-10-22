import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='release/chat-reply-source-question-20261019',files=['src/lib/chat-humanizer.ts','src/lib/chat-turn-cues.ts'];
const hash=value=>createHash('sha256').update(value).digest('hex'),hashes=()=>Object.fromEntries(files.map(p=>[p,hash(readFileSync(p))])),sourcesBefore=hashes();
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const compile=frozen=>build({entryPoints:['scripts/verify/chat-continuity-resume.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"source-question-stock"'},plugins:frozen?[{name:'frozen-before-source-question',setup(builder){for(const p of files)builder.onLoad({filter:new RegExp(p.replaceAll('/','[\\\\/]')+'$')},()=>({loader:'ts',contents:readFileSync(join(root,'before',p),'utf8')}));}}]:[]});
const before=await compile(true),current=await compile(false);let active=current.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?active:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const open=async()=>{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runResumeStock);return {context,page};};
const report={complete:false,scope:'Same full synthetic native database; captured real sender requests, local fixed transport only. Preparation is send-to-request, not visible UI or Android time.',phases:[],checks:[],paidCalls:0,sourceHashesBefore:sourcesBefore};
const check=(name,value)=>{assert.ok(value,name);report.checks.push({name,ok:true});};
try{
 const prep=await open();let fixture;
 try{fixture=await prep.page.evaluate(()=>window.prepareResumeStock(false,[{id:'source-question-stock-original',role:'user',content:'古月，我是唐舞麟。今天的锻造总算忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？',revision:1,createdAt:Date.now()+100,isProactive:false},{id:'source-question-stock-unsupported',role:'assistant',content:'舞麟，累不累？先歇一会儿吧。我这边没什么大事，就是院子里那株花今天开得特别好，颜色我很喜欢，想指给你看看。',revision:1,createdAt:Date.now()+101,isProactive:false}]));}
 finally{await prep.context.close();}
 const fixturePath=root+'/stock-fixture-'+Date.now()+'.json';writeFileSync(fixturePath,JSON.stringify(fixture));report.fixture={path:fixturePath,sha256:fixture.sha256,counts:Object.fromEntries(Object.entries(fixture.data.tables).filter(([,rows])=>rows.length).map(([name,rows])=>[name,rows.length]))};
 for(const [phase,bundle]of [['before',before],['current',current]]){
  active=bundle.outputFiles[0].text;const run=await open();
  try{const data=await run.page.evaluate(fixture=>window.runResumeStock(fixture,false,false,'古月，我想听你的心里话，不用特意找件新鲜事逗我开心。那株花如果只是你想象的，就直说。能这样和你聊会儿，我已经很高兴了。'),fixture);report.phases.push({phase,...data});check(phase+' three complete native sends use the same whole fixture',data.samples.length===3&&data.samples.every(s=>!s.failed&&!s.error&&s.replies.length&&s.fixtureSha256===fixture.sha256));}
  finally{await run.context.close();}
 }
 for(let i=0;i<3;i++){
  const a=report.phases[0].samples[i],b=report.phases[1].samples[i];
  check('sample'+i+' non-system history and user input byte-identical',JSON.stringify(a.messages.map(ms=>ms.filter(m=>m.role!=='system')))===JSON.stringify(b.messages.map(ms=>ms.filter(m=>m.role!=='system'))));
  check('sample'+i+' evidence cue absent before and present now',!JSON.stringify(a.messages).includes('[本轮经历核对]')&&JSON.stringify(b.messages).includes('[本轮经历核对]'));
  check('sample'+i+' no new native reads, keys, queries or index changes',JSON.stringify(a.reads)===JSON.stringify(b.reads));
  check('sample'+i+' no increase in auxiliary local requests',a.auxiliaryLocalCalls===b.auxiliaryLocalCalls);
  check('sample'+i+' unrelated tombstone bodies below100',Object.entries(b.reads).filter(([k])=>k.startsWith('memorySourceTombstones.')).reduce((n,[,r])=>n+r.bodies,0)<100);
 }
 const median=values=>values.toSorted((a,b)=>a-b)[1];
 report.timing=report.phases.map(p=>({phase:p.phase,firstRequestMs:p.samples.map(s=>s.firstRequestMs),medianMs:median(p.samples.map(s=>s.firstRequestMs)),wholeMs:p.samples.map(s=>s.wholeMs)}));report.complete=true;
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));report.sourceHashesAfter=hashes();report.stableSources=JSON.stringify(sourcesBefore)===JSON.stringify(report.sourceHashesAfter);const path=root+'/stock-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks.length,error:report.error,timing:report.timing,paidCalls:0}));}
