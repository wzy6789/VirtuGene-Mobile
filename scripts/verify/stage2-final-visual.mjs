import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {scaleTextFromBaseline} from './text-reflow.mjs';

const out=process.env.VG_FINAL_VISUAL_OUT??'.tmp-preview/stage2-ui-20261018/S11/current-visual';
mkdirSync(out,{recursive:true});
const preview=await starfieldPreview({port:0,output:out+'/server'});
const browser=await chromium.launch({channel:'chrome'});
const report={at:new Date().toISOString(),checks:[],pages:[],errors:[],axe:[],source:JSON.parse(readFileSync(out+'/server/source-hashes.json','utf8')),boundary:'Current production MobileLayout and world components; synthetic isolated database, system reduced motion. No model/media/native. Not the signed-in sidebar or Android.'};
const check=(pass,name,data)=>report.checks.push({pass:!!pass,name,data});
const definitions=[
 ['home','home-sample','home','.vg-world-home-sample .vg-world-assistant'],
 ['starfield','six','starfield','.vg-world-constellation'],
 ['directory','mixed-status','stage','.vg-stage-list'],
 ['scene-detail','six','detail','.vg-sector-title'],
 ['relations','relations-sample','relations','.vg-relations-page'],
 ['memory','memory-sample','memory','.vg-memory-exhibit'],
 ['timeline','timeline-sample','timeline','.vg-timeline-page'],
 ['world-settings','world-settings-sample','worldSettings','.vg-settings-world'],
 ['appearance','one','appearance','.vg-background-editor'],
 ['reader','reader-sample','canvas','.vg-stream'],
].filter(([name])=>!process.env.VG_FINAL_VIEWS||process.env.VG_FINAL_VIEWS.split(',').includes(name));
try {
 for(const theme of ['dark','light'])for(const [name,state,view,selector] of definitions){
  const sizes=[[390,844,1,1]];
  if(['starfield','directory','relations','memory','timeline','reader'].includes(name))sizes.push([320,640,2,1]);
  if(name==='starfield')sizes.push([360,800,1,2],[430,932,1,3],[390,857,1,1]);
  for(const[width,height,font,dpr]of sizes){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,isMobile:true,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);
   const label=`${name}-${theme}-${width}-${height}-font${font*100}-dpr${dpr}`;
   const phase=value=>writeFileSync(out+'/active-case.json',JSON.stringify({label,phase:value,at:new Date().toISOString()}));
   const watchdog=setTimeout(()=>{report.errors.push({label,error:'Case exceeded20s; closing its owned browser context instead of waiting indefinitely.'});void context.close();},20000);
   page.on('pageerror',e=>report.errors.push({label,error:e.message}));
   try{
    const url=`${preview.address}/app?virtugene-preview=mobile&theme=${theme}&state=${state}&view=${view}`;
    phase('navigate');await page.goto(url);await page.waitForFunction(()=>window.starfieldReady||window.starfieldStartupError);await page.locator(selector).waitFor();
    if(name==='memory')await page.locator('[data-exhibit-id]').first().waitFor();
    if(name==='relations')await page.locator('[data-relation-key]').first().waitFor();
    if(name==='timeline')await page.locator('.vg-timeline-item').first().waitFor();
    phase('font-image-decode');await page.evaluate(async()=>{
     await document.fonts.ready;
     // Offscreen lazy portraits deliberately have not started loading. Waiting
     // for their decode would hold a screenshot forever without rendering them.
     const visible=[...document.images].filter(image=>{const r=image.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;});
     await Promise.all(visible.map(image=>image.decode().catch(()=>{})));
    });
    if(font===2){
     // Scope text scaling to the active page, not the permanent tab navigation.
     const root=name==='reader'?'.vg-canvas':name==='scene-detail'?'.vg-world-theater':selector;
     phase('scale-text');await scaleTextFromBaseline(page,root,'.soul-orb,.vg-soul-orb,.sr-only,[aria-hidden="true"]');
    }
    await page.waitForFunction(()=>!document.querySelector('.vg-page-exit'));
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const capture=async(suffix='')=>{
     const snapshot=await page.evaluate(()=>({...starfieldPreview.snapshot(),visualViewport:visualViewport&&{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft},safeTop:getComputedStyle(document.documentElement).getPropertyValue('--vg-safe-top'),loadedFonts:[...document.fonts].filter(f=>f.status==='loaded').length,overflow:document.documentElement.scrollWidth-innerWidth}));
     check(snapshot.mobileLayout&&snapshot.IS_MOBILE&&!snapshot.native,label+suffix+': actual mobile shell',snapshot.viewport);
     check(snapshot.overflow<=1,label+suffix+': no document horizontal overflow',snapshot.overflow);
     check(Object.values(snapshot.isolation).every(n=>n===0),label+suffix+': no attempted model/media/native',snapshot.isolation);
     check(snapshot.loadedFonts>0,label+suffix+': loaded local UI font');
     const path=`${label}${suffix}.png`;await page.screenshot({path:out+'/'+path});report.pages.push({label:label+suffix,file:path,url,width,height,fontScale:font,dpr,at:new Date().toISOString(),snapshot});
    };
    phase('capture');await capture();
    if(width===390&&height===844){
     phase('contrast');const result=await new AxeBuilder({page}).include('.mobile-layout').withRules(['color-contrast']).analyze();report.axe.push({label,violations:result.violations,incomplete:result.incomplete});check(result.violations.length===0,label+': text contrast scan',result.violations);
     if(name==='relations'||name==='memory'){
      await page.locator(name==='relations'?'[data-relation-key]':'[data-exhibit-id]').first().getByRole('button').click();
      const detail=page.getByRole('dialog',{name:name==='relations'?'关系详情':'记录详情',exact:true});await detail.waitFor();await page.evaluate(()=>document.fonts.ready);await capture('-detail');
     }
    }
   }catch(error){report.errors.push({label,error:error.stack});await page.screenshot({path:`${out}/${label}-failure.png`}).catch(()=>{});}
   finally{clearTimeout(watchdog);phase('close-context');await context.close();}
  }
 }
 check(report.errors.length===0,'No runtime or fixture errors',report.errors);
 const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 report.sourceDrift=report.source.inputs.filter(i=>sha(i.path)!==i.sha256);
 check(report.sourceDrift.length===0,'Preview source remained current during capture',report.sourceDrift);
}finally{
 report.pass=report.checks.every(c=>c.pass)&&!report.errors.length;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));
 await browser.close();await new Promise(r=>preview.server.close(r));
}
console.log(JSON.stringify({pass:report.pass,pages:report.pages.length,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass).map(c=>c.name),errors:report.errors}));
if(!report.pass)process.exitCode=1;
