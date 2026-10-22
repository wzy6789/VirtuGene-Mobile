import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,constants} from 'node:fs';

const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-summary-covered-prefix-20261019';
const frozen=['src/db/chat-summary-archive.ts','src/db/message-repo.ts','src/db/index.ts'];
for(const file of frozen){const target=join(root,'before',file);mkdirSync(dirname(target),{recursive:true});if(!existsSync(target))copyFileSync(file,target,constants.COPYFILE_EXCL);}
const beforeMode=process.argv.includes('--before')||process.argv.includes('--red');
const migrationMode=process.argv.includes('--migration');
if(beforeMode&&migrationMode)throw Error('Use --migration against the current schema; --red keeps the v42 production baseline.');
const sources=['scripts/verify/chat-summary-covered-prefix.ts','scripts/verify/chat-summary-covered-prefix.mjs',...frozen,'src/db/chat-archive-reader.ts','src/lib/chat-summary-evidence.ts','src/lib/ai/summary-batches.ts','src/db/message-evidence-key.ts','src/db/memory-source-tombstone-repo.ts'];
const hashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashesBefore=hashes(),startedAt=new Date().toISOString();
const effectiveHashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(beforeMode&&frozen.includes(path)?join(root,'before',path):path)).digest('hex')]));
const effectiveSourceHashesBefore=effectiveHashes();
const baselineHashes=Object.fromEntries(frozen.map(path=>[path,createHash('sha256').update(readFileSync(join(root,'before',path))).digest('hex')]));
const buildBundle=async(frozenMode)=>{
 const bundle=await build({entryPoints:['scripts/verify/chat-summary-covered-prefix.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"covered-prefix-verification"'},plugins:frozenMode?[{name:'frozen-before-covered-prefix',setup(b){b.onLoad({filter:/[\\/]src[\\/]db[\\/](chat-summary-archive|message-repo|index)\.ts$/},args=>{const relative=frozen.find(file=>resolve(file)===resolve(args.path));if(relative)return {loader:'ts',contents:readFileSync(join(root,'before',relative),'utf8')};});}}]:[]});
 return bundle.outputFiles[0].text;
};
const currentCode=await buildBundle(beforeMode);
let code=migrationMode?await buildBundle(true):currentCode;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><meta charset="utf-8"><title>Isolated covered-prefix capture</title><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-precise-memory-info']});
let report,blockedRequests=0,browserVersion=browser.version();
try{
 const context=await browser.newContext({permissions:[]}),origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
 const page=await context.newPage();await page.goto(origin);
 if(migrationMode){
  const fixture=await page.evaluate(()=>window.prepareCoveredPrefixMigration());
  code=currentCode;await page.reload();
  report=await page.evaluate(async fixture=>{try{return await window.verifyCoveredPrefixMigration(fixture);}catch(error){throw Error(JSON.stringify({name:error.name,message:error.message,inner:error.inner?.message,stack:error.stack}));}},fixture);
 }else report=await page.evaluate(async()=>{try{return await window.runCoveredPrefix();}catch(error){throw Error(JSON.stringify({name:error.name,message:error.message,inner:error.inner?.message,stack:error.stack}));}});
 if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.message};process.exitCode=1;}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
 const sourceHashesAfter=hashes(),effectiveSourceHashesAfter=effectiveHashes(),path=join(root,(migrationMode?'migration':beforeMode?'red':'current')+'-'+Date.now()+'.json');
 mkdirSync(root,{recursive:true});
 writeFileSync(path,JSON.stringify({...report,beforeMode,migrationMode,startedAt,finishedAt:new Date().toISOString(),workingDirectory:process.cwd(),browserVersion,permissions:[],blockedRequests,stableSources:JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter),stableEffectiveSources:JSON.stringify(effectiveSourceHashesBefore)===JSON.stringify(effectiveSourceHashesAfter),sourceHashesBefore,sourceHashesAfter,effectiveSourceHashesBefore,effectiveSourceHashesAfter,baselineHashes,model:'未确认',reasoning:'未确认'},null,2));
 console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures,error:report.error,scale:report.rows?.filter(row=>row.scenario.startsWith('scale-')).map(row=>({scenario:row.scenario,messageBodyRows:row.messageBodyRows,messageKeyRows:row.messageKeyRows,elapsedMs:row.elapsedMs,segmentsHash:row.segmentsHash,cursorHash:row.cursorHash})),paidCalls:0},null,2));
}
