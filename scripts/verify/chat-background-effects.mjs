import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,basename} from 'node:path';

// Runs the actual ChatWindow and background repository on an isolated origin.
// The imported fixture replaces model transport and rejects microphone access.
const out=process.env.VG_CHAT_BACKGROUND_EFFECTS_EVIDENCE??'.tmp-preview/chat-background-effects-20261015';
mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/chat-background-complete.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'},plugins:[{name:'historical-bubble-commits',setup(b){b.onLoad({filter:/MessageBubble\.tsx$/},async args=>({loader:'tsx',contents:readFileSync(args.path,'utf8').replace(/(function MessageBubble\([^\n]+\{\s*\n)/,'$1 window.bubbleRenders??={};window.bubbleRenders[message.id]=(window.bubbleRenders[message.id]||0)+1;\n')}));b.onLoad({filter:/ChatBackgroundLayer\.tsx$/},async args=>({loader:'tsx',contents:readFileSync(args.path,'utf8').replace('  const ref=useRef<HTMLDivElement>(null),','  window.backgroundRenders=(window.backgroundRenders||0)+1;\n  const ref=useRef<HTMLDivElement>(null),')}));}}]});
const assets='dist/renderer/assets',css=readdirSync(assets).filter(f=>f.endsWith('.css'));
const server=createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}
  else if(req.url.startsWith('/assets/')){try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(readFileSync(join(assets,basename(req.url))));}catch{res.writeHead(404).end();}}
  else{res.setHeader('Content-Type','text/html;charset=utf8');res.end(`<!doctype html><html lang="zh-CN" class="dark"><head><title>聊天背景边缘特效隔离验收</title><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><main id="app" class="mobile-layout"></main><script src="/fixture.js"></script></body></html>`);}
});
await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();
const report={checks:[],errors:[],network:[],screenshots:[],performance:[],motion:[],video:undefined,modelCalls:0,microphoneCalls:0,limitations:['Desktop Chrome with touch emulation, not Android or an installed APK.','No sustained thermal or real-device GPU frame-time test.','Scrolling intentionally pauses decoration; idle measurements separately exercise active effect animations.','RAF/long-task figures are laboratory timing observations, not a guarantee of phone frame rate.']};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',req=>{if(!req.url().startsWith(origin)&&!req.url().startsWith('data:')&&!req.url().startsWith('blob:'))report.network.push(req.url());});
const check=(value,name,detail)=>{report.checks.push({pass:!!value,name,detail});if(!value)throw Error(name);};
const api=(name,...args)=>page.evaluate(({name,args})=>window.backgroundTest[name](...args),{name,args});
const chat=(name,...args)=>page.evaluate(({name,args})=>window.chatStreamTest[name](...args),{name,args});
const settle=()=>page.waitForTimeout(120);
const ready=async(history=3)=>{await api('setup',history);await page.getByRole('textbox',{name:'消息内容'}).waitFor();await settle();};
const shot=async(name)=>{const path=`${out}/${name}.png`;await page.screenshot({path});report.screenshots.push(path);};
const foreground=()=>page.locator('.chat-room').evaluate(room=>{
  const items=[room.querySelector('.chat-header'),room.querySelector('.chat-thread'),room.querySelector('.chat-composer'),room.querySelector('.vg-message-bubble')];
  return items.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y,w:r.width,h:r.height,color:s.color,background:s.backgroundColor,image:s.backgroundImage,font:s.fontSize};});
});
const effects=()=>page.locator('.chat-room .vg-chat-atmosphere-edge').evaluate(layer=>{
  const nodes=[...layer.querySelectorAll('*')];
  const styles=nodes.map(n=>{const s=getComputedStyle(n);return {name:s.animationName,state:s.animationPlayState};});
  for(const pseudo of ['::before','::after']){const s=getComputedStyle(layer,pseudo);styles.push({name:s.animationName,state:s.animationPlayState});}
  return styles;
});
const assertPaused=async(name)=>{await page.waitForTimeout(40);const styles=await effects();check(styles.every(s=>s.name==='none'||s.state==='paused'),name,styles);};
async function traceFrames(cdp,label,scrolling){
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
  const sample=await page.evaluate(async scrolling=>{
    const frames=[],tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});
    const el=document.querySelector('.chat-thread');let previous;
    for(let i=0;i<180;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(previous!==undefined)frames.push(now-previous);previous=now;if(scrolling)el.scrollTop=Math.max(0,el.scrollHeight-el.clientHeight-80+10*Math.sin(i/8));}
    observer.disconnect();frames.sort((a,b)=>a-b);return {p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],over33:frames.filter(t=>t>33.4).length,longTasks:tasks};
  },scrolling);
  const complete=new Promise(yes=>cdp.once('Tracing.tracingComplete',yes));await cdp.send('Tracing.end');const {stream}=await complete;let trace='';
  while(true){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});writeFileSync(`${out}/trace-${label}.json`,trace);
  return sample;
}
try{
  await page.goto(origin);await page.waitForFunction(()=>window.backgroundTest);await ready();
  if(!process.env.VG_EFFECTS_PERFORMANCE_ONLY){
  const themes=(await page.evaluate(()=>backgroundTest.themes)).filter(t=>t.id!=='neutral'),paths=new Set(),shapes=new Set();
  for(const mode of ['dark','light'])for(const width of [320,390,430])for(const theme of themes){
    await page.setViewportSize({width,height:844});await api('theme',mode);await api('save',{mode:'clean',themeId:theme.id,effect:'dust',strength:'gentle'});await settle();const clean=await foreground();
    await api('save',{mode:'atmosphere',themeId:theme.id,effect:'dust',strength:'gentle'});await settle();const enhanced=await foreground();
    check(JSON.stringify(clean)===JSON.stringify(enhanced),`${theme.label}/${mode}/${width}: foreground layout, color and surfaces unchanged`,{clean,enhanced});
    const view=await page.locator('.chat-room').evaluate(room=>{
      const layer=room.querySelector('.vg-chat-atmosphere-edge'),particles=[...layer.querySelectorAll('.vg-chat-background-dust')],rr=room.getBoundingClientRect();
      return {overflow:document.documentElement.scrollWidth>innerWidth,layerInThread:!!room.querySelector('.chat-thread .vg-chat-atmosphere-edge'),particleCount:particles.length,buttons:[...room.querySelectorAll('.chat-header button,.chat-composer button')].map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})),particles:particles.map(n=>{const p=n.parentElement,r=p.getBoundingClientRect(),s=getComputedStyle(p);return {clipped:['hidden','clip'].includes(s.overflowX)&&['hidden','clip'].includes(s.overflowY),left:r.left-rr.left,right:r.right-rr.left,width:r.width,roomWidth:rr.width};}),paths:[...layer.querySelectorAll('.vg-chat-background-arcs path')].map(n=>n.getAttribute('d')),shapes:particles.map(n=>{const s=getComputedStyle(n);return [s.width,s.height,s.borderRadius,s.clipPath,n.getAttribute('data-particle-shape')].join('|');})};
    });
    check(!view.overflow&&!view.layerInThread&&view.buttons.every(b=>b.w>=44&&b.h>=44),`${theme.label}/${mode}/${width}: isolated edge layer, touch targets and no overflow`);
    check(view.particleCount===8&&view.particles.every(p=>p.clipped&&p.width<=p.roomWidth*.12+1&&(p.left<=1||p.right>=p.roomWidth-1)),`${theme.label}/${mode}/${width}: eight gentle particles in clipped edge tracks`,view.particles);
    paths.add(view.paths.join('|'));shapes.add(view.shapes.join('|'));
    if(mode==='dark'&&width===390||mode==='light'&&width===390&&['cool','warm','mysterious'].includes(theme.id))await shot(`theme-${theme.id}-${mode}-${width}`);
  }
  check(paths.size===6,'all six themes have distinct SVG light paths',paths.size);
  check(shapes.size>=4,'particle silhouettes differ across theme families',shapes.size);
  await page.setViewportSize({width:390,height:844});await api('theme','dark');await api('save',{themeId:'mysterious',mode:'atmosphere',effect:'dust',strength:'vivid'});await settle();
  check(await page.locator('.chat-room .vg-chat-background-dust').count()===12,'vivid dust stays within twelve particles');
  await page.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(260);const idleStates=await effects();check(idleStates.filter(s=>s.name!=='none'&&s.state==='running').length>=3,'idle effect channels are active without user input',idleStates);
  const properties=await page.locator('.chat-room .vg-chat-atmosphere-edge').evaluate(layer=>[...new Set(layer.getAnimations({subtree:true}).flatMap(a=>a.effect.getKeyframes().flatMap(k=>Object.keys(k).filter(key=>!['offset','computedOffset','easing','composite'].includes(key)))))].sort());
  check(properties.every(p=>['opacity','transform','translate','rotate','scale'].includes(p)),'active effect keyframes animate only opacity or transform properties',properties);
  await api('save',{effect:'glow'});check(await page.locator('.chat-room .vg-chat-background-dust').count()===0,'glow selection does not quietly add particles');
  await api('save',{effect:'dust',strength:'off'});await settle();check(await page.locator('.chat-room .vg-chat-background-dust').count()===0,'motion off renders no dust');check((await effects()).every(s=>s.name==='none'),'off disables every background animation');
  await api('save',{strength:'vivid'});await api('reduced',true);await settle();check((await effects()).every(s=>s.name==='none'),'app reduced motion disables all edge animation');await api('reduced',false);
  await page.emulateMedia({reducedMotion:'reduce'});check((await effects()).every(s=>s.name==='none'),'system reduced motion disables all edge animation');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('textbox',{name:'消息内容'}).focus();await assertPaused('input focus pauses particles, arcs and glow');await page.evaluate(()=>document.activeElement.blur());await page.waitForTimeout(220);
  await page.locator('.chat-thread').evaluate(n=>n.dispatchEvent(new Event('scroll')));await assertPaused('history scrolling pauses all background channels');await page.waitForTimeout(240);
  for(const attribute of ['hidden','inert']){await page.locator('.chat-room').evaluate((n,key)=>n.setAttribute(key,''),attribute);await assertPaused(`${attribute} room pauses decorative channels`);await page.locator('.chat-room').evaluate((n,key)=>n.removeAttribute(key),attribute);}
  await page.evaluate(()=>document.documentElement.setAttribute('data-vg-background','true'));await assertPaused('background application state pauses decoration');await page.evaluate(()=>document.documentElement.removeAttribute('data-vg-background'));
  await page.getByRole('button',{name:'聊天设置',exact:true}).click();await page.getByRole('dialog',{name:'聊天设置',exact:true}).waitFor();await assertPaused('actual settings modal pauses underlying decoration');
  await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:/聊天外观/}).click();
  const editor=page.getByRole('dialog',{name:'聊天外观',exact:true});await editor.waitFor();await settle();
  await assertPaused('appearance editor keeps covered chat decoration paused');
  const previewStates=await editor.locator('.vg-background-preview .vg-chat-atmosphere-edge').evaluate(layer=>{const nodes=[...layer.querySelectorAll('*')],states=nodes.map(n=>{const s=getComputedStyle(n);return{name:s.animationName,state:s.animationPlayState};});for(const pseudo of ['::before','::after']){const s=getComputedStyle(layer,pseudo);states.push({name:s.animationName,state:s.animationPlayState});}return states;});
  check(previewStates.filter(s=>s.name!=='none'&&s.state==='running').length>=3,'actual appearance preview remains animated inside the modal',previewStates);await shot('editor-live-preview-dark-390');
  await editor.getByText('动态效果',{exact:true}).scrollIntoViewIfNeeded();await shot('editor-effect-options-dark-390');
  await editor.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:'返回',exact:true}).click();await page.waitForTimeout(450);
  await ready();await api('save',{mode:'atmosphere',themeId:'lively',effect:'dust',strength:'vivid'});await chat('submit','我想慢慢聊。');await page.waitForFunction(()=>chatStreamTest.requests().length===1);await page.getByRole('status',{name:'正在回应',exact:true}).waitFor();
  check(await page.locator('[data-streaming-reply]').count()===0,'waiting does not introduce an empty bubble');await assertPaused('waiting gives motion priority to the header orb');
  const layer=await page.locator('.chat-room .vg-chat-atmosphere-edge').elementHandle();
  await chat('push',0,'我在听。');await page.locator('[data-streaming-reply]').waitFor();await assertPaused('streaming gives motion priority to visible content');
  const backgroundRenders=await page.evaluate(()=>window.backgroundRenders);const times=await layer.evaluate(n=>{const animations=n.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation);n.__effectAnimations=animations.map(a=>({animation:a,time:a.currentTime}));return animations.map(a=>({name:a.animationName,time:a.currentTime}));});await chat('push',0,'你慢慢说，我们不着急。');await settle();
  check(await layer.evaluate(n=>n===document.querySelector('.chat-room .vg-chat-atmosphere-edge')),'streamed tokens preserve the same background DOM instance');
  const animationRetention=await layer.evaluate(n=>{const current=n.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation),before=n.__effectAnimations;return {stable:current.length===before.length&&before.every((old,i)=>current[i]===old.animation&&current[i].currentTime===old.time),after:current.map(a=>({name:a.animationName,time:a.currentTime}))};});check(animationRetention.stable,'stream append does not restart background cycle animations',{before:times,...animationRetention});
  check(Number.isFinite(backgroundRenders)&&await page.evaluate(()=>window.backgroundRenders)===backgroundRenders,'stream append causes no background React renders',backgroundRenders);await chat('finish',0);await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
  await ready(70);await api('save',{mode:'atmosphere',effect:'dust',strength:'vivid'});await page.waitForTimeout(350);
  const historicalCommits=await page.evaluate(async()=>{const el=document.querySelector('.chat-thread');el.scrollTop-=80;await new Promise(requestAnimationFrame);const rows=[...el.querySelectorAll('[data-message-id]')],id=rows[Math.floor(rows.length/2)].dataset.messageId,before=bubbleRenders[id],top=el.scrollTop;for(let i=0;i<25;i++){el.scrollTop=top+5*Math.sin(i/4);await new Promise(requestAnimationFrame);}return bubbleRenders[id]-before;});
  check(historicalCommits===0,'decorative scroll frames do not rerender retained historical bubbles',historicalCommits);
  }
  await ready(70);const cdp=await context.newCDPSession(page);
  for(const behavior of ['scroll','idle'])for(const effect of ['baseline','glow','vividDust']){
    await api('save',{mode:effect==='baseline'?'clean':'atmosphere',effect:effect==='vividDust'?'dust':'glow',strength:effect==='vividDust'?'vivid':'gentle'});await page.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(260);
    const channels=await effects(),activeCSSAnimations=await page.locator('.chat-room .vg-chat-atmosphere-edge').evaluate(n=>n.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation&&a.playState==='running').length),sample=await traceFrames(cdp,`${behavior}-${effect}`,behavior==='scroll');report.performance.push({behavior,effect,activeCSSAnimations,computedRunningStyleChannels:channels.filter(s=>s.name!=='none'&&s.state==='running').length,...sample});
  }
  for(const behavior of ['scroll','idle']){const values=report.performance.filter(s=>s.behavior===behavior),baseline=values[0];check(values.slice(1).every(s=>s.p95<=baseline.p95*1.1),`${behavior} P95 frame intervals within +10% of the same-condition clean baseline`,values);}
  check(report.performance.find(p=>p.behavior==='idle'&&p.effect==='vividDust').activeCSSAnimations>=3,'idle performance sample includes running particle animations');
  check(await chat('extraNetwork')===0&&report.network.length===0,'no external requests or real model transport',report.network);check(report.errors.length===0,'no uncaught component errors',report.errors);
  // A separate, short clip shows theme changes, waiting, first body and continuation.
  if(!process.env.VG_EFFECTS_PERFORMANCE_ONLY){
  const clipContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,recordVideo:{dir:out,size:{width:390,height:844}}}),clip=await clipContext.newPage();await clip.goto(origin);await clip.waitForFunction(()=>window.backgroundTest);await clip.evaluate(()=>atmosphereTest.demo());await clip.getByRole('textbox',{name:'消息内容'}).waitFor();
  for(const id of ['cool','warm','lively','calm','steady','mysterious']){await clip.evaluate(id=>backgroundTest.save({themeId:id,effect:'dust',strength:'vivid'}),id);await clip.waitForTimeout(1800);}
  await clip.evaluate(()=>chatStreamTest.submit('今晚的光很安静。'));await clip.waitForFunction(()=>chatStreamTest.requests().length===1);await clip.waitForTimeout(800);await clip.evaluate(()=>chatStreamTest.push(0,'我在这里，慢慢说。'));await clip.locator('[data-streaming-reply]').waitFor();await clip.waitForTimeout(500);await clip.evaluate(()=>chatStreamTest.push(0,'让聊天停在舒服的节奏里。'));await clip.waitForTimeout(500);await clip.evaluate(()=>chatStreamTest.finish(0));await clip.waitForTimeout(900);await clipContext.close();report.video=await clip.video().path();
  }
  report.status='pass';
}catch(error){report.status='failed';report.failure=error.message;process.exitCode=1;console.error(error);}
finally{writeFileSync(`${out}/result.json`,JSON.stringify(report,null,2));await browser.close();server.close();}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,performance:report.performance,video:report.video}));






