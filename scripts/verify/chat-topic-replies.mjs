import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,constants} from 'node:fs';

const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-topic-replies-20261019';
const frozen=['src/lib/chat/send-service.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat-conversation-state.ts','src/db/chat-topic-state-repo.ts','src/db/index.ts'];
for(const file of frozen){const target=join(root,'before',file);mkdirSync(dirname(target),{recursive:true});if(!existsSync(target))copyFileSync(file,target,constants.COPYFILE_EXCL);}
const beforeMode=process.argv.includes('--before')||process.argv.includes('--red');
const legacyRetrySource=process.argv.includes('--legacy-retry-source');
if(beforeMode&&legacyRetrySource)throw Error('Choose the original frozen baseline or the isolated legacy retry-source overlay.');
const retryOverlay={file:'src/lib/chat/send-service.ts',from:'appendTopicReplyEvidence(next,source,messages,topicSource.domain)',to:'appendTopicReplyEvidence(next,userMsg,messages,topicSource.domain)'};
const effectiveContents=path=>{
 let contents=readFileSync(beforeMode&&frozen.includes(path)?join(root,'before',path):path,'utf8');
 if(legacyRetrySource&&path===retryOverlay.file){
  if(contents.split(retryOverlay.from).length!==2)throw Error('Expected exactly one current stored-source append site for isolated legacy overlay.');
  contents=contents.replace(retryOverlay.from,retryOverlay.to);
 }
 return contents;
};
const sources=['scripts/verify/chat-topic-replies.ts','scripts/verify/chat-topic-replies.mjs','scripts/verify/chat-human-live.ts',...frozen,...(existsSync('src/lib/chat-topic-replies.ts')?['src/lib/chat-topic-replies.ts']:[])];
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=()=>Object.fromEntries(sources.map(path=>[path,hash(path)]));
const effectiveHashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(effectiveContents(path)).digest('hex')]));
const startedAt=new Date().toISOString(),sourceHashesBefore=hashes(),effectiveSourceHashesBefore=effectiveHashes();
const bundle=await build({entryPoints:['scripts/verify/chat-topic-replies.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'http://127.0.0.1:1/blocked'}),'import.meta.hot':'undefined',__APP_VERSION__:'"topic-reply-verification"',LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"isolated-no-paid-token"',LIVE_RESPONSES:'[]'},plugins:beforeMode||legacyRetrySource?[{name:'isolated-topic-reply-source-overlay',setup(b){b.onLoad({filter:/[\\/]src[\\/].*\.ts$/},args=>{const file=frozen.find(file=>resolve(file)===resolve(args.path));if(file&&(beforeMode||legacyRetrySource&&file===retryOverlay.file))return {loader:'ts',contents:effectiveContents(file)};});}}]:[]});
const code=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?code:'<!doctype html><meta charset="utf-8"><title>Isolated topic reply evidence</title><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let report,blockedRequests=0;const browserVersion=browser.version(),origin='http://127.0.0.1:'+server.address().port;
try{
 const context=await browser.newContext({permissions:[]});
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
 const page=await context.newPage();
 await page.exposeFunction('topicReplyReloadProbe',async expected=>{
  const fresh=await context.newPage();
  try{await fresh.goto(origin);await fresh.waitForFunction(()=>!!window.runTopicReplyReload);return await fresh.evaluate(expected=>window.runTopicReplyReload(expected),expected);}
  finally{await fresh.close();}
 });
 await page.goto(origin);report=await page.evaluate(()=>window.runTopicReplies());
 if(!report.complete)process.exitCode=1;
}catch(error){report={complete:false,error:error.message};process.exitCode=1;}
finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
 const sourceHashesAfter=hashes(),effectiveSourceHashesAfter=effectiveHashes();
 const path=join(root,(beforeMode?'red':legacyRetrySource?'legacy-retry':'current')+'-'+Date.now()+'.json');mkdirSync(root,{recursive:true});
 writeFileSync(path,JSON.stringify({...report,beforeMode,legacyRetrySource,...(legacyRetrySource?{isolatedSourceOverlay:retryOverlay}:{}),startedAt,finishedAt:new Date().toISOString(),workingDirectory:process.cwd(),origin,browserVersion,permissions:[],blockedRequests,stableSources:JSON.stringify(sourceHashesBefore)===JSON.stringify(sourceHashesAfter),stableEffectiveSources:JSON.stringify(effectiveSourceHashesBefore)===JSON.stringify(effectiveSourceHashesAfter),sourceHashesBefore,sourceHashesAfter,effectiveSourceHashesBefore,effectiveSourceHashesAfter,baselineHashes:Object.fromEntries(frozen.map(file=>[file,hash(join(root,'before',file))])),apiCalls:0,model:'未确认',reasoning:'未确认'},null,2));
 console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,paidCalls:0},null,2));
}
