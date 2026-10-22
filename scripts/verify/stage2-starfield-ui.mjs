import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const baseline=process.env.VG_STAGE2_BASELINE==='1';
const out=process.env.VG_STAGE2_OUTPUT??`.tmp-preview/stage2-ui-20261018/${baseline?'S01/baseline':'S03-A/checks'}`;
mkdirSync(out,{recursive:true});
const preview=await starfieldPreview({port:0,output:out+'/server',materialTransport:baseline?'inline':'http'}),browser=await chromium.launch({channel:'chrome',headless:true});
const report={at:new Date().toISOString(),baseline,checks:[],screenshots:[],errors:[],limits:['Actual MobileLayout with isolated synthetic IndexedDB and guarded model/media/native boundaries, not the signed-in sidebar.','Browser font/viewport/keyboard/safe area simulation is not Android testing.','V1 user visual approval is separate from automatic checks.']};
const check=(ok,name,details)=>{report.checks.push({name,pass:!!ok,details});assert(ok,name+' '+JSON.stringify(details??''));};
const enter=async(page,state)=>{await page.evaluate(s=>window.starfieldPreview.setState(s),state);await page.getByRole('button',{name:'星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('[data-starfield-map] img')].map(img=>img.decode().catch(()=>{})));});};
try{
 for(const theme of ['dark','light'])for(const [width,height,font] of [[390,844,100],[320,640,100],[360,800,100],[430,932,100],[320,640,200]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(preview.address+`/app?virtugene-preview=mobile&theme=${theme}`);await page.waitForFunction(()=>window.starfieldReady);await page.evaluate(()=>window.starfieldPreview.motion(false));
  await enter(page,font===200?'long-scenes':'six');
  if(font!==100)await page.evaluate(f=>{document.documentElement.style.fontSize=`${f}%`;},font);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const metrics=await page.evaluate(()=>{const box=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {top:r.top,bottom:r.bottom,width:r.width,height:r.height,bg:s.backgroundColor,color:s.color,font:s.fontFamily,columns:s.gridTemplateColumns};};return{...window.starfieldPreview.snapshot(),rootOverflow:document.documentElement.scrollWidth>innerWidth,map:box('[data-starfield-map]'),archive:box('[aria-label="世界档案"]'),markers:[...document.querySelectorAll('[data-scene-marker]')].filter(el=>getComputedStyle(el).display!=='none').map(el=>({id:el.dataset.sceneMarker,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})),directory:box('[data-starfield-directory]'),page:box('.vg-world-page')};});
  const label=`${theme}-${width}-${height}-font${font}`;
  if(font===200)check(await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize)>=28),label+' actual enlarged text, not scaled screenshot');
  check(metrics.IS_MOBILE&&metrics.mobileLayout&&!metrics.native&&!metrics.desktopTitlebar,label+' real mobile identity',metrics.viewport);
  check(!metrics.rootOverflow,label+' no root horizontal overflow');
  check(Object.values(metrics.isolation).every(n=>n===0),label+' no attempted model/media/native calls',metrics.isolation);
  if(!baseline){
   check(metrics.map.height>=140&&metrics.map.height<=220,label+' bounded panorama',metrics.map);
   check(metrics.markers.length===(width<400?3:5)&&metrics.markers.every(b=>b.width>=44&&b.height>=44),label+' stable reachable marker targets',metrics.markers);
   check(metrics.directory&&metrics.directory.height>=56,label+' permanent scene directory',metrics.directory);
   check(metrics.archive.columns.split(' ').length===1,label+' single-column archive index',metrics.archive);
   check(metrics.page.bg===(theme==='dark'?'rgb(16, 21, 29)':'rgb(244, 242, 237)'),label+' scoped light-and-paper palette',metrics.page);
  }
  const file=label+'.png';await page.screenshot({path:out+'/'+file});report.screenshots.push({file,metrics});
  if(!baseline&&width===390){
   const scroll=page.locator('.vg-world-page');await scroll.evaluate(el=>el.scrollTop=0);
   const beforeFocus=page.locator('[data-scene-marker]').first();await beforeFocus.click();await page.locator('[data-scene-detail],.vg-sector-detail').waitFor();await page.getByRole('button',{name:'返回星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();
   check(await beforeFocus.evaluate(el=>el===document.activeElement),theme+' detail back restores scene trigger focus');
   await page.locator('[data-starfield-directory]').click();await page.waitForFunction(()=>window.starfieldPreview.snapshot().navigation.activeView==='stage');check(true,theme+' directory opens actual scene management');
   await page.getByRole('button',{name:'返回星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();
   await page.locator('.vg-starfield-records>summary').click();
   await page.getByRole('group',{name:'场景状态筛选'}).getByRole('button',{name:'进行中',exact:true}).click();
   const activeIds=await page.locator('[data-scene-row]').evaluateAll(nodes=>nodes.map(el=>el.dataset.sceneRow).sort());
   check(JSON.stringify(activeIds)===JSON.stringify(['starfield-fixture:alpha:scene:1','starfield-fixture:alpha:scene:4']),theme+' progressive scene filter preserves real IDs',activeIds);
   await page.locator('.vg-starfield-records>summary').click();
   await page.route('**/assets/orbit-window-*.webp*',route=>route.fulfill({status:404,contentType:'text/plain',body:'Controlled missing art'}));
   const beforeMap=await page.locator('[data-starfield-map]').boundingBox();
   await page.locator('.vg-starfield-art>img').evaluate(img=>{img.src=img.src+'?controlled404=1';});
   await page.locator('[data-starfield-poster-fallback]').waitFor();
   const afterMap=await page.locator('[data-starfield-map]').boundingBox();
   check(beforeMap.height===afterMap.height&&await page.locator('[data-starfield-directory]').count()===1,theme+' actual HTTP404 falls back without layout jump or lost controls');
   await page.unroute('**/assets/orbit-window-*.webp*');
   await page.locator('.vg-world-page').evaluate(el=>el.scrollTop=0);await page.evaluate(()=>window.starfieldPreview.setState('empty'));await page.getByRole('button',{name:'星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();check(await page.locator('[data-scene-marker]').count()===0,theme+' empty has no fake scene nodes');check(await page.locator('[data-starfield-directory]').count()===1,theme+' empty retains scene directory');
   for(const state of ['load-error','loading']){
    await page.evaluate(s=>window.starfieldPreview.setState(s),state);await page.getByRole('button',{name:'星域',exact:true}).click();
    await page.getByRole('button',{name:'返回世界',exact:true}).waitFor();
    if(state==='load-error'){await page.getByText('世界读取失败',{exact:true}).waitFor();check(await page.getByRole('button',{name:'重新读取',exact:true}).isVisible(),theme+' read failure is explicit and retryable');}
    else{await page.getByRole('status',{name:'正在读取星域',exact:true}).waitFor();await page.evaluate(()=>window.starfieldPreview.releaseLoading());await page.getByRole('status',{name:'正在读取星域',exact:true}).waitFor({state:'hidden'});check(true,theme+' loading releases without pretending empty');}
   }
  }
  await context.close();
 }
 check(report.errors.length===0,'no runtime errors',report.errors);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{report.source=preview.manifest;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>preview.server.close(r));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
