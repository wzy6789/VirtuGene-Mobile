/** SHA-authenticated historical-module composition, never a source restore.
 * Only an ephemeral localhost SSE fixture is allowed; no provider/credential loader. */
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {comparisonCases} from './chat-core-comparison-cases.mjs';

const base='release/chat-core-implementation-20261021';
const root=join(base,'review/baseline-probe-'+Date.now());mkdirSync(root,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/u,''));
const coveragePath=join(base,'review/baseline-coverage-20261022.json');
const coverage=readJson(coveragePath),initial=readJson(join(base,'baseline.json'));
const originals=new Map(),checks=[],errors=[],rows=[],requests=[],bundles={},builds={};
const check=(name,ok,detail)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
function decode(bytes,encoding){
  if(encoding==='raw'||!encoding)return bytes;
  const lf=bytes.toString('utf8').replace(/^\uFEFF/u,'').replace(/\r\n/gu,'\n');
  return Buffer.from((encoding.endsWith('-bom')?'\uFEFF':'')+(encoding.startsWith('crlf')?lf.replace(/\n/gu,'\r\n'):lf));
}
for(const item of coverage.files){
  if(!item.beforeBytesVerified)throw Error('A planned original source is unavailable: '+item.path);
  const source=item.source;
  let original;
  if(source.kind==='unchanged-current-bytes')original=readFileSync(item.path);
  else if(source.kind==='archived-bytes-match-plan-sha')original=decode(readFileSync(source.matches[0].path),source.matches[0].encoding);
  else if(source.kind==='git-bytes-match-plan-sha'){
    const blob=spawnSync('git',['show',source.commit+':'+source.path],{maxBuffer:5*1024*1024});
    if(blob.status!==0)throw Error('Verified original Git object unavailable');
    original=decode(blob.stdout,source.encoding);
  }else throw Error('Unknown original provenance');
  if(sha(original)!==item.expectedSha256)throw Error('Original source no longer matches recorded plan SHA: '+item.path);
  originals.set(item.path,{bytes:original,sha256:item.expectedSha256,source,scope:'original-plan-module-inventory'});
}
// The initial implementation snapshot also authenticated these consumers.
// Intermediate per-task snapshots are deliberately not treated as original T0.
for(const [path,expected]of Object.entries(initial.sourceHashes)){
  if(originals.has(path)){
    if(originals.get(path).sha256!==expected)throw Error('Conflicting initial snapshots: '+path);
    continue;
  }
  const archived=join(base,'before',path);
  if(!existsSync(archived)||sha(readFileSync(archived))!==expected)throw Error('Initial consumer archive mismatch: '+path);
  originals.set(path,{bytes:readFileSync(archived),sha256:expected,source:{kind:'initial-implementation-snapshot',path:archived},scope:'initial-implementation-extra'});
}
for(const [path,item]of originals){
  const copy=join(root,'authenticated-before',path);mkdirSync(dirname(copy),{recursive:true});writeFileSync(copy,item.bytes);
  item.artifact=copy;
}
const protectedPaths=[...originals.keys(),join(base,'live/initial-trial-budget-20261022.json'),join(base,'live/full-comparison/full-comparison-budget-20261022.json')];
const protectedBefore=Object.fromEntries(protectedPaths.map(path=>[path,sha(readFileSync(path))]));
const token=randomUUID();let active,origin,externalRequests=0,audioAttempts=0;
const scene=comparisonCases.find(item=>item.id==='light');
const server=createServer(async(req,res)=>{
  if(req.url.endsWith('/test.js')){const variant=req.url.split('/')[1];res.setHeader('Content-Type','text/javascript');res.end(bundles[variant]);return;}
  if(!req.url.startsWith('/chat/completions')){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><script src="test.js"></script>');return;}
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token||!active){res.writeHead(403).end();return;}
  let body='';for await(const part of req)body+=part;
  const payload=JSON.parse(body);
  if(++active.attempt>2||payload.messages?.at(-1)?.content!==scene.inputs[active.turn]){res.writeHead(503).end();errors.push('Unexpected fixture request');return;}
  requests.push({variant:active.variant,turn:active.turn+1,attempt:active.attempt,inputSha256:sha(JSON.stringify(payload.messages)),model:payload.model,thinking:payload.thinking,reasoningEffort:payload.reasoning_effort,messages:payload.messages});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const glyphs=Array.from(scene.offline[active.turn]);
  for(let i=0;i<glyphs.length;i+=9){if(res.destroyed)break;res.write('data: '+JSON.stringify({choices:[{delta:{content:glyphs.slice(i,i+9).join('')},finish_reason:null}]})+'\n\n');await new Promise(done=>setTimeout(done,1));}
  if(!res.destroyed)res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0}})+'\n\ndata: [DONE]\n\n');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
const overrides=new Map([...originals].map(([path,item])=>[resolve(path),item]));
try{
  for(const variant of ['before','current']){
    try{
      const built=await build({entryPoints:['scripts/verify/chat-core-live-trial.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',logLevel:'silent',loader:{'.png':'dataurl','.webp':'dataurl'},
        define:{LIVE_PROXY:JSON.stringify(origin+'/chat/completions'),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:'[]','import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"historical-module-local-probe"'},
        plugins:variant==='before'?[{name:'sha-authenticated-originals',setup(b){b.onLoad({filter:/\.(?:tsx?|mjs)$/},args=>{const item=overrides.get(resolve(args.path));return item?{contents:item.bytes.toString('utf8'),loader:args.path.endsWith('.mjs')?'js':args.path.endsWith('.tsx')?'tsx':'ts'}:undefined;});}}]:[]});
      bundles[variant]=built.outputFiles[0].text;const artifact=join(root,variant+'.bundle.js');writeFileSync(artifact,bundles[variant]);
      const dependencies=Object.fromEntries(Object.keys(built.metafile.inputs).filter(path=>existsSync(path)).map(path=>{
        const item=variant==='before'?overrides.get(resolve(path)):undefined;
        return [path,{sha256:item?.sha256??sha(readFileSync(path)),provenance:item?.scope??'shared-current-not-historical-closure'}];
      }));
      builds[variant]={built:true,artifact,sha256:sha(bundles[variant]),dependencies};
      check(variant+' source composition compiles without editing old modules',true);
    }catch(error){builds[variant]={built:false,error:String(error)};check(variant+' source composition compiles without editing old modules',false,String(error));}
  }
  const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const variant of ['before','current']){
      if(!builds[variant]?.built)continue;
      const context=await browser.newContext({permissions:[]});
      await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();externalRequests++;return route.abort();});
      await context.exposeFunction('reportAudioAttempt',()=>{audioAttempts++;});
      await context.addInitScript(()=>{const block=()=>{window.reportAudioAttempt();throw Error('Audio/microphone prohibited in source composition probe');};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=block;HTMLMediaElement.prototype.play=block;});
      const page=await context.newPage();page.on('pageerror',error=>errors.push({variant,error:error.message}));
      try{
        await page.goto(origin+'/'+variant+'/');await page.evaluate(()=>window.prepareCoreTrial());
        for(let turn=0;turn<3;turn++){
          active={variant,turn,attempt:0};const result=await page.evaluate(text=>window.runCoreTrialTurn(text),scene.inputs[turn]);
          rows.push({variant,turn:turn+1,mockRequests:active.attempt,...result});
          check(variant+' native sender turn'+(turn+1),result.completed&&!result.failed&&result.replies.length>0,{mockRequests:active.attempt,rows:result.rows});
        }
      }catch(error){errors.push({variant,error:String(error)});check(variant+' native DB sender initialises and runs',false,String(error));}
      finally{await context.close();}
    }
  }finally{await browser.close();}
}finally{await new Promise(done=>server.close(done));}
for(const [path,expected]of Object.entries(protectedBefore))check('protected source/ledger byte-preserved: '+path,sha(readFileSync(path))===expected);
check('no provider transport or audio/microphone attempts',externalRequests===0&&audioAttempts===0,{externalRequests,audioAttempts});
const report={at:new Date().toISOString(),complete:checks.every(item=>item.ok)&&!errors.length,coveragePath,coverageSha256:sha(readFileSync(coveragePath)),authenticatedBefore:Object.fromEntries([...originals].map(([path,{bytes,...item}])=>[path,item])),builds,rows,requests,checks,failures:checks.filter(item=>!item.ok),errors,providerCalls:0,providerTokens:0,productionFilesRestored:0,externalRequests,audioAttempts,codingModel:'未确认',codingReasoning:'未确认',
  scope:'Only the46 authenticated original plan modules plus initial snapshot extras are overridden in memory. Other transitive dependencies/harness stay current and are explicitly inventoried, so this is NOT a complete old-application/old-APK reconstruction or a new real-model before/after comparison. Three synthetic fixture turns per variant on isolated native IndexedDB, disposable localhost token and controlled mock SSE. No provider key or loader, paid-ledger mutations, Android, audio or microphone.'};
const reportPath=join(root,'result.json');writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({reportPath,complete:report.complete,authenticatedModules:originals.size,turns:rows.length,checks:checks.length,failures:report.failures,errors,providerCalls:0},null,2));
if(!report.complete)process.exitCode=1;
