import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve('release/chat-current-speed-'+Date.now());mkdirSync(root,{recursive:true});
const docs=['CHAT-REPLY-SOURCE-QUESTION','CHAT-OPEN-WORDS','CHAT-SETTLEMENT-SOURCE-KINDS','CHAT-RUNTIME-VOICE-ECHO']
  .map(name=>JSON.parse(readFileSync('docs/'+name+'-2026-10-19.json','utf8')));
const sources=docs.flatMap(doc=>Array.isArray(doc.production)?doc.production:[doc.production])
  .map(row=>({...row,before:row.before??row.beforeSnapshot}));
const hash=value=>createHash('sha256').update(value).digest('hex');
for(const source of sources){
  assert.equal(hash(readFileSync(source.path)),source.sha256,'current source matches phase record: '+source.path);
  assert.equal(hash(readFileSync(source.before)),source.beforeSha256,'frozen source matches: '+source.path);
}
const report={createdAt:new Date().toISOString(),workspace:process.cwd(),complete:false,
  codingModel:'未确认',codingReasoning:'未确认',sources,checks:[],runs:[],fixtures:[],
  scope:'Current actual sender/native isolated stock versus seven frozen files before the latest four bounded fixes. All other source is identical. Fixed local JSON transport waits 100ms. Not a release6.0.14 comparison, provider TTFT, Android or presented-frame measurement.',
  usage:{paidCalls:0,promptTokens:0,completionTokens:0,costUSD:0},errors:[],blockedExternal:[],
  limits:['Per case three independent full-database resets; small samples and desktop CPU4x do not represent an OPPO latency guarantee.',
    'Stream callback is an application notification, not visible DOM or a decoded video frame.',
    'JSON transport supplies the entire short reply after a fixed 100ms; this does not measure full-reply buffering cost with a long real stream.',
    'Application and provider cache, live model latency and installed APK were not changed or tested.']};
const check=(name,condition)=>{report.checks.push({name,ok:!!condition});assert.ok(condition,name);};
const once=(text,needle,replacement)=>{assert.equal(text.split(needle).length,2,'exact instrumentation anchor');return text.replace(needle,replacement);};
// Instrument the existing test harness only, leaving production algorithms,
// generation settings, source checks and persona adoption unchanged.
const instrument=original=>{
  let text=original;
  text=once(text,'new ChatReplyStream(sessionId,()=>undefined)',
    'new ChatReplyStream(sessionId,()=>{(window as any).__speedStreamHook?.();})');
  const at=text.indexOf('(window as any).runResumeStock=');assert.ok(at>0);
  let part=text.slice(at);
  part=once(part,'iteration<3','iteration<1');
  part=once(part,'messages:unknown[]=[],auxiliary:unknown[]=[];',
    'messages:unknown[]=[],wireConfigs:unknown[]=[],auxiliary:unknown[]=[];');
  part=once(part,'let firstRequestMs:number|undefined;',
    'let firstRequestMs:number|undefined,mockTransportReadyMs:number|undefined,firstStreamCallbackMs:number|undefined;');
  part=once(part,'window.fetch=async(_url,init)=>{',
    '(window as any).__speedStreamHook=()=>{firstStreamCallbackMs??=performance.now()-started;};window.fetch=async(_url,init)=>{');
  part=once(part,'messages.push(body.messages);',
    'messages.push(body.messages);const {messages:_,...config}=body;wireConfigs.push(config);');
  part=once(part,"return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});",
    "await new Promise(resolve=>setTimeout(resolve,100));if(body.messages?.[body.messages.length-1]?.content===text)mockTransportReadyMs??=performance.now()-started;return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});");
  part=once(part,'fixtureSha256:fixture.sha256,firstRequestMs,wholeMs,',
    'fixtureSha256:fixture.sha256,firstRequestMs,mockTransportReadyMs,firstStreamCallbackMs,wireConfigs,wholeMs,');
  part=once(part,'window.fetch=savedFetch;for(const reset of restore)reset();',
    'window.fetch=savedFetch;delete (window as any).__speedStreamHook;for(const reset of restore)reset();');
  return text.slice(0,at)+part;
};
const compile=frozen=>build({entryPoints:['scripts/verify/chat-current-speed.ts'],bundle:true,write:false,
  platform:'browser',format:'iife',metafile:true,loader:{'.png':'dataurl','.webp':'dataurl'},
  define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"current-speed-test"'},
  plugins:[{name:'isolated-current-speed',setup(builder){
    builder.onLoad({filter:/chat-continuity-resume\.ts$/},args=>({loader:'ts',contents:instrument(readFileSync(args.path,'utf8'))}));
    if(frozen)for(const source of sources)builder.onLoad({filter:new RegExp(source.path.replaceAll('/','[\\\\/]')+'$')},
      ()=>({loader:'ts',contents:readFileSync(source.before,'utf8')}));
  }}]});
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const summarize=samples=>({n:samples.length,preparationMs:samples.map(s=>s.firstRequestMs),
  preparationMedianMs:median(samples.map(s=>s.firstRequestMs)),
  firstCallbackMs:samples.map(s=>s.firstStreamCallbackMs),firstCallbackMedianMs:median(samples.map(s=>s.firstStreamCallbackMs)),
  wholeMedianMs:median(samples.map(s=>s.wholeMs)),systemChars:samples.map(s=>s.messages[0][0].content.length),
  reads:samples.map(s=>({bodies:Object.values(s.reads).reduce((n,r)=>n+r.bodies,0),
    keys:Object.values(s.reads).reduce((n,r)=>n+r.keys,0),
    tombstoneBodies:Object.entries(s.reads).filter(([name])=>name.startsWith('memorySourceTombstones.')).reduce((n,[,r])=>n+r.bodies,0)}))});
let browser,server;
try{
  const bundles={before:await compile(true),current:await compile(false)};
  const paths=Object.keys(bundles.current.metafile.inputs).filter(path=>path.startsWith('src/')||path.startsWith('server/'));
  report.productionSourceHashesBefore=Object.fromEntries(paths.map(path=>[path,hash(readFileSync(path))]));
  let active=bundles.current.outputFiles[0].text;
  server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');
    res.end(req.url==='/test.js'?active:'<!doctype html><script src="/test.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const open=async(rate=1)=>{
    const context=await browser.newContext({permissions:[],timezoneId:'Asia/Shanghai'});
    await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();report.blockedExternal.push(new URL(route.request().url()).origin);return route.abort();});
    await context.addInitScript(()=>{
      const deny=()=>Promise.reject(Error('No microphone or audio in speed fixture'));
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=deny;HTMLMediaElement.prototype.play=deny;
      if(window.speechSynthesis)window.speechSynthesis.speak=()=>{throw Error('Speech disabled');};
      for(const name of ['AudioContext','webkitAudioContext'])if(window[name])window[name]=function(){throw Error('Audio disabled');};
    });
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate});
    await page.goto(origin);await page.waitForFunction(()=>!!window.prepareCurrentSpeedFixture);
    return {context,page};
  };
  const fixtures={};
  for(const role of ['古月娜','陆雪琪']){
    const prep=await open();try{fixtures[role]=await prep.page.evaluate(role=>window.prepareCurrentSpeedFixture(role),role);}finally{await prep.context.close();}
    const fixture=fixtures[role],path=join(root,role==='古月娜'?'gu-fixture.json':'lu-fixture.json');
    writeFileSync(path,JSON.stringify(fixture));report.fixtures.push({role,path,sha256:fixture.sha256,
      counts:Object.fromEntries(Object.entries(fixture.data.tables).filter(([,rows])=>rows.length).map(([name,rows])=>[name,rows.length]))});
  }
  const cases=[
    {id:'gu-invitation-desktop',role:'古月娜',rate:1,text:'古月，我是唐舞麟。今天的锻造总算忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？'},
    {id:'gu-invitation-cpu4',role:'古月娜',rate:4,text:'古月，我是唐舞麟。今天的锻造总算忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？'},
    {id:'gu-normal-cpu4',role:'古月娜',rate:4,text:'古月，我是唐舞麟。今天食堂的面居然还不错。'},
    {id:'lu-invitation-cpu4',role:'陆雪琪',rate:4,text:'雪琪，我是张小凡。今天的事情忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？'},
  ].filter(test=>!process.env.VG_SPEED_CASE||process.env.VG_SPEED_CASE.split(',').includes(test.id));
  for(const [caseIndex,test]of cases.entries()){
    for(const phase of (caseIndex%2?['current','before']:['before','current']).filter(phase=>!process.env.VG_SPEED_PHASE||phase===process.env.VG_SPEED_PHASE)){
      active=bundles[phase].outputFiles[0].text;
      const result={samples:[],apiCalls:0};
      for(let independent=0;independent<3;independent++){
       const run=await open(test.rate);
       try{
        const data=await run.page.evaluate(async({fixture,text})=>{
          try{return await window.runResumeStock(fixture,false,false,text);}
          catch(error){return {harnessError:{name:error?.name,message:error?.message,stack:error?.stack,inner:error?.inner?{name:error.inner.name,message:error.inner.message}:undefined}};}
        },{fixture:fixtures[test.role],text:test.text});
        if(data.harnessError){report.harnessFailure={case:test.id,phase,independent,...data.harnessError};throw Error(JSON.stringify(report.harnessFailure));}
        result.samples.push(...data.samples);
       }finally{await run.context.close();}
      }
      try{
        const entry={...test,phase,...result};report.runs.push(entry);
        check(test.id+'/'+phase+' three completed native sends',result.samples.length===3&&result.samples.every(s=>!s.error&&!s.failed&&s.replies.length===1&&s.messages.length===1&&s.fixtureSha256===fixtures[test.role].sha256));
        check(test.id+'/'+phase+' main thinking remains enabled/low',result.samples.every(s=>s.wireConfigs[0]?.thinking?.type==='enabled'&&s.wireConfigs[0]?.reasoning_effort==='low'));
        check(test.id+'/'+phase+' local callback occurs after the complete mock reply',result.samples.every(s=>s.firstStreamCallbackMs>=s.mockTransportReadyMs&&s.mockTransportReadyMs-s.firstRequestMs>=95));
        entry.summary=summarize(result.samples);writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
        console.log(JSON.stringify({case:test.id,phase,summary:entry.summary}));
      }finally{}
    }
    const a=report.runs.find(r=>r.id===test.id&&r.phase==='before'),b=report.runs.find(r=>r.id===test.id&&r.phase==='current');
    if(!a||!b)continue;
    for(let i=0;i<3;i++){
      const sameReads=JSON.stringify(a.samples[i].reads)===JSON.stringify(b.samples[i].reads);
      (report.readComparisons??=[]).push({case:test.id,index:i,equal:sameReads,
        differences:sameReads?[]:[...new Set([...Object.keys(a.samples[i].reads),...Object.keys(b.samples[i].reads)])].filter(key=>JSON.stringify(a.samples[i].reads[key])!==JSON.stringify(b.samples[i].reads[key])).map(key=>({key,before:a.samples[i].reads[key],current:b.samples[i].reads[key]}))});
      check(test.id+'/'+i+' complete non-system history unchanged',JSON.stringify(a.samples[i].messages.map(m=>m.filter(row=>row.role!=='system')))===JSON.stringify(b.samples[i].messages.map(m=>m.filter(row=>row.role!=='system'))));
      check(test.id+'/'+i+' actual generation settings unchanged',JSON.stringify(a.samples[i].wireConfigs)===JSON.stringify(b.samples[i].wireConfigs));
      check(test.id+'/'+i+' auxiliary request count unchanged',a.samples[i].auxiliaryLocalCalls===b.samples[i].auxiliaryLocalCalls);
    }
  }
  report.comparison=cases.filter(test=>report.runs.filter(r=>r.id===test.id).length===2).map(test=>{const a=report.runs.find(r=>r.id===test.id&&r.phase==='before').summary,b=report.runs.find(r=>r.id===test.id&&r.phase==='current').summary;return {case:test.id,role:test.role,cpuRate:test.rate,before:a,current:b,
    preparationDeltaMs:b.preparationMedianMs-a.preparationMedianMs,callbackDeltaMs:b.firstCallbackMedianMs-a.firstCallbackMedianMs};});
  report.productionSourceHashesAfter=Object.fromEntries(paths.map(path=>[path,hash(readFileSync(path))]));
  check('all bundled production source stable during test',JSON.stringify(report.productionSourceHashesBefore)===JSON.stringify(report.productionSourceHashesAfter));
  check('no unexpected page errors or external browser network',report.errors.length===0&&report.blockedExternal.length===0);
  report.complete=true;
}catch(error){report.errors.push(error.stack??String(error));process.exitCode=1;}
finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,errors:report.errors,evidence:join(root,'report.json'),paidCalls:0}));
}
