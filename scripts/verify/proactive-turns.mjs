import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-core-implementation-20261021',before=process.argv.includes('--before');
const files=['src/store/chat-store.ts','src/pages/ChatPage.tsx','src/lib/ai/proactive-chat.ts','src/lib/chat/request-coordinator.ts','src/lib/chat-composer-drafts.ts','src/db/index.ts'];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const hashes=()=>Object.fromEntries(files.map(p=>[p,hash(p)]));
const sourceHashesBefore=hashes();
const bundle=await build({entryPoints:['scripts/verify/proactive-turns.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"proactive-verification"'},plugins:before?[{name:'frozen-proactive-baseline',setup(b){b.onLoad({filter:/[\\/]src[\\/].*\.tsx?$/},args=>{const source=files.find(p=>resolve(p)===resolve(args.path));if(source&&existsSync(join(root,'before',source)))return {loader:source.endsWith('tsx')?'tsx':'ts',contents:readFileSync(join(root,'before',source),'utf8')};});}}]:[]});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
let report,external=0;const origin='http://127.0.0.1:'+server.address().port;
try{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external++;return route.abort();});const page=await context.newPage();
await page.exposeFunction('probeProactiveReload',async()=>{const fresh=await context.newPage();try{await fresh.goto(origin);await fresh.waitForFunction(()=>!!window.resumeProactiveVisit);return await fresh.evaluate(()=>window.resumeProactiveVisit());}finally{await fresh.close();}});
await page.goto(origin);await page.waitForFunction(()=>!!window.runProactiveTurns);report=await page.evaluate(()=>window.runProactiveTurns());}
catch(error){report={complete:false,error:String(error)};}
finally{await browser.close();await new Promise(r=>server.close(r));}
const sourceHashesAfter=hashes();mkdirSync(root,{recursive:true});const path=join(root,`proactive-${before?'before':'current'}-${Date.now()}.json`);
writeFileSync(path,JSON.stringify({...report,sourceHashesBefore,sourceHashesAfter,stableSources:JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter),externalRequests:external,apiCalls:0,permissions:[],workingDirectory:process.cwd(),model:'模拟传输，无模型调用',codingModel:'未确认',codingReasoning:'未确认'},null,2));
console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(x=>x.name),error:report.error},null,2));if(!report.complete)process.exitCode=1;
