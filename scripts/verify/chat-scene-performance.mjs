import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import os from 'node:os';
const out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-scene-plan-20261019/performance';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report={environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,browser:browser.version(),viewport:'390x844',dpr:2},samples:[],limitations:['Desktop Chrome, not Android/GPU measurement.','Input dispatch to next rAF is a browser feedback proxy, not physical keyboard latency.','Synthetic 500 mixed messages; no model transport in performance sampling.']};
for(const mode of ['legacy','static','dynamic','snow-study','mist-coast','hearth-cabin','night-train','home-bedroom','home-living']){
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),page=await context.newPage();
 // The isolated server's CSP blocks external/model/media transport. Avoid Playwright routing,
 // which disables HTTP cache and would make a claimed warm-cache comparison misleading.
 for(const cache of ['cold','warm']){
  const navigation=Date.now();await page.goto('http://127.0.0.1:5321/');await page.waitForFunction(()=>window.sceneTest);
  await page.evaluate(async()=>{await window.backgroundTest.setup(0);await window.sceneTest.stock(500);});
  await page.getByRole('textbox',{name:'消息内容'}).waitFor();const interactive=Date.now()-navigation;
  const start=Date.now();if(mode==='legacy')await page.evaluate(()=>window.backgroundTest.save({mode:'atmosphere',strength:'gentle'}));else{await page.evaluate(mode=>window.sceneTest.scene(['static','dynamic'].includes(mode)?'cafe-afternoon':mode,mode==='static'?'power-save':'auto'),mode);await page.waitForFunction(()=>document.querySelector('.vg-chat-scene')?.dataset.sceneLoad==='ready');}
  const sceneVisible=Date.now()-start;await page.waitForTimeout(700);
  const cdp=await context.newCDPSession(page);await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
  const measurements=await page.evaluate(async()=>{const input=document.querySelector('[aria-label="消息内容"]'),thread=document.querySelector('.chat-thread'),setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;thread.scrollTop=6000;await new Promise(r=>setTimeout(r,180));const feedback=[],intervals=[],longTasks=[];let previous=performance.now(),alive=true;
   const observer=new PerformanceObserver(entries=>entries.getEntries().forEach(e=>longTasks.push({start:e.startTime,duration:e.duration})));observer.observe({type:'longtask',buffered:false});
   const tick=now=>{intervals.push(now-previous);previous=now;if(alive)requestAnimationFrame(tick);};requestAnimationFrame(tick);
   for(let i=0;i<40;i++){const start=performance.now();setter.call(input,'同条件中文输入测试'+i);input.dispatchEvent(new Event('input',{bubbles:true}));thread.scrollTop=6000-(i+1)*60;await new Promise(r=>requestAnimationFrame(r));feedback.push(performance.now()-start);}alive=false;observer.disconnect();
   const p95=rows=>[...rows].sort((a,b)=>a-b)[Math.floor(rows.length*.95)];return{feedback,intervals,longTasks,inputP95:p95(feedback),frameIntervalP95:p95(intervals),renderedBubbles:document.querySelectorAll('.vg-message-bubble').length,scene:window.sceneTest.inspect(),resources:window.sceneTest.resources()};
  });
  const finished=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await finished;let trace='';while(true){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString():chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});await cdp.detach();writeFileSync(`${out}/${mode}-${cache}-trace.json`,trace);
  const assetRequests=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/scene-assets/')).map(e=>({name:e.name.split('/').pop(),transferSize:e.transferSize,decodedBodySize:e.decodedBodySize,duration:e.duration})));
  report.samples.push({mode,cache,interactiveAfterNavigationMs:interactive,sceneReadyAfterSelectionMs:sceneVisible,assetRequests,...measurements});
 }
 await context.close();
}
await browser.close();report.status=report.samples.length===18&&report.samples.every(s=>s.renderedBubbles<80)?'pass':'failed';writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,samples:report.samples.map(({mode,cache,inputP95,frameIntervalP95,sceneReadyAfterSelectionMs})=>({mode,cache,inputP95,frameIntervalP95,sceneReadyAfterSelectionMs}))}));if(report.status!=='pass')process.exitCode=1;
