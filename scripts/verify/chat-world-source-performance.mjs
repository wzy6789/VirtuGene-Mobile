import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-world-source-20261019',runId=Date.now();mkdirSync(root,{recursive:true});
const frozen=['src/lib/world/world-turn.ts','src/lib/world/world-context.ts','src/lib/world/world-ai-client.ts','src/lib/world/world-recall.ts','src/lib/character-history-recall.ts','src/lib/world/world-director.ts','src/lib/world/world-actor.ts','src/lib/world/world-narrator.ts','src/lib/world/world-consistency.ts','src/lib/world/world-settlement.ts'];
const files=[...frozen,'src/lib/world/world-source-guard.ts','src/lib/memory-source-snapshot.ts','scripts/verify/chat-world-source-races.ts','scripts/verify/chat-world-source-performance.mjs'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const hashes=()=>Object.fromEntries(files.map(path=>[path,hash(readFileSync(path))]));
const initial=hashes(),checks=[];const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
const compile=async before=>(await build({entryPoints:['scripts/verify/chat-world-source-races.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":"http://127.0.0.1:1/blocked"}','import.meta.hot':'undefined',__APP_VERSION__:'"world-source-stock"'},plugins:before?[{name:'world-source-before',setup(b){b.onLoad({filter:/[\\/]src[\\/].*\.ts$/},args=>{const path=frozen.find(path=>resolve(path)===resolve(args.path));if(path)return{loader:'ts',contents:readFileSync(root+'/before/'+path,'utf8')};});}}]:[]})).outputFiles[0].text;
let browser,report={complete:false,phases:[],checks,apiCalls:0,errors:[],sourceHashes:initial,snapshotPolicy:'Ten pre-phase source files vs current; all remaining files current. Identical full native DB fixture imported in each sample; not a release comparison.'},blocked=0;
async function page(code,run){
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[]});
 try{await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(blocked++,route.abort()));const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runWorldSourceStock==='function');return await run(page);}
 finally{await context.close();await new Promise(resolve=>server.close(resolve));}
}
const median=x=>x.toSorted((a,b)=>a-b)[Math.floor(x.length/2)];
try{
 const current=await compile(false),before=await compile(true);browser=await chromium.launch({channel:'chrome',headless:true});
 const prepared=await page(current,p=>p.evaluate(()=>window.prepareWorldSourceStock()));
 report.fixtureSha256=prepared.fixtureSha256;report.fixturePath=root+'/stock-fixture-'+runId+'.json';writeFileSync(report.fixturePath,JSON.stringify(prepared,null,2),{flag:'wx'});report.fixtureFileSha256=hash(readFileSync(report.fixturePath));
 check(hash(JSON.stringify(prepared.data))===prepared.fixtureSha256,'browser and node full fixture hashes match');
 for(const [phase,code] of [['before',before],['after',current]]){
  const result=await page(code,p=>p.evaluate(prepared=>window.runWorldSourceStock(prepared),prepared));check(result.complete,phase+' healthy three-sample actual world turns');
  for(const sample of result.samples){sample.payloadSha256=hash(JSON.stringify(sample.requests.map(row=>row.messages)));check(sample.fixtureSha256===prepared.fixtureSha256,phase+' identical imported native fixture');}
  const totals=sample=>Object.entries(sample.reads).reduce((out,[key,row])=>{const table=key.split(':')[1].split('.')[0],value=out[table]??={calls:0,bodies:0,keys:0,requestedKeys:0,cursorVisits:0};for(const field of Object.keys(value))value[field]+=row[field];return out;},{});
  const summary={firstRequestMs:median(result.samples.map(s=>s.requests[0].atMs)),directorRequestMs:median(result.samples.map(s=>s.requests.find(r=>r.stage==='director').atMs)),actorRequestMs:median(result.samples.map(s=>s.requests.find(r=>r.stage==='actor').atMs)),firstJSVisibleMs:median(result.samples.map(s=>s.firstVisibleMs)),wholeMs:median(result.samples.map(s=>s.totalMs)),reads:result.samples.map(totals)};
  report.phases.push({phase,...result,summary});console.log(JSON.stringify({phase,complete:result.complete,summary:{...summary,reads:summary.reads[0]}}));
 }
 for(let i=0;i<3;i++)check(report.phases[0].samples[i].payloadSha256===report.phases[1].samples[i].payloadSha256,'exact complete model messages before/after sample '+i);
 check(blocked===0,'no external network request');report.complete=true;
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
 await browser?.close();report.sourceHashesAfter=hashes();report.changedDuringRun=files.filter(file=>initial[file]!==report.sourceHashesAfter[file]);report.blockedRequests=blocked;if(report.changedDuringRun.length){report.complete=false;process.exitCode=1;}
 const path=root+'/stock-performance-'+runId+'.json';writeFileSync(path,JSON.stringify({...report,workingDirectory:process.cwd(),model:'未确认',reasoning:'未确认',limitations:'Desktop Chromium with 30ms local synthetic calls, three samples per phase; first JS publication is not decoded display or Android. Authorization read locks now include source dependencies; whole native read costs retained.'},null,2));console.log(JSON.stringify({path,complete:report.complete,errors:report.errors,changedDuringRun:report.changedDuringRun,apiCalls:0},null,2));
}
