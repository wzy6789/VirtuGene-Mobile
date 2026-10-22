import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const before=process.env.VG_STAGE2_STAGE_BEFORE==='1';
const out=`.tmp-preview/stage2-ui-20261018/S04-A/${before?'before':'checks'}`;mkdirSync(out,{recursive:true});
const server=await starfieldPreview({port:0,output:out+'/server'}),browser=await chromium.launch({channel:'chrome'});
const report={at:new Date().toISOString(),before,checks:[],screenshots:[],errors:[],limitations:['Actual MobileLayout and MobileStagePage on isolated synthetic IndexedDB, not user records or Android.','No model/finish-settlement call is allowed by this fixture.']};
const check=(ok,name,detail)=>{report.checks.push({pass:!!ok,name,detail});assert(ok,name+' '+JSON.stringify(detail??''));};
try{
 for(const theme of ['dark','light'])for(const [width,height,font,state] of [[390,844,100,'mixed-status'],[320,640,200,'long-scenes'],[430,932,100,'mixed-status']]){
  const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.address+`/app?virtugene-preview=mobile&theme=${theme}&state=${state}&view=stage`);await page.locator('.vg-stage-list').waitFor();await page.evaluate(()=>document.fonts.ready);
  if(font!==100)await page.evaluate(f=>document.documentElement.style.setProperty('font-size',f+'%','important'),font);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const label=`${theme}-${width}-font${font}`,data=await page.locator('.vg-stage-room').evaluate(root=>({bg:getComputedStyle(root).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),rows:root.querySelectorAll('.vg-stage-list>li').length,...window.starfieldPreview.snapshot()}));
  check(data.mobileLayout&&data.IS_MOBILE&&!data.native,label+' actual mobile layout');check(!data.overflow,label+' no horizontal overflow');
  if(!before){
   check(data.bg===(theme==='dark'?'rgb(16, 21, 29)':'rgb(244, 242, 237)'),label+' approved material palette');check(await page.locator('.vg-stage-filters').isVisible(),label+' status filters visible');
   if(font===200)check(data.rootFont>=28,label+' actual200% text');
   const more=page.locator('.vg-stage-list>li').first().getByRole('button',{name:/更多操作/});const r=await more.boundingBox();check(r.width>=44&&r.height>=44,label+' more retains44px target',r);
  }
  const file=label+'.png';await page.screenshot({path:out+'/'+file});report.screenshots.push({file,data});
  if(!before&&width===390){
   const filters=page.getByRole('group',{name:'按场景状态筛选'});await filters.getByRole('button',{name:'还没开始',exact:true}).click();check(await page.locator('.vg-stage-list>li').count()===1,theme+' draft filter uses actual loaded status');
   await filters.getByRole('button',{name:'先搁着',exact:true}).click();check(await page.locator('.vg-stage-list>li').count()===2,theme+' paused filter excludes other statuses');
   const row=page.locator('.vg-stage-list>li').last(),id=await row.getAttribute('data-stage-id');await row.scrollIntoViewIfNeeded();const top=await page.locator('.vg-stage-room').evaluate(el=>el.scrollTop);await row.getByRole('button',{name:'回看',exact:true}).click();await page.locator('.vg-stage-active').waitFor();await page.getByRole('button',{name:'返回',exact:true}).click();await page.locator('.vg-stage-list').waitFor();
   check(await filters.getByRole('button',{name:'先搁着',exact:true}).getAttribute('aria-pressed')==='true',theme+' review return keeps status filter');check(Math.abs(await page.locator('.vg-stage-room').evaluate(el=>el.scrollTop)-top)<2,theme+' review return keeps list position');check(await page.locator(`[data-stage-id="${id}"] [data-stage-review]`).evaluate(el=>document.activeElement===el),theme+' review return restores originating control');
   await row.getByRole('button',{name:'回看',exact:true}).click();await page.locator('.vg-stage-active').waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('vg:back-request',{cancelable:true})));await page.locator('.vg-stage-list').waitFor();check(await page.locator(`[data-stage-id="${id}"] [data-stage-review]`).evaluate(el=>document.activeElement===el),theme+' existing app back event restores originating control');
   await row.getByRole('button',{name:/更多操作/}).click();const menu=page.getByRole('dialog',{name:'场景操作',exact:true});await menu.waitFor();check(!await menu.evaluate(el=>el.classList.contains('vg-mobile-page')),theme+' short actions use a centered dialog');await menu.getByRole('button',{name:'删除场景记录',exact:true}).click();const confirm=page.getByRole('dialog',{name:'删除场景记录',exact:true});await confirm.waitFor();await confirm.getByRole('button',{name:'取消',exact:true}).click();check(await page.locator(`[data-stage-id="${id}"]`).count()===1,theme+' delete cancellation preserves actual row');check(await page.locator(`[data-stage-id="${id}"] [data-stage-more]`).evaluate(el=>document.activeElement===el),theme+' confirmation cancellation returns to originating more button');
   await row.getByRole('button',{name:/更多操作/}).click();await menu.getByRole('button',{name:'删除场景记录',exact:true}).click();await confirm.getByRole('button',{name:'确认删除',exact:true}).click();await page.locator(`[data-stage-id="${id}"]`).waitFor({state:'hidden'});check(await page.locator('.vg-stage-list [data-stage-more]').first().evaluate(el=>document.activeElement===el),theme+' confirmed deletion focuses nearest remaining legal row');
   await filters.getByRole('button',{name:'全部',exact:true}).click();await page.getByRole('button',{name:'开启新场景',exact:true}).click();const field=page.getByRole('textbox',{name:'起始地点',exact:true});await field.fill('留在本机的未提交草稿');await page.setViewportSize({width:390,height:520});check(await field.inputValue()==='留在本机的未提交草稿',theme+' creation keeps draft on reduced viewport');await page.getByRole('button',{name:'取消',exact:true}).click();await page.setViewportSize({width:390,height:844});
  }
  check(Object.values((await page.evaluate(()=>window.starfieldPreview.snapshot())).isolation).every(n=>n===0),label+' zero model/media/native attempts');await page.close();
 }
 if(!before){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(8000);await page.goto(server.address+'/app?virtugene-preview=mobile&state=many-more&view=stage');await page.locator('.vg-stage-list>li').nth(49).waitFor();await page.evaluate(()=>window.starfieldPreview.failNext('load'));await page.getByRole('button',{name:'加载更多场景',exact:true}).click();await page.getByRole('alert').filter({hasText:/已显示/}).waitFor();check(await page.locator('.vg-stage-list>li').count()===50,'failed next page preserves50 successful rows');await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.vg-stage-list>li').length===73);check(true,'retry loads all73 actual scenes');await page.evaluate(()=>window.starfieldPreview.revokeWorld());await page.getByRole('heading',{name:'场景读取失败',exact:true}).waitFor();check(await page.locator('.vg-stage-list>li').count()===0,'world revocation still clears every old row');await page.close();
 }
 check(report.errors.length===0,'no runtime errors',report.errors);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{report.source=server.manifest;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.server.close(r));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
