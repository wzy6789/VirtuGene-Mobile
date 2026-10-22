import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-core-implementation-20261021/performance';mkdirSync(root,{recursive:true});
const smallRepeat=process.argv.includes('--small-repeat');
const coldWarm=process.argv.includes('--cold-warm')||smallRepeat;
const phases=coldWarm?['cold','warm']:['single'];
const sizes=smallRepeat?[1000]:[1000,10000,50000],samples=smallRepeat?6:1;
const frozenRoot='release/chat-core-implementation-20261021/delivery',frozen=JSON.parse(readFileSync(join(frozenRoot,'baseline.json'),'utf8')).files;
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const [path,expected] of Object.entries(frozen))if(hash(join(frozenRoot,'before',path))!==expected)throw Error('Frozen source changed: '+path);
const historySource='src/lib/chat-history-index.ts',historyBefore=join(root,'history-index-before.ts');
const diarySource='src/db/diary-repo.ts',diaryBefore=join(root,'diary-repo-before.ts');
const qualitySources=['src/lib/chat-user-visual-risk.ts','src/lib/chat-output-quality.ts'];
const measuredSources=[...Object.keys(frozen),historySource,diarySource,...qualitySources];
const currentHashes=Object.fromEntries(measuredSources.map(path=>[path,hash(path)]));
const bundleRoot=join(root,'stock-bundles-'+Date.now());mkdirSync(bundleRoot,{recursive:true});
const bundles={},bundleEvidence={};for(const variant of ['before','current']){
  const built=await build({entryPoints:['scripts/verify/chat-core-stock-speed.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},
  define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"core-stock-speed"',LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-no-paid-key"',LIVE_RESPONSES:'[]'},
  plugins:variant==='before'?[{name:'frozen-prefix-baseline',setup(builder){builder.onLoad({filter:/[\\/]src[\\/].*\.tsx?$/},args=>{if(resolve(args.path)===resolve(historySource))return {loader:'ts',contents:readFileSync(historyBefore,'utf8')};if(resolve(args.path)===resolve(diarySource))return {loader:'ts',contents:readFileSync(diaryBefore,'utf8')};const path=Object.keys(frozen).find(path=>resolve(path)===resolve(args.path));if(path)return {loader:path.endsWith('tsx')?'tsx':'ts',contents:readFileSync(join(frozenRoot,'before',path),'utf8')};});}}]:[]});
  bundles[variant]=built.outputFiles[0].text;const artifact=join(bundleRoot,variant+'.js');writeFileSync(artifact,bundles[variant]);
  const dependencies=Object.fromEntries(Object.keys(built.metafile.inputs).filter(path=>!path.startsWith('<')).map(path=>{
    const before=variant==='before'?(path===historySource?historyBefore:path===diarySource?diaryBefore:Object.keys(frozen).includes(path)?join(frozenRoot,'before',path):path):path;
    return [path,hash(before)];
  }));
  bundleEvidence[variant]={artifact,sha256:createHash('sha256').update(bundles[variant]).digest('hex'),dependencyHashes:dependencies};
}
const server=createServer((req,res)=>{const variant=req.url.startsWith('/before')?'before':'current';res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html;charset=utf-8');res.end(req.url.endsWith('.js')?bundles[variant]:`<!doctype html><meta charset="utf-8"><script src="/${variant}.js"></script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-precise-memory-info']});const runs=[],checks=[];let error,external=0;
try{
  for(const role of ['古月娜','陆雪琪'])for(const messages of sizes)for(let sample=0;sample<samples;sample++)for(const variant of sample%2?['current','before']:['before','current']){
    const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external++;return route.abort();});
    const page=await context.newPage();await page.goto(origin+'/'+variant);await page.evaluate(({messages,role})=>window.prepareCoreStock(messages,role),{messages,role});
    const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
    for(const phase of phases){
      const result=await page.evaluate(phase=>window.runCoreStock(phase),phase);runs.push({variant,sample,...result});
      console.log(JSON.stringify({variant,role,messages,sample,phase,preparationMs:result.preparationMs,firstPublishMs:result.firstPublishMs,completed:result.completed,error:result.error}));
    }
    await context.close();
  }
  for(const current of runs.filter(run=>run.variant==='current')){const before=runs.find(run=>run.variant==='before'&&run.sample===current.sample&&run.phase===current.phase&&run.fixture.role===current.fixture.role&&run.fixture.messages===current.fixture.messages),label=current.fixture.role+'/'+current.fixture.messages+'/'+current.phase+'/'+current.sample;
    checks.push({name:label+' identical synthetic originals',ok:before.fixture.sha256===current.fixture.sha256});
    checks.push({name:label+' identical full model input',ok:before.fullModelInputSha256===current.fullModelInputSha256});
    checks.push({name:label+' original message fields preserved after send',ok:before.sourceBytesPreserved&&current.sourceBytesPreserved});
    checks.push({name:label+' current common-term index reads are bounded',ok:current.preRequestReads.messageHistorySearch.keys<=100});
    checks.push({name:label+' unrelated private diary bodies never enter preparation',ok:current.preRequestReads.diaries.bodies===0});
    checks.push({name:label+' one request, thinking enabled and same final dialogue',ok:before.completed&&current.completed&&before.requests===1&&current.requests===1&&before.answer===current.answer&&current.wireConfig.thinking?.type==='enabled'&&JSON.stringify(before.wireConfig)===JSON.stringify(current.wireConfig)});
    checks.push({name:label+' current safe prefix precedes controlled terminal chunk',ok:current.firstPublishMs<current.providerFinalMs-200});
  }
}catch(cause){error=String(cause);}finally{await browser.close();await new Promise(r=>server.close(r));}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const repeatedSummary=smallRepeat&&!error&&runs.length===2*sizes.length*samples*phases.length*2?['古月娜','陆雪琪'].flatMap(role=>phases.map(phase=>{
  const cell=runs.filter(run=>run.fixture.role===role&&run.phase===phase),before=cell.filter(run=>run.variant==='before'),current=cell.filter(run=>run.variant==='current');
  const summary=items=>({n:items.length,preparationMedianMs:median(items.map(item=>item.preparationMs)),preparationRangeMs:[Math.min(...items.map(item=>item.preparationMs)),Math.max(...items.map(item=>item.preparationMs))],firstPublishMedianMs:median(items.map(item=>item.firstPublishMs))});
  return {role,phase,before:summary(before),current:summary(current),pairedPreparationDeltaMedianMs:median(current.map(item=>item.preparationMs-before.find(prior=>prior.sample===item.sample).preparationMs))};
})):undefined;
const report={complete:!error&&external===0&&checks.length===2*sizes.length*samples*phases.length*7&&checks.every(check=>check.ok),checks,failures:checks.filter(check=>!check.ok),runs,error,sourceHashesBefore:currentHashes,sourceHashesAfter:Object.fromEntries(measuredSources.map(path=>[path,hash(path)])),frozenSources:{...frozen,[historySource]:hash(historyBefore),[diarySource]:hash(diaryBefore)},bundleEvidence,externalRequests:external,apiCalls:0,microphoneUsed:false,deviceTested:false,
  coldWarm,smallRepeat,samples,repeatedSummary,phaseDefinition:coldWarm?'cold = first send in a fresh page after synthetic fixture setup, not APK launch or schema upgrade; warm = next send in the same live page/database, retaining first-turn native rows. Explicit reply separators keep equivalent history on both variants. No data cleared or authorization cached between phases.':'single first send only',
  scope:'Actual sender on native isolated synthetic databases: '+sizes.join('/')+' messages, 8105 tombstones, 500 private diaries, multiple accounts and roles. The ten frozen pre-prefix files plus the pre-optimization history and diary repositories vary; all other code is shared. '+(smallRepeat?'Six paired desktop samples per phase/cell; order alternates before/current then current/before to inspect the prior small-stock preparation concern.':'Single desktop sample per phase/cell.')+' Controlled SSE40/400ms, thinking remains enabled. Not provider latency, peak RSS, presented-frame timing or Android.'};
const path=join(root,(smallRepeat?'stock-small-repeat-':coldWarm?'stock-cold-warm-':'stock-')+Date.now()+'.json');writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify({path,complete:report.complete,checks:checks.length,failures:report.failures,error,repeatedSummary},null,2));if(!report.complete)process.exitCode=1;
