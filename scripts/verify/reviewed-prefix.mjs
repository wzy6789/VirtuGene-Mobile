import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const files=['src/lib/chat/reviewed-prefix.ts','src/lib/chat/output-contract.ts','src/lib/chat-output-quality.ts','src/db/index.ts','src/db/chat-reply-attempt-repo.ts','src/lib/chat-topic-replies.ts'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const sourceHashesBefore=hashes();
const bundle=await build({entryPoints:['scripts/verify/reviewed-prefix.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"prefix-prototype"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});let report,external=0;
try{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external++;return route.abort();});const page=await context.newPage();await page.goto(origin);report=await page.evaluate(()=>window.runReviewedPrefix());}
catch(error){report={complete:false,error:String(error)};}
finally{await browser.close();await new Promise(r=>server.close(r));}
const root='release/chat-core-implementation-20261021/output';mkdirSync(root,{recursive:true});const path=join(root,'prefix-'+Date.now()+'.json');
writeFileSync(path,JSON.stringify({...report,sourceHashesBefore,sourceHashesAfter:hashes(),externalRequests:external,apiCalls:0,microphoneUsed:false,deviceTested:false},null,2));
console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(c=>c.name),error:report.error},null,2));if(!report.complete)process.exitCode=1;
