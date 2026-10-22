import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const rounds=process.argv.includes('--smoke')?1:30;
const sessionCount=process.argv.includes('--sessions')?Number(process.argv[process.argv.indexOf('--sessions')+1]):128;
assert.ok(Number.isInteger(sessionCount)&&sessionCount>0&&sessionCount<=20000);
const dir=`.tmp-preview/voice-chain-speed-20261016/chain/sessions-${sessionCount}`+(rounds===1?'/smoke':'');mkdirSync(dir,{recursive:true});
const reports=[],browser=await chromium.launch({channel:'chrome',headless:true});const q=(v,p)=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*p)-1];
try{
 for(const mode of ['before','after']){
  const source=readFileSync(mode==='before'?'.tmp-preview/voice-chain-speed-20261016/before/character-memory.ts':'src/lib/character-memory.ts','utf8');
  const history=readFileSync(mode==='before'?'.tmp-preview/voice-chain-speed-20261016/before/chat-history-index.ts':'src/lib/chat-history-index.ts','utf8');
  const bundle=await build({entryPoints:['scripts/verify/voice-chain-speed.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-chain-speed"'},plugins:[{name:'selected-memory',setup(b){b.onLoad({filter:/[\\/]lib[\\/](character-memory|chat-history-index)\.ts$/},args=>({contents:args.path.endsWith('character-memory.ts')?source:history,loader:'ts',resolveDir:dirname(args.path)}));}}]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext();
  try{
   const page=await context.newPage(),origin=`http://127.0.0.1:${server.address().port}`;await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto(origin);await page.waitForFunction(()=>!!window.voiceChainSpeed);
   assert.equal(await page.evaluate(()=>document.characterSet),'UTF-8');console.log(JSON.stringify({mode,started:true}));
   const report=await page.evaluate(({rounds,sessionCount})=>window.voiceChainSpeed(rounds,sessionCount),{rounds,sessionCount});report.memorySourceHash=createHash('sha256').update(source).digest('hex');report.historySourceHash=createHash('sha256').update(history).digest('hex');reports.push(report);writeFileSync(`${dir}/${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({mode,rounds:report.rows.length,firstP50:q(report.rows.map(r=>r.firstFromSendMs),.5)}));
  }finally{await context.close();await new Promise(r=>server.close(r));}
 }
 for(let i=0;i<rounds;i++){const a=reports[0].rows[i],b=reports[1].rows[i];assert.equal(a.inputHash,b.inputHash);assert.equal(a.pcmHash,b.pcmHash);assert.equal(a.spokenHash,b.spokenHash);assert.equal(a.heard,b.heard);assert.deepEqual(a.requests,b.requests);assert.equal(a.metrics.sourceCheckCount,b.metrics.sourceCheckCount);assert.ok(b.reads.rows<a.reads.rows);}
 for(let i=0;i<rounds;i++){
  const a=reports[0].rows[i].readWork,b=reports[1].rows[i].readWork;
  assert.equal(a.rows-b.rows,10000,'only unrelated moment view bodies are removed');
  assert.ok(b.keys<a.keys&&b.requests<a.requests,'index work and requests actually decrease');
  for(const table of ['messages','memories','characterKnowledge','memorySourceTombstones'])assert.deepEqual(a.tables[table],b.tables[table],'necessary source bodies are unchanged: '+table);
  assert.equal(a.tables.sessions.rows,b.tables.sessions.rows,'key-only authorization adds no session body clones');
 }
 const summary=reports.map((r,i)=>({mode:i?'after':'before',rounds,sendToFirstPcm:{p50:q(r.rows.map(r=>r.firstFromSendMs),.5),p95:q(r.rows.map(r=>r.firstFromSendMs),.95)},context:{p50:q(r.rows.map(r=>r.metrics.contextPreparationMs),.5),p95:q(r.rows.map(r=>r.metrics.contextPreparationMs),.95)},sourceCheck:{p50:q(r.rows.map(r=>r.metrics.sourceCheckMs),.5),p95:q(r.rows.map(r=>r.metrics.sourceCheckMs),.95)},reads:[...new Set(r.rows.map(r=>r.reads.rows))],sourceChecks:[...new Set(r.rows.map(r=>r.metrics.sourceCheckCount))],requests:r.rows[0].requests}));
 for(let i=0;i<summary.length;i++)summary[i].databaseWork={bodyRows:[...new Set(reports[i].rows.map(r=>r.readWork.rows))],indexKeys:[...new Set(reports[i].rows.map(r=>r.readWork.keys))],requests:[...new Set(reports[i].rows.map(r=>r.readWork.requests))]};
 writeFileSync(`${dir}/comparison.json`,JSON.stringify({passed:true,summary,allInputPcmHeardHashesEqual:true,modelRequestCountsEqual:true,sourceCheckCountsEqual:true,apiCalls:0,microphone:false,androidRuntime:false,scope:reports[0].scope},null,2));console.log(JSON.stringify({summary,evidence:`${dir}/comparison.json`}));
}catch(error){writeFileSync(`${dir}/failed-${Date.now()}.txt`,String(error.stack??error));throw error;}
finally{await browser.close();}
