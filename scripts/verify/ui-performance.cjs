const { createRequire } = require('node:module');
const path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const { build } = require('esbuild');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const record = process.argv.includes('--record-baseline');
const fixture = `
import React,{useRef,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {NotificationCloud} from './src/components/chat/NotificationCloud';
import {StreamingReply} from './src/components/chat/StreamingReply';
import {ChatReplyStream} from './src/lib/chat-stream';
import {useLatestMessageScroll} from './src/components/ui/useLatestMessageScroll';
import {useNotificationStore} from './src/store/notification-store';
import {useAuthStore} from './src/store/auth-store';
useAuthStore.setState({userId:'performance-fixture'});
const stream=new ChatReplyStream('performance-fixture',()=>{});
window.perfUi={renders:{},stream,push:()=>useNotificationStore.getState().push({characterId:'test',characterName:'星遥',avatar:'🌙',preview:'这是一条连续到达的消息。'}),clear:()=>useNotificationStore.getState().clear()};
function Probe(){const ref=useRef(null);const latest=useLatestMessageScroll(ref,'performance');
useEffect(()=>{window.perfUi.latest=latest;},[latest]);
return <div ref={ref} id="scroll-probe" style={{height:160,overflow:'auto'}}><div id="probe-content" data-streaming-reply style={{height:1000}}>滚动测量</div></div>;}
createRoot(document.getElementById('root')).render(<div className="mobile-layout"><NotificationCloud/><StreamingReply stream={stream} avatar="🌙"/><Probe/></div>);
`;
(async () => {
  // Instrument component execution in the verification bundle, never in shipping code.
  const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': '{"DEV":false}', 'process.env.NODE_ENV': '"production"', __APP_VERSION__: '"verify"' }, plugins: [{ name: 'render-counters', setup(build) {
    build.onLoad({filter: /(?:NotificationCloud|MessageBubble)\.tsx$/}, async args => {
      let contents = fs.readFileSync(args.path, 'utf8');
      contents = contents.replace(/(function MessageNotification\([^\n]+\{\s*\n)/, '$1  window.perfUi.renders[item.id] = (window.perfUi.renders[item.id] || 0) + 1;\n');
      contents = contents.replace(/(function MessageBubble\([^\n]+\{\s*\n)/, '$1  window.perfUi.renders[message.id] = (window.perfUi.renders[message.id] || 0) + 1;\n');
      return {contents, loader:'tsx'};
    });
  } }] });
  const assets = path.resolve('dist/renderer/assets'), css = fs.readdirSync(assets).filter(name => name.endsWith('.css'));
  const server = http.createServer((req,res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents); }
    else if (req.url.startsWith('/assets/')) { try {res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(fs.readFileSync(path.join(assets,path.basename(req.url))));}catch{res.writeHead(404);res.end();} }
    else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(name=>`<link rel="stylesheet" href="/assets/${name}">`).join('')}</head><body><div id="root"></div><script src="/app.js"></script></body></html>`);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const output=path.resolve('.tmp-preview/ui-performance');fs.mkdirSync(output,{recursive:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.measurements={scrollReads:0,scrollWrites:0,slotPhases:[],observations:0};
      for(const name of ['scrollHeight','clientHeight','scrollTop']) {
        const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,name);
        Object.defineProperty(Element.prototype,name,{...descriptor,get(){if(this.id==='scroll-probe')window.measurements.scrollReads++;return descriptor.get.call(this);},...(descriptor.set?{set(value){if(this.id==='scroll-probe')window.measurements.scrollWrites++;descriptor.set.call(this,value);}}:{})});
      }
      const observe=ResizeObserver.prototype.observe;
      ResizeObserver.prototype.observe=function(node,...args){if(node.id==='scroll-probe'||node.id==='probe-content')window.measurements.observations++;return observe.call(this,node,...args);};
      const rect=Element.prototype.getBoundingClientRect,animate=Element.prototype.animate;
      Element.prototype.getBoundingClientRect=function(){if(this.hasAttribute('data-notification-slot'))window.measurements.slotPhases.push('read');return rect.call(this);};
      Element.prototype.animate=function(...args){if(this.hasAttribute('data-notification-slot'))window.measurements.slotPhases.push('write');return animate.apply(this,args);};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.perfUi?.latest);await page.evaluate(()=>document.fonts.ready);
    const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    await page.evaluate(()=>{window.perfUi.push();window.perfUi.push();window.perfUi.push();});await page.waitForTimeout(400);
    const before=await metrics();
    const retained=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[data-notification-id]')].map(x=>x.dataset.notificationId);return {id:ids[1],renders:window.perfUi.renders[ids[1]]};});
    await page.evaluate(()=>{window.measurements.slotPhases=[];window.perfUi.push();});await page.waitForTimeout(60);
    const unchangedNotificationRenders=await page.evaluate(({id,renders})=>window.perfUi.renders[id]-renders,retained);
    const slotPhases=await page.evaluate(()=>window.measurements.slotPhases);
    // One arrival per frame exercises stack replacement while prior motion is active.
    await page.evaluate(async()=>{for(let i=0;i<60;i++){window.perfUi.push();await new Promise(requestAnimationFrame);}});await page.waitForTimeout(400);
    const after=await metrics();
    await page.evaluate(()=>{window.perfUi.clear();window.perfUi.stream.finish('第一段已经生成完毕。---第二段');});await page.waitForTimeout(100);
    const first=await page.evaluate(()=>({id:window.perfUi.stream.ids[0],renders:window.perfUi.renders[window.perfUi.stream.ids[0]]}));
    await page.evaluate(async()=>{for(let i=0;i<60;i++){window.perfUi.stream.finish(window.perfUi.stream.raw+'文字');await new Promise(requestAnimationFrame);}});
    const completedBubbleRenders=await page.evaluate(({id,renders})=>window.perfUi.renders[id]-renders,first);
    await page.waitForTimeout(500);
    await page.evaluate(()=>{window.measurements.scrollWrites=0;window.measurements.scrollReads=0;document.getElementById('probe-content').style.height='1024px';});await page.waitForTimeout(300);
    const resize=await page.evaluate(()=>({...window.measurements,gap:document.getElementById('scroll-probe').scrollHeight-document.getElementById('scroll-probe').clientHeight-document.getElementById('scroll-probe').scrollTop}));
    await page.evaluate(()=>{window.measurements.scrollWrites=0;const node=document.createElement('div');node.id='new-layout-node';document.getElementById('scroll-probe').appendChild(node);});await page.waitForTimeout(250);
    const idleWrites=await page.evaluate(()=>window.measurements.scrollWrites);
    const observations=await page.evaluate(()=>window.measurements.observations);
    const report={unchangedNotificationRenders,completedBubbleRenders,slotPhases,resizeReads:resize.scrollReads,resizeWrites:resize.scrollWrites,resizeGap:resize.gap,idleWrites,observations,notificationStress:{layoutCount:after.LayoutCount-before.LayoutCount,recalcStyleCount:after.RecalcStyleCount-before.RecalcStyleCount,layoutMs:1000*(after.LayoutDuration-before.LayoutDuration),scriptMs:1000*(after.ScriptDuration-before.ScriptDuration)},remainingAnimations:await page.evaluate(()=>document.getAnimations().length),errors};
    fs.writeFileSync(path.join(output,record?'baseline.json':'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    if(!record){
      const check=(ok,label)=>{if(!ok)throw new Error(label);console.log('PASS '+label);};
      check(unchangedNotificationRenders===0,'a new notification leaves retained cards unrendered');
      check(completedBubbleRenders===0,'60 token updates never rerender the completed bubble');
      check(!slotPhases.slice(slotPhases.indexOf('write')).includes('read'),'all stack positions are read before animation writes');
      check(resize.gap<2 && resize.scrollWrites>0 && resize.scrollWrites<=24,'stream height settles within a bounded number of scroll writes');
      check(idleWrites===0,'unchanged layout never writes the same scroll position');
      check(observations===2,'adding a child does not reobserve existing layout nodes');
      check(report.remainingAnimations===0 && errors.length===0,'stress clears animations and produces no browser errors');
    }
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
