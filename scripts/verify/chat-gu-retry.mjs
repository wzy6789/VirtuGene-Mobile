import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const files=['src/db/index.ts','src/lib/chat/send-service.ts','src/db/chat-reply-attempt-repo.ts'];
const hashes=()=>Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),before=hashes();
const bundle=await build({entryPoints:['scripts/verify/chat-gu-retry.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"gu-retry"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runGuRetry);report=await page.evaluate(()=>window.runGuRetry());if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:error.stack??String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const after=hashes(),path='release/chat-gu-retry-20261019/checks-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({...report,sourceHashesBefore:before,sourceHashesAfter:after,stableSources:JSON.stringify(before)===JSON.stringify(after)},null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,paidCalls:0}));}
