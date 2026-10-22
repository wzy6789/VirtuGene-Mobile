import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright'),root='release/chat-thread-identity-20261019';mkdirSync(root,{recursive:true});
const files=['src/db/continuity-repo.ts','src/db/chat-auxiliary-guard.ts','src/store/emotion-store.ts','src/lib/ai/context-consolidator.ts','src/vite-env.d.ts'],hashes=()=>Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),before=hashes();
const built=await build({entryPoints:['scripts/verify/chat-thread-identity.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":"http://127.0.0.1:1/blocked"}','import.meta.hot':'undefined',__APP_VERSION__:'"thread-identity-test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?built.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runThreadIdentity);report=await page.evaluate(()=>window.runThreadIdentity());if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:error.stack??String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const after=hashes(),path=root+'/checks-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({...report,sourceHashesBefore:before,sourceHashesAfter:after,stableSources:JSON.stringify(before)===JSON.stringify(after),apiCalls:0},null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,apiCalls:0}));}
