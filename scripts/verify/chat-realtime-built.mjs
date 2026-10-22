/** Production chunks, rather than the bundled verification fixture's runtime, are exercised here. */
import {chromium} from 'playwright';import{readdirSync,mkdirSync,writeFileSync}from'node:fs';
const out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-realtime-20261019/built',origin=process.env.VG_SCENE_ORIGIN??'http://127.0.0.1:5322';mkdirSync(out,{recursive:true});
const sceneId=process.env.VG_SCENE_BUILT_ID??'snow-study';
const file=readdirSync('dist/renderer/assets').find(f=>/^realtime-renderer-.*\.js$/.test(f));if(!file)throw Error('Missing production renderer chunk');
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),page=await context.newPage();
const report={checks:[],requests:[],errors:[],scope:'Actual production-built backend and GLTFLoader imported as separate HTTP modules, using the isolated component fixture only to supply a catalog and poster. No real model/microphone/native.'};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});if(!pass)throw Error(name);};page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>report.requests.push(r.url()));
try{
 await page.goto(origin);await page.waitForFunction(()=>window.sceneTest);await page.evaluate(()=>window.backgroundTest.setup(0));check(!report.requests.some(r=>/realtime-renderer-|GLTFLoader-|\.glb$/.test(r)),'production graphics chunks and GLB are absent before scene activation');
 const result=await page.evaluate(async ({file,sceneId})=>{
  const scene=window.sceneTest.scenes.find(s=>s.id===sceneId),variant=scene.poster.find(p=>p.width===1080)??scene.poster.at(-1),image=new Image();image.src=variant.src;await image.decode();
  // Vite shares helpers with the application entry. Normal production HTML supplies
  // its mount target; the isolated component fixture uses #app and must supply #root too.
  const appRoot=document.createElement('div');appRoot.id='root';appRoot.hidden=true;document.body.append(appRoot);
  const host=document.createElement('div');Object.assign(host.style,{position:'fixed',inset:0,width:'390px',height:'844px',pointerEvents:'none'});document.body.append(host);const before=performance.now(),module=await import('/assets/'+file),mount=Object.values(module).find(value=>typeof value==='function'),controller=new AbortController();let failure='';
  const instance=await (Object.values(module).find(value=>value&&typeof value==='object'&&typeof value.mountRealtimeScene==='function').mountRealtimeScene)(host,scene,{url:image.src,width:image.width,height:image.height,source:image,release(){}},{width:390,height:844,dpr:2},'balanced',controller.signal,reason=>failure=reason);instance.apply({mode:'idle',reason:'idle',effectFps:24,parallaxEnabled:false});await new Promise(r=>setTimeout(r,700));
  const snapshot=instance.inspect();instance.apply({mode:'paused',reason:'input',effectFps:0,parallaxEnabled:false});const frames=instance.inspect().frames;await new Promise(r=>setTimeout(r,160));const paused=frames===instance.inspect().frames;controller.abort();instance.dispose();const canvases=host.querySelectorAll('canvas').length;host.remove();return{snapshot,paused,canvases,failure,initializationAndObservationMs:performance.now()-before};
 },{file,sceneId});
 check(result.snapshot.backend==='webgl2'&&result.snapshot.frames>5&&result.snapshot.triangles>(sceneId==='snow-study'?30000:1000),'production GLB, shaders and split loader actually render',{sceneId,...result});check(result.paused&&result.canvases===0&&!result.failure,'production pause and abort remove the actual canvas',result);
 check(report.requests.some(r=>r.includes('GLTFLoader-'))&&report.requests.some(r=>r.endsWith('.glb')),'split production loader and local immutable model are fetched lazily',report.requests.filter(r=>/realtime-renderer-|GLTFLoader-|\.glb$/.test(r)));check(report.errors.length===0,'no production module errors',report.errors);report.status='pass';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;console.error(error);}finally{await context.close();await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
