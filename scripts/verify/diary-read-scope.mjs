import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const files=['src/db/index.ts','src/db/diary-repo.ts'],hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),before=hashes();
const bundle=await build({entryPoints:['scripts/verify/diary-read-scope.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"diary-read-scope"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);report=await page.evaluate(()=>window.runDiaryReadScope());}
catch(error){report={complete:false,error:String(error)};}finally{await browser.close();await new Promise(r=>server.close(r));}
const root='release/chat-core-implementation-20261021/performance';mkdirSync(root,{recursive:true});const path=join(root,'diary-scope-'+Date.now()+'.json');writeFileSync(path,JSON.stringify({...report,sourceHashesBefore:before,sourceHashesAfter:hashes()},null,2));
console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(c=>c.name),initialBodies:report.initialBodies,emptyBodies:report.emptyBodies,upgradeMs:report.upgradeMs,error:report.error},null,2));if(!report.complete)process.exitCode=1;
