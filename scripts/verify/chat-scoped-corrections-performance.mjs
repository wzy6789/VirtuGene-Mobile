import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const reopening=process.argv.includes('--reopening');
const root=reopening?'release/chat-topic-reopening-20261019':'release/chat-scoped-corrections-20261019',production=reopening?['src/lib/chat-topic-outcomes.ts']:['src/lib/chat-topic-outcomes.ts','src/lib/chat-scoped-facts.ts','src/db/chat-topic-state-repo.ts','src/lib/memory-correction.ts'];
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),beforeHashes=Object.fromEntries(production.map(path=>[path,hash(path)]));
const beforeFilter=reopening?/[\\/]src[\\/]lib[\\/]chat-topic-outcomes\.ts$/:/[\\/]src[\\/](?:lib[\\/](?:chat-topic-outcomes|memory-correction)|db[\\/]chat-topic-state-repo)\.ts$/;
const compile=async before=>build({entryPoints:['scripts/verify/chat-scoped-corrections.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"scoped-stock-test"'},plugins:before?[{name:'frozen-pre-phase-files',setup(builder){builder.onLoad({filter:beforeFilter},args=>({contents:readFileSync(root+'/before/'+basename(args.path),'utf8'),loader:'ts'}));}}]:[]});
const currentBundle=await compile(false),beforeBundle=await compile(true);
let active=currentBundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?active:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const report={complete:false,phases:[],checks:[],apiCalls:0,fullPlanComplete:false,sourceHashesBefore:beforeHashes,errors:[]};
const open=async()=>{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();page.setDefaultTimeout(60000);await page.goto(origin);await page.waitForFunction(()=>!!window.runScopedStock);return {context,page};};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
try{
 const prep=await open();let ordinary,scoped;
 try{ordinary=await prep.page.evaluate(()=>window.prepareScopedStock(false));scoped=await prep.page.evaluate(()=>window.prepareScopedStock(true));}finally{await prep.context.close();}
 const fixturePath=root+'/stock-fixtures-'+Date.now()+'.json';writeFileSync(fixturePath,JSON.stringify({ordinary,scoped}));report.fixture={path:fixturePath,sha256:hash(fixturePath),ordinary:ordinary.fixtureSha256,scoped:scoped.fixtureSha256,counts:Object.fromEntries(Object.entries(ordinary.data.tables).filter(([,rows])=>rows.length).map(([table,rows])=>[table,rows.length]))};
 for(const [phase,bundle,fixture]of [['before-ordinary',beforeBundle,ordinary],['current-ordinary',currentBundle,ordinary],['current-scoped',currentBundle,scoped]]){
  active=bundle.outputFiles[0].text;const {context,page}=await open();
  try{const result=await page.evaluate(fixture=>window.runScopedStock(fixture),fixture);report.phases.push({phase,...result});check(phase+' three valid samples with identical full native import',result.samples.length===3&&result.samples.every(sample=>!sample.failed&&sample.replies.length&&sample.fixtureSha256===fixture.fixtureSha256));}
  finally{await context.close();}
 }
 const old=report.phases[0].samples,current=report.phases[1].samples;
 check('ordinary complete model messages identical across all before/current samples',new Set([...old,...current].map(sample=>sample.messagesSha256)).size===1);
 for(const phase of report.phases)for(const sample of phase.samples){
  const unrelated=Object.entries(sample.reads).filter(([key])=>/memorySourceTombstones/.test(key)).reduce((sum,[,value])=>sum+value.bodies,0);
  check(phase.phase+' scoped withdrawal reads stay below unrelated archive',unrelated<100);
 }
 const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
 report.summary=report.phases.map(phase=>({phase:phase.phase,firstRequestMedianMs:median(phase.samples.map(sample=>sample.firstRequestMs)),wholeMedianMs:median(phase.samples.map(sample=>sample.wholeMs)),bodyReads:phase.samples.map(sample=>Object.values(sample.reads).reduce((sum,row)=>sum+row.bodies,0)),withdrawalBodies:phase.samples.map(sample=>Object.entries(sample.reads).filter(([key])=>key.includes('memorySourceTombstones')).reduce((sum,[,row])=>sum+row.bodies,0))}));
 report.complete=true;
}catch(error){report.errors.push(error.stack??String(error));process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));report.sourceHashesAfter=Object.fromEntries(production.map(path=>[path,hash(path)]));report.stableSources=JSON.stringify(report.sourceHashesBefore)===JSON.stringify(report.sourceHashesAfter);const path=root+'/stock-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks.length,summary:report.summary,errors:report.errors,apiCalls:0}));}
