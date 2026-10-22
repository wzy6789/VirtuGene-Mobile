import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-world-source-20261019';mkdirSync(root,{recursive:true});
const before=process.argv.includes('--before');
const frozen=['src/lib/world/world-turn.ts','src/lib/world/world-context.ts','src/lib/world/world-ai-client.ts','src/lib/world/world-recall.ts','src/lib/character-history-recall.ts','src/lib/world/world-director.ts','src/lib/world/world-actor.ts','src/lib/world/world-narrator.ts','src/lib/world/world-consistency.ts','src/lib/world/world-settlement.ts'];
const files=['src/lib/world/world-turn.ts','src/lib/world/world-context.ts','src/lib/world/world-ai-client.ts','src/lib/world/world-recall.ts','src/lib/character-history-recall.ts','src/lib/memory-source-snapshot.ts','src/lib/world/world-source-guard.ts','src/lib/world/world-director.ts','src/lib/world/world-actor.ts','src/lib/world/world-narrator.ts','src/lib/world/world-consistency.ts','src/lib/world/world-settlement.ts','scripts/verify/chat-world-source-races.ts','scripts/verify/chat-world-source-races.mjs'];
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=()=>Object.fromEntries(files.map(path=>[path,hash(path)]));
const sourceHashesBefore=hashes();
const effectiveSourceHashes=Object.fromEntries(files.map(path=>[path,hash(before&&frozen.includes(path)?root+'/before/'+path:path)]));
const bundle=await build({entryPoints:['scripts/verify/chat-world-source-races.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":"http://127.0.0.1:1/blocked"}','import.meta.hot':'undefined',__APP_VERSION__:'"world-source-race"'},plugins:before?[{name:'frozen-world-source-stage',setup(b){b.onLoad({filter:/[\\/]src[\\/].*\.ts$/},args=>{const path=frozen.find(path=>resolve(path)===resolve(args.path));if(path)return{loader:'ts',contents:readFileSync(root+'/before/'+path,'utf8')};});}}]:[]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});let result,blockedRequests=0;
try{
 const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(blockedRequests++,route.abort()));
 const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runWorldSourceRaces==='function');result=await page.evaluate(()=>window.runWorldSourceRaces());if(!result.complete)process.exitCode=1;
}catch(error){result={complete:false,error:error.stack};process.exitCode=1;}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));const sourceHashesAfter=hashes(),path=root+(before?'/red-':'/races-')+Date.now()+'.json';
 writeFileSync(path,JSON.stringify({...result,before,origin,workingDirectory:process.cwd(),sourceHashesBefore,sourceHashesAfter,effectiveSourceHashes,snapshotPolicy:'Ten non-overwriting pre-phase source files; other sources stay current. Not a historical release reconstruction.',stableSources:JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter),blockedRequests},null,2));
 console.log(JSON.stringify({path,complete:result.complete,checks:result.checks?.length,failures:result.failures?.map(row=>row.name),error:result.error,apiCalls:0},null,2));
}
