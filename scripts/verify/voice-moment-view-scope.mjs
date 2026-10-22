import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const dir='.tmp-preview/voice-chain-speed-20261016/moment';mkdirSync(dir,{recursive:true});
const baseline='.tmp-preview/voice-chain-speed-20261016/before-moment/character-memory.ts';
const reports=[],browser=await chromium.launch({channel:'chrome',headless:true});
const q=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
try{
 for(const mode of ['before','after']){
  const source=readFileSync(mode==='before'?baseline:'src/lib/character-memory.ts','utf8');
  const bundle=await build({entryPoints:['scripts/verify/voice-moment-view-scope.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-speed-check"'},plugins:[{name:'frozen-memory',setup(b){b.onLoad({filter:/[\\/]lib[\\/]character-memory\.ts$/},args=>({contents:source,loader:'ts',resolveDir:dirname(args.path)}));}}]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext();
  try{
   const origin=`http://127.0.0.1:${server.address().port}`,page=await context.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto(origin);await page.waitForFunction(()=>!!window.voiceMomentViewScope);
   assert.equal(await page.evaluate(()=>document.characterSet),'UTF-8');console.log(JSON.stringify({mode,started:true}));
   const report=await page.evaluate(()=>window.voiceMomentViewScope());report.sourceHash=createHash('sha256').update(source).digest('hex');
   reports.push(report);writeFileSync(`${dir}/${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({mode,rows:report.rows.length,checks:report.checks.length}));
  }finally{await context.close();await new Promise(r=>server.close(r));}
 }
 assert.equal(reports[0].rows.length,90);assert.equal(reports[1].rows.length,90);
 for(let i=0;i<90;i++){const a=reports[0].rows[i],b=reports[1].rows[i];assert.equal(a.hash,b.hash);assert.deepEqual(a.ids,b.ids);assert.ok(b.reads.tables.momentViews<a.reads.tables.momentViews);}
 assert.deepEqual(reports[0].checks,reports[1].checks);
 const summary=reports.map((r,i)=>({mode:i?'after':'before',modes:['ordinary','explicit','shared'].map(name=>{const rows=r.rows.filter(row=>row.mode===name);return {name,rounds:rows.length,p50:q(rows.map(r=>r.elapsedMs),.5),p95:q(rows.map(r=>r.elapsedMs),.95),viewReads:[...new Set(rows.map(r=>r.reads.tables.momentViews))]};})}));
 writeFileSync(`${dir}/comparison.json`,JSON.stringify({passed:true,summary,allReferenceContextHashesEqual:true,controlChecks:reports[0].checks.length,apiCalls:0,androidRuntime:false,scope:reports[0].scope},null,2));console.log(JSON.stringify({summary,evidence:`${dir}/comparison.json`}));
}catch(error){writeFileSync(`${dir}/failed-${Date.now()}.txt`,String(error.stack??error));throw error;}
finally{await browser.close();}
