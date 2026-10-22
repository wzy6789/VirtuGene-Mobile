import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const before=process.argv.includes('--before'),root='release/chat-archive-incremental-20261019';
mkdirSync(root,{recursive:true});
const appliedSourceHashes={};
const bundle=await build({entryPoints:['scripts/verify/chat-auxiliary-window.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-auxiliary-window"'},plugins:[{name:'record-actual-source-bytes',setup(b){b.onLoad({filter:/(chat-auxiliary-guard|chat-archive-reader|message-repo)\.ts$/},args=>{const archived=before&&args.path.endsWith('chat-auxiliary-guard.ts'),contents=readFileSync(archived?root+'/before/chat-auxiliary-guard.ts':args.path,'utf8');appliedSourceHashes[args.path]={sha256:createHash('sha256').update(contents).digest('hex'),source:archived?'archived auxiliary guard':'current source'};return {loader:'ts',contents};});}}]});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{
 const context=await browser.newContext({permissions:[]}),origin=`http://127.0.0.1:${server.address().port}`;
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runAuxiliaryWindow==='function');
 report=await page.evaluate(async()=>{try{return await window.runAuxiliaryWindow();}catch(error){throw Error(JSON.stringify({name:error.name,message:error.message,inner:error.inner?.message,stack:error.stack}));}});
 console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),paidCalls:0}));
 if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.message};process.exitCode=1;console.log(JSON.stringify(report));}
finally{
 await browser.close();await new Promise(r=>server.close(r));
 const hashes=Object.fromEntries(['src/db/chat-auxiliary-guard.ts','src/db/chat-archive-reader.ts','src/db/message-repo.ts','scripts/verify/chat-auxiliary-window.ts'].flatMap(path=>{try{return [[path,createHash('sha256').update(readFileSync(resolve(path))).digest('hex')]];}catch{return [];}}));
 writeFileSync(`${root}/auxiliary-${before?'before':'after'}-${Date.now()}.json`,JSON.stringify({...report,before,hashes,appliedSourceHashes,bundleSha256:createHash('sha256').update(code).digest('hex')},null,2));
}
