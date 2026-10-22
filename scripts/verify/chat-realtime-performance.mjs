/** Same-stock paired browser evidence; not Android timing or model latency. */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
const origin=process.env.VG_SCENE_ORIGIN??'http://127.0.0.1:5322',out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-realtime-20261019/performance';mkdirSync(out,{recursive:true});
const sceneId=process.env.VG_SCENE_PERF_ID??'snow-study',trials=Number(process.env.VG_SCENE_PERF_TRIALS??3);
if(!/^(snow-study|guofeng-tea-room|urban-window-seat|polar-refuge|orbital-observatory|moonlit-bedroom)$/.test(sceneId)||!Number.isInteger(trials)||trials<1||trials>3)throw Error('Invalid bounded performance options');
const browser=await chromium.launch({channel:'chrome',headless:true}),report={startedAt:new Date().toISOString(),environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,browser:browser.version(),viewport:'390x844',dpr:2,source:'actual ChatWindow, locally seeded identical 500 mixed messages',scene:'snow-study'},samples:[],errors:[],limitations:['Desktop Chrome evidence, not Android IME/GPU frame time, battery or thermal performance.','Three trials per mode; exploratory regression evidence, not universal performance guarantee.','UI rAF intervals are separate from background renderer frames; renderer is intentionally capped.','Input-dispatch to next rAF is a browser feedback proxy, not physical keyboard latency.','This fixture bundles actual components; scene selection time is not the production lazy-chunk cold-start cost.','No model/provider/microphone request. Cold/warm refer to HTTP assets in a fresh/reused isolated browser context.']};
const p95=rows=>{const sorted=[...rows].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*.95)]??0;};
const api=(page,owner,name,...args)=>page.evaluate(({owner,name,args})=>window[owner][name](...args),{owner,name,args});
try{
 report.environment.scene=sceneId;report.limitations[1]=`${trials} trial(s) per mode; exploratory regression evidence, not universal performance guarantee.`;
 for(let trial=1;trial<=trials;trial++)for(const renderer of trial%2?['layered','auto']:['auto','layered']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  // No routing: Playwright route disables HTTP cache and invalidates warm-cache claims.
  for(const cache of ['cold','warm']){
   const navStart=performance.now();await page.goto(origin);await page.waitForFunction(()=>window.sceneTest);await api(page,'backgroundTest','setup',0);await api(page,'sceneTest','stock',500);await api(page,'backgroundTest','theme','dark');await page.getByRole('textbox',{name:'消息内容'}).waitFor();
   const interactiveAfterNavigationMs=performance.now()-navStart,start=performance.now();await api(page,'sceneTest','scene',sceneId,'auto',{renderer,parallaxEnabled:false});await page.waitForFunction(backend=>{const s=window.sceneTest.inspect()[0];return s?.state==='ready'&&s.backend===backend;},renderer==='auto'?'webgl2':'layered');const sceneReadyAfterSelectionMs=performance.now()-start;
   await page.waitForTimeout(600);const cdp=await context.newCDPSession(page);await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
   const sample=await page.evaluate(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),intervals=[],longTasks=[],feedback=[];let previous=performance.now(),alive=true;
    const observer=new PerformanceObserver(list=>list.getEntries().forEach(e=>longTasks.push({start:e.startTime,duration:e.duration})));observer.observe({type:'longtask',buffered:false});
    const tick=now=>{intervals.push(now-previous);previous=now;if(alive)requestAnimationFrame(tick);};requestAnimationFrame(tick);
    const before=window.sceneTest.inspect()[0],idleStart=performance.now();await wait(2000);const idleElapsed=performance.now()-idleStart,afterIdle=window.sceneTest.inspect()[0],idleIntervals=intervals.splice(0),idleTasks=longTasks.splice(0);
    const input=document.querySelector('[aria-label="消息内容"]'),thread=document.querySelector('.chat-thread'),setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    // Actual active input must pause scene effects while text and scrolling remain responsive.
    input.focus();thread.scrollTop=Math.max(0,thread.scrollHeight-thread.clientHeight-800);await wait(120);previous=performance.now();intervals.length=0;longTasks.length=0;
    const inputStart=window.sceneTest.inspect()[0];for(let i=0;i<50;i++){const began=performance.now();setter.call(input,'同条件中文输入测试 '+i);input.dispatchEvent(new Event('input',{bubbles:true}));thread.scrollTop=Math.max(0,thread.scrollTop-18);await new Promise(r=>requestAnimationFrame(r));feedback.push(performance.now()-began);await wait(16);}
    const inputEnd=window.sceneTest.inspect()[0];alive=false;observer.disconnect();return{idle:{elapsedMs:idleElapsed,before,after:afterIdle,intervals:idleIntervals,longTasks:idleTasks},input:{before:inputStart,after:inputEnd,feedback,intervals:[...intervals],longTasks:[...longTasks]},bubbles:document.querySelectorAll('.vg-message-bubble').length,resources:window.sceneTest.resources()};
   });
   const finished=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await finished;let trace='';for(;;){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString():chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});await cdp.detach();
   const tracePath=`${out}/trial-${trial}-${renderer}-${cache}-trace.json`;writeFileSync(tracePath,trace);
   const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/scene-assets/')||r.name.endsWith('.glb')).map(r=>({name:r.name.split('/').pop(),transferSize:r.transferSize,decodedBodySize:r.decodedBodySize,duration:r.duration})));
   const idleRendererFrames=(sample.idle.after.particles?.frames??0)-(sample.idle.before.particles?.frames??0),inputRendererFrames=(sample.input.after.particles?.frames??0)-(sample.input.before.particles?.frames??0);
   report.samples.push({trial,renderer,cache,interactiveAfterNavigationMs,sceneReadyAfterSelectionMs,idleRendererFrames,idleRendererFps:idleRendererFrames*1000/sample.idle.elapsedMs,idleUiFrameP95:p95(sample.idle.intervals),inputUiFrameP95:p95(sample.input.intervals),inputFeedbackP95:p95(sample.input.feedback),inputRendererFrames,resourceRequests:resources,tracePath,...sample});
   console.log(JSON.stringify({trial,renderer,cache,sceneReadyAfterSelectionMs:Math.round(sceneReadyAfterSelectionMs),idleRendererFrames,inputRendererFrames,inputP95:p95(sample.input.feedback)}));
  }
  await context.close();
 }
 report.status=report.samples.length===trials*4&&report.samples.every(s=>s.bubbles<80&&s.inputRendererFrames===0&&s.resources.reservedBytes+s.resources.realtimeReservedBytes<=48*1024*1024)&&report.errors.length===0?'pass':'failed';
}catch(error){report.status='failed';report.failure=String(error);console.error(error);}
finally{await browser.close();report.finishedAt=new Date().toISOString();report.sceneModelHash=createHash('sha256').update(readFileSync(`src/assets/chat-scenes/${sceneId}/scene.glb`)).digest('hex');writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,samples:report.samples.length,out}));if(report.status!=='pass')process.exitCode=1;}
