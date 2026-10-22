import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const dir='.tmp-preview/voice-phrase-deadline-20261016/browser';mkdirSync(dir,{recursive:true});const reports=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const q=(rows,p)=>[...rows].sort((a,b)=>a-b)[Math.ceil(rows.length*p)-1];
try{
 for(const mode of ['before','after']){
  const bundle=await build({entryPoints:['scripts/verify/voice-phrase-deadline-browser.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-phrase-deadline-test"'},
   plugins:mode==='before'?[{name:'frozen-phrase-controller',setup(b){b.onLoad({filter:/voice-call[\\/](controller|utterance)\.ts$/},args=>({contents:readFileSync(`.tmp-preview/voice-phrase-deadline-20261016/before/${args.path.split(/[\\/]/).pop()}`,'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const context=await browser.newContext();
  try{
   const origin=`http://127.0.0.1:${server.address().port}`,page=await context.newPage();await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto(origin);await page.waitForFunction(()=>!!window.phraseDatabaseRun);
   assert.equal(await page.evaluate(()=>document.characterSet),'UTF-8');console.log(JSON.stringify({mode,started:true,onlyLocalOrigin:true,microphone:false}));
   const report=await page.evaluate(()=>window.phraseDatabaseRun());report.controllerHash=createHash('sha256').update(readFileSync(mode==='before'?'.tmp-preview/voice-phrase-deadline-20261016/before/controller.ts':'src/lib/voice-call/controller.ts')).digest('hex');
   reports.push(report);writeFileSync(`${dir}/${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({mode,rounds:report.rows.length,firstP50:q(report.rows.map(r=>r.firstFromTextMs),.5),firstP95:q(report.rows.map(r=>r.firstFromTextMs),.95),reads:[...new Set(report.rows.map(r=>r.reads.rows))]}));
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 for(let i=0;i<30;i++){const a=reports[0].rows[i],b=reports[1].rows[i];assert.equal(a.inputHash,b.inputHash);assert.equal(a.pcmHash,b.pcmHash);assert.equal(a.spokenHash,b.spokenHash);assert.equal(a.heard,b.heard);assert.deepEqual(a.counts,{dialogue:1,tts:1});assert.deepEqual(b.counts,{dialogue:1,tts:2});assert.ok(b.metrics.sourceCheckCount>=a.metrics.sourceCheckCount);}
 for(let i=0;i<30;i++){
  const a=reports[0].rows[i],b=reports[1].rows[i];
  assert.equal(b.metrics.sourceCheckCount-a.metrics.sourceCheckCount,4,'extra segment retains four fresh authorization checks');
  assert.equal(b.reads.rows-a.reads.rows,508,'additional reads are bounded per extra segment');
  assert.equal(b.reads.tables.messageHistorySearch,a.reads.tables.messageHistorySearch,'candidate history search is not repeated per segment');
  assert.equal(b.reads.tables.memorySourceTombstones-a.reads.tables.memorySourceTombstones,4,'fresh selected-source checks do not scan unrelated tombstones');
 }
 const summary=reports.map((report,i)=>({mode:i?'after':'before',rounds:30,firstFromText:{p50:q(report.rows.map(r=>r.firstFromTextMs),.5),p95:q(report.rows.map(r=>r.firstFromTextMs),.95)},firstFromSend:{p50:q(report.rows.map(r=>r.firstFromSendMs),.5),p95:q(report.rows.map(r=>r.firstFromSendMs),.95)},reads:[...new Set(report.rows.map(r=>r.reads.rows))],checks:[...new Set(report.rows.map(r=>r.metrics.sourceCheckCount))],ttsRequests:i?2:1}));
 writeFileSync(`${dir}/comparison.json`,JSON.stringify({summary,completeInputPcmAndSpokenTextUnchanged:true,dialogueRequestsUnchanged:true,ttsRequestsIncreased:true,apiCalls:0,microphone:false,androidRuntime:false,limitation:'Fixed simulated transport, 4x desktop CPU and synthetic stocked data. Additional TTS requests and fresh checks are reported; no actual provider cost/speed or physical sound guarantee.'},null,2));console.log(JSON.stringify({evidence:`${dir}/comparison.json`,summary}));
}finally{await browser.close();}
