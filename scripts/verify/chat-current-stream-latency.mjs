import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=resolve('release/chat-current-stream-latency-'+Date.now());mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/chat-current-stream-latency.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},
  define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"stream-latency-test"'},
  plugins:[{name:'observe-native-publication',setup(builder){builder.onLoad({filter:/chat-continuity-resume\.ts$/},args=>{
    const text=readFileSync(args.path,'utf8'),needle='new ChatReplyStream(sessionId,()=>undefined)';
    assert.equal(text.split(needle).length,2);return {loader:'ts',contents:text.replace(needle,'new ChatReplyStream(sessionId,()=>{(window as any).__latencyPublication?.();})')};
  });}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright'),browser=await chromium.launch({channel:'chrome',headless:true});
const paths=Object.keys(bundle.metafile.inputs).filter(path=>path.startsWith('src/')||path.startsWith('server/'));
const hashes=()=>Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const report={complete:false,checks:[],paidCalls:0,errors:[],productionHashesBefore:hashes(),codingModel:'未确认',codingReasoning:'未确认'};
try{
  const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(origin);await page.waitForFunction(()=>!!window.runCurrentStreamLatency);
  Object.assign(report,await page.evaluate(()=>window.runCurrentStreamLatency()));
  const check=(name,ok)=>{report.checks.push({name,ok:!!ok});assert.ok(ok,name);};
  for(const sample of report.samples){
    check(sample.name+' one main call, no failure, two real saved reply rows',sample.mainCalls===1&&!sample.failed&&!sample.error&&sample.replies.length===2);
    check(sample.name+' thinking remains enabled/low',sample.generation.thinking?.type==='enabled'&&sample.generation.reasoning_effort==='low');
    check(sample.name+' first body arrives well before completion',sample.completeBodyMs-sample.firstBodyMs>1100);
    check(sample.name+' publication time captured',Number.isFinite(sample.firstPublicationMs));
  }
  report.productionHashesAfter=hashes();
  check('production sources unchanged',JSON.stringify(report.productionHashesBefore)===JSON.stringify(report.productionHashesAfter));
  check('no uncaught page errors',report.errors.length===0);report.complete=true;
}catch(error){report.errors.push(error.stack??String(error));process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,samples:report.samples,errors:report.errors,evidence:join(out,'report.json'),paidCalls:0}));}
