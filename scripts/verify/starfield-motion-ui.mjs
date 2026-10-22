import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=`.tmp-preview/starfield-upgrade-20261017/P6b/${process.env.VG_STARFIELD_MOTION_PHASE??'after'}-${Date.now()}`;mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],videos:[],limits:['Actual MobileLayout, synthetic isolated IndexedDB, no signed-in sidebar or physical-device claim.','Controlled press and paused CSS-animation keyframe screenshots are not a natural video timing measurement.']};
const check=async(name,run)=>{try{report.checks.push({name,pass:true,detail:await run()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
let server,browser;
try{
 server=await starfieldPreview({port:0,output:out+'/server'});browser=await chromium.launch({channel:'chrome'});
 for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'no-preference',recordVideo:{dir:out,size:{width:390,height:844}}});
  const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.address+`/app?virtugene-preview=mobile&theme=${theme}`);await page.waitForFunction(()=>window.starfieldReady);await page.evaluate(()=>document.fonts.ready);
  const start=async()=>{await page.evaluate(()=>starfieldPreview.setState('six'));await page.evaluate(()=>starfieldPreview.motion(true));await page.getByRole('button',{name:'星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();await page.waitForTimeout(250);};
  const art=()=>page.locator('.vg-starfield-art'),marker=()=>page.locator('[data-scene-marker]').first();
  await start();const map=page.locator('[data-starfield-map]');await map.scrollIntoViewIfNeeded();
  await check(theme+': press moves only the art within 2–4px, preserving 44px target',async()=>{
   const b=await marker().boundingBox(),cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});await page.waitForTimeout(160);
   const s=await art().evaluate(n=>{const m=new DOMMatrixReadOnly(getComputedStyle(n).transform);const b=n.parentElement.querySelector('[data-scene-marker]').getBoundingClientRect();return{x:m.m41,y:m.m42,w:b.width,h:b.height,press:n.parentElement.hasAttribute('data-starfield-press')};});
   await page.screenshot({path:out+`/${theme}-pressed.png`});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
   assert(s.y>=1.8&&s.y<=4&&Math.abs(s.x)<=4,JSON.stringify(s));assert(s.w>=44&&s.h>=44);return s;
  });
  await page.waitForTimeout(250);
  await check(theme+': cancelled press returns to rest without navigating',async()=>{assert.equal(await page.locator('.vg-sector-detail').count(),0);assert.equal(await art().evaluate(n=>getComputedStyle(n).transform),'none');});
  await check(theme+': native vertical drag cancels feedback and never opens a scene',async()=>{
   const b=await marker().boundingBox(),cdp=await context.newCDPSession(page),p={x:b.x+b.width/2,y:b.y+b.height/2};
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+60}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);
   assert.equal(await map.getAttribute('data-starfield-press'),null);assert.equal(await page.locator('.vg-sector-detail').count(),0);
  });
  await page.evaluate(()=>{window.starfieldEntryStarts=0;window.starfieldEntryFrames=[];document.addEventListener('animationstart',e=>{if(e.target.matches('.vg-sector-detail')){window.starfieldEntryStarts++;const a=e.target.getAnimations().find(a=>a.animationName==='vg-sector-reveal');if(a)window.starfieldEntryFrames.push(a.effect.getKeyframes().map(f=>({opacity:f.opacity,transform:f.transform,y:new DOMMatrixReadOnly(f.transform).m42})));}});});
  await marker().click();await page.locator('.vg-sector-detail').waitFor();await page.getByText('正在读取这段经历…',{exact:true}).waitFor({state:'hidden'});
  await check(theme+': detail enters once in <=200ms from visible text and <=3px',async()=>{
   const entry=await page.locator('.vg-sector-detail').evaluate(n=>{const a=n.getAnimations().find(a=>a.animationName==='vg-sector-reveal');const s=getComputedStyle(n);return{animation:s.animationName,duration:parseFloat(s.animationDuration),frames:a?.effect.getKeyframes().map(f=>({opacity:f.opacity,transform:f.transform,y:new DOMMatrixReadOnly(f.transform).m42}))??window.starfieldEntryFrames.at(-1)};});
   assert.equal(entry.animation,'vg-sector-reveal');assert(entry.duration>0&&entry.duration<=.2);
   assert(entry.frames?.length>0,'Read actual animation frames, not only a declared name');assert(Number(entry.frames[0].opacity)>=.8);assert(Math.abs(entry.frames[0].y)<=3);
   return entry;
  });
  await page.waitForTimeout(250);const starts=await page.evaluate(()=>window.starfieldEntryStarts);
  const id=(await page.evaluate(()=>starfieldPreview.snapshot())).sceneIds[0];
  await page.evaluate(id=>starfieldPreview.mutateScene(id,'rename'),id);await page.getByRole('heading',{name:'修改后仍属于这一幕的完整标题',exact:true}).waitFor();await page.waitForTimeout(220);
  await check(theme+': live data update does not replay entry',async()=>{assert(starts>0);assert.equal(await page.evaluate(()=>window.starfieldEntryStarts),starts);});
  await page.getByRole('button',{name:'返回星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor({state:'visible'});
  await check(theme+': return restores the same overview without exit ghosts',async()=>{assert.equal(await page.locator('[data-scene-marker]').count(),6);assert.equal(await page.locator('.vg-sector-detail').count(),0);assert.equal(await page.locator('.vg-mobile-page-exit,.vg-soul-ghost').count(),0);});
  await page.waitForTimeout(250);await page.screenshot({path:out+`/${theme}-rest.png`});
  for(const type of ['system','app','background']){
   if(type==='system')await page.emulateMedia({reducedMotion:'reduce'});else if(type==='app')await page.evaluate(()=>starfieldPreview.motion(false));else await page.evaluate(()=>document.documentElement.setAttribute('data-vg-background',''));
   await marker().click();await page.locator('.vg-sector-detail').waitFor();
   await check(`${theme}-${type}: detail is immediately static and readable`,async()=>{const s=await page.locator('.vg-sector-detail').evaluate(n=>({animation:getComputedStyle(n).animationName,transform:getComputedStyle(n).transform,opacity:getComputedStyle(n).opacity}));assert.equal(s.animation,'none');assert.equal(s.transform,'none');assert.equal(s.opacity,'1');return s;});
   await page.getByRole('button',{name:'返回星域',exact:true}).click();
   await check(`${theme}-${type}: art has no active or ongoing motion`,async()=>{const s=await art().evaluate(n=>({animations:n.getAnimations().length,duration:getComputedStyle(n).transitionDuration,transform:getComputedStyle(n).transform}));assert.equal(s.animations,0);assert.equal(s.transform,'none');return s;});
   if(type==='system')await page.emulateMedia({reducedMotion:'no-preference'});else if(type==='app')await page.evaluate(()=>starfieldPreview.motion(true));else await page.evaluate(()=>document.documentElement.removeAttribute('data-vg-background'));
  }
  for(const width of [320,360,390,430]){await page.setViewportSize({width,height:width===320?740:844});await check(`${theme}-${width}: no overflow and stable marker targets`,async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await marker().evaluate(n=>n.getBoundingClientRect().width>=44));});}
  if(theme==='dark'){
   await page.setViewportSize({width:390,height:844});
   const samples={static:[],motion:[]};
   for(let trial=0;trial<3;trial++)for(const kind of trial%2?['motion','static']:['static','motion']){
    const disable=kind==='static'?await page.addStyleTag({content:'.vg-starfield-art,.vg-sector-detail{animation:none!important;transition:none!important}'}):undefined;
    const sample=await page.evaluate(async()=>{
     const frames=[],tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});
     document.querySelector('[data-scene-marker]').click();let last=performance.now();
     for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-last);last=now;}
     observer.disconnect();return{frames,tasks};
    });samples[kind].push(sample);
    await page.locator('.vg-sector-detail').waitFor();await page.getByRole('button',{name:'返回星域',exact:true}).click();await page.waitForTimeout(250);await disable?.evaluate(n=>n.remove());
   }
   const stats=kind=>{const frames=samples[kind].flatMap(s=>s.frames).sort((a,b)=>a-b);return{p95:frames[Math.floor(frames.length*.95)],over33:frames.filter(t=>t>33.4).length,longTasks:samples[kind].flatMap(s=>s.tasks),frames};};
   report.performance={static:stats('static'),motion:stats('motion'),samples,scope:'Three paired real scene-entry runs per mode, 120 frames each; baseline disables only the owned art/detail CSS effects, same IndexedDB and other components.'};
   await check('scene-entry motion retains +10% pooled P95 and no additional long tasks',async()=>{const p=report.performance;assert(p.motion.p95<=p.static.p95*1.1);assert(p.motion.longTasks.length<=p.static.longTasks.length);assert(p.motion.over33<=p.static.over33);return{staticP95:p.static.p95,motionP95:p.motion.p95};});
  }
  await check(theme+': all product model/microphone/native guards remain untouched',async()=>{const s=await page.evaluate(()=>starfieldPreview.snapshot());assert.equal(s.IS_MOBILE,true);assert.equal(s.native,false);assert(Object.values(s.isolation).every(n=>n===0));return s.isolation;});
  const video=page.video();await context.close();const file=out+`/${theme}.webm`;await video.saveAs(file);report.videos.push(file);
 }
}catch(e){report.errors.push(String(e));}
finally{await browser?.close();if(server)await new Promise(r=>server.server.close(r));report.pass=report.errors.length===0&&report.checks.length>0&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
