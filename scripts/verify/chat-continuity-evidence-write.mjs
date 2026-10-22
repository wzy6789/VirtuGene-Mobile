import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';

const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-continuity-sources-20261019';
const before=process.argv.includes('--before');
const frozen=['src/db/continuity-repo.ts','src/lib/character-memory.ts','src/store/emotion-store.ts','src/db/message-repo.ts','src/db/index.ts','src/lib/memory-source-snapshot.ts','src/lib/world/world-writer.ts'];
const sources=['scripts/verify/chat-continuity-evidence-write.ts','scripts/verify/chat-continuity-evidence-write.mjs',...frozen,'src/db/chat-auxiliary-guard.ts','src/lib/sync.ts',...(existsSync('src/lib/continuity-sources.ts')?['src/lib/continuity-sources.ts']:[])];
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=()=>Object.fromEntries(sources.map(path=>[path,hash(path)]));
const effectiveHashes=()=>Object.fromEntries(sources.map(path=>[path,hash(before&&frozen.includes(path)?join(root,'before',path):path)]));
const startedAt=new Date().toISOString(),sourceHashesBefore=hashes(),effectiveSourceHashesBefore=effectiveHashes();
const bundle=await build({entryPoints:['scripts/verify/chat-continuity-evidence-write.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"continuity-evidence-write-verification"'},plugins:before?[{name:'frozen-before-continuity-evidence',setup(build){build.onLoad({filter:/[\\/]src[\\/].*\.ts$/},args=>{const file=frozen.find(file=>resolve(file)===resolve(args.path));if(file)return {loader:'ts',contents:readFileSync(join(root,'before',file),'utf8')};});}}]:[]});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><meta charset="utf-8"><title>Isolated continuity evidence writes</title><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let report,blockedRequests=0;const browserVersion=browser.version(),origin='http://127.0.0.1:'+server.address().port;
try{
 const context=await browser.newContext({permissions:[]});
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
 const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runContinuityEvidenceWrite==='function');
 report=await page.evaluate(()=>window.runContinuityEvidenceWrite());if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.message};process.exitCode=1;}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
 const sourceHashesAfter=hashes(),effectiveSourceHashesAfter=effectiveHashes(),path=join(root,(before?'write-red-':'write-current-')+Date.now()+'.json');mkdirSync(root,{recursive:true});
 writeFileSync(path,JSON.stringify({...report,before,startedAt,finishedAt:new Date().toISOString(),workingDirectory:process.cwd(),origin,browserVersion,permissions:[],blockedRequests,stableSources:JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter),stableEffectiveSources:JSON.stringify(effectiveSourceHashesBefore)===JSON.stringify(effectiveSourceHashesAfter),sourceHashesBefore,sourceHashesAfter,effectiveSourceHashesBefore,effectiveSourceHashesAfter,apiCalls:0,model:'未确认',reasoning:'未确认'},null,2));
 console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,paidCalls:0},null,2));
}
