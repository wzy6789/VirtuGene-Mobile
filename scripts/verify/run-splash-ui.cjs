const { createRequire } = require('node:module');
const path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const { build } = require('esbuild');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const fixture = `
import React,{useState,useCallback,Profiler,StrictMode} from 'react';import {createRoot} from 'react-dom/client';
import {SplashScreen} from './src/components/splash/SplashScreen';
let commits=0,completions=0;
function Fixture(){const[ready,setReady]=useState(false),[gone,setGone]=useState(false),[mounted,setMounted]=useState(true);
const complete=useCallback(()=>{completions++;setGone(true);},[]);
window.splashUi={ready:()=>setReady(true),commits:()=>commits,completions:()=>completions,unmount:()=>setMounted(false),quiet:value=>{document.documentElement.dataset.vgReducedMotion=String(value);window.dispatchEvent(new Event('vg:motion-preference'));},background:value=>document.documentElement.toggleAttribute('data-vg-background',value)};
return <><main id="destination" inert={!gone} aria-hidden={!gone||undefined} style={{height:'100%',display:'grid',placeItems:'center',background:'#111522'}}><button style={{color:'white'}}>进入数字世界</button></main>{mounted&&!gone&&<Profiler id="splash" onRender={()=>commits++}><SplashScreen ready={ready} onComplete={complete}/></Profiler>}</>;}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
`;
const appFixture = `
import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import {ipc} from './src/lib/ipc-client';import {useAuthStore} from './src/store/auth-store';
import {installThemePreferences} from './src/lib/theme';
installThemePreferences();
ipc.app.getVersion=async()=>undefined;
window.bootLogin=()=>useAuthStore.getState().login('launch-fixture','启动体验',null,'');
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
`;
(async()=>{
  const options={bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"DEV":true}',__APP_VERSION__:'"test"'}};
  const [bundle,appBundle]=await Promise.all([
    build({...options,stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'}}),
    build({...options,stdin:{contents:appFixture,resolveDir:process.cwd(),loader:'tsx'},plugins:[{name:'deferred-seed-init',setup(build){build.onLoad({filter:/[\\/]seed-init\.ts$/},()=>({contents:'export const initSeedCharacters=()=>new Promise(resolve=>{window.bootReady=resolve;});',loader:'ts'}));}}]})
  ]);
  const assets=path.resolve('dist/renderer/assets'),css=fs.readdirSync(assets).filter(name=>name.endsWith('.css'));
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(req.url==='/fixture.js'||req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end((req.url==='/app.js'?appBundle:bundle).outputFiles[0].contents);}
    else if(req.url.startsWith('/assets/')){try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(fs.readFileSync(path.join(assets,path.basename(req.url))));}catch{res.writeHead(404);res.end();}}
    else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${css.map(name=>`<link rel="stylesheet" href="/assets/${name}">`).join('')}<style>html,body,#root{height:100%;margin:0;background:#0f0f1a}</style></head><body><div id="root"></div><script src="${pathname==='/app'?'/app.js':'/fixture.js'}"></script></body></html>`);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const output=path.resolve('.tmp-preview/splash-ui-20261003');fs.mkdirSync(output,{recursive:true});
  let checks=0;const check=(ok,label)=>{if(!ok)throw new Error(label);console.log('PASS '+label);checks++;};
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const base=`http://127.0.0.1:${server.address().port}`;
    await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const api=(name,...args)=>page.evaluate(({name,args})=>window.splashUi[name](...args),{name,args});
    const load=async()=>{await page.goto(base);await page.waitForFunction(()=>!!window.splashUi);await page.evaluate(()=>document.fonts.ready);};
    await load();await page.waitForTimeout(720);
    const splash=page.locator('.vg-splash');
    check(await splash.evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(12, 16, 32)','signature uses the dark theme canvas');
    check(await page.getByRole('heading',{name:'VIRTUGENE'}).count()===1,'brand is the primary readable heading');
    check(await page.getByRole('status',{name:'正在启动 VirtuGene'}).count()===1,'startup has one quiet accessible status');
    check(await splash.evaluate(el=>el.querySelectorAll('*').length<150 && !el.querySelector('canvas,img')),'bounded vector artwork needs no raster assets or canvas loop');
    check(await splash.evaluate(el=>[el,...el.querySelectorAll('*')].every(node=>getComputedStyle(node).filter==='none'&&getComputedStyle(node).backdropFilter==='none')),'no live filter or backdrop blur');
    const commits=await api('commits');await page.waitForTimeout(600);
    check(await api('commits')===commits,'orbital motion makes no frame-by-frame React commits');
    check(await splash.evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').every(a=>a.effect.getKeyframes().every(frame=>Object.keys(frame).every(key=>['offset','computedOffset','easing','composite','transform','opacity'].includes(key))))),'running animation changes only transform and opacity');
    await page.screenshot({path:path.join(output,'mobile-dark.png')});
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    check(await splash.evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(245, 246, 252)','light app preference uses the matching launch canvas');
    await page.screenshot({path:path.join(output,'mobile-light-preference.png')});
    await page.evaluate(()=>document.documentElement.classList.add('dark'));
    for(const [width,height] of [[320,568],[390,844],[430,932],[844,390],[1280,800]]){
      await page.setViewportSize({width,height});await page.waitForTimeout(60);
      const bounds=await page.locator('.vg-boot-stage').boundingBox(),status=await page.locator('.vg-boot-status').boundingBox(),eyebrow=await page.locator('.vg-boot-eyebrow').boundingBox();
      check(bounds.y>eyebrow.y+eyebrow.height && bounds.y+bounds.height<status.y && status.y+status.height<height && await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`signature fits ${width}x${height} without collisions`);
      if(width===1280)await page.screenshot({path:path.join(output,'desktop-dark.png')});
      if(width===844)await page.screenshot({path:path.join(output,'landscape-dark.png')});
    }
    await api('background',true);
    check(await splash.evaluate(el=>el.getAnimations({subtree:true}).every(a=>a.playState!=='running')),'backgrounded launch pauses decorative motion');
    await api('background',false);await page.setViewportSize({width:390,height:844});
    check(await page.locator('#destination').evaluate(el=>el.inert),'covered destination rejects focus and touch');
    await page.evaluate(()=>{window.oldDestination=document.getElementById('destination');});await api('ready');
    await page.waitForFunction(()=>document.querySelector('.vg-splash')?.dataset.phase==='leaving');await page.waitForTimeout(110);
    check(await splash.evaluate(el=>{const opacity=Number(getComputedStyle(el).opacity);return opacity>0&&opacity<1;}),'ready content is revealed by a gradual fade');
    await page.screenshot({path:path.join(output,'handoff-dark.png')});
    await splash.waitFor({state:'detached'});
    check(await page.evaluate(()=>window.oldDestination===document.getElementById('destination')&&!window.oldDestination.inert),'handoff preserves the prepared page and restores input');
    check(await api('completions')===1 && await page.evaluate(()=>document.getAnimations().length)===0,'completion runs once and releases all startup animations');
    await load();await api('ready');await splash.waitFor({state:'detached'});
    check(await api('completions')===1,'fast initialization still completes the short brand reveal');
    await page.emulateMedia({reducedMotion:'reduce'});await load();
    check(await splash.evaluate(el=>el.getAnimations({subtree:true}).length)===0,'system reduced motion shows static artwork');
    await api('ready');await splash.waitFor({state:'detached'});check(await api('completions')===1,'reduced motion exits as soon as content is ready');
    await page.emulateMedia({reducedMotion:'no-preference'});await load();await api('ready');await api('quiet',true);await splash.waitFor({state:'detached'});
    check(await api('completions')===1,'changing app motion preference releases an active launch');
    await load();await api('ready');await api('unmount');await page.waitForTimeout(1100);check(await api('completions')===0,'unmounted signature leaves no completion timer');
    // Real App: delay only seed readiness, preserve auth/theme/rendering code.
    await page.goto(`${base}/app`);await page.waitForFunction(()=>!!window.bootReady);await page.waitForTimeout(750);
    check(await splash.count()===1 && await page.locator('form').count()===0,'real app waits for initialization before mounting its destination');
    await page.evaluate(()=>window.bootReady());await page.locator('form').waitFor({state:'attached'});
    check(await splash.count()===1 && await page.locator('form').evaluate(el=>!!el.closest('[inert]')),'real auth page mounts underneath the departing signature');
    await splash.waitFor({state:'detached'});
    check(await page.locator('form').evaluate(el=>!el.closest('[inert]')),'real auth page becomes interactive without a blank intermediate page');
    await page.evaluate(()=>localStorage.clear());await page.goto(`${base}/app?virtugene-preview=mobile`);await page.waitForFunction(()=>!!window.bootReady);await page.waitForTimeout(750);
    await page.evaluate(()=>{window.bootLogin();window.bootReady();});await page.locator('.mobile-layout').waitFor({state:'attached'});
    check(await splash.count()===1 && await page.locator('.mobile-layout').evaluate(el=>!!el.closest('[inert]')),'logged-in mobile destination prepares below the same signature');
    check(await page.locator('[role="dialog"]').count()===0,'onboarding and update sheets wait until the signature leaves');
    await splash.waitFor({state:'detached'});
    check(await page.locator('.mobile-layout').evaluate(el=>!el.closest('[inert]')),'logged-in startup restores mobile interaction after the fade');
    check(errors.length===0,`no browser errors: ${errors.join('; ')}`);
    console.log(`ALL PASS ${checks}`);fs.writeFileSync(path.join(output,'result.txt'),`PASS ${checks} launch checks\n`);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
