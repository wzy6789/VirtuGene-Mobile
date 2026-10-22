import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const dir='.tmp-preview/voice-segment-playback-20261015', reports=[];
const afterOnly=process.argv.includes('--after-only');
if(afterOnly) reports.push(JSON.parse(readFileSync(`${dir}/browser-before.json`,'utf8')));
const browser=await chromium.launch({channel:'chrome',headless:true});
const q=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
try{
  for(const mode of afterOnly?['after']:['before','after']){
    const controllerHash=createHash('sha256').update(readFileSync(mode==='before'?`${dir}/before/controller.ts`:'src/lib/voice-call/controller.ts')).digest('hex');
    const bundle=await build({entryPoints:['scripts/verify/voice-segment-browser.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-segment-test"'},
      plugins:mode==='before'?[{name:'controller-before-segment-queue',setup(b){b.onLoad({filter:/voice-call[\\/]controller\.ts$/},args=>({contents:readFileSync(`${dir}/before/controller.ts`,'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});
    const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const context=await browser.newContext();
    try{
      const origin=`http://127.0.0.1:${server.address().port}`,page=await context.newPage();
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      await page.goto(origin);await page.waitForFunction(()=>!!window.segmentDatabaseRun);
      const encoding=await page.evaluate(()=>document.characterSet);assert.equal(encoding,'UTF-8');
      console.log(JSON.stringify({mode,documentEncoding:encoding}));
      const report=await page.evaluate(()=>window.segmentDatabaseRun());report.controllerHash=controllerHash;reports.push(report);
      writeFileSync(`${dir}/browser-${mode}.json`,JSON.stringify(report,null,2));
      console.log(JSON.stringify({mode,rounds:report.rows.length,gapP50:q(report.rows.map(r=>r.gapMs),.5),gapP95:q(report.rows.map(r=>r.gapMs),.95),rows:[...new Set(report.rows.map(r=>r.reads.rows))]}));
    }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
  }
  for(let i=0;i<30;i++){
    const a=reports[0].rows[i],b=reports[1].rows[i];assert.equal(a.inputHash,b.inputHash);assert.deepEqual(a.counts,b.counts);assert.equal(a.heard,b.heard);
    // A large packet split at the leading budget may add one fresh check, never remove one.
    assert.ok(b.sourceChecks>=a.sourceChecks);
  }
  writeFileSync(`${dir}/browser-comparison.json`,JSON.stringify({summary:reports.map((r,i)=>({mode:i?'after':'before',rounds:30,gap:{p50:q(r.rows.map(x=>x.gapMs),.5),p95:q(r.rows.map(x=>x.gapMs),.95)},elapsed:{p50:q(r.rows.map(x=>x.elapsedMs),.5)},reads:[...new Set(r.rows.map(x=>x.reads.rows))],checks:[...new Set(r.rows.map(x=>x.sourceChecks))]})),fullInputHashUnchanged:true,modelRequestsUnchanged:true,heardUnchanged:true,apiCalls:0,
    limitation:'Source check split overhead is reported, not hidden. Desktop stocked IndexedDB and simulated audio/network are not Android or physical sound.'},null,2));
}finally{await browser.close();}
