/** Replay saved provider bytes through the CURRENT real sender and isolated DB.
 * No connection loader, provider fetch or paid budget mutation is permitted.
 * This proves handling of recorded outputs, never new model expression quality. */
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
const base='release/chat-core-implementation-20261021';
const root=join(base,'review/recorded-replay-'+Date.now());mkdirSync(root,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
const inputPaths={initial:join(base,'live/initial-trial-results-20261022.json'),comparison:join(base,'live/full-comparison/full-comparison-results-20261022.json'),followup:join(base,'live/full-comparison/review-followup-20261022/full-comparison-results-20261022.json')};
const inputs=Object.fromEntries(Object.entries(inputPaths).map(([key,path])=>[key,JSON.parse(readFileSync(path,'utf8'))]));
for(const [key,relative]of [['finalSource','live/final-source-followup-20261022/result.json'],['currentScene','live/final-source-followup-20261022/scene-recheck/result.json']]){
  const path=join(base,relative);if(!existsSync(path))continue;
  const original=JSON.parse(readFileSync(path,'utf8'));
  if(!original.complete||original.offline)throw Error('Additional real original is not complete');
  inputPaths[key]=path;inputs[key]=original;
}
const budgetPaths=[join(base,'live/initial-trial-budget-20261022.json'),join(base,'live/full-comparison/full-comparison-budget-20261022.json')];
const cumulative=join(base,'live/final-source-followup-20261022/cumulative-budget-20261022.json');if(existsSync(cumulative))budgetPaths.push(cumulative);
const budgetBefore=Object.fromEntries(budgetPaths.map(path=>[path,sha(readFileSync(path))]));
const cases=[];
for(const [dataset,report]of Object.entries(inputs)){
  for(const variant of [...new Set(report.rows.map(row=>row.variant))])for(const caseId of [...new Set(report.rows.filter(row=>row.variant===variant).map(row=>row.caseId))]){
    const rows=report.rows.filter(row=>row.variant===variant&&row.caseId===caseId);
    const turns=rows.map(row=>{
      const calls=report.calls.filter(call=>call.variant===variant&&call.caseId===caseId&&call.messages.at(-1)?.content===row.input);
      if(calls.length!==1||!calls[0].raw||calls[0].finish!=='stop')throw Error('Recorded transport is not an unambiguous complete original');
      return {input:row.input,original:row,call:calls[0]};
    });
    let seed;
    if((dataset==='followup'||dataset==='finalSource')&&caseId.startsWith('recorded-')){
      const sourceCase=caseId==='recorded-episode'?'emotion':'continuity',count=caseId==='recorded-episode'?5:8;
      seed=inputs.comparison.rows.filter(row=>row.variant==='current'&&row.caseId===sourceCase).slice(0,count).map(({input,replies})=>({input,replies}));
    }
    if(dataset==='currentScene')seed=inputs.finalSource.rows.filter(row=>row.caseId==='emotion').slice(0,4).map(({input,replies})=>({input,replies}));
    cases.push({dataset,variant,caseId,turns,seed});
  }
}
const expectedTurns=Object.values(inputs).reduce((n,input)=>n+input.rows.length,0);
if(cases.reduce((n,item)=>n+item.turns.length,0)!==expectedTurns)throw Error('Replay must retain every original recorded turn');
const token=randomUUID(),rows=[],checks=[],errors=[],requests=[];let bundle='',origin='',active;
const check=(name,ok,detail)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const server=createServer(async(req,res)=>{
  if(req.url==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if(!req.url.startsWith('/chat/completions')){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');return;}
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token||!active){res.writeHead(403).end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  const payload=JSON.parse(body),turn=active.turn;
  if(payload.messages?.at(-1)?.content!==turn.input||++active.attempt>2){errors.push('unexpected replay request');res.writeHead(503).end();return;}
  const request={dataset:active.scene.dataset,variant:active.scene.variant,caseId:active.scene.caseId,turn:active.index+1,attempt:active.attempt,inputSha256:sha(JSON.stringify(payload.messages)),rawSha256:sha(turn.call.raw),messages:payload.messages};requests.push(request);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  // Deliberately split source bytes into small chunks to exercise early review.
  // No original chunk timing was retained; these delays are NOT a speed test.
  const glyphs=Array.from(turn.call.raw);
  for(let at=0;at<glyphs.length;at+=9){
    if(res.destroyed)break;
    res.write('data: '+JSON.stringify({model:turn.call.responseModel??turn.call.model,choices:[{delta:{content:glyphs.slice(at,at+9).join('')},finish_reason:null}]})+'\n\n');
    await new Promise(resolve=>setTimeout(resolve,1));
  }
  if(!res.destroyed)res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0}})+'\n\ndata: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
const built=await build({entryPoints:['scripts/verify/chat-core-live-trial.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:JSON.stringify(origin+'/chat/completions'),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:'[]','import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"recorded-output-replay"'}});
bundle=built.outputFiles[0].text;writeFileSync(join(root,'current.bundle.js'),bundle);
const dependencyHashes=Object.fromEntries(Object.keys(built.metafile.inputs).filter(path=>existsSync(path)).map(path=>[path,sha(readFileSync(path))]));
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});let external=0;
try{
  for(const scene of cases){
    const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external++;return route.abort();});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/?case='+scene.caseId);await page.evaluate(()=>window.prepareCoreTrial());
    if(scene.seed)await page.evaluate(seed=>window.seedRecordedCoreTrial(seed),scene.seed);
    for(let index=0;index<scene.turns.length;index++){
      const turn=scene.turns[index];active={scene,index,turn,attempt:0};
      const draftReview=await page.evaluate(({raw,text})=>window.inspectRecordedCoreTrialDraft(raw,text),{raw:turn.call.raw,text:turn.input});
      const result=await page.evaluate(input=>window.runCoreTrialTurn(input),turn.input);
      const row={dataset:scene.dataset,originalVariant:scene.variant,caseId:scene.caseId,turn:index+1,originalRaw:turn.call.raw,originalReplies:turn.original.replies,draftReview,mockRequests:active.attempt,...result};rows.push(row);
      check(scene.dataset+'/'+scene.variant+'/'+scene.caseId+'/'+(index+1)+' safe nonempty native reply',result.completed&&!result.failed&&result.replies.length>0,{error:result.error,completion:result.rows.map(row=>row.replyCompletion)});
    }
    await context.close();
  }
}catch(error){errors.push(String(error));}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
for(const path of budgetPaths)check('paid cumulative ledger byte-preserved: '+path,sha(readFileSync(path))===budgetBefore[path]);
const captured=(dataset,caseId,turn)=>rows.find(row=>row.dataset===dataset&&row.originalVariant==='current'&&row.caseId===caseId&&row.turn===turn)?.replies.join('')??'';
check('captured unsupported completed episode removed from the actual native replay',!captured('comparison','emotion',6).includes('我也有过拿错东西'));
check('captured wrong speaker removed while preserving independent future wish',!captured('comparison','continuity',9).includes('你说汤姆')&&captured('comparison','continuity',9).includes('要是哪天'));
check('captured retrospective mental process removed from intact emotional replay',!captured('followup','emotion',6).includes('我最近有个'));
check('captured unsupported recurring action removed from original seeded context',!captured('followup','recorded-episode',1).includes('我有时候东西明明'));
check('all original recorded turns were replayed',rows.length===expectedTurns);
check('no external transport attempted',external===0);
const report={at:new Date().toISOString(),complete:checks.every(item=>item.ok)&&errors.length===0,checks,failures:checks.filter(item=>!item.ok),rows,requests,errors,externalRequests:external,providerCalls:0,providerTokens:0,model:'recorded prior deepseek-flash output; no current model call',codingModel:'未确认',codingReasoning:'未确认',inputEvidence:Object.fromEntries(Object.entries(inputPaths).map(([key,path])=>[key,{path,sha256:sha(readFileSync(path))}])),bundleSha256:sha(bundle),dependencyHashes,budgetBefore,
  scope:'Current real sender/native isolated DB, all'+expectedTurns+' saved provider outputs; original whole scenes retained separately. Fixed saved bytes replayed on each allowed correction,9-codepoint controlled stream chunks. Changed histories/prompts may differ after repair. No newly sampled model, no model speed measurement, no hardware/audio/microphone, no credential loader, no paid budget reset. Replay output must not replace or masquerade as original model dialogue.'};
writeFileSync(join(root,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({path:join(root,'result.json'),complete:report.complete,turns:rows.length,checks:checks.length,failures:report.failures,errors,providerCalls:0},null,2));
if(!report.complete)process.exitCode=1;
