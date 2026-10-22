import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const dir='.tmp-preview/voice-parallel-recall-20261015';
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={results:[],errors:[],realApiCalls:0};
const median=values=>{const v=[...values].sort((a,b)=>a-b);return(v[Math.floor((v.length-1)/2)]+v[Math.ceil((v.length-1)/2)])/2;};
try {
 for(const label of ['before','after']) {
  const bundle=await build({entryPoints:['scripts/verify/voice-context-latency.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'},plugins:[{name:'scoped-query-comparison',setup(b){
   b.onLoad({filter:/lib[\\/]character-memory\.ts$/},args=>{
    let contents=readFileSync(dir+'/before/character-memory.ts','utf8');
    if(label==='after'){
      const start=contents.indexOf('      const perActor = await Promise.all(audience.map(async characterId => ({');
      const end=contents.indexOf('      const supportingIds',start);
      if(start<0||end<0)throw Error('Frozen experiment block missing');
      contents=contents.slice(0,start)+`      const perActor = await Promise.all(audience.map(async characterId => {
        const [shared, scenes, finished, live] = await Promise.all([
          selectRecallableSharedMemories({ userId: p.userId, worldId: world.id, characterId, limit: 8 }),
          selectRecallableScenes({ userId: p.userId, worldId: world.id, characterId, limit: 6 }),
          selectRecentFinishedSceneMoments({ userId: p.userId, worldId: world.id, characterId, limit: 1 }),
          selectLiveSceneMoments({ userId: p.userId, worldId: world.id, characterId, limit: 3 }),
        ]);
        return { shared, scenes, finished, live };
      }));
`+contents.slice(end);
    }
    return{contents,loader:'ts',resolveDir:dirname(args.path)};
   });
   b.onLoad({filter:/verify[\\/]voice-context-latency\.ts$/},args=>{
    let contents=readFileSync(args.path,'utf8');
    contents=`import { verifyKnowledgeScope } from './voice-knowledge-scope-check';\n`+contents;
    contents=contents.replace('return { samples, checks, sourceResults, turns, fixture:', 'await verifyKnowledgeScope(); return { samples, checks, sourceResults, turns, fixture:');
    const marker='  const samples = [];';
    if(!contents.includes(marker))throw Error('Fixture insertion marker missing');
    contents=contents.replace(marker,`await db.characterKnowledge.bulkPut(Array.from({length:10000},(_,i)=>({id:'other-world-'+i,userId:i%2?'u':'foreign',worldId:'not-current-world',characterId:'a',eventId:'not-selected-'+i,knowledgeLevel:'full',canMention:true,learnedAt:now})) as any);
      ${marker}`);
    return{contents,loader:'ts',resolveDir:dirname(args.path)};
   });
  }}]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<script src="/test.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext();
  try{
   const page=await context.newPage();await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.voiceContextLatency);
   const result=await page.evaluate(()=>window.voiceContextLatency(true,true));
   report.results.push({label,...result});
   console.log(JSON.stringify({label,prepareMedianMs:median(result.samples.map(s=>s.prepareMs)),rows:result.samples[0].preparation.rows,knowledgeRows:result.samples[0].preparation.tables.characterKnowledge}));
  }finally{await context.close();await new Promise(r=>server.close(r));}
 }
 report.promptUnchanged=new Set(report.results.flatMap(r=>r.samples.map(s=>s.promptHash))).size===1;
 if(!report.promptUnchanged)throw Error('Full model input changed');
 report.summary=report.results.map(r=>({label:r.label,prepareMedianMs:median(r.samples.map(s=>s.prepareMs)),rows:r.samples[0].preparation.rows,knowledgeRows:r.samples[0].preparation.tables.characterKnowledge,checks:r.checks,sourceResults:r.sourceResults}));
 report.scope='Only four independent recall selectors changed from serial awaits to Promise.all; same seeded DB with 10000 same-role other-world knowledge rows, plus populated voice fixture. Desktop CPU 4x, simulated model/audio, no physical phone or API.';
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{await browser.close();writeFileSync(dir+'/comparison.json',JSON.stringify(report,null,2));writeFileSync(dir+'/summary.json',JSON.stringify({summary:report.summary,promptUnchanged:report.promptUnchanged,errors:report.errors,scope:report.scope},null,2));}
