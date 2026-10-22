import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const focus=process.argv.includes('--focus');
const retry=process.argv.includes('--retry');
const dailyStyle=process.argv.includes('--daily-style');
if([retry,focus,dailyStyle].filter(Boolean).length>1)throw Error('Choose a single frozen comparison phase');
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright'),root=dailyStyle?'release/chat-daily-style-20261019':retry?'release/chat-gu-retry-20261019':focus?'release/chat-continuity-focus-20261019':'release/chat-continuity-resume-20261019';
const files=dailyStyle?['src/lib/chat-expression-guidance.ts','src/lib/chat-humanizer.ts','src/lib/chat-emotional-expression.ts','src/lib/chat/send-service.ts']:retry?['src/db/index.ts','src/lib/chat/send-service.ts','src/db/chat-reply-attempt-repo.ts']:['src/db/index.ts','src/db/continuity-repo.ts','src/lib/continuity-sources.ts','src/lib/chat/send-service.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat-topic-controls.ts',...(focus?['src/db/chat-topic-state-repo.ts','src/lib/chat-conversation-state.ts']:[])];
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),hashes=()=>Object.fromEntries(files.map(path=>[path,hash(path)])),beforeHashes=hashes();
const beforeFilter=dailyStyle?/[\\/]src[\\/]lib[\\/]chat-expression-guidance\.ts$/:retry?/[\\/]src[\\/](?:db[\\/]index|lib[\\/]chat[\\/]send-service)\.ts$/:focus?/[\\/]src[\\/](?:db[\\/](?:index|continuity-repo|chat-topic-state-repo)|lib[\\/](?:continuity-sources|chat-topic-outcomes|chat-topic-controls|chat-conversation-state|chat[\\/]send-service))\.ts$/:/[\\/]src[\\/](?:db[\\/](?:index|continuity-repo)|lib[\\/](?:continuity-sources|chat-topic-outcomes|chat[\\/]send-service))\.ts$/;
const compile=before=>build({entryPoints:['scripts/verify/chat-continuity-resume.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"continuity-resume-stock"'},plugins:before?[{name:'frozen-before-files',setup(builder){builder.onLoad({filter:beforeFilter},args=>({contents:readFileSync(root+'/before/'+(retry||dailyStyle?'src/'+args.path.replaceAll('\\','/').split('/src/')[1]:basename(args.path)),'utf8'),loader:'ts'}));}}]:[]});
const before=await compile(true),current=await compile(false);let active=current.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?active:'<!doctype html><script src="/test.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const open=async()=>{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();page.setDefaultTimeout(60000);await page.goto(origin);await page.waitForFunction(()=>!!window.runResumeStock);return {context,page};};
const report={complete:false,phases:[],checks:[],errors:[],character:'古月娜',modelTransport:'local stub',apiCalls:0,fullPlanComplete:false,sourceHashesBefore:beforeHashes};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
try{
 const prep=await open();let fixture;try{fixture=await prep.page.evaluate(focus=>window.prepareResumeStock(focus),focus);}finally{await prep.context.close();}
 const path=root+'/stock-fixture-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(fixture));report.fixture={path,sha256:hash(path),nativeSha256:fixture.sha256,counts:Object.fromEntries(Object.entries(fixture.data.tables).filter(([,rows])=>rows.length).map(([table,rows])=>[table,rows.length]))};
 for(const [phase,bundle,resume,followup]of [['before-ordinary',before,false,false],['current-ordinary',current,false,false],[focus?'current-focus':'current-resume',current,!focus,focus]]){
  active=bundle.outputFiles[0].text;const {context,page}=await open();
  try{const result=await page.evaluate(({fixture,resume,followup})=>window.runResumeStock(fixture,resume,followup),{fixture,resume,followup});report.phases.push({phase,...result});check(phase+' three successful actual sends with identical full native import',result.samples.length===3&&result.samples.every(sample=>!sample.failed&&!sample.error&&sample.replies.length&&sample.fixtureSha256===fixture.sha256));}
  finally{await context.close();}
 }
 check('ordinary full main-chat model messages unchanged across before/current',new Set(report.phases.slice(0,2).flatMap(phase=>phase.samples.map(sample=>sample.messagesSha256))).size===1);
 for(const phase of report.phases.slice(1))for(const sample of phase.samples){
  check(phase.phase+' does not read50000 unrelated closed thread bodies',Object.entries(sample.reads).filter(([name])=>name.startsWith('continuityThreads.')).reduce((sum,[,value])=>sum+value.bodies,0)<40);
  check(phase.phase+' does not scan8105 unrelated withdrawals',Object.entries(sample.reads).filter(([name])=>name.startsWith('memorySourceTombstones.')).reduce((sum,[,value])=>sum+value.bodies,0)<100);
 }
 for(const sample of report.phases[2].samples){
  check(focus?'focus uses the selected primary ID without a new title lookup':'resume uses scoped exact-title native index',focus
   ?sample.reads['continuityThreads.get']?.calls>0&&!Object.values(sample.reads).some(row=>row.indexes.includes('[userId+characterId+title]'))
   :Object.values(sample.reads).some(row=>row.indexes.includes('[userId+characterId+title]')));
  check('resume retains the original record and supplies its fields',sample.thread?.status==='open'&&sample.messages.length===1&&JSON.stringify(sample.messages).includes('地铁'));
 }
 const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
 report.summary=report.phases.map(phase=>({phase:phase.phase,firstRequestMedianMs:median(phase.samples.map(sample=>sample.firstRequestMs)),wholeMedianMs:median(phase.samples.map(sample=>sample.wholeMs)),threadBodies:phase.samples.map(sample=>Object.entries(sample.reads).filter(([name])=>name.startsWith('continuityThreads.')).reduce((sum,[,value])=>sum+value.bodies,0)),withdrawalBodies:phase.samples.map(sample=>Object.entries(sample.reads).filter(([name])=>name.startsWith('memorySourceTombstones.')).reduce((sum,[,value])=>sum+value.bodies,0)),auxiliaryLocalCalls:phase.samples.map(sample=>sample.auxiliaryLocalCalls)}));
 report.complete=true;
}catch(error){report.errors.push(error.stack??String(error));process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));report.sourceHashesAfter=hashes();report.stableSources=JSON.stringify(beforeHashes)===JSON.stringify(report.sourceHashesAfter);const path=root+'/stock-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks.length,summary:report.summary,errors:report.errors,apiCalls:0}));}
