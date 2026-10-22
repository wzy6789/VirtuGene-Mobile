import { chromium } from 'playwright';
import { productPreview } from '../preview-product-upgrade.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out=process.env.VG_RUNTIME_OUTPUT||'.tmp-preview/ui-overhaul-20261016/runtime-profile';
mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0,production:true}),browser=await chromium.launch({channel:'chrome'});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'no-preference'}),page=await context.newPage();
const report={browser:browser.version(),reactMode:'production',cpuThrottle:4,samples:[],cycles:[],checks:[],errors:[],scope:'Actual product components with small synthetic fixture in isolated localhost. Desktop Chrome headless CPU/DOM/heap/rAF/paint trace, not Android GPU/frame/thermal or long-history database performance.',limitations:['No matching before trace; samples are current-state measurements.','rAF callback cadence is not presented-frame/GPU time.','Forced GC excludes collectible garbage; retained heap is not total process or GPU memory.','Short navigation stress does not replace required 10-minute physical-device thermal/battery test.']};
const api=(method,...args)=>page.evaluate(async({method,args})=>window.productUpgradeTest[method](...args),{method,args});
const assert=(value,label)=>{report.checks.push({label,pass:!!value});if(!value)throw Error(label);};
const cdp=await context.newCDPSession(page);
try{
 assert(preview.production===true,'production React bundle explicitly enabled');
 await context.route('**/*',route=>route.request().url().startsWith(preview.address+'/')?route.continue():route.abort());
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(preview.address+'/app');await page.waitForFunction(()=>window.productUpgradeReady);await page.evaluate(()=>document.fonts.ready);
 await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
 async function sample(name,{reduced=false,background=false}={}){
  await api('reduced',reduced);await page.evaluate(background=>{if(background)document.documentElement.dataset.vgBackground='true';else delete document.documentElement.dataset.vgBackground;},background);
  await page.waitForTimeout(500);
  const events=[];const consume=({value})=>events.push(...value);cdp.on('Tracing.dataCollected',consume);
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});
  const before=await metrics();
  const state=await page.evaluate(async()=>{
   const longTasks=[];const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(x=>({at:x.startTime,duration:x.duration}))));observer.observe({type:'longtask'});
   let svgWrites=0;const orbObserver=new MutationObserver(records=>{svgWrites+=records.length;});document.querySelectorAll('[data-soul-orb-host]').forEach(node=>orbObserver.observe(node,{subtree:true,attributes:true,attributeFilter:['transform','d','opacity']}));
   const frames=[];let last=performance.now(),start=last;
   await new Promise(resolve=>{const frame=now=>{frames.push(now-last);last=now;if(now-start<2500)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
   observer.disconnect();orbObserver.disconnect();frames.shift();frames.sort((a,b)=>a-b);
   return{elapsed:last-start,frames:frames.length,rafP50:frames[Math.floor(frames.length*.5)],rafP95:frames[Math.floor(frames.length*.95)],rafOver50:frames.filter(x=>x>50).length,longTasks,svgWrites,orbs:document.querySelectorAll('[data-soul-orb-host]').length,background:document.documentElement.dataset.vgBackground??null,particleFields:[...document.querySelectorAll('.vg-chat-particles')].map(node=>({state:node.dataset.particleState,reason:node.dataset.particlePause,canvas:node.querySelectorAll('canvas').length}))};
  });
  const after=await metrics();const ended=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await ended;cdp.off('Tracing.dataCollected',consume);
  writeFileSync(out+'/'+name+'-trace.json',JSON.stringify({traceEvents:events}));
  const summary={};for(const key of ['Paint','Layout','UpdateLayoutTree','FunctionCall','RunTask']){const rows=events.filter(e=>e.name===key&&e.ph==='X');summary[key]={count:rows.length,totalMs:rows.reduce((sum,e)=>sum+(e.dur??0)/1000,0),maxMs:Math.max(0,...rows.map(e=>(e.dur??0)/1000))};}
  report.samples.push({name,...state,metricsDelta:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(k=>[k,after[k]-before[k]])),trace:summary});
 }
 await api('go','chat');await page.locator('.chat-room').waitFor();await page.waitForTimeout(500);
 await sample('chat-gentle');await sample('chat-reduced',{reduced:true});await sample('chat-background',{background:true});
 const paused=report.samples.at(-1);assert(paused.svgWrites===0,'background orb makes no per-frame SVG writes after settling');
 await page.evaluate(()=>delete document.documentElement.dataset.vgBackground);await api('reduced',true);await api('go','characters');await api('seedMany',30);await page.waitForTimeout(500);
 async function checkpoint(cycles){await cdp.send('HeapProfiler.collectGarbage');await page.waitForTimeout(150);const m=await metrics();report.cycles.push({cycles,heap:m.JSHeapUsedSize,...await cdp.send('Memory.getDOMCounters'),liveNodes:await page.evaluate(()=>document.querySelectorAll('*').length),ghosts:await page.locator('.vg-soul-ghost,.vg-soul-surface,.vg-modal-exit,.vg-page-exit').count(),particleResources:await api('particleResources')});console.log('CHECKPOINT '+JSON.stringify(report.cycles.at(-1)));}
 await checkpoint(0);
 for(let i=1;i<=Number(process.env.VG_RUNTIME_CYCLES||48);i++){
  await page.getByRole('button',{name:'打开知微的角色空间',exact:true}).click();await page.locator('.vg-space-chat-action').click();await page.locator('.chat-room').waitFor();await page.locator('.chat-header').getByRole('button',{name:'返回',exact:true}).click();await page.locator('.vg-gallery-shortcuts').waitFor();
  if(i%12===0){await page.waitForTimeout(400);await checkpoint(i);}
 }
 assert(report.cycles.every(c=>c.ghosts===0),'no handoff or exit snapshots retained after navigation settles');
 assert(report.cycles.every(c=>c.particleResources.destroyedPathEntries===0),'no destroyed particle containers retained in path cache');
 assert(report.errors.length===0,'no browser runtime errors');
 try{report.detached=await cdp.send('DOM.getDetachedDomNodes');}catch(error){report.detachedUnavailable=error.message;}
 report.particleEngine=await api('particleDiagnostics');
 if(process.env.VG_RUNTIME_HEAP==='1'){const chunks=[];const chunk=event=>chunks.push(event.chunk);cdp.on('HeapProfiler.addHeapSnapshotChunk',chunk);await cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});cdp.off('HeapProfiler.addHeapSnapshotChunk',chunk);report.heapSnapshot=out+'/navigation.heapsnapshot';writeFileSync(report.heapSnapshot,chunks.join(''));report.afterHeapSnapshot={...(await metrics()),...(await cdp.send('Memory.getDOMCounters'))};}
 report.isolation=await api('snapshot');report.status='measured';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();await new Promise(resolve=>preview.server.close(resolve));}
