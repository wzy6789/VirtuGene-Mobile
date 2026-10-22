import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=`.tmp-preview/starfield-upgrade-20261017/P7/${process.env.VG_STARFIELD_LIFECYCLE_PHASE??'after'}-${Date.now()}`;mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],samples:[],limits:['Actual MobileLayout and IndexedDB on independent synthetic test origin, not the logged-in sidebar.','HTTP image is the exact production asset; only fault timing/status is controlled.','4x CPU throttle and forced-GC desktop heap samples do not prove Android GPU, thermal or OS-memory behavior.']};
const check=async(name,run)=>{try{report.checks.push({name,pass:true,detail:await run()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
let server,browser;
try{
 server=await starfieldPreview({port:0,output:out+'/server',materialTransport:'http'});browser=await chromium.launch({channel:'chrome'});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
 await context.addInitScript(()=>{
  const nativeAdd=EventTarget.prototype.addEventListener,nativeRemove=EventTarget.prototype.removeEventListener,ids=new WeakMap();let seq=0;const listeners=new Set();
  const key=(target,type,callback,options)=>{if(!callback||target!==window&&target!==document)return;let id=ids.get(callback);if(!id){id=++seq;ids.set(callback,id);}return`${target===window?'w':'d'}:${type}:${id}:${typeof options==='boolean'?options:!!options?.capture}`;};
  EventTarget.prototype.addEventListener=function(type,callback,options){const k=key(this,type,callback,options);if(k)listeners.add(k);return nativeAdd.call(this,type,callback,options);};
  EventTarget.prototype.removeEventListener=function(type,callback,options){const k=key(this,type,callback,options);if(k)listeners.delete(k);return nativeRemove.call(this,type,callback,options);};
  const active={MutationObserver:0,ResizeObserver:0,IntersectionObserver:0};
  for(const name of Object.keys(active)){const Native=window[name];if(!Native)continue;window[name]=class extends Native{targets=new Set();observe(target,...args){if(!this.targets.size)active[name]++;this.targets.add(target);return super.observe(target,...args);}unobserve(target){const removed=this.targets.delete(target);if(removed&&!this.targets.size)active[name]--;return super.unobserve(target);}disconnect(){if(this.targets.size)active[name]--;this.targets.clear();return super.disconnect();}};}
  window.lifecycleCounts=()=>({listeners:listeners.size,observers:{...active}});
 });
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>report.errors.push(e.message));
 let mode='ready',releaseImage,held=false;
 await page.route('**/assets/mineral-world-*.webp',async route=>{
  if(mode==='hold'){held=true;await new Promise(resolve=>releaseImage=resolve);}
  if(mode==='missing')return route.fulfill({status:404,body:'not found'});
  if(mode==='corrupt')return route.fulfill({status:200,contentType:'image/webp',body:'invalid webp'});
  return route.continue();
 });
 await page.goto(server.address+'/app?virtugene-preview=mobile');await page.waitForFunction(()=>window.starfieldReady);await page.evaluate(()=>document.fonts.ready);
 const enter=async()=>{await page.getByRole('button',{name:'星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();};
 const leave=async()=>{await page.getByRole('button',{name:'返回世界',exact:true}).click();await page.getByRole('button',{name:'星域',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-starfield-overview]'));};
 const reset=async()=>{await page.evaluate(()=>starfieldPreview.setState('six'));await page.evaluate(()=>starfieldPreview.motion(true));};
 await reset();mode='hold';await enter();await page.waitForFunction(()=>!document.querySelector('.vg-starfield-art img')?.complete);
 const mapBefore=await page.locator('[data-starfield-map]').boundingBox();const captionBefore=await page.locator('.vg-starfield-caption').first().boundingBox();const followingBefore=await page.getByRole('navigation',{name:'世界档案'}).boundingBox();
 await check('slow actual material never blocks map markers, archives or DOM copy',async()=>{assert(held);assert.equal(await page.locator('[data-scene-marker]').count(),6);assert.equal(await page.getByRole('navigation',{name:'世界档案'}).getByRole('button').count(),4);assert(await page.getByRole('heading',{name:'我们的共同世界'}).isVisible());});
 mode='missing';releaseImage();await page.locator('[data-starfield-poster-fallback]').waitFor();
 await check('404 fallback preserves map and following content positions without layout shift',async()=>{const b=await page.locator('[data-starfield-map]').boundingBox(),caption=await page.locator('.vg-starfield-caption').first().boundingBox();assert(Math.abs(b.y-mapBefore.y)<1&&Math.abs(b.height-mapBefore.height)<1);assert(Math.abs(caption.y-captionBefore.y)<1);const following=await page.getByRole('navigation',{name:'世界档案'}).boundingBox();assert(Math.abs(following.y-followingBefore.y)<1,`following controls moved ${following.y-followingBefore.y}px`);return{map:b,caption,following};});
 await check('failed material is clearly announced and all scene records remain usable',async()=>{assert.equal(await page.getByRole('status').filter({hasText:/星体/}).count(),1);assert.equal(await page.locator('[data-scene-row]').count(),6);await page.locator('[data-scene-marker]').first().click();await page.locator('.vg-sector-detail').waitFor();await page.getByRole('button',{name:'返回星域',exact:true}).click();});
 for(const theme of ['dark','light'])for(const width of [320,390,430])for(const scale of [1,1.5]){
  await page.evaluate(([theme,scale])=>{starfieldPreview.theme(theme);document.documentElement.style.fontSize=15*scale+'px';},[theme,scale]);await page.setViewportSize({width,height:844});
  await check(`${theme}-${width}-${scale}: fallback notice avoids marker targets and caption`,async()=>{
   const boxes=await page.locator('[data-starfield-map]').evaluate(n=>{const box=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};};return{notice:box(n.querySelector('[role=status]')),markers:[...n.querySelectorAll('[data-scene-marker]')].map(box),caption:box(n.nextElementSibling)};});
   const n=boxes.notice;assert(boxes.markers.every(m=>n.bottom<=m.y||n.y>=m.bottom||n.right<=m.x||n.x>=m.right));assert(n.bottom<=boxes.caption.y);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));return boxes;
  });
 }
 await page.evaluate(()=>{starfieldPreview.theme('dark');document.documentElement.style.fontSize='15px';});await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:out+'/missing-dark.png'});await leave();
 mode='corrupt';await enter();await page.locator('[data-starfield-poster-fallback]').waitFor();await check('undecodable WebP falls back through the real image error event',async()=>{assert.equal(await page.locator('.vg-starfield-art img').count(),0);});await leave();
 mode='ready';await enter();await page.waitForFunction(()=>document.querySelector('.vg-starfield-art img')?.naturalWidth>0);await check('next visit recovers the actual asset without a stuck fallback',async()=>{assert.equal(await page.locator('[data-starfield-poster-fallback]').count(),0);});await leave();
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
 const memory=async()=>{await cdp.send('HeapProfiler.collectGarbage');const dom=await cdp.send('Memory.getDOMCounters'),m=await cdp.send('Performance.getMetrics');return{...await page.evaluate(()=>lifecycleCounts()),...dom,heapUsed:m.metrics.find(m=>m.name==='JSHeapUsedSize').value};};
 for(let i=0;i<3;i++){await enter();await leave();}
 const baseline=await memory();report.baseline=baseline;
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
 for(let i=0;i<20;i++){
  const interruption=['background','hidden','inert'][i%3];
  await enter();await page.locator('[data-starfield-map]').scrollIntoViewIfNeeded();const b=await page.locator('[data-scene-marker]').first().boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
  // Return a primitive: an undisposed JSHandle to the pressed DOM node would
  // itself retain every detached scene tree and fabricate a lifecycle leak.
  await page.waitForFunction(()=>!!document.querySelector('[data-starfield-press]'));
  await page.evaluate(reason=>{if(reason==='background')document.documentElement.setAttribute('data-vg-background','');else document.querySelector('[data-starfield-overview]').parentElement.setAttribute(reason,'');},interruption);
  await page.waitForFunction(()=>!document.querySelector('[data-starfield-press]'));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await page.evaluate(reason=>{if(reason==='background')document.documentElement.removeAttribute('data-vg-background');else document.querySelector('[data-starfield-overview]').parentElement.removeAttribute(reason);},interruption);
  await page.waitForTimeout(240);
  await check(`cycle ${i+1}: ${interruption} recovery does not resume a held press or perpetual art animation`,async()=>{assert.equal(await page.locator('[data-starfield-press]').count(),0);const values=await page.locator('.vg-starfield-art').evaluate(n=>({transform:getComputedStyle(n).transform,animations:n.getAnimations().filter(a=>a.playState==='running').length}));assert.equal(values.transform,'none');assert.equal(values.animations,0);return values;});
  await leave();report.samples.push({cycle:i+1,...await memory()});
 }
 const traceComplete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await traceComplete;let trace='';while(true){const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break;}await cdp.send('IO.close',{handle:stream});writeFileSync(out+'/lifecycle-trace.json',trace);report.trace=out+'/lifecycle-trace.json';
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 await check('20 actual mount/unmount cycles release listeners and observer subscriptions',async()=>{assert(report.samples.every(s=>s.listeners===baseline.listeners));assert(report.samples.every(s=>JSON.stringify(s.observers)===JSON.stringify(baseline.observers)));return{baseline,last:report.samples.at(-1)};});
 await check('forced-GC DOM/listener/heap samples remain bounded after 20 cycles',async()=>{const last=report.samples.at(-1);assert(last.jsEventListeners<=baseline.jsEventListeners+4);assert(last.nodes<=baseline.nodes+40);assert(last.heapUsed<=baseline.heapUsed+2*1024*1024);return{nodeDelta:last.nodes-baseline.nodes,listenerDelta:last.jsEventListeners-baseline.jsEventListeners,heapDelta:last.heapUsed-baseline.heapUsed};});
 await check('isolation and mobile identity retain their real values',async()=>{const s=await page.evaluate(()=>starfieldPreview.snapshot());assert(s.IS_MOBILE&&s.mobileLayout&&!s.native);assert(Object.values(s.isolation).every(n=>n===0));return s.isolation;});
 await context.close();
}catch(e){report.errors.push(String(e));}
finally{await browser?.close();if(server)await new Promise(r=>server.server.close(r));report.pass=report.errors.length===0&&report.checks.length>0&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
