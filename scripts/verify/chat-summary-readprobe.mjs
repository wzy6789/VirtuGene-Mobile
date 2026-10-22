import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync,readFileSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const report={complete:false,phases:[],paidCalls:0};const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const phase of ['before','after']){
 const bundle=await build({entryPoints:['scripts/verify/chat-summary-readprobe.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"summary-readprobe"'},plugins:phase==='before'?[{name:'saved-summary-repo-only',setup(b){b.onLoad({filter:/session-repo\.ts$/},()=>({loader:'ts',contents:readFileSync('release/chat-summary-cas-20261018/before/session-repo.ts','utf8')}));}}]:[]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const context=await browser.newContext({permissions:[]});
 try{const origin=`http://127.0.0.1:${server.address().port}`;await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runSummaryReadProbe);const result=await page.evaluate(()=>window.runSummaryReadProbe());if(!result.complete)throw Error('Summary probe did not commit');report.phases.push({phase,...result});}
 finally{await context.close();await new Promise(r=>server.close(r));}
 }
 if(report.phases[0].reads['memorySourceTombstones.query'].returned!==8105||Object.entries(report.phases[1].reads).some(([name,read])=>name.startsWith('memorySourceTombstones.')&&(read.returned>0||read.valueTracking===false)))throw Error('Expected scoped suppression read comparison not observed');
 report.complete=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await browser.close();writeFileSync('release/chat-summary-cas-20261018/readprobe-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
