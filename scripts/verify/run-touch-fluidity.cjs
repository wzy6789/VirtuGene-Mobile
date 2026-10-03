const {createRequire}=require('module');
const path=require('path'),fs=require('fs'),http=require('http'),assert=require('assert/strict');
const {build}=require('esbuild');
const {chromium}=createRequire(path.join(path.dirname(process.execPath),'package.json'))('playwright');
const fixture=`
import React,{Profiler,useEffect,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {SwipeActionItem} from './src/components/ui/SwipeActionItem';import {useLatestMessageScroll} from './src/components/ui/useLatestMessageScroll';
import {useSlideOutCancel} from './src/components/ui/useSlideOutCancel';import {PressLightCard} from './src/components/ui/PhysicalInteractions';
let commits=0;window.touchTest={commits:()=>commits};
function App(){useSlideOutCancel();const [clicks,setClicks]=useState(0),[pins,setPins]=useState(0),[cards,setCards]=useState(0),[height,setHeight]=useState(1000),[session,setSession]=useState('one'),[following,setFollowing]=useState(true);
const scrollRef=useRef(null),latest=useLatestMessageScroll(scrollRef,session,setFollowing);useEffect(()=>latest(),[height,session,latest]);
Object.assign(window.touchTest,{grow:()=>setHeight(v=>v+120),auto:()=>latest(),force:()=>latest(true),session:()=>setSession(v=>v==='one'?'two':'one'),resizeChild:()=>{document.querySelector('#history-body').style.height='1600px';}});
return <main className="mobile-layout" style={{padding:16,height:'100dvh',overflow:'auto'}}><h2 style={{margin:'8px 0 20px'}}>星域触控</h2>
<Profiler id="rows" onRender={()=>commits++}><div style={{display:'grid',gap:12}}>{['知微','阿澜'].map(name=><SwipeActionItem key={name} itemId={name} onClick={()=>setClicks(v=>v+1)} actions={[{label:'置顶',color:'bg-gene-purple',onClick:()=>setPins(v=>v+1)},{label:'删除',color:'bg-red-500',onClick:()=>setPins(v=>v+10)}]} contentClassName="vg-conversation-shell"><button id={name==='知微'?'row-0':'row-1'} className="vg-conversation-row" style={{height:80,width:'100%',padding:16,textAlign:'left'}}>🌌 {name}<small style={{display:'block',marginTop:6}}>慢慢聊，也能随时接续。</small></button></SwipeActionItem>)}</div></Profiler>
<output id="clicks">{clicks}</output><output id="pins">{pins}</output><PressLightCard id="card" style={{display:'block',height:64,width:'100%',margin:'14px 0'}} onClick={()=>setCards(v=>v+1)}>星域卡片</PressLightCard><output id="cards">{cards}</output>
<div ref={scrollRef} id="history" tabIndex={0} style={{height:150,overflow:'auto',overflowAnchor:'none',border:'1px solid #2b3650',borderRadius:16}}><div id="history-body" style={{height,padding:16}}>正在查看真实滚动区域</div></div>
<button id="latest" onClick={()=>latest(true)} style={{height:48,marginTop:12}}>回到最新</button><output id="following">{String(following)}</output></main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
(async()=>{
 const output=path.resolve('.tmp-preview/touch-fluidity-20261002');fs.mkdirSync(output,{recursive:true});
 const result=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'import.meta.env':'{"DEV":true}',__APP_VERSION__:'"verify"'},logLevel:'warning'});
 const assets=path.resolve('dist/renderer/assets'),css=fs.readdirSync(assets).find(n=>n.endsWith('.css'));
 const server=http.createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(result.outputFiles[0].contents);}
  else if(req.url==='/styles.css'){res.setHeader('content-type','text/css');res.end(fs.readFileSync(path.join(assets,css)));}
  else if(/^\/[\w.-]+\.woff2$/.test(req.url)){res.setHeader('content-type','font/woff2');res.end(fs.readFileSync(path.join(assets,req.url.slice(1))));}
  else if(req.url==='/favicon.ico'){res.statusCode=204;res.end();}
  else{res.setHeader('content-type','text/html');res.end('<!doctype html><html class="dark" lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;
 const check=(v,label)=>{assert.ok(v,label);checks++;console.log('PASS '+label);};
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#row-0').waitFor();await page.waitForTimeout(400);
  const row=page.locator('#row-0'),surface=row.locator('..'),item=surface.locator('..');
  const xOf=()=>surface.evaluate(el=>getComputedStyle(el).transform==='none'?0:new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  const start=async()=>{const b=await row.boundingBox();await page.mouse.move(b.x+b.width*.8,b.y+40);await page.mouse.down();return{x:b.x+b.width*.8,y:b.y+40};};
  const wait=()=>page.waitForTimeout(300);const before=await page.evaluate(()=>touchTest.commits());let p=await start();
  await page.mouse.move(p.x-85,p.y+6,{steps:12});await page.waitForTimeout(40);
  check(Math.abs((await xOf())+85)<2,'row follows the actual pointer without animation lag');
  check(await page.evaluate(()=>touchTest.commits())===before,'drag frames do not rerender the React list');
  check(await item.getAttribute('data-swipe-landing')==='open','release landing is previewed before lifting');
  await page.mouse.up();await wait();check(Math.abs((await xOf())+128)<1,'release reveals the existing actions');check(await page.locator('#clicks').textContent()==='0','swiping never opens a chat');
  await item.getByRole('button',{name:'置顶',exact:true}).click();await wait();check(await page.locator('#pins').textContent()==='1'&&Math.abs(await xOf())<1,'a deliberate action fires once and retracts the row');
  p=await start();await page.mouse.move(p.x-38,p.y,{steps:2});await page.mouse.up();await wait();check(Math.abs((await xOf())+128)<1,'a short quick flick uses release velocity');
  await row.click();await wait();check(Math.abs(await xOf())<1&&await page.locator('#clicks').textContent()==='0','tapping an expanded row only closes it');
  p=await start();await page.mouse.move(p.x-42,p.y,{steps:3});await page.waitForTimeout(130);await page.mouse.up();await page.waitForTimeout(45);
  const moving=await xOf();p=await start();check(Math.abs((await xOf())-moving)<6,'grabbing a rebound preserves its current pose');
  await page.mouse.move(p.x-90,p.y,{steps:5});await page.mouse.up();await wait();
  await page.locator('#row-1').focus();await page.keyboard.press('ArrowLeft');await wait();check(Math.abs(await xOf())<1,'opening another row closes its predecessor');await page.keyboard.press('Escape');await wait();
  await row.focus();await page.keyboard.press('ArrowLeft');await wait();check(await item.getByRole('button',{name:'删除',exact:true}).getAttribute('tabindex')==='0','keyboard users can reach revealed actions');
  await page.keyboard.press('Escape');await wait();check(await item.locator('.vg-swipe-actions').evaluate(el=>el.inert),'closed actions leave the interaction tree');
  p=await start();await page.mouse.move(p.x-220,p.y,{steps:5});await page.waitForTimeout(25);check((await xOf())<-128&&(await xOf())>-146,'overswiping meets bounded resistance');
  await surface.evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1})));await page.mouse.up();await wait();check(Math.abs(await xOf())<1,'pointer cancellation restores the committed position');
  p=await start();await page.mouse.move(p.x+5,p.y+60,{steps:5});await page.mouse.up();await wait();check(Math.abs(await xOf())<1,'vertical intent never reveals actions');await row.click();check(await page.locator('#clicks').textContent()==='1','a normal tap remains usable');
  await page.emulateMedia({reducedMotion:'reduce'});await row.focus();await page.keyboard.press('ArrowLeft');check(await surface.evaluate(el=>el.getAnimations().length===0),'quiet mode retains actions without motion');await page.keyboard.press('Escape');
  const card=page.locator('#card'),cb=await card.boundingBox();await page.mouse.move(cb.x+60,cb.y+20);await page.mouse.down();await page.mouse.move(cb.x+85,cb.y+20);await page.mouse.up();const cardBefore=await page.locator('#cards').textContent();await card.click();check(Number(await page.locator('#cards').textContent())===Number(cardBefore)+1,'quiet-mode card tap is not blocked by an old press');await page.emulateMedia({reducedMotion:'no-preference'});
  const history=page.locator('#history'),bottom=()=>history.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<2);
  await page.evaluate(()=>touchTest.force());await page.waitForTimeout(400);check(await bottom(),'explicit latest request reaches the bottom');
  await history.evaluate(el=>{el.scrollTop=120;el.dispatchEvent(new Event('scroll'));});await page.evaluate(()=>touchTest.grow());await page.waitForTimeout(400);check(await history.evaluate(el=>el.scrollTop)===120,'new content respects history reading');
  await page.evaluate(()=>{touchTest.auto();window.visualViewport?.dispatchEvent(new Event('resize'));});await page.waitForTimeout(400);check(await history.evaluate(el=>el.scrollTop)===120,'automatic and viewport requests preserve reading position');
  await page.locator('#latest').click();await page.waitForTimeout(400);check(await bottom(),'return-to-latest resumes following');
  await page.evaluate(()=>touchTest.resizeChild());await page.waitForTimeout(80);check(await bottom(),'late content measurements follow without jumping');
  await page.evaluate(()=>touchTest.force());const hb=await history.boundingBox();await page.mouse.move(hb.x+80,hb.y+50);await page.mouse.down();await history.evaluate(el=>{el.scrollTop=140;el.dispatchEvent(new Event('scroll'));});await page.mouse.up();await page.waitForTimeout(400);check(await history.evaluate(el=>el.scrollTop)===140,'taking over cancels delayed bottom adjustments');
  await page.evaluate(()=>touchTest.session());await page.waitForTimeout(400);check(await bottom(),'a newly opened session starts at latest');
  const cdp=await page.context().newCDPSession(page),b=await row.boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.round(b.x+270),y:Math.round(b.y+40)}]});
  for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(b.x+270-i*20),y:Math.round(b.y+40)}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait();
  check(Math.abs((await xOf())+128)<1,'real touchscreen input reveals row actions');await cdp.detach();await page.screenshot({path:path.join(output,'swipe-dark.png')});
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'controls fit '+width+'px');}
  check(await surface.evaluate(el=>el.style.willChange)==='','completed motion releases compositing hints');check(errors.length===0,'no browser exceptions: '+errors.join('\n'));fs.writeFileSync(path.join(output,'result.txt'),'PASS '+checks+' touch fluidity checks\n');console.log('ALL PASS '+checks);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
