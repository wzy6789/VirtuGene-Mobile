import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-topic-state-races.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
let report;
try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.runTopicStateRaces);report=await page.evaluate(async()=>{try{return await window.runTopicStateRaces();}catch(error){return {complete:false,error:{name:error.name,message:error.message,stack:error.stack,inner:error.inner?{name:error.inner.name,message:error.inner.message}:undefined}};}});if(!report.complete)process.exitCode=1;console.log(JSON.stringify({complete:report.complete,checks:report.checks?.length,error:report.error,paidCalls:0}));}
catch(error){report={complete:false,error:error.message};process.exitCode=1;console.log(JSON.stringify(report));}
finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync('release/chat-topic-outcomes-20261018/races-'+Date.now()+'.json',JSON.stringify(report,null,2));}
