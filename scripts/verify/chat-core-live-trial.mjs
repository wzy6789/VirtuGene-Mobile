import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {runBudgetedRequest} from './api-request-budget.mjs';
import {comparisonCases} from './chat-core-comparison-cases.mjs';
const offline=process.argv.includes('--offline');
const full=process.argv.includes('--full-comparison');
const followup=process.argv.includes('--review-followup');
if(followup&&!full)throw Error('Review follow-up must use the established full-comparison phase');
const privatePath=process.env.VG_CHAT_CORE_API_CONFIG,key=offline?'not-a-provider-key':process.env.DEEPSEEK_API_KEY;
if(!offline&&(!privatePath||!key))throw Error('Requires explicit private API loader');
const stored=offline?{provider:'deepseek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',thinking:{type:'enabled'},reasoningEffort:'low',maxOutputTokens:900,initialRequestLimit:6}:JSON.parse(readFileSync(privatePath,'utf8'));
if(stored.provider!=='deepseek'||stored.baseUrl!=='https://api.deepseek.com/v1'||stored.model!=='deepseek-flash'
  ||stored.thinking?.type!=='enabled'||stored.reasoningEffort!=='low'||stored.maxOutputTokens!==900||stored.initialRequestLimit!==6)throw Error('Unexpected verification configuration');
const phaseRoot='release/chat-core-implementation-20261021/live'+(offline?'/offline-'+Date.now():full?'/full-comparison':'');
const root=followup?join(phaseRoot,'review-followup-20261022'):phaseRoot;mkdirSync(root,{recursive:true});
const budgetFile=join(phaseRoot,full?'full-comparison-budget-20261022.json':'initial-trial-budget-20261022.json');
const config={phase:full?'chat-core-full-comparison-20261022':'chat-core-initial-20261022',limit:full?72:6,model:stored.model,thinking:stored.thinking,reasoningEffort:stored.reasoningEffort,maxOutputTokens:stored.maxOutputTokens};
// The file is fixed across invocations. Never create another phase to retry.
if(followup&&!offline){
  const ledger=JSON.parse(readFileSync(budgetFile,'utf8'));
  if(ledger.config?.phase!==config.phase||ledger.config?.limit!==72||ledger.requests.length!==60||ledger.stopped||ledger.requests.some(entry=>entry.result?.status!==200))throw Error('Follow-up requires exactly sixty confirmed requests in the original72-attempt ledger');
}else if(existsSync(budgetFile)&&JSON.parse(readFileSync(budgetFile,'utf8')).requests.length)throw Error('Trial already attempted; inspect its cumulative ledger before a deliberate resume');
const recorded=followup?JSON.parse(readFileSync('release/chat-core-implementation-20261021/live/full-comparison/full-comparison-results-20261022.json','utf8')):undefined;
const replayCase=(id,caseId,targetTurn)=>{
  const trajectory=recorded.rows.filter(row=>row.variant==='current'&&row.caseId===caseId);
  if(trajectory.length!==10||trajectory.some(row=>!row.completed||row.failed))throw Error('Recorded trajectory is incomplete');
  return {id,inputs:[trajectory[targetTurn-1].input],seed:trajectory.slice(0,targetTurn-1).map(({input,replies})=>({input,replies})),offline:['我想说一个假设：如果杯子真会接电话，铃声大概就是一声叮。']};
};
const followupCases=followup?[comparisonCases.find(item=>item.id==='emotion'),replayCase('recorded-episode','emotion',6),replayCase('recorded-speaker','continuity',9)]:undefined;
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const token=randomUUID(),bundles={},bundleEvidence={},calls=[],rows=[],errors=[];
const sha=value=>createHash('sha256').update(value).digest('hex');
const frozenRoot='release/chat-core-implementation-20261021/delivery';
const frozen=JSON.parse(readFileSync(join(frozenRoot,'baseline.json'),'utf8')).files;
for(const [file,hash]of Object.entries(frozen))if(sha(readFileSync(join(frozenRoot,'before',file)))!==hash)throw Error('Frozen baseline changed');
const reportPath=join(root,full?'full-comparison-results-20261022.json':'initial-trial-results-20261022.json');
const report=()=>({date:new Date().toISOString(),config,rows,calls,errors,budgetFile,
  complete:rows.length===(followup?12:full?60:6)&&rows.every(row=>row.completed&&!row.failed)&&!errors.length,
  scope:followup?'Current sender review-fix follow-up: one intact ten-turn emotion trajectory and two explicitly seeded captured contexts. Uses only the remaining twelve attempts of the unchanged full-comparison72 budget; retries share that remainder. Never splice these turns into the original sixty-turn comparison. No hardware/microphone/audio. Complete transport does not prove expression quality.':full?'Gu/Tang three fixed ten-turn trajectories on both sender variants; isolated IndexedDB and streaming proxy.72 total provider attempts including retries. Ten frozen pre-prefix files vary; other code, including current persona, is shared. No hardware/microphone/audio. Complete transport does not prove expression quality.':'Gu/Tang three-turn paired trial through actual private sender and isolated IndexedDB; streaming proxy. Six total provider attempts including retries. No hardware/microphone/audio. Not full Q59 acceptance.',
  actualBilling:'Unconfirmed; provider token usage is reported without estimating a bill',sourceHashes,baselineHashes:frozen,bundleEvidence,
  apiCalls:offline?0:existsSync(budgetFile)?JSON.parse(readFileSync(budgetFile,'utf8')).requests.length:0,offline});
const persist=()=>writeFileSync(reportPath,JSON.stringify(report(),null,2));
let origin,sourceHashes={};
const server=createServer(async(req,res)=>{
  if(!req.url.startsWith('/chat/completions')){
    res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html;charset=utf-8');
    const variant=req.url.startsWith('/before')?'before':'current';
    res.end(req.url.endsWith('.js')?bundles[variant]:`<!doctype html><meta charset="utf-8"><script src="/${variant}.js"></script>`);return;
  }
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token){res.writeHead(403).end();return;}
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>300000)throw Error('Request too large');}
    const payload=JSON.parse(body),requestUrl=new URL(req.url,origin),variant=requestUrl.searchParams.get('variant'),caseId=requestUrl.searchParams.get('case');
    if(payload.model!==config.model||payload.thinking?.type!=='enabled'||payload.reasoning_effort!=='low'||!payload.stream)throw Error('Production model/thinking configuration mismatch');
    payload.max_tokens=Math.min(payload.max_tokens??900,config.maxOutputTokens);
    const started=performance.now(),call={variant,caseId,sequence:0,model:payload.model,thinking:payload.thinking,reasoningEffort:payload.reasoning_effort,maxTokens:payload.max_tokens,
      messages:payload.messages,inputSha256:sha(JSON.stringify(payload.messages)),raw:'',finish:undefined,usage:undefined,firstAnswerMs:undefined};
    await runBudgetedRequest(budgetFile,config,async reservation=>{
      call.sequence=reservation.sequence;calls.push(call);persist();
      const stop=new AbortController(),cancel=()=>{if(!res.writableEnded)stop.abort();};res.on('close',cancel);
      try{
        const lastInput=payload.messages.at(-1)?.content;
        const fixture=(followupCases??comparisonCases).find(item=>item.id===caseId),fixtureIndex=fixture?.inputs.indexOf(lastInput)??-1;
        const syntheticText=full&&fixtureIndex>=0?fixture.offline[fixtureIndex]:lastInput?.includes('认真说')?'好，今天不逗你。大事我会先听你的想法。':lastInput?.includes('轻松话题')?'我觉得相爱以后，尊重彼此的心愿比替对方决定更重要。':'我在呢。先听你说。';
        const syntheticBody=[{choices:[{delta:{content:syntheticText},finish_reason:null}]},{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n';
        const upstream=offline?new Response(syntheticBody,{headers:{'Content-Type':'text/event-stream'}}):await fetch(stored.baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:stop.signal});
        call.status=upstream.status;
        if(!upstream.ok){res.writeHead(upstream.status,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'Provider rejected this bounded verification request'}}));return {status:upstream.status};}
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
        const reader=upstream.body.getReader(),decoder=new TextDecoder();let pending='';
        const parse=line=>{if(!line.startsWith('data:'))return;const value=line.slice(5).trim();if(!value||value==='[DONE]')return;
          let event;try{event=JSON.parse(value);}catch{return;}
          if(typeof event.model==='string')call.responseModel=event.model;
          const delta=event.choices?.[0]?.delta?.content;
          if(typeof delta==='string'&&delta){call.firstAnswerMs??=performance.now()-started;call.raw+=delta;}
          if(event.choices?.[0]?.finish_reason)call.finish=event.choices[0].finish_reason;
          if(event.usage)call.usage=event.usage;
        };
        while(true){const part=await reader.read();if(part.done)break;res.write(part.value);pending+=decoder.decode(part.value,{stream:true});const lines=pending.split('\n');pending=lines.pop();lines.forEach(parse);}
        pending+=decoder.decode();if(pending.trim())parse(pending);
        call.durationMs=performance.now()-started;persist();res.end();return {status:upstream.status,usage:call.usage};
      }finally{res.off('close',cancel);}
    });
  }catch{
    // Never echo a provider response, headers or credential-bearing exception.
    errors.push('budget/configuration/transport failure');persist();
    if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'Bounded live trial stopped'}}));else res.end();
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
const sourceFiles=['src/lib/chat/send-service.ts','src/lib/chat/topic-candidates.ts','src/lib/chat/proactive-visit.ts','src/lib/chat-humanizer.ts','src/lib/chat-topic-replies.ts','src/db/chat-topic-state-repo.ts'];
sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,sha(readFileSync(file))]));
for(const variant of followup?['current']:['before','current']){
  const built=await build({entryPoints:['scripts/verify/chat-core-live-trial.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},
  define:{LIVE_PROXY:JSON.stringify(origin+'/chat/completions'),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:'[]','import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"bounded-core-trial"'},
  plugins:variant==='before'?[{name:'frozen-core-baseline',setup(b){b.onLoad({filter:/[\\/]src[\\/].*\.tsx?$/},args=>{const file=Object.keys(frozen).find(file=>resolve(file)===resolve(args.path));if(file)return {loader:file.endsWith('tsx')?'tsx':'ts',contents:readFileSync(join(frozenRoot,'before',file),'utf8')};});}}]:[]});
  bundles[variant]=built.outputFiles[0].text;
  const artifact=join(root,variant+'.bundle.js');writeFileSync(artifact,bundles[variant]);
  const dependencyHashes=Object.fromEntries(Object.keys(built.metafile.inputs).filter(file=>existsSync(file)).map(file=>{
    const original=Object.keys(frozen).find(path=>resolve(path)===resolve(file));
    return [file,sha(readFileSync(variant==='before'&&original?join(frozenRoot,'before',original):file))];
  }));
  bundleEvidence[variant]={artifact,sha256:sha(bundles[variant]),bytes:Buffer.byteLength(bundles[variant]),dependencyHashes,
    note:'Actual served bundle retained before provider calls. Contains only a disposable localhost test token, never the provider key. Source hashes describe build-time dependencies; the bundle is the authoritative executed snapshot.'};
}
const inputs=['古月，我是唐舞麟。今天改了半天还是没弄好，有点泄气，先别给建议。','其实只是想听你说说话。换个轻松话题，你选，别再问我选什么。','这件事我们认真说：以后重要决定先听我的想法，不要替我做主。今天先不逗我，好吗？'];
const trajectories=followup?followupCases:full?comparisonCases:[{id:'initial',inputs}];
if(followup)writeFileSync(join(root,'followup-scope.json'),JSON.stringify({originalReport:'../full-comparison-results-20261022.json',budgetFile,unchangedTotalLimit:72,confirmedPriorRequests:offline?0:60,maximumRemainingActualAttempts:12,plannedMainTurns:12,retriesAlsoConsumeRemainder:true,model:config.model,thinking:config.thinking,reasoningEffort:config.reasoningEffort,maxOutputTokens:config.maxOutputTokens,cases:trajectories.map(({id,inputs,seed})=>({id,turns:inputs.length,seededPriorTurns:seed?.length??0})),noOriginalTranscriptRewriting:true},null,2));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  outer:for(const trajectory of trajectories)for(const variant of followup?['current']:['before','current']){
    const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    const page=await context.newPage();page.on('pageerror',()=>errors.push('isolated page error'));await page.goto(origin+'/'+variant+'?case='+trajectory.id);
    await page.evaluate(()=>window.prepareCoreTrial());
    if(trajectory.seed)await page.evaluate(turns=>window.seedRecordedCoreTrial(turns),trajectory.seed);
    for(let i=0;i<trajectory.inputs.length;i++){
      const ledger=existsSync(budgetFile)?JSON.parse(readFileSync(budgetFile,'utf8')):undefined;
      if(ledger?.stopped||ledger?.requests.length>=config.limit){await context.close();break outer;}
      const result=await page.evaluate(input=>window.runCoreTrialTurn(input),trajectory.inputs[i]);rows.push({variant,caseId:trajectory.id,turn:i+1,...result});persist();
      console.log(JSON.stringify({variant,caseId:trajectory.id,turn:i+1,completed:result.completed,firstPublishedMs:result.firstPublishedMs,totalMs:result.totalMs,requests:calls.length}));
      if(result.failed||!result.replies.length){await context.close();break outer;}
    }
    await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));persist();}
console.log(JSON.stringify({reportPath,apiCalls:report().apiCalls,pairedTurns:rows.length,complete:report().complete}));
if(!report().complete)process.exitCode=1;
