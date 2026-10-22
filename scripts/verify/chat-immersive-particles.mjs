import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,basename} from 'node:path';

// Actual ChatWindow, IndexedDB appearance settings and production particle code.
// The existing fixture intercepts model transport and rejects microphone access.
// Everything is served from a fresh loopback origin, never the user's account.
const out=process.env.VG_IMMERSIVE_PARTICLES_EVIDENCE??'.tmp-preview/chat-immersive-particles-20261015';
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const performanceOnly=!!process.env.VG_IMMERSIVE_PERFORMANCE_ONLY,skipPerformance=!!process.env.VG_IMMERSIVE_SKIP_PERFORMANCE;
mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/chat-background-complete.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'},plugins:[{name:'historical-bubble-commits',setup(b){b.onLoad({filter:/MessageBubble\.tsx$/},async args=>({loader:'tsx',contents:readFileSync(args.path,'utf8').replace(/(function MessageBubble\([^\n]+\{\s*\n)/,'$1 window.bubbleRenders??={};window.bubbleRenders[message.id]=(window.bubbleRenders[message.id]||0)+1;\n')}));}}]});
const assets='dist/renderer/assets',css=readdirSync(assets).filter(f=>f.endsWith('.css'));
const server=createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url.startsWith('/assets/')){try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(readFileSync(join(assets,basename(req.url))));}catch{res.writeHead(404).end();}return;}
  res.setHeader('Content-Type','text/html;charset=utf8');res.end(`<!doctype html><html lang="zh-CN" class="dark"><head><title>聊天沉浸粒子隔离验收</title><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><main id="app" class="mobile-layout"></main><script src="/fixture.js"></script></body></html>`);
});
await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();
const phase=performanceOnly?'performance':skipPerformance?'functional':'complete';
const report={runId,phase,runtime:{node:process.version,browser:browser.version(),css},checks:[],errors:[],network:[],screenshots:[],performance:[],themes:[],video:undefined,modelCalls:0,microphoneCalls:0,limitations:['Desktop Chrome touch emulation, not an Android device or an installed APK.','Canvas pixel checks verify rendered marks and central coverage; human visual review is still required.','RAF and long tasks are CPU-side laboratory observations, not GPU frame-time or phone-frame-rate guarantees.','No sustained thermal, battery or low-memory Android check.']};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',req=>{if(!req.url().startsWith(origin)&&!req.url().startsWith('data:')&&!req.url().startsWith('blob:'))report.network.push(req.url());});
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)throw Error(name);};
const api=(name,...args)=>page.evaluate(({name,args})=>window.backgroundTest[name](...args),{name,args});
const chat=(name,...args)=>page.evaluate(({name,args})=>window.chatStreamTest[name](...args),{name,args});
const settle=(ms=160)=>page.waitForTimeout(ms);
const ready=async(history=3)=>{await api('setup',history);await page.getByRole('textbox',{name:'消息内容'}).waitFor();await settle();};
const shot=async(name)=>{const path=`${out}/${name}.png`;await page.screenshot({path});report.screenshots.push(path);};
const foreground=()=>page.locator('.chat-room').evaluate(room=>[room.querySelector('.chat-header'),room.querySelector('.chat-thread'),room.querySelector('.chat-composer'),room.querySelector('.vg-message-bubble')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,y:r.y,w:r.width,h:r.height,color:s.color,background:s.backgroundColor,image:s.backgroundImage,font:s.fontSize,text:n.classList.contains('vg-message-bubble')?n.textContent:undefined};}));

// Production exposes only a local numeric renderer snapshot, never chat content.
// The fixture explicitly imports a WeakMap-backed inspector. In tsParticles 4,
// the HTML canvas transfers to OffscreenCanvas, so sampling through its real
// renderer context is required; canvas.getContext() on the DOM node would throw.
const inspect=(selector='.chat-room .vg-chat-atmosphere-edge')=>page.locator(selector).evaluate(layer=>{
  const canvas=layer.querySelector('canvas'),host=layer.querySelector('.vg-chat-particles'),hosts=[...document.querySelectorAll('.vg-chat-particles')],index=hosts.indexOf(host),raw=index>=0?backgroundTest.fields(true)[index]:null;
  const pixels=raw?.pixelSample??raw?.pixels??{painted:0,central:0,hash:0,centralHash:0,alphaSum:0,width:0,height:0};
  const rr=layer.parentElement.getBoundingClientRect(),cr=canvas?.getBoundingClientRect();
  return{canvasCount:layer.querySelectorAll('canvas').length,hostCount:layer.querySelectorAll('.vg-chat-particles').length,engine:raw??null,attrs:host?{...host.dataset}:{},pixels,fullRoom:!!cr&&Math.abs(cr.width-rr.width)<2&&Math.abs(cr.height-rr.height)<2,canvasStyle:canvas?{pointerEvents:getComputedStyle(canvas).pointerEvents,opacity:getComputedStyle(canvas).opacity}:null};
});
const waitEngine=async(selector)=>{await page.waitForFunction(selector=>{const layer=document.querySelector(selector),host=layer?.querySelector('.vg-chat-particles'),index=[...document.querySelectorAll('.vg-chat-particles')].indexOf(host),state=index<0?null:backgroundTest.fields(false)[index];return !!layer?.querySelector('canvas')&&state?.count>0&&state.status!=='loading';},selector??'.chat-room .vg-chat-atmosphere-edge');await settle(350);return inspect(selector);};
const paused=async(name,selector)=>{const before=await inspect(selector);await settle(80);const after=await inspect(selector);const state=after.engine?.status??after.attrs.particleState??after.attrs.state;check(['paused','static','off'].includes(state)||before.engine?.frames===after.engine?.frames&&before.pixels.hash===after.pixels.hash,name,{before,after});};

async function traceFrames(cdp,label,scrolling){
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
  const sample=await page.evaluate(async scrolling=>{const frames=[],tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});const el=document.querySelector('.chat-thread');let previous;for(let i=0;i<180;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(previous!==undefined)frames.push(now-previous);previous=now;if(scrolling)el.scrollTop=Math.max(0,el.scrollHeight-el.clientHeight-80+10*Math.sin(i/8));}observer.disconnect();frames.sort((a,b)=>a-b);return{p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],over33:frames.filter(t=>t>33.4).length,longTasks:tasks};},scrolling);
  const done=new Promise(yes=>cdp.once('Tracing.tracingComplete',yes));await cdp.send('Tracing.end');const {stream}=await done;let raw='';while(true){const chunk=await cdp.send('IO.read',{handle:stream});raw+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});writeFileSync(`${out}/trace-${label}.json`,raw);return sample;
}

try{
  await page.goto(origin);await page.waitForFunction(()=>window.backgroundTest);await ready();
  if(!performanceOnly){
  const themes=(await page.evaluate(()=>backgroundTest.themes)).filter(t=>t.id!=='neutral'),signatures=new Set();
  for(const mode of ['dark','light'])for(const width of [320,390,430])for(const theme of themes){
    await page.setViewportSize({width,height:844});await api('theme',mode);await api('save',{mode:'clean',themeId:theme.id,effect:'dust',strength:'vivid'});await settle();const clean=await foreground();
    await api('save',{mode:'atmosphere',themeId:theme.id,effect:'dust',strength:'vivid'});const rendered=await waitEngine();
    check(JSON.stringify(clean)===JSON.stringify(await foreground()),`${theme.label}/${mode}/${width}: foreground content, geometry and surfaces preserved`);
    const layout=await page.locator('.chat-room').evaluate(room=>({overflow:document.documentElement.scrollWidth>innerWidth,layerInThread:!!room.querySelector('.chat-thread .vg-chat-atmosphere-edge'),buttons:[...room.querySelectorAll('.chat-header button,.chat-composer button')].map(n=>{const r=n.getBoundingClientRect();return{w:r.width,h:r.height};})}));
    check(!layout.overflow&&!layout.layerInThread&&layout.buttons.every(b=>b.w>=44&&b.h>=44),`${theme.label}/${mode}/${width}: no overflow, no scroll-layer embedding, touch targets intact`,layout);
    check(rendered.canvasCount===1&&rendered.fullRoom&&rendered.pixels.painted>30&&rendered.pixels.central>8,`${theme.label}/${mode}/${width}: one painted full-room canvas includes central particles`,rendered);
    check(rendered.engine?.count>=30&&rendered.engine?.count<=100,`${theme.label}/${mode}/${width}: immersive density stays within the renderer budget`,rendered.engine?.count);
    check(rendered.canvasStyle.pointerEvents==='none',`${theme.label}/${mode}/${width}: particles cannot capture chat input`);
    if(width===390){report.themes.push({theme:theme.id,mode,...rendered});signatures.add(JSON.stringify([rendered.engine?.shape,rendered.engine?.motion,rendered.attrs.particleShape,rendered.attrs.particleMotion]));await shot(`theme-${theme.id}-${mode}-390`);}
  }
  check(signatures.size===6,'six themes expose six shape and motion signatures',[...signatures]);
  await page.setViewportSize({width:390,height:844});await api('theme','dark');await api('save',{mode:'atmosphere',themeId:'lively',effect:'dust',strength:'vivid'});const first=await waitEngine();await settle(450);const second=await inspect();
  check(first.pixels.centralHash!==second.pixels.centralHash&&second.pixels.central>8,'idle particles visibly move through the central background',{first,second});
  await api('save',{strength:'gentle'});const gentle=await waitEngine();await api('save',{strength:'vivid'});const vivid=await waitEngine();
  check((gentle.engine?.count??Number(gentle.attrs.particleCount))>0&&(vivid.engine?.count??Number(vivid.attrs.particleCount))>(gentle.engine?.count??Number(gentle.attrs.particleCount)),'gentle and vivid have distinct bounded particle densities',{gentle,vivid});
  await api('save',{effect:'glow',strength:'gentle'});const glow=await waitEngine();check(glow.pixels.painted>0&&glow.pixels.central>0,'default glow mode also has a visible central particle field',glow);
  await api('save',{effect:'dust',strength:'off'});await settle(300);await paused('motion off preserves a static or absent field');
  await api('save',{strength:'vivid'});await waitEngine();await api('reduced',true);await settle(100);await paused('application reduced motion stops particle movement');await api('reduced',false);await settle(250);
  await page.emulateMedia({reducedMotion:'reduce'});await settle(100);await paused('system reduced motion stops particle movement');await page.emulateMedia({reducedMotion:'no-preference'});await settle(250);
  await page.getByRole('textbox',{name:'消息内容'}).focus();await paused('input focus gives priority to typing');await page.evaluate(()=>document.activeElement.blur());await settle(250);
  await page.locator('.chat-thread').evaluate(n=>n.dispatchEvent(new Event('scroll')));await paused('scrolling history pauses particle drawing');await settle(260);check((await inspect()).engine?.status==='running','particles resume after the scroll pause expires');
  for(const attr of ['hidden','inert']){await page.locator('.chat-room').evaluate((n,key)=>n.setAttribute(key,''),attr);await paused(`${attr} room does not animate`);await page.locator('.chat-room').evaluate((n,key)=>n.removeAttribute(key),attr);await settle(150);}
  await page.evaluate(()=>document.documentElement.setAttribute('data-vg-background','true'));await paused('background app does not animate');await page.evaluate(()=>document.documentElement.removeAttribute('data-vg-background'));await settle(200);
  await page.getByRole('button',{name:'聊天设置',exact:true}).click();const settings=page.getByRole('dialog',{name:'聊天设置',exact:true});await settings.waitFor();await paused('settings modal pauses the covered chat');
  await settings.getByRole('button',{name:/聊天外观/}).click();const editor=page.getByRole('dialog',{name:'聊天外观',exact:true});await editor.waitFor();const previewSelector='.vg-background-preview .vg-chat-atmosphere-edge';const previewA=await waitEngine(previewSelector);await paused('appearance editor keeps covered chat paused');await settle(300);const previewB=await inspect(previewSelector);check(previewA.pixels.hash!==previewB.pixels.hash,'editor preview remains live while covered chat is paused',{previewA,previewB});await shot('editor-live-preview-dark-390');
  await editor.getByRole('button',{name:'取消',exact:true}).click();await settings.getByRole('button',{name:'返回',exact:true}).click();await settle(450);check(await page.locator('.vg-chat-atmosphere-edge canvas').count()===1,'closing editor destroys only its preview canvas');check((await api('particleContainers')).length===1,'closing editor also destroys its engine container');
  await ready();await api('save',{mode:'atmosphere',themeId:'mysterious',effect:'dust',strength:'vivid'});await waitEngine();const canvas=await page.locator('.chat-room .vg-chat-atmosphere-edge canvas').elementHandle();await chat('submit','我想慢慢聊。');await page.waitForFunction(()=>chatStreamTest.requests().length===1);await page.getByRole('status',{name:'正在回应',exact:true}).waitFor();check(await page.locator('[data-streaming-reply]').count()===0,'waiting still has no empty bubble');await paused('waiting gives the header orb motion priority');
  await chat('push',0,'我在听。');await page.locator('[data-streaming-reply]').waitFor();await paused('streaming keeps decoration still');const stable=await inspect();await chat('push',0,'你慢慢说，我们不着急。');await settle();check(await canvas.evaluate(n=>n===document.querySelector('.chat-room .vg-chat-atmosphere-edge canvas')),'stream append retains the canvas instance');check((await inspect()).engine?.instanceId===stable.engine?.instanceId,'stream append does not recreate the particle container');await chat('finish',0);await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
  for(let i=0;i<16;i++)await chat('switchTo',i%2?'a':'b');await settle(350);check(await page.locator('.chat-room .vg-chat-atmosphere-edge canvas').count()===1,'rapid role switches leave one active canvas');const pool=await api('particleContainers');check(pool.length===1&&pool.every(c=>!c.destroyed),'rapid role switches leave one live engine container, with no detached-container leak',pool);
  await api('account','particle-isolation-user');await api('ensure');await settle(350);check(!(await api('rows')).roleRow&&(await api('rows')).global.config.themeId==='cool','new account receives isolated default appearance');check(await page.locator('.chat-room .vg-chat-atmosphere-edge canvas').count()<=1,'account switch does not retain an old canvas');await api('account','stream-test-user');await api('ensure');await settle(350);
  await api('enabled',false);await settle(150);check(await page.locator('.chat-room .vg-chat-atmosphere-edge canvas').count()===0,'background disable releases the canvas');check((await api('particleContainers')).length===0,'background disable releases the engine container as well');check((await api('rows')).roleRow.config.themeId==='mysterious','background disable retains saved appearance');await api('enabled',true);await waitEngine();
  await ready(70);await api('save',{mode:'atmosphere',themeId:'mysterious',effect:'dust',strength:'vivid'});await waitEngine();const commits=await page.evaluate(async()=>{const n=document.querySelector('.chat-thread'),rows=[...n.querySelectorAll('[data-message-id]')],id=rows[Math.floor(rows.length/2)].dataset.messageId,before=bubbleRenders[id],top=n.scrollTop;for(let i=0;i<25;i++){n.scrollTop=top-30+Math.sin(i/4)*5;await new Promise(requestAnimationFrame);}return bubbleRenders[id]-before;});check(commits===0,'particle and scroll frames do not rerender retained historical bubbles',commits);
  }
  if(!skipPerformance){
  await ready(70);
  const cdp=await context.newCDPSession(page);
  for(const behavior of ['idle','scroll'])for(const effect of ['baseline','glow','vividDust']){await api('save',{mode:effect==='baseline'?'clean':'atmosphere',themeId:'mysterious',effect:effect==='vividDust'?'dust':'glow',strength:effect==='vividDust'?'vivid':'gentle'});await page.evaluate(()=>document.activeElement?.blur());await settle(350);const before=await inspect(),sample=await traceFrames(cdp,`${behavior}-${effect}`,behavior==='scroll'),after=await inspect();report.performance.push({behavior,effect,before,after,...sample});}
  for(const behavior of ['idle','scroll']){const values=report.performance.filter(v=>v.behavior===behavior),baseline=values[0];check(values.slice(1).every(v=>v.p95<=baseline.p95*1.1+2),`${behavior}: P95 remains within same-condition +10% and 2ms timing tolerance`,values.map(({before,after,...rest})=>rest));}
  const active=report.performance.find(v=>v.behavior==='idle'&&v.effect==='vividDust');check(active.before.pixels.hash!==active.after.pixels.hash&&active.after.engine?.frames>active.before.engine?.frames,'idle performance measurement exercised actual moving canvas particles');
  const scrolling=report.performance.find(v=>v.behavior==='scroll'&&v.effect==='vividDust');check(scrolling.after.engine?.status==='paused','scroll performance sample actually paused the decorative renderer',scrolling.after.engine);
  }
  if(!performanceOnly){
  // Compatibility is exercised rather than inferred from desktop feature support.
  const fallbackContext=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true});await fallbackContext.addInitScript(()=>Object.defineProperty(HTMLCanvasElement.prototype,'transferControlToOffscreen',{value:undefined,configurable:true}));const fallback=await fallbackContext.newPage(),fallbackErrors=[];fallback.on('pageerror',e=>fallbackErrors.push(e.message));await fallback.goto(origin);await fallback.waitForFunction(()=>window.backgroundTest);await fallback.evaluate(()=>backgroundTest.setup());await fallback.getByRole('textbox',{name:'消息内容'}).waitFor();await fallback.evaluate(()=>backgroundTest.save({mode:'atmosphere',themeId:'steady',effect:'dust',strength:'vivid'}));await fallback.waitForTimeout(400);check(await fallback.locator('.chat-room .vg-chat-atmosphere-edge canvas').count()===0&&fallbackErrors.length===0,'missing OffscreenCanvas falls back without a canvas or uncaught error',fallbackErrors);await fallback.evaluate(()=>chatStreamTest.submit('兼容环境也可以正常聊天。'));await fallback.waitForFunction(()=>chatStreamTest.requests().length===1);await fallback.evaluate(()=>{chatStreamTest.push(0,'我在。');chatStreamTest.finish(0);});await fallback.getByText('我在。',{exact:true}).waitFor();check(true,'fallback renderer does not block sending and reading a real component reply');const fallbackShot=`${out}/unsupported-offscreen-fallback-320.png`;await fallback.screenshot({path:fallbackShot});report.screenshots.push(fallbackShot);await fallbackContext.close();await page.bringToFront();await settle(200);
  check(await chat('extraNetwork')===0&&report.network.length===0,'no external effects, model or microphone requests',report.network);check(report.errors.length===0,'no uncaught component errors',report.errors);
  if(!process.env.VG_IMMERSIVE_SKIP_VIDEO){const clipContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,recordVideo:{dir:out,size:{width:390,height:844}}}),clip=await clipContext.newPage();await clip.goto(origin);await clip.waitForFunction(()=>window.backgroundTest);await clip.evaluate(()=>atmosphereTest.demo());await clip.getByRole('textbox',{name:'消息内容'}).waitFor();for(const id of ['cool','warm','lively','calm','steady','mysterious']){await clip.evaluate(id=>backgroundTest.save({themeId:id,mode:'atmosphere',effect:'dust',strength:'vivid'}),id);await clip.waitForTimeout(2400);}await clip.evaluate(()=>chatStreamTest.submit('今晚的光很安静。'));await clip.waitForFunction(()=>chatStreamTest.requests().length===1);await clip.waitForTimeout(700);await clip.evaluate(()=>chatStreamTest.push(0,'我在这里，慢慢说。'));await clip.locator('[data-streaming-reply]').waitFor();await clip.waitForTimeout(500);await clip.evaluate(()=>chatStreamTest.finish(0));await clip.waitForTimeout(800);await clipContext.close();report.video=await clip.video().path();}
  }
  if(performanceOnly){check(await chat('extraNetwork')===0&&report.network.length===0,'performance origin makes no external requests',report.network);check(report.errors.length===0,'performance run has no uncaught component errors',report.errors);}
  report.status='pass';
}catch(error){report.status='failed';report.failure=error.stack??error.message;process.exitCode=1;const path=`${out}/failure-${runId}.png`;try{await page.screenshot({path});report.screenshots.push(path);}catch{/* Preserve the original failure if the page itself crashed. */}console.error(error);}
finally{const data=JSON.stringify(report,null,2);writeFileSync(`${out}/result.json`,data);writeFileSync(`${out}/result-${phase}.json`,data);if(report.status==='failed')writeFileSync(`${out}/result-failed-${runId}.json`,data);await browser.close();server.close();}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,performance:report.performance.map(({before,after,...s})=>s),video:report.video}));
