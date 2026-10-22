import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright'),root='release/chat-thread-identity-20261019';
const files=['src/db/continuity-repo.ts','src/db/chat-auxiliary-guard.ts','src/store/emotion-store.ts','src/lib/ai/context-consolidator.ts','src/vite-env.d.ts'];
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),hashes=()=>Object.fromEntries(files.map(path=>[path,hash(path)])),beforeHashes=hashes();
const compile=before=>build({entryPoints:['scripts/verify/chat-thread-identity.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":"http://127.0.0.1:1/blocked"}','import.meta.hot':'undefined',__APP_VERSION__:'"identity-stock-test"'},plugins:before?[{name:'five-frozen-identity-files',setup(builder){builder.onLoad({filter:/[\\/]src[\\/](?:db[\\/](?:continuity-repo|chat-auxiliary-guard)|store[\\/]emotion-store|lib[\\/]ai[\\/]context-consolidator)\.ts$/},args=>({contents:readFileSync(root+'/before/'+basename(args.path),'utf8'),loader:'ts'}));}}]:[]});
const current=await compile(false),before=await compile(true);let active=current.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?active:'<!doctype html><script src="/test.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const open=async()=>{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();page.setDefaultTimeout(60000);await page.goto(origin);await page.waitForFunction(()=>!!window.runIdentityStock);return {context,page};};
const report={complete:false,phases:[],checks:[],errors:[],apiCalls:0,sourceHashesBefore:beforeHashes};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
try{
 const prep=await open();let fixture;try{fixture=await prep.page.evaluate(()=>window.prepareIdentityStock());}finally{await prep.context.close();}
 const fixturePath=root+'/stock-fixture-'+Date.now()+'.json';writeFileSync(fixturePath,JSON.stringify(fixture));report.fixture={path:fixturePath,fileSha256:hash(fixturePath),nativeSha256:fixture.sha256,counts:Object.fromEntries(Object.entries(fixture.data.tables).filter(([,rows])=>rows.length).map(([name,rows])=>[name,rows.length]))};
 for(const [label,bundle]of [['before',before],['current',current]]){active=bundle.outputFiles[0].text;const {context,page}=await open();try{const result=await page.evaluate(fixture=>window.runIdentityStock(fixture),fixture);report.phases.push({label,...result});check(label+' three valid capture/commit samples',result.samples.length===3&&result.samples.every(sample=>sample.valid&&sample.written));}finally{await context.close();}}
 check('identical full original-message snapshots across before/current',new Set(report.phases.flatMap(phase=>phase.samples.map(sample=>sample.originalMessagesSha256))).size===1);
 for(const sample of report.phases[1].samples){check('current inventory contains exactly two observed open records',sample.inventory?.length===2);check('current does not read50000 unrelated closed thread bodies',Object.entries(sample.reads).filter(([name])=>name.startsWith('continuityThreads.')).reduce((sum,[,row])=>sum+row.bodies,0)<40);check('withdrawal reads do not scan8105 irrelevant rows',Object.entries(sample.reads).filter(([name])=>name.startsWith('memorySourceTombstones.')).reduce((sum,[,row])=>sum+row.bodies,0)<100);}
 const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
 report.summary=report.phases.map(phase=>({label:phase.label,captureMedianMs:median(phase.samples.map(sample=>sample.capturedMs)),wholeGuardMedianMs:median(phase.samples.map(sample=>sample.wholeGuardMs)),threadBodies:phase.samples.map(sample=>Object.entries(sample.reads).filter(([name])=>name.startsWith('continuityThreads.')).reduce((sum,[,row])=>sum+row.bodies,0))}));report.complete=true;
}catch(error){report.errors.push(error.stack??String(error));process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));report.sourceHashesAfter=hashes();report.stableSources=JSON.stringify(beforeHashes)===JSON.stringify(report.sourceHashesAfter);const path=root+'/stock-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks.length,summary:report.summary,errors:report.errors,apiCalls:0}));}
