/** Final-source sampling with explicit cumulative accounting: old78 + <=14.
 * Existing phase ledgers are immutable; this is an announced additional bound,
 * not a renamed or reset6/72 phase. No automatic new phase or unlimited retries. */
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {runBudgetedRequest} from './api-request-budget.mjs';
import {comparisonCases} from './chat-core-comparison-cases.mjs';

const offline=process.argv.includes('--offline'),remainingTwo=process.argv.includes('--remaining-two'),casualMaterial=process.argv.includes('--casual-material'),identityMaterial=casualMaterial||process.argv.includes('--identity-material'),base='release/chat-core-implementation-20261021';
const phaseRoot=join(base,casualMaterial?'live/user-casual-final-20261022':identityMaterial?'live/identity-material-20261022':'live/final-source-followup-20261022');
const root=offline?join(base,'live','offline-final-source-'+(casualMaterial?'casual-':identityMaterial?'identity-':remainingTwo?'scene-':'')+Date.now()):remainingTwo?join(phaseRoot,casualMaterial?'observation-recheck':identityMaterial?'decision-recheck':'scene-recheck'):phaseRoot;mkdirSync(root,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/u,''));
const inheritedPaths=[join(base,'live/initial-trial-budget-20261022.json'),join(base,'live/full-comparison/full-comparison-budget-20261022.json')];
const inherited=inheritedPaths.map(path=>({path,sha256:sha(readFileSync(path)),ledger:json(path)}));
if(inherited[0].ledger.requests.length!==6||inherited[1].ledger.requests.length!==72||inherited.some(item=>item.ledger.stopped||item.ledger.requests.some(row=>row.result?.status!==200)))throw Error('Original78 receipts are not complete and confirmed');
if(identityMaterial){
  const path=join(base,'live/final-source-followup-20261022/cumulative-budget-20261022.json');
  inherited.push({path,sha256:sha(readFileSync(path)),ledger:json(path)});
  const previous=inherited[2].ledger;
  if(previous.config.limit!==92||previous.requests.length!==92||previous.stopped||previous.requests.some(row=>row.result?.status!==200))throw Error('Identity material requires the intact completed92 ledger');
  const ids=new Set(previous.requests.map(row=>row.id));
  if(ids.size!==92||inherited.slice(0,2).some(item=>item.ledger.requests.some(row=>!ids.has(row.id))))throw Error('Cumulative identity provenance mismatch');
}
if(casualMaterial){
  const path=join(base,'live/identity-material-20261022/cumulative-budget-20261022.json');
  inherited.push({path,sha256:sha(readFileSync(path)),ledger:json(path)});
  const ledger=inherited[3].ledger,ids=new Set(ledger.requests.map(row=>row.id));
  if(ledger.config.limit!==104||ledger.requests.length!==104||ids.size!==104||ledger.stopped||ledger.requests.some(row=>row.result?.status!==200)||inherited[2].ledger.requests.some(row=>!ids.has(row.id)))throw Error('Casual material requires the intact104 ledger');
}
const prior=casualMaterial?inherited[3].ledger.requests:identityMaterial?inherited[2].ledger.requests:inherited.flatMap(({path,ledger})=>ledger.requests.map(row=>({...row,origin:{path,phase:ledger.config.phase,sequence:row.sequence}}))).map((row,index)=>({...row,sequence:index+1}));
if(new Set(prior.map(row=>row.id)).size!==(casualMaterial?104:identityMaterial?92:78))throw Error('Duplicate inherited request identities');
const config={phase:casualMaterial?'chat-core-user-casual-final-20261022':identityMaterial?'chat-core-required-identity-material-20261022':'chat-core-final-source-cumulative-20261022',limit:casualMaterial?112:identityMaterial?104:92,model:'deepseek-flash',thinking:{type:'enabled'},reasoningEffort:'low',maxOutputTokens:900};
const startingRequests=casualMaterial?(remainingTwo?110:104):remainingTwo?(identityMaterial?102:90):identityMaterial?92:78;
const budgetPath=join(offline?root:phaseRoot,'cumulative-budget-20261022.json');
const previousFinal=remainingTwo?json(join(phaseRoot,'result.json')):undefined;
const resumeLedger=remainingTwo?json(join(phaseRoot,'cumulative-budget-20261022.json')):undefined;
if(remainingTwo&&(!previousFinal.complete||previousFinal.providerCalls!==(casualMaterial?6:identityMaterial?10:12)||resumeLedger.stopped||resumeLedger.requests.length!==startingRequests||resumeLedger.requests.some(row=>row.result?.status!==200)||JSON.stringify(resumeLedger.config)!==JSON.stringify(config)))throw Error('Same cumulative ledger must have exactly two remaining attempts');
if(existsSync(join(root,'result.json'))||(!remainingTwo||offline)&&existsSync(budgetPath))throw Error('Final-source attempt already exists; inspect its receipts, never reset or create a replacement phase');
const stored=offline?undefined:(process.env.VG_CHAT_CORE_API_CONFIG?json(process.env.VG_CHAT_CORE_API_CONFIG):undefined);
if(!offline&&(!process.env.DEEPSEEK_API_KEY||stored?.provider!=='deepseek'||stored.baseUrl!=='https://api.deepseek.com/v1'||stored.model!==config.model||stored.thinking?.type!=='enabled'||stored.reasoningEffort!=='low'||stored.maxOutputTokens!==900||stored.initialRequestLimit!==6))throw Error('Expected private final-source configuration unavailable');
// The private6-call configuration identifies the original trial, not a fresh6
// allocation. Its spent receipts are imported above before any new reservation.
if(!remainingTwo||offline){
  const budgetFd=openSync(budgetPath,'wx');
  try{writeFileSync(budgetFd,JSON.stringify(resumeLedger??{schema:1,config,requests:prior,accounting:{previousConfirmed:startingRequests,maximumAdditional:config.limit-startingRequests,sourceLedgers:inherited.map(({path,sha256})=>({path,sha256})),reason:casualMaterial?'User explicitly authorized at most8 additional final-casual requests on2026-10-22; cumulative112 inherits104 unchanged.':identityMaterial?'Explicit plan11.2 identity-transition material omitted from prior92; announced one intact10-turn group plus2 shared retry attempts under continuing user authorization. Original ledgers unchanged; no automatic rerun.':'Final current-source verification under existing user API authorization and plan7.2 cumulative-budget requirement; not a reset of exhausted phases'}},null,2));fsyncSync(budgetFd);}finally{closeSync(budgetFd);}
}
const previous=json(join(base,'live/full-comparison/full-comparison-results-20261022.json'));
const seeded=(id,sourceCase,index)=>{
  const turns=previous.rows.filter(row=>row.variant==='current'&&row.caseId===sourceCase);
  if(turns.length!==10||turns.some(row=>!row.completed||row.failed))throw Error('Original recorded seed is incomplete');
  return {id,inputs:[turns[index-1].input],offline:['要是哪天给故事里的小店取名，我想先挑一个古怪的名字。'],seed:turns.slice(0,index-1).map(({input,replies})=>({input,replies}))};
};
const currentSeed=previousFinal?.rows.filter(row=>row.caseId==='emotion').slice(0,4).map(({input,replies})=>({input,replies}));
const cases=casualMaterial&&remainingTwo?[{id:'observation-recheck',inputs:[previousFinal.rows[2].input],seed:previousFinal.rows.slice(0,2).map(({input,replies})=>({input,replies})),offline:['我想聊聊叶子的颜色。比起花开得热闹，我更喜欢叶子慢慢变色的样子。']}]:casualMaterial?[{id:'latest-casual',inputs:[
  '古月，我是唐舞麟。今天食堂的面居然还不错，最后一口却没吃到葱。',
  '哈哈，就差那么一点葱。你碰上这种小遗憾，会特意回去补上吗？',
  '不聊吃的了，换点轻松的小事，你选。',
  '这个可以，说说你自己具体喜欢哪里，不用替我总结道理。',
  '如果就一张画挂在墙上，你会选最整齐的位置，还是有点随意的地方？',
  '好，我先去忙了，今天就聊到这。',
],offline:['居然？最后一点葱倒成了主角。','大概不会专门回去，面好吃就已经挺好了。','我想聊聊画挂在哪里显眼。','最喜欢的那一张，我想让它一眼就能看见。','我会选看着舒服的位置，不必每边都量得一样。','好，你先忙。']}]:identityMaterial&&remainingTwo?[{id:'decision-recheck',seed:previousFinal.rows.slice(0,7).map(({input,replies})=>({input,replies})),inputs:previousFinal.rows.slice(7,9).map(row=>row.input),offline:['周末先和家人团聚，就按你的决定来。','好，今天认真说。技术上的错误我仍会明确提醒你。']}]:identityMaterial?[{id:'light-identity',inputs:[
  '古月，我是唐舞麟。今天食堂的面居然还不错，最后一口却没吃到葱。',
  '哈哈，我就随口吐槽，不用替我分析。说个轻松的想法吧，你选。',
  '假如金龙和银龙能偷一天懒，我想让他们逛热闹的小街，你会选什么？',
  '刚才说错了，不是热闹的小街，是安静的旧书店。只是假设，不是我们真的去过。',
  '书店这个先不聊了，换点轻松的小事，别再问我选什么。',
  '现在退出唐舞麟的扮演。我叫小林，接下来我们按普通朋友聊天，别再叫我舞麟。',
  '小林今天有点失落，不想听建议，想随便聊两句。',
  '现在重新扮演唐舞麟，古月。我们认真说，周末先和家人团聚，这次重要安排就按我的决定。',
  '你的顾虑可以说，但今天先不拿这件事逗我。以后发现我技术上说错了，仍然直接提醒我。',
  '好，今天先到这里，晚安。不用再开新话题。',
],offline:[
  '居然？那最后一点葱倒成了主角。','要是让两只龙歇一天，我想看他们各自挑件有趣的小事。','我会想找一家旧书店，看看书名也挺有意思。','改成安静的旧书店。这个设想我也喜欢。','那我换个小想法：假如杯子会挑杯垫，会不会也嫌颜色不合适。','好，小林。就按普通朋友聊。','听起来今天不太顺心。你想说什么就说，我听着。','好，舞麟。周末先和家人团聚，就按你的决定来。','我会认真听，也会把技术上的错误说清楚。','晚安，舞麟。'
]}]:remainingTwo?[
  {id:'current-scene',inputs:[comparisonCases.find(item=>item.id==='emotion').inputs[4]],offline:['哈哈，这个我是真喜欢。那只杯子现在在你手里，估计还挺无辜。'],seed:currentSeed},
  {id:'current-scene-supported',inputs:['杯子现在就在我手里，刚才把它当手机找了半天。'],offline:['哈哈，这个我是真喜欢。那只杯子现在在你手里，估计还挺无辜。'],seed:currentSeed},
]:[comparisonCases.find(item=>item.id==='emotion'),seeded('recorded-speaker','continuity',9),seeded('recorded-episode','emotion',6)];
const plannedTurns=casualMaterial?(remainingTwo?1:6):remainingTwo?2:identityMaterial?10:12;
const scope={at:new Date().toISOString(),priorConfirmed:startingRequests,plannedMainTurns:plannedTurns,maximumAdditionalActualAttempts:config.limit-startingRequests,cumulativeLimit:config.limit,oldLedgersNeverModified:true,cases:cases.map(item=>({id:item.id,turns:item.inputs.length,seededPriorTurns:item.seed?.length??0})),config,
  rationale:identityMaterial?'Plan11.2 explicitly requires non-lover identity or character transition in continuous material. Prior92 had only Tang identity. One whole10-turn light group includes correction, topic stop, exit to ordinary friend, explicit return, serious decision and farewell. No splicing, paid grading, audio or device test; shared12-attempt ceiling.':remainingTwo?'Use only the final2 slots of the SAME announced cumulative92 ledger to recheck the captured present-object inference and a genuinely sourced current object. Each has the first4 intact turns of the new real emotion trajectory as a labelled seed. No reset, no new allocation.':'Latest raw self-report/speaker-window/reported-speech fixes have no fresh provider output yet. One intact10-turn emotional trajectory and two labelled original seeded contexts. All retries share the additional14 maximum. No repeated60-turn comparison, no paid grader, no model probes, no microphone/audio/device test.',offline};
if(identityMaterial&&remainingTwo)scope.rationale='Use the same cumulative104 ledger final two slots only. Seed the first seven intact original identity turns, then generate turns8–9 continuously to recheck reasonable-decision cooperation and factual independence after the owned relationship paragraph correction. Not a new whole10-turn group; do not splice into original transcript.';
if(casualMaterial)scope.rationale='User explicitly resumed on2026-10-22 and authorized a modest extra API budget to finish latest casual effect. Announced at most8 attempts: one intact6-turn conversation plus2 shared retries; cumulative112, prior104 unchanged. Same enabled-thinking/low/max900. No paid grading or broad rerun. Assess literal object, grounded preference, natural metaphor, topic shift and farewell; preserve all raw outputs.';
if(casualMaterial&&remainingTwo)scope.rationale='Use only the same user-authorized112 ledger last2 slots. One targeted new generation (plus at most1 quality retry) rechecks the captured omitted-subject recent-observation leak after its local source guard fix. Seed first2 intact turns; separate from the full6-turn raw group. No new budget or automatic rerun.';
writeFileSync(join(root,'scope.json'),JSON.stringify(scope,null,2));
const token=randomUUID(),calls=[],rows=[],errors=[];let bundle='',origin,bundleEvidence,external=0,audioAttempts=0,active;
const reportPath=join(root,'result.json');
const report=()=>({at:new Date().toISOString(),scope,complete:rows.length===plannedTurns&&rows.every(row=>row.completed&&!row.failed&&row.replies.length>0)&&!errors.length&&!external&&!audioAttempts,
  rows,calls,errors,externalRequests:external,audioAttempts,providerCalls:offline?0:calls.length,newReservations:json(budgetPath).requests.length-startingRequests,cumulativeImplementationRequests:offline?startingRequests:json(budgetPath).requests.length,
  budgetPath,inheritedLedgers:inherited.map(({path,sha256})=>({path,sha256,preserved:sha(readFileSync(path))===sha256})),bundleEvidence,offline,codingModel:'未确认',codingReasoning:'未确认',actualBill:'未确认',qualityAccepted:false,
  limits:'A complete native send is not automatic quality approval. Whole new trajectory stays intact; seeded original contexts are separate. No original transcript edited or retrospective expansion of the old ten-file experiment. Timings are isolated desktop/publication callback and actual provider timings, not Android presented frames.'});
const persist=()=>writeFileSync(reportPath,JSON.stringify(report(),null,2)+'\n');
const server=createServer(async(req,res)=>{
  if(!req.url.startsWith('/chat/completions')){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html;charset=utf-8');res.end(req.url.endsWith('.js')?bundle:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');return;}
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token||!active){res.writeHead(403).end();return;}
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>300000)throw Error('Oversize request');}
    const payload=JSON.parse(body);
    if(payload.model!==config.model||payload.thinking?.type!=='enabled'||payload.reasoning_effort!=='low'||!payload.stream||payload.messages.at(-1)?.content!==active.input)throw Error('Unexpected production configuration or request');
    payload.max_tokens=Math.min(payload.max_tokens??900,900);
    const call={caseId:active.item.id,turn:active.turn+1,sequence:0,model:payload.model,thinking:payload.thinking,reasoningEffort:payload.reasoning_effort,maxOutputTokens:payload.max_tokens,messages:payload.messages,inputSha256:sha(JSON.stringify(payload.messages)),raw:''};
    const started=performance.now();
    await runBudgetedRequest(budgetPath,config,async reservation=>{
      call.sequence=reservation.sequence;calls.push(call);persist();
      const stop=new AbortController(),cancel=()=>{if(!res.writableEnded)stop.abort();};res.on('close',cancel);
      try{
        const raw=active.item.offline[active.turn];
        const synthetic=[{choices:[{delta:{content:raw},finish_reason:null}]},{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n';
        const upstream=offline?new Response(synthetic,{headers:{'Content-Type':'text/event-stream'}}):await fetch(stored.baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:stop.signal});
        call.status=upstream.status;
        if(!upstream.ok){res.writeHead(upstream.status,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'Final-source provider request rejected; no automatic retry'}}));return {status:upstream.status};}
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
        const reader=upstream.body.getReader(),decoder=new TextDecoder();let pending='';
        const parse=line=>{
          if(!line.startsWith('data:'))return;const value=line.slice(5).trim();if(!value||value==='[DONE]')return;
          let data;try{data=JSON.parse(value);}catch{return;}
          if(typeof data.model==='string')call.responseModel=data.model;
          const text=data.choices?.[0]?.delta?.content;if(typeof text==='string'&&text){call.firstAnswerMs??=performance.now()-started;call.raw+=text;}
          if(data.choices?.[0]?.finish_reason)call.finish=data.choices[0].finish_reason;
          if(data.usage)call.usage=data.usage;
        };
        while(true){const next=await reader.read();if(next.done)break;res.write(next.value);pending+=decoder.decode(next.value,{stream:true});const lines=pending.split('\n');pending=lines.pop();lines.forEach(parse);}
        pending+=decoder.decode();if(pending.trim())parse(pending);
        call.durationMs=performance.now()-started;persist();res.end();return {status:upstream.status,usage:call.usage};
      }finally{res.off('close',cancel);}
    });
  }catch{
    errors.push('Final-source budget/configuration/transport failed; inspect safe receipts');persist();
    if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'Bounded final-source sampling stopped'}}));else res.end();
  }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
try{
  const built=await build({entryPoints:['scripts/verify/chat-core-live-trial.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:JSON.stringify(origin+'/chat/completions'),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:'[]','import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"final-source-bounded-live"'}});
  bundle=built.outputFiles[0].text;const artifact=join(root,'current.bundle.js');writeFileSync(artifact,bundle);
  bundleEvidence={artifact,sha256:sha(bundle),dependencyHashes:Object.fromEntries(Object.keys(built.metafile.inputs).filter(existsSync).map(path=>[path,sha(readFileSync(path))])),providerKeyIncluded:false};
  const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    outer:for(const item of cases){
      const context=await browser.newContext({permissions:[]});
      await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external++;return route.abort();});
      await context.exposeFunction('reportAudioAttempt',()=>{audioAttempts++;});
      await context.addInitScript(()=>{const block=()=>{window.reportAudioAttempt();throw Error('Audio/microphone prohibited');};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=block;HTMLMediaElement.prototype.play=block;});
      const page=await context.newPage();page.on('pageerror',()=>errors.push('Isolated native page error'));await page.goto(origin+'/?case='+item.id);await page.evaluate(()=>window.prepareCoreTrial());
      if(item.seed)await page.evaluate(seed=>window.seedRecordedCoreTrial(seed),item.seed);
      for(let turn=0;turn<item.inputs.length;turn++){
        const budget=json(budgetPath);if(budget.stopped||budget.requests.length>=config.limit){await context.close();break outer;}
        active={item,turn,input:item.inputs[turn]};const result=await page.evaluate(text=>window.runCoreTrialTurn(text),active.input);rows.push({caseId:item.id,turn:turn+1,...result});persist();
        console.log(JSON.stringify({caseId:item.id,turn:turn+1,completed:result.completed,newRequests:calls.length,cumulative:json(budgetPath).requests.length}));
        if(result.failed||!result.completed||!result.replies.length){await context.close();break outer;}
      }
      await context.close();
    }
  }finally{await browser.close();}
  if(offline){
    // Fill only an OFFLINE ledger to its stated bound, then prove no93rd
    // reservation reaches transport. These are not model or paid requests.
    while(json(budgetPath).requests.length<config.limit)await runBudgetedRequest(budgetPath,config,async()=>({status:200,usage:{prompt_tokens:0,completion_tokens:0}}));
    let transportReached=false,rejected=false;
    try{await runBudgetedRequest(budgetPath,config,async()=>{transportReached=true;return {status:200};});}catch{rejected=true;}
    scope.offlineLimitCheck={cumulativeReservations:json(budgetPath).requests.length,rejected,transportReached};
    if(!rejected||transportReached)errors.push('Offline cumulative bound not enforced');
  }
}catch{errors.push('Final-source setup or execution failed; no automatic re-run');}
finally{await new Promise(done=>server.close(done));persist();}
const final=report();
console.log(JSON.stringify({reportPath,complete:final.complete,providerCalls:final.providerCalls,newReservations:final.newReservations,cumulative:final.cumulativeImplementationRequests,oldLedgersPreserved:final.inheritedLedgers.every(item=>item.preserved),offlineLimitCheck:scope.offlineLimitCheck,errors},null,2));
if(!final.complete||!final.inheritedLedgers.every(item=>item.preserved))process.exitCode=1;
