import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium }=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const output=process.env.VG_ORB_VITALITY_OUT??'.tmp-preview/orb-vitality-20261013';mkdirSync(output,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/orb-vitality-ui.tsx'],bundle:true,write:false,outfile:'fixture.js',platform:'browser',format:'iife',jsx:'automatic',target:'es2020',
  loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"DEV":true,"VITE_AI_GATEWAY_URL":""}', 'import.meta.hot':'undefined', __APP_VERSION__:'"6.1.0"'}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const assets='dist/renderer/assets',assetNames=new Set(readdirSync(assets));
const base=[...assetNames].filter(name=>name.endsWith('.css')).map(name=>readFileSync(join(assets,name),'utf8')).join('\n');
const html=`<!doctype html><html lang="zh-CN" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}\n${css}html,body,#root{height:100%;margin:0;background:var(--bg);color:var(--text);font-family:var(--vg-font-ui,system-ui)}</style><div id="root"></div><script src="/fixture.js"></script></html>`;
const server=createServer((req,res)=>{const name=req.url.split('?')[0].slice(1);if(assetNames.has(name)){res.setHeader('Content-Type',name.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(readFileSync(join(assets,name)));return;}
  res.setHeader('Content-Type',name==='fixture.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(name==='fixture.js'?js:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Users/34568/AppData/Local/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executablePath,'Existing browser required; never install');
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'no-preference'}),page=await context.newPage();
const checks=[],errors=[],videos=[];let blocked=0,performanceEvidence;
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);};
const isolate=async p=>{p.on('pageerror',error=>errors.push(error.stack||error.message));await p.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();blocked++;return route.abort();});};
const test=(name,...args)=>page.evaluate(({name,args})=>window.vitalityTest[name](...args),{name,args});
const active=()=>page.waitForFunction(()=>vitalityTest.activity().clients>0);
const paused=()=>page.waitForFunction(()=>vitalityTest.activity().clients===0);
const probe=()=>page.getByRole('button',{name:'动效测试小星0',exact:true});
const sample=async root=>root.evaluate(element=>new Promise(resolve=>{
  const body=element.querySelector('svg > g'),core=element.querySelector('.vg-orb-core ellipse');const samples=[],start=performance.now();
  const frame=()=>{const m=body.transform.baseVal.consolidate().matrix; samples.push({x:(m.a*128+m.c*132+m.e)*element.clientWidth/256,y:(m.b*128+m.d*132+m.f)*element.clientWidth/256,sx:Math.hypot(m.a,m.b),light:core.getAttribute('transform')});
    if(performance.now()-start<1200)requestAnimationFrame(frame);else resolve(samples);};frame();}));
try{
  await isolate(page);await page.goto(origin);await page.waitForFunction(()=>vitalityTest.ready);await active();
  checks.push(...await test('contracts'));
  const header=page.locator('.vg-character-orb .vg-soul-orb');await header.waitFor();
  check(await header.getAttribute('data-orb-motion')==='active','actual chat header retains base life while reading');
  const outline=await sample(header);const range=key=>Math.max(...outline.map(value=>value[key]))-Math.min(...outline.map(value=>value[key]));
  check(range('x')<2&&range('y')<2&&range('sx')<.03,'44px reading outline stays within 2px and 3 percent scale envelope');
  check(new Set(outline.map(value=>value.light)).size>10,'internal light remains visibly alive during quiet reading');
  await page.screenshot({path:join(output,'actual-chat-dark-390.png')});
  await page.getByRole('button',{name:'打开林舟的状态与互动',exact:true}).click();await page.getByRole('dialog').waitFor();
  check(await page.locator('.vg-soul-ghost').count()===1,'status panel uses one bounded visual handoff');
  await page.waitForTimeout(450);check(await page.locator('.vg-soul-ghost').count()===0,'status handoff removes its inert visual');
  await page.screenshot({path:join(output,'actual-status-panel.png')});await page.keyboard.press('Escape');await page.waitForTimeout(450);
  check(await page.getByRole('dialog').count()===0&&await header.getAttribute('data-orb-motion')==='active','closing status restores the original reading entry');
  await page.getByRole('button',{name:'打开林舟的状态与互动',exact:true}).click();await page.getByRole('button',{name:'语音通话',exact:true}).click();await page.locator('.vg-voice-call-soul').waitFor();
  check(await page.locator('.vg-soul-ghost').count()===1,'status-to-call uses the existing orb as its visual anchor');
  await page.waitForTimeout(450);await page.screenshot({path:join(output,'actual-call-ready.png')});await page.keyboard.press('Escape');await page.waitForTimeout(250);
  check(!(await test('callState')).busy&&!(await test('callState')).target,'closing a not-started call makes no audio operation');
  await test('mode','lab');await probe().waitFor();await active();
  const baseCommits=await test('commits');await page.waitForTimeout(350);check(await test('commits')===baseCommits,'ambient animation commits no React frames');
  const light=page.locator('.vg-orb-core ellipse').first();const beforeState=await light.getAttribute('transform');await test('emotion','thinking');await page.waitForTimeout(25);const afterState=await light.getAttribute('transform');
  const numbers=value=>(value.match(/-?\d+\.?\d*/g)||[]).map(Number);
  check(numbers(beforeState).slice(0,2).every((value,index)=>Math.abs(value-numbers(afterState)[index])<3),'state transition keeps the internal light phase');
  await test('emotion','idle');await page.waitForTimeout(450);
  let box=await probe().boundingBox();const center={x:box.x+box.width/2,y:box.y+box.height/2};
  const scale=()=>probe().locator('svg > g').evaluate(element=>{const m=element.transform.baseVal.consolidate().matrix;return Math.hypot(m.c,m.d);});
  const resting=await scale(),count=await test('activations');await page.mouse.move(center.x+20,center.y);await page.mouse.down();await page.waitForTimeout(180);
  check(await scale()<resting-.015,'press gives a small visible compression');
  check(Number(await page.locator('.vg-orb-core ellipse').nth(3).getAttribute('opacity'))>0,'press gathers internal light toward the touch');
  await page.mouse.move(center.x+40,center.y);await page.mouse.up();await page.waitForTimeout(500);
  check(await test('activations')===count&&await scale()>resting-.015,'cancelled movement settles without activation or stuck squash');
  box=await probe().boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,isPrimary:true})));await page.mouse.up();
  check(await test('activations')===count,'pointercancel suppresses the subsequent activation');
  await probe().focus();await page.keyboard.press('Enter');check(await test('activations')===count+1,'keyboard still activates once after cancellation');
  const cdp=await context.newCDPSession(page);box=await probe().boundingBox();const point={x:box.x+box.width/2,y:box.y+box.height/2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
  check(await test('activations')===count+2,'native touch tap activates once');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-65}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
  check(await test('activations')===count+2,'native touch scrolling never activates the orb');
  for(let i=0;i<5;i++)await probe().click();await page.waitForTimeout(800);
  check(await test('activations')===count+7&&await scale()>.95&&await scale()<1.05,'rapid clicks are bounded and settle');
  await test('emotion','working');await probe().click();check(await probe().locator('.vg-soul-orb').getAttribute('data-orb-emotion')==='working','touch never replaces a real work state');
  await test('emotion','idle');await test('cue');await page.waitForTimeout(450);check(await scale()>.95&&await scale()<1.05,'reply-arrival cue settles once without a repeating hop');
  await test('intensity','reduced');await paused();await test('emotion','error');
  check(await probe().locator('.vg-soul-orb').getAttribute('data-orb-emotion')==='error'&&await page.getByRole('status').textContent()==='error','reduced motion retains a clear static state');
  await test('intensity','lively');await active();await page.emulateMedia({reducedMotion:'reduce'});await paused();check(true,'system reduced motion overrides lively');
  await page.emulateMedia({reducedMotion:'no-preference'});await active();await test('reduce',true);await paused();check(true,'existing app reduce-motion setting also overrides lively');
  await test('reduce',false);await active();await test('platformBackground',true);await paused();check((await test('activity')).scheduled===false,'app background releases the shared frame clock');
  await test('platformBackground',false);await active();await test('visibility',true);await paused();check(true,'hidden document pauses decorative motion');await test('visibility',false);await active();
  await test('hidden',true);await paused();check(true,'native intersection pauses an offscreen orb');await test('hidden',false);await probe().scrollIntoViewIfNeeded();await active();
  await test('mode','settings');await page.getByRole('radiogroup',{name:'小星动态强度'}).waitFor();await page.getByRole('radio',{name:/减少动态/}).check();await paused();
  check((await test('preference'))['vitality-owner']==='reduced','actual settings save the current account intensity');
  await test('owner','another-owner');await active();check(await page.getByRole('radiogroup',{name:'小星动态强度'}).getByRole('radio',{name:/柔和/}).isChecked(),'new account has its own gentle default');
  await page.getByRole('radio',{name:/灵动/}).check();await test('owner','vitality-owner');await paused();check(await page.getByRole('radio',{name:/减少动态/}).isChecked(),'returning account restores its own reduced choice');
  await page.reload();await page.waitForFunction(()=>vitalityTest.ready);await paused();check(await page.locator('.vg-character-orb .vg-soul-orb').getAttribute('data-orb-intensity')==='reduced','account intensity survives a real browser reload');
  await test('intensity','gentle');await test('call','listening');await page.getByRole('dialog').waitFor();await page.waitForTimeout(150);
  const callOrb=page.locator('.vg-voice-call-soul .vg-soul-orb');
  check(await callOrb.getAttribute('data-orb-audio')==='none','listening without a capture signal shows no volume ripple');
  const signalCommits=await test('commits');for(let i=0;i<20;i++)await test('level',.4+i/100);await page.waitForTimeout(80);
  check(await callOrb.getAttribute('data-orb-audio')==='capture'&&Number(await callOrb.locator('.vg-orb-core circle').getAttribute('opacity'))>0,'real capture presentation follows supplied native-level input');
  check(await test('commits')===signalCommits,'capture level updates do not commit the call React surface');
  await test('call','listening',{inputMode:'text',level:1});await page.waitForTimeout(80);check(await callOrb.getAttribute('data-orb-audio')==='none','typed input ignores even a stale nonzero microphone level');
  await test('call','listening',{muted:true,level:1});await page.waitForTimeout(80);check(await callOrb.getAttribute('data-orb-audio')==='none','muted capture never produces a ripple');
  await test('call','playing');await page.waitForTimeout(80);check(await callOrb.getAttribute('data-orb-audio')==='none','playing phase without acknowledged speaking text has only base life');
  await test('call','playing',{speakingText:'确已播放的验证片段'});await page.waitForTimeout(80);check(await callOrb.getAttribute('data-orb-audio')==='playback','acknowledged playback drives the output presentation');
  await page.keyboard.press('Escape');await page.locator('button.vg-voice-call-capsule').waitFor();check((await test('callState')).busy&&(await test('callState')).minimized,'back keeps the original busy host while shrinking');
  await page.locator('button.vg-voice-call-capsule').click();await page.getByRole('dialog').waitFor();check((await test('callState')).busy&&!(await test('callState')).minimized,'restoring the capsule keeps the same call');
  await test('call','paused');await page.waitForTimeout(80);check(await callOrb.getAttribute('data-orb-motion')==='paused','paused call visibly gathers into a static state');
  await test('stopCall');await test('mode','lab');await test('emotion','idle');await active();
  for(const theme of ['dark','light'])for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);await probe().scrollIntoViewIfNeeded();
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}-${width} no horizontal overflow`);
    await page.screenshot({path:join(output,`${theme}-${width}.png`)});
  }
  await page.setViewportSize({width:320,height:568});await page.evaluate(()=>document.body.style.zoom='1.25');await page.getByRole('textbox',{name:'自由输入'}).scrollIntoViewIfNeeded();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)&&await page.getByRole('textbox',{name:'自由输入'}).isVisible(),'short enlarged viewport keeps the free input reachable');
  await page.screenshot({path:join(output,'light-320-short-zoom125.png')});await page.evaluate(()=>document.body.style.zoom='1');
  await test('mode','settings');await test('font',22);await page.getByRole('radiogroup',{name:'小星动态强度'}).scrollIntoViewIfNeeded();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'large chat font and small settings page remain usable');
  await page.screenshot({path:join(output,'actual-settings-320-font22.png')});
  await test('mode','lab');await page.setViewportSize({width:390,height:844});await test('copies',6);await probe().scrollIntoViewIfNeeded();await active();await page.waitForTimeout(500);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Performance.enable');const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));const before=await metric();
  const perf=await page.evaluate(()=>new Promise(resolve=>{let writes=0,layouts=0;const original=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(...args){layouts++;return original.apply(this,args);};
    const observer=new MutationObserver(records=>writes+=records.length);document.querySelectorAll('.vg-soul-orb').forEach(root=>observer.observe(root,{subtree:true,attributes:true}));
    const commits=vitalityTest.commits(),start=performance.now(),frames=[];let previous=start;
    const frame=()=>{const now=performance.now();frames.push(now-previous);previous=now;if(now-start<1200)requestAnimationFrame(frame);else{observer.disconnect();Element.prototype.getBoundingClientRect=original;resolve({writes,layouts,reactCommits:vitalityTest.commits()-commits,elapsedMs:now-start,frameIntervalsMs:frames,activity:vitalityTest.activity()});}};requestAnimationFrame(frame);}));
  const after=await metric();performanceEvidence={...perf,cpuThrottle:4,taskDurationMs:(after.TaskDuration-before.TaskDuration)*1000,scriptDurationMs:(after.ScriptDuration-before.ScriptDuration)*1000,scope:'Headless desktop Chrome, six actual SVG components; not Android frame time.'};
  check(perf.layouts===0&&perf.reactCommits===0&&perf.activity.clients===6&&perf.activity.scheduled,'six visible orbs share one scheduler with zero frame layout reads or React commits');
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  check(errors.length===0,'no uncaught page exceptions');check(blocked===0,'zero external requests');
  // Short recordings use separate fresh contexts and the actual chat/panel/probe components.
  for(const theme of ['dark','light']){
    let recording;
    try{recording=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,recordVideo:{dir:join(output,'raw-video'),size:{width:390,height:844}}});}
    catch(error){videos.push({theme,supported:false,error:String(error)});break;}
    const p=await recording.newPage();await isolate(p);await p.goto(origin);await p.waitForFunction(()=>vitalityTest.ready);if(theme==='light')await p.evaluate(()=>document.documentElement.classList.remove('dark'));
    await p.waitForTimeout(1800);await p.getByRole('button',{name:'打开林舟的状态与互动',exact:true}).click();await p.waitForTimeout(1300);await p.keyboard.press('Escape');await p.waitForTimeout(600);
    await p.evaluate(()=>vitalityTest.mode('lab'));await p.getByRole('button',{name:'动效测试小星0',exact:true}).waitFor();await p.waitForTimeout(1300);const b=await p.getByRole('button',{name:'动效测试小星0',exact:true}).boundingBox();await p.mouse.move(b.x+b.width*.65,b.y+b.height*.5);await p.mouse.down();await p.waitForTimeout(170);await p.mouse.up();await p.waitForTimeout(1700);
    const video=p.video();await recording.close();const path=join(output,`orb-${theme}.webm`);await video.saveAs(path);videos.push({theme,supported:true,path,scope:'Actual component rendering; seeded fictional local chat, no live model/audio.'});
  }
  writeFileSync(join(output,'result.json'),JSON.stringify({date:new Date().toISOString(),passed:checks.length,checks,errors,blockedExternalRequests:blocked,realModelCalls:0,nativeAudioUsed:false,performance:performanceEvidence,videos},null,2)+'\n');
  process.stdout.write(`PASS orb-vitality: ${checks.length} checks, ${videos.filter(v=>v.supported).length} short videos, isolated IndexedDB, zero external requests\n`);
}catch(error){await page.screenshot({path:join(output,`failure-${Date.now()}.png`)}).catch(()=>{});writeFileSync(join(output,`failure-${Date.now()}.json`),JSON.stringify({checks,errors,blocked,error:String(error)},null,2));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
