import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {memorySpeaker} from '../../server/memory-source-policy.mjs';
const root='release/chat-archive-incremental-20261019';mkdirSync(root,{recursive:true});
const beforeWire=process.argv.includes('--before-wire');
const phase=beforeWire?'before-wire':process.argv.includes('--red')?'red':'green';
const sources=['src/lib/ai/context-summarizer.ts','server/gateway.mjs','src/lib/ai/summary-batches.ts','server/summary-history-policy.mjs','server/summary-history-policy.d.mts','src/store/group-store.ts','scripts/verify/chat-summary-wire.mjs','scripts/verify/chat-summary-wire.ts'];
const sourceHashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashesBefore=sourceHashes(),appliedSources={};
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
const upstreamBodies=[],gatewayBodies=[];
let truncateNextBatch=false;
const upstream=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const chunks=[];for await(const data of req)chunks.push(data);
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));upstreamBodies.push({path:req.url,payload});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'synthetic-summary-wire',choices:[{message:{content:req.url.startsWith('/gateway')?'\u007b"summary":"合成摘要，不用于质量评分。"\u007d':'合成摘要，不用于质量评分。'},finish_reason:truncateNextBatch?'length':'stop'}]}));
});
let browser,child,web;const report={complete:false,phase,checks:[],failures:[],rows:[],invalid:[],gatewayInvalid:[],otherOperations:[],paidCalls:0,scope:'Actual summarizeContext direct transport and actual gateway process to localhost synthetic upstream; no real provider or private chat data.'};
const check=(ok,label)=>{report.checks.push({label,pass:!!ok});if(!ok)report.failures.push(label);};
try{
  const upstreamPort=await listen(upstream),upstreamOrigin=`http://127.0.0.1:${upstreamPort}`;
  const reserve=createServer(),gatewayPort=await listen(reserve);await close(reserve);const gatewayOrigin=`http://127.0.0.1:${gatewayPort}`;
  let gatewayEntry='server/gateway.mjs';
  if(beforeWire){
    const contents=readFileSync(root+'/before/gateway.mjs','utf8');
    const isolated=await build({stdin:{contents,resolveDir:resolve('server'),sourcefile:'before-gateway.mjs'},bundle:true,write:false,platform:'node',format:'esm'});
    gatewayEntry=root+'/isolated-before-gateway.mjs';writeFileSync(gatewayEntry,isolated.outputFiles[0].text);
    appliedSources.gateway={source:root+'/before/gateway.mjs',sha256:createHash('sha256').update(contents).digest('hex')};
  }else appliedSources.gateway={source:gatewayEntry,sha256:sourceHashesBefore[gatewayEntry]};
  child=spawn(process.execPath,[gatewayEntry],{cwd:process.cwd(),windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(gatewayPort),DEEPSEEK_API_KEY:'synthetic-not-a-credential',DEEPSEEK_BASE_URL:upstreamOrigin+'/gateway',VIRTUGENE_GATEWAY_TOKEN:'synthetic-gateway-token',GATEWAY_ALLOW_ANONYMOUS:'true',GATEWAY_DATA_DIR:join(root,'summary-wire-isolated-data'),GATEWAY_RATE_LIMIT:'1000',GATEWAY_AUX_RATE_LIMIT:'1000',GATEWAY_DAILY_LIMIT:'1000'},stdio:'ignore'});
  let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error('Isolated gateway exited');try{if((await fetch(gatewayOrigin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}if(!ready)throw Error('Gateway startup timed out');
  const bundled=await build({entryPoints:['scripts/verify/chat-summary-wire.ts'],bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:gatewayOrigin,VITE_AI_GATEWAY_TOKEN:'synthetic-gateway-token'}),SUMMARY_WIRE_UPSTREAM:JSON.stringify(upstreamOrigin),__APP_VERSION__:'"summary-wire-isolated"'},plugins:beforeWire?[{name:'isolated-before-summary-transport',setup(b){b.onLoad({filter:/context-summarizer\.ts$/},()=>{const contents=readFileSync(root+'/before/context-summarizer.ts','utf8');appliedSources.summarizer={source:root+'/before/context-summarizer.ts',sha256:createHash('sha256').update(contents).digest('hex')};return{contents,loader:'ts'};});}}]:[]});
  if(!beforeWire)appliedSources.summarizer={source:'src/lib/ai/context-summarizer.ts',sha256:sourceHashesBefore['src/lib/ai/context-summarizer.ts']};
  web=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundled.outputFiles[0].text:'<!doctype html><title>Isolated summary transport</title><script src="/test.js"></script>');});const origin=`http://127.0.0.1:${await listen(web)}`;
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({permissions:[]});
  await context.route('**/*',route=>[origin,upstreamOrigin,gatewayOrigin].some(allowed=>route.request().url().startsWith(allowed+'/'))?route.continue():route.abort());
  const page=await context.newPage();page.on('request',request=>{if(request.url()===gatewayOrigin+'/v1/aux'&&request.method()==='POST')gatewayBodies.push(JSON.parse(request.postData()||'{}'));});await page.goto(origin);await page.waitForFunction(()=>typeof window.runSummaryWire==='function');
  for(const mode of ['direct','gateway']){
    const before=upstreamBodies.length,results=await page.evaluate(mode=>window.runSummaryWire(mode),mode),wire=upstreamBodies.slice(before);
    check(wire.length===results.length,mode+' uses one intended request per valid summary batch');
    for(let i=0;i<results.length;i++){
      const row=results[i],payload=wire[i]?.payload,user=payload?.messages?.findLast(message=>message.role==='user')?.content??'';
      const segments=row.input.history.map((segment,index)=>({index,expectedChars:segment.content.length,fullyTransmitted:user.includes(segment.content),tail:segment.content.slice(-25),tailTransmitted:user.includes(segment.content.slice(-25))}));
      check(row.result.complete===true,mode+' marks valid batch complete on '+row.name);
      check(segments.every(segment=>segment.fullyTransmitted),mode+' sends every exact cursor-covered segment on '+row.name);
      check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(user),mode+' preserves surrogate pairs on '+row.name);
      if(row.name==='mixed-provenance-segments')check(user.includes('群成员：'+memorySpeaker('assistant'))&&user.includes(memorySpeaker('user',false)),mode+' retains original provenance and group speaker labels outside the segment budget');
      report.rows.push({...row,segments,upstream:payload,gatewayBody:mode==='gateway'?gatewayBodies[i]:undefined,inputContentChars:row.input.history.reduce((sum,item)=>sum+item.content.length,0),wireUserChars:user.length});
    }
    truncateNextBatch=true;
    const beforeTruncated=upstreamBodies.length,truncated=await page.evaluate(mode=>window.runSummaryWire(mode),mode);
    truncateNextBatch=false;
    check(upstreamBodies.length-beforeTruncated===truncated.length,mode+' truncated summary uses no extra regeneration');
    for(const item of truncated)check(item.result.complete===false,mode+' truncated provider output never advances coverage on '+item.name);
    report.truncated??=[];report.truncated.push(...truncated.map(item=>({mode,name:item.name,result:item.result})));
    const beforeInvalid=upstreamBodies.length,invalid=await page.evaluate(mode=>window.runInvalidSummaryWire(mode),mode);
    check(upstreamBodies.length===beforeInvalid,mode+' rejects unrepresentable summary batches before any model request');
    for(const item of invalid)check(item.result.complete===false,mode+' never advances a clipped/unrepresentable batch on '+item.name);
    report.invalid.push(...invalid);
  }
  const submit=async(operation,payload)=>{const response=await fetch(gatewayOrigin+'/v1/aux',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-gateway-token'},body:JSON.stringify({operation,payload}),signal:AbortSignal.timeout(10000)});return{status:response.status,body:await response.json()};};
  for(const invalid of report.invalid.filter(row=>row.mode==='direct')){
    const before=upstreamBodies.length,result=await submit('context-summary',{history:invalid.history});
    check(result.status===400&&upstreamBodies.length===before,'gateway rejects direct malformed '+invalid.name+' without contacting its model');report.gatewayInvalid.push({name:invalid.name,result,upstreamCalls:upstreamBodies.length-before});
  }
  const history=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'row-'+i+'_'+String(i).repeat(1300)}));
  for(const operation of ['emotion','context-settle','memory']){
    const before=upstreamBodies.length,result=await submit(operation,{history});const payload=upstreamBodies.at(-1)?.payload;
    const expected=history.slice(-24).map(item=>(item.role==='assistant'?'assistant':'user')+': '+item.content.slice(0,1000)).join('\n').slice(0,20000);
    check(result.status===200&&upstreamBodies.length===before+1&&payload?.messages.at(-1)?.content===expected,operation+' keeps existing non-summary history bounds unchanged');report.otherOperations.push({operation,result,userChars:payload?.messages.at(-1)?.content.length});
  }
  const diary={mode:'auto',text:'文'.repeat(13000),context:'境'.repeat(9000)},expectedDiary=(`mode=auto\n内容：${diary.text.slice(0,12000)}\n上下文：${diary.context.slice(0,8000)}`).slice(0,20000);
  const diaryBefore=upstreamBodies.length,diaryResult=await submit('diary',diary),diaryWire=upstreamBodies.at(-1)?.payload;
  check(diaryResult.status===200&&upstreamBodies.length===diaryBefore+1&&diaryWire?.messages.at(-1)?.content===expectedDiary,'diary keeps existing text/context bounds unchanged');
  report.otherOperations.push({operation:'diary',result:diaryResult,userChars:diaryWire?.messages.at(-1)?.content.length});
  report.complete=report.failures.length===0;
}catch(error){report.failures.push(error.stack||error.message);}
finally{
  if(browser)await browser.close();if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}if(web)await close(web);await close(upstream);
  report.sourceHashesBefore=sourceHashesBefore;report.sourceHashesAfter=sourceHashes();report.stableSources=JSON.stringify(report.sourceHashesBefore)===JSON.stringify(report.sourceHashesAfter);report.appliedSources=appliedSources;report.model='未确认';report.reasoning='未确认';
  const path=`${root}/summary-wire-${phase}-${Date.now()}.json`;writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,failures:report.failures,paidCalls:0,evidence:path}));if(!report.complete)process.exitCode=1;
}
