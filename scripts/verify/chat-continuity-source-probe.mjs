import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,constants} from 'node:fs';

const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-continuity-sources-20261019';
const production=['src/db/continuity-repo.ts','src/lib/character-memory.ts','src/store/emotion-store.ts','src/db/message-repo.ts','src/db/index.ts','src/lib/memory-source-snapshot.ts','src/lib/world/world-writer.ts','src/lib/world/world-recall.ts','src/lib/world/world-context.ts'];
for(const file of production){const target=join(root,'before',file);mkdirSync(dirname(target),{recursive:true});if(!existsSync(target))copyFileSync(file,target,constants.COPYFILE_EXCL);}
const sources=['scripts/verify/chat-continuity-source-probe.ts','scripts/verify/chat-continuity-source-probe.mjs',...production,...(existsSync('src/lib/continuity-sources.ts')?['src/lib/continuity-sources.ts']:[])];
const beforeMode=process.argv.includes('--before')||process.argv.includes('--red');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=()=>Object.fromEntries(sources.map(path=>[path,hash(path)]));
const effectiveHashes=()=>Object.fromEntries(sources.map(path=>[path,hash(beforeMode&&production.includes(path)?join(root,'before',path):path)]));
const sourceHashesBefore=hashes(),effectiveSourceHashesBefore=effectiveHashes(),startedAt=new Date().toISOString();
const bundle=await build({entryPoints:['scripts/verify/chat-continuity-source-probe.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"continuity-source-probe"'},plugins:beforeMode?[{name:'frozen-continuity-source-probe',setup(b){b.onLoad({filter:/[\\/]src[\\/].*\.ts$/},args=>{const file=production.find(file=>resolve(file)===resolve(args.path));if(file)return {loader:'ts',contents:readFileSync(join(root,'before',file),'utf8')};});}}]:[]});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/probe.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/probe.js'?code:'<!doctype html><meta charset="utf-8"><title>Isolated continuity source probe</title><script src="/probe.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let report,blockedRequests=0;const browserVersion=browser.version(),origin='http://127.0.0.1:'+server.address().port;
try{
 const context=await browser.newContext({permissions:[]});
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
 const page=await context.newPage();await page.goto(origin);report=await page.evaluate(()=>window.runContinuitySourceProbe());
 if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.message};process.exitCode=1;}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
 const sourceHashesAfter=hashes(),effectiveSourceHashesAfter=effectiveHashes(),path=join(root,(beforeMode?'red':'probe')+'-'+Date.now()+'.json');mkdirSync(root,{recursive:true});
 writeFileSync(path,JSON.stringify({...report,beforeMode,snapshotPolicy:'Non-overwriting per-file source snapshots, captured when each path was first added to this probe; not a single historical git revision. Original 19/4-failure probe and expanded 169/95-failure probe precede implementation.',startedAt,finishedAt:new Date().toISOString(),workingDirectory:process.cwd(),origin,browserVersion,permissions:[],blockedRequests,stableSources:JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter),stableEffectiveSources:JSON.stringify(effectiveSourceHashesBefore)===JSON.stringify(effectiveSourceHashesAfter),sourceHashesBefore,sourceHashesAfter,effectiveSourceHashesBefore,effectiveSourceHashesAfter,bundleSha256:createHash('sha256').update(code).digest('hex'),baselineHashes:Object.fromEntries(production.map(file=>[file,hash(join(root,'before',file))])),apiCalls:0,model:'未确认',reasoning:'未确认'},null,2));
 console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,apiCalls:0},null,2));
}
