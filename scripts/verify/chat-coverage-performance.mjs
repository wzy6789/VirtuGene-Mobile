import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const topicScope=process.argv.includes('--topic-scope');
const topicWiring=process.argv.includes('--topic-wiring');
const requestRecovery=process.argv.includes('--request-recovery');
const output=(requestRecovery?'release/chat-request-recovery-20261018/':topicWiring?'release/chat-topic-wiring-20261018/':topicScope?'release/chat-topic-scope-20261018/':'release/chat-coverage-fix-20261018/')+'performance-'+Date.now()+'.json';
const report={scope:topicWiring?'Saved pre-wiring sender/topic helpers vs current; same source-backed topic stock and coverage; input changes expected from the new topic projection':topicScope?'Saved topic-focus helpers vs current; same current coverage pipeline and synthetic distributions; desktop only':'Saved pre-change source vs current; same synthetic distributions and desktop context; payload expected to change for restored coverage',phases:[],paidCalls:0,complete:false,errors:[]};
if(requestRecovery)report.scope='Saved sender/client before physical-request guard vs current; same seven-topic stock, exact messages payload hash comparison and cursor-inclusive read counters; mocked desktop transport only';
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const phase of ['before','after']){
  const beforeFilter=requestRecovery?/(send-service|deepseek|web-api)\.ts$/:topicWiring?/(send-service|chat-topic-outcomes|chat-conversation-state|chat-topic-state-repo)\.ts$/:topicScope?/(chat-conversation-state|chat-turn-cues)\.ts$/:/(chat-history-window|send-service|deepseek)\.ts$/;
  const beforeRoot=requestRecovery?'release/chat-request-recovery-20261018/before':topicWiring?'release/chat-topic-wiring-20261018/before':topicScope?'release/chat-topic-scope-20261018/before':'release/chat-coverage-fix-20261018/before';
  const bundle=await build({entryPoints:['scripts/verify/chat-coverage-performance.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{PERF_FIXED_BASE:requestRecovery?'1792326000000':'undefined',PERF_SEED_TOPICS:JSON.stringify(topicWiring||requestRecovery),LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:'"production"',LIVE_EMOTION_COMPACT:'false',LIVE_GU_VOICE_COMPACT:'false',LIVE_JUDGMENT_ECHO_COMPACT:'false',LIVE_COMPACT_REACT_GUIDANCE:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"coverage-performance"'},plugins:phase==='before'?[{name:'saved-before-coverage',setup(b){b.onLoad({filter:beforeFilter},args=>({contents:readFileSync(join(beforeRoot,basename(args.path)),'utf8'),loader:'ts'}));}}]:[]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const context=await browser.newContext({permissions:[]});
  try{
   const origin=`http://127.0.0.1:${server.address().port}`;
   await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
   const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runCoveragePerformance);
   const data=await page.evaluate(()=>window.runCoveragePerformance());
   report.phases.push({phase,...data});
   if(data.samples.some(sample=>sample.messages.length<14))throw Error('Historical stock was not actually supplied to the sender');
   if(phase==='after'&&data.samples.some(sample=>!sample.latestCorrectionKept))throw Error('Optimized sender still lost the known correction');
   data.samples.forEach(sample=>{sample.inputSha256=createHash('sha256').update(JSON.stringify(sample.messages)).digest('hex');});
   console.log(JSON.stringify({phase,samples:data.samples.map(s=>({prepareMs:s.prepareMs,chars:s.inputChars,correction:s.latestCorrectionKept,tombstoneReads:s.reads['memorySourceTombstones.query']}))}));
  }finally{await context.close();await new Promise(r=>server.close(r));}
 }
 if(requestRecovery&&report.phases[0].samples.some((s,i)=>s.inputSha256!==report.phases[1].samples[i].inputSha256))throw Error('Physical-request guard unexpectedly changed outgoing messages payload');
 report.complete=true;
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{await browser?.close();writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({complete:report.complete,errors:report.errors,evidence:output}));}
