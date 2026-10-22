import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-topic-replies-20261019';
const sources=['scripts/verify/chat-topic-reply-roundtrip.ts','scripts/verify/chat-topic-reply-roundtrip.mjs','src/lib/sync.ts','src/lib/chat-topic-replies.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat-conversation-state.ts','src/db/chat-topic-state-repo.ts','src/db/index.ts','src/db/message-repo.ts','src/db/memory-source-tombstone-repo.ts'];
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=()=>Object.fromEntries(sources.map(path=>[path,hash(path)]));
const startedAt=new Date().toISOString(),sourceHashesBefore=hashes();
const bundle=await build({entryPoints:['scripts/verify/chat-topic-reply-roundtrip.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"topic-reply-roundtrip-verification"'}});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><meta charset="utf-8"><title>Isolated topic reply sync roundtrip</title><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let report,blockedRequests=0;const browserVersion=browser.version(),origin='http://127.0.0.1:'+server.address().port;
try{
  const context=await browser.newContext({permissions:[]});
  await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
  const page=await context.newPage();
  await page.goto(origin);await page.waitForFunction(()=>typeof window.runTopicReplyRoundtrip==='function');
  report=await page.evaluate(()=>window.runTopicReplyRoundtrip());
  if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.message};process.exitCode=1;}
finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  const sourceHashesAfter=hashes(),path=join(root,'roundtrip-'+Date.now()+'.json');mkdirSync(root,{recursive:true});
  writeFileSync(path,JSON.stringify({...report,startedAt,finishedAt:new Date().toISOString(),workingDirectory:process.cwd(),origin,browserVersion,permissions:[],blockedRequests,stableSources:JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter),sourceHashesBefore,sourceHashesAfter,apiCalls:0,model:'未确认',reasoning:'未确认'},null,2));
  console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,paidCalls:0},null,2));
}
