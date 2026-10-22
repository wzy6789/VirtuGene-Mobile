import {chromium} from 'playwright';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const address=process.env.VG_VOICE_MOTION_ADDRESS??'http://127.0.0.1:5301';
const out=process.env.VG_VOICE_MOTION_OUT??'.tmp-preview/stage2-ui-20261018/S09-C/checks';mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(process.env.VG_VOICE_MOTION_MANIFEST??'.tmp-preview/stage2-ui-20261018/S09-B/live-fonts-final/source-hashes.json','utf8'));
const drift=()=>manifest.inputs.filter(i=>existsSync(i.path)&&createHash('sha256').update(readFileSync(i.path)).digest('hex')!==i.sha256);
const report={checks:[],samples:[],cycles:[],limitations:['Headless desktop Chrome, actual VoiceCallHost/Dialog/SoulOrb with controlled store states. Not Android GPU, hardware audio, microphone or a real call.','Instrumentation counts this isolated document only; persistent React root listeners are compared after a warm-up mount. Detached node-local listeners are pruned from the instrumentation because their nodes are collectible, and per-operation IndexedDB request/transaction targets are excluded; document/window/MediaQueryList listeners remain counted. This is a UI lifecycle check, not a heap snapshot.','Three30-second pairs with normal animation versus the actual reduced-motion gate. RAF intervals measure desktop scheduling, not GPU cost.']};
const check=(ok,name,data)=>{report.checks.push({pass:!!ok,name,data});assert(ok,name+' '+JSON.stringify(data??''));};
const browser=await chromium.launch({channel:'chrome'});let page;
const open=async()=>{const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'no-preference'});await p.addInitScript(()=>{
 const listeners=[],add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
 const capture=o=>typeof o==='boolean'?o:!!o?.capture;
 EventTarget.prototype.addEventListener=function(type,fn,options){if(fn&&!listeners.some(v=>v.target===this&&v.type===type&&v.fn===fn&&v.capture===capture(options)))listeners.push({target:this,type,fn,capture:capture(options)});return add.call(this,type,fn,options);};
 EventTarget.prototype.removeEventListener=function(type,fn,options){const i=listeners.findIndex(v=>v.target===this&&v.type===type&&v.fn===fn&&v.capture===capture(options));if(i>=0)listeners.splice(i,1);return remove.call(this,type,fn,options);};
 const observers={resize:new Set(),intersection:new Set()},targets=new WeakMap();
 for(const [name,key] of [['ResizeObserver','resize'],['IntersectionObserver','intersection']]){const Original=window[name];window[name]=class extends Original{observe(target,...args){let set=targets.get(this);if(!set)targets.set(this,set=new Set());set.add(target);observers[key].add(this);return super.observe(target,...args);}unobserve(target){targets.get(this)?.delete(target);if(!targets.get(this)?.size)observers[key].delete(this);return super.unobserve(target);}disconnect(){targets.delete(this);observers[key].delete(this);return super.disconnect();}};}
 const urls=new Set(),create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=function(value){const url=create.call(this,value);urls.add(url);return url;};URL.revokeObjectURL=function(url){urls.delete(url);return revoke.call(this,url);};
 window.motionOwned=()=>{for(let i=listeners.length-1;i>=0;i--)if((listeners[i].target instanceof Node&&!listeners[i].target.isConnected)||['IDBTransaction','IDBRequest'].includes(listeners[i].target.constructor.name))listeners.splice(i,1);return{listeners:listeners.length,listenerTypes:listeners.reduce((result,v)=>{const key=v.target.constructor.name+':'+v.type;result[key]=(result[key]||0)+1;return result;},{}),resize:observers.resize.size,intersection:observers.intersection.size,objectUrls:urls.size,canvas:document.querySelectorAll('canvas').length,clock:window.callUiTest?.motion()};};
 });await p.goto(address+'/?virtugene-preview=mobile');await p.waitForFunction(()=>window.callUiTest);return p;};
try{
 check(drift().length===0,'live compiled inputs match worktree',drift());
 page=await open();
 const show=async()=>{await page.evaluate(()=>window.callUiTest.hosted());await page.getByRole('button',{name:'收起通话',exact:true}).waitFor();await page.waitForFunction(()=>callUiTest.motion().clients===1);};
 const close=async()=>{await page.evaluate(()=>window.hostedCall.cleanup());await page.waitForFunction(()=>callUiTest.motion().clients===0&&!callUiTest.motion().scheduled);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
 await show();await page.getByRole('button',{name:'收起通话',exact:true}).click();await page.getByRole('button',{name:/返回与晓来的语音通话/}).click();await page.evaluate(()=>window.hostedCall.navigate());await close();await page.waitForTimeout(400);const baseline=await page.evaluate(()=>window.motionOwned());report.lifecycleBaseline=baseline;
 for(let cycle=1;cycle<=10;cycle++){
  await show();await page.getByRole('button',{name:'收起通话',exact:true}).click();await page.getByRole('button',{name:/返回与晓来的语音通话/}).waitFor();await page.evaluate(()=>window.hostedCall.navigate());await page.getByRole('button',{name:/返回与晓来的语音通话/}).click();await page.getByRole('button',{name:'收起通话',exact:true}).waitFor();await close();await page.waitForTimeout(400);
  const current=await page.evaluate(()=>window.motionOwned());report.cycles.push({cycle,current});check(current.clock.clients===0&&!current.clock.scheduled&&['listeners','resize','intersection','objectUrls','canvas'].every(k=>current[k]<=baseline[k]),'cycle'+cycle+' releases frame client, observers and temporary resources',current);
 }
 await show();await page.evaluate(()=>document.documentElement.setAttribute('data-vg-background',''));await page.waitForFunction(()=>callUiTest.motion().clients===0&&!callUiTest.motion().scheduled);check(true,'background releases shared clock');await page.evaluate(()=>document.documentElement.removeAttribute('data-vg-background'));await page.waitForFunction(()=>callUiTest.motion().clients===1);await close();
 check(Object.values(await page.evaluate(()=>window.voiceIsolation)).every(n=>n===0),'lifecycle has no network/audio/capture attempts');await page.close();page=undefined;
 for(let pair=1;pair<=3;pair++)for(const reduced of [true,false]){
  page=await open();await page.evaluate(async reduced=>{await callUiTest.hosted();callUiTest.reduceMotion(reduced);document.documentElement.dataset.vgReducedMotion=String(reduced);},reduced);await page.locator('.vg-voice-call').waitFor();await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForFunction(reduced=>callUiTest.motion().clients===(reduced?0:1),reduced);
  check(await page.evaluate(()=>[...document.fonts].some(f=>f.status==='loaded')),'pair'+pair+' uses actually loaded bundled fonts');
  const sample=await page.evaluate(()=>new Promise(resolve=>{
   const frames=[],longTasks=[],start=performance.now(),initialCommits=callUiTest.commits();let previous=start;
   const observer=PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({start:e.startTime,duration:e.duration});}):null;observer?.observe({entryTypes:['longtask']});
   const action=setInterval(()=>{const phase=Math.floor((performance.now()-start)/5000)%2?'playing':'listening';callUiTest.state(phase);},5000);
   const frame=now=>{frames.push(now-previous);previous=now;if(now-start<30000)requestAnimationFrame(frame);else{clearInterval(action);observer?.disconnect();frames.sort((a,b)=>a-b);resolve({elapsed:now-start,count:frames.length,p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],over33:frames.filter(n=>n>33.4).length,longTasks:observer?longTasks:null,reactCommits:callUiTest.commits()-initialCommits,clock:callUiTest.motion(),isolation:voiceIsolation});}};requestAnimationFrame(frame);
  }));
  report.samples.push({pair,reduced,...sample});writeFileSync(out+'/progress.json',JSON.stringify(report,null,2));check(sample.elapsed>=30000&&sample.p95<=33.4,'pair'+pair+(reduced?' static':' animated')+'30s desktop scheduling within budget',sample);check(Object.values(sample.isolation).every(n=>n===0),'pair'+pair+' no real transport/capture/audio');console.log(JSON.stringify({pair,reduced,p95:sample.p95,longTasks:sample.longTasks?.length}));await page.close();page=undefined;
 }
 check(drift().length===0,'inputs remain unchanged during samples',drift());report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{await page?.close();await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
