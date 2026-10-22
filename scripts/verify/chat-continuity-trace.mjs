import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
const nodeRequire=createRequire(join(dirname(process.execPath),'package.json'));
const {chromium}=nodeRequire('playwright');
const stamp=new Date().toISOString().replace(/[:.]/gu,'-');
const out=`release/chat-continuity-trace-${stamp}`;
mkdirSync(out,{recursive:true});
const sourcePaths=['src/lib/chat/send-service.ts','src/lib/chat-history-window.ts','src/lib/chat-context-compiler.ts','src/lib/ai/deepseek.ts','src/db/index.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat-scoped-facts.ts','src/lib/chat-conversation-state.ts','src/db/chat-topic-state-repo.ts','src/lib/chat-topic-replies.ts','server/gateway.mjs','server/chat-history-policy.mjs','scripts/verify/chat-continuity-fixtures.ts','scripts/verify/chat-continuity-trace.ts'];
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const initialSources=sourcePaths.map(path=>({path,sha256:sha(path)}));
const report={startedAt:new Date().toISOString(),workspace:process.cwd(),codingModel:'未确认',codingReasoning:'未确认',complete:false,sourceHashes:initialSources,errors:[],paidCalls:0};
let browser,server;
try{
const bundle=await build({entryPoints:['scripts/verify/chat-continuity-trace.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"continuity-offline"'},plugins:[{
 name:'test-only-compiler-trace',setup(b){
  b.onLoad({filter:/chat-context-compiler\.ts$/},args=>{
   const source=readFileSync(args.path,'utf8');
   if(!source.includes('export function compileChatContext('))throw Error('Compiler changed; inspect instrumentation');
   const contents=source.replace('export function compileChatContext(','function underlyingCompileChatContext(')+`
export function compileChatContext(...args:Parameters<typeof underlyingCompileChatContext>) {
 const result=underlyingCompileChatContext(...args);
 (globalThis as any).__continuityCompile?.({identityChars:args[0].length,budget:args[2]??24000,sections:args[1].map(s=>({key:s.key,chars:s.text.length,priority:s.priority,requireComplete:s.requireComplete})),included:result.included,partial:result.partial,omitted:result.omitted});
 return result;
}`;
   return {contents,loader:'ts'};
  });
  b.onLoad({filter:/chat-history-window\.ts$/},args=>{
   let contents=readFileSync(args.path,'utf8');
   for(const name of ['buildChatHistoryWindow','boundChatHistory','buildContinuityBridge']){
    const from='export function '+name;
    if(!contents.includes(from))throw Error('History selection changed; inspect instrumentation');
    contents=contents.replace(from,'function underlying'+name);
   }
   contents+=`
export function buildChatHistoryWindow(...args:Parameters<typeof underlyingbuildChatHistoryWindow>){
 const result=underlyingbuildChatHistoryWindow(...args);
 (globalThis as any).__continuityHistory?.({stage:'selected-history',currentId:args[1],candidates:args[0],result});return result;
}
export function boundChatHistory<T extends {content:string}>(history:T[]):T[]{
 const result=underlyingboundChatHistory(history);
 (globalThis as any).__continuityHistory?.({stage:'transport-bound',input:history,result});return result;
}
export function buildContinuityBridge(...args:Parameters<typeof underlyingbuildContinuityBridge>){
 const result=underlyingbuildContinuityBridge(...args);
 (globalThis as any).__continuityHistory?.({stage:'bridge',result});return result;
}`;
   return {contents,loader:'ts'};
  });
 }
}]});
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({permissions:[]});
 const origin=`http://127.0.0.1:${server.address().port}`;
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin);await page.waitForFunction(()=>!!window.runContinuityTrace);
 console.log(JSON.stringify({running:true,output:out,synthetic:true}));
 const data=await page.evaluate(()=>window.runContinuityTrace());
 Object.assign(report,data);
 if(data.rows.length!==24)throw Error('Expected 12 trajectories x 2 real role configurations');
 const changed=initialSources.filter(s=>sha(s.path)!==s.sha256);
 report.sourceChangedDuringRun=changed;
 report.complete=report.errors.length===0&&changed.length===0;
 if(!report.complete)throw Error('Source changed or browser failed; keep diagnostic results, rerun after inspection');
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
 await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));
 report.finishedAt=new Date().toISOString();
 writeFileSync(out+'/baseline.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({complete:report.complete,trajectories:report.rows?.length??0,turns:report.rows?.reduce((n,r)=>n+r.turns.length,0)??0,evidence:out+'/baseline.json',errors:report.errors}));
}
