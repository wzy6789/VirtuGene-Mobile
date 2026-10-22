import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-summary-cas.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"summary-cas"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const context=await browser.newContext({permissions:[]});const origin=`http://127.0.0.1:${server.address().port}`;await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runSummaryCas);report=await page.evaluate(()=>window.runSummaryCas());console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,paidCalls:0}));}
catch(error){report={complete:false,error:error.message};process.exitCode=1;console.log(JSON.stringify(report));}
finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync('release/chat-summary-cas-20261018/cas-'+Date.now()+'.json',JSON.stringify(report,null,2));}
