import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {writeFileSync} from 'node:fs';
const output=process.argv[2]??'docs/HISTORY-SEARCH-INDEX-CHECKS-2026-10-13.json';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/history-search-index.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
let report;
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.historyIndexChecks);report=await page.evaluate(async()=>{try{return await window.historyIndexChecks();}catch(error){throw Error(error.name+': '+error.message+'\n'+error.stack);}});}
catch(e){report={complete:false,error:e.message};process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
