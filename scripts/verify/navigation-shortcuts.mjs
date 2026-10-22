import { chromium } from 'playwright';
import { productPreview } from '../preview-product-upgrade.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out=process.env.VG_NAV_OUTPUT||'.tmp-preview/ui-overhaul-20261016/navigation-shortcuts/before';
mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0});
const browser=await chromium.launch({channel:'chrome'});
const report={checks:[],errors:[],videos:[],limitations:['Desktop Chrome mobile viewport; not Android hardware or system keyboard.','Synthetic records; no real model, microphone or audio.']};
const assert=(value,detail)=>{if(!value)throw Error(JSON.stringify(detail));};
async function check(name,run){try{report.checks.push({name,pass:true,detail:await run()});}catch(e){report.checks.push({name,pass:false,error:e.message});}}
try{
 for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:320,height:740},isMobile:true,hasTouch:true,reducedMotion:'reduce',colorScheme:theme,recordVideo:{dir:out+'/video',size:{width:320,height:740}}});
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(preview.address+'/app?theme='+theme);await page.waitForFunction(()=>window.productUpgradeReady);
  await page.evaluate(()=>window.productUpgradeTest.go('characters'));await page.locator('.vg-gallery-shortcuts').waitFor();
  const trigger=page.getByRole('button',{name:'角色群聊',exact:true});
  await trigger.click();await page.locator('[data-group-page]').waitFor();await page.waitForTimeout(100);
  await check(theme+': group takes keyboard focus',async()=>assert(await page.evaluate(()=>document.querySelector('[data-group-page]')?.contains(document.activeElement)),await page.evaluate(()=>document.activeElement?.outerHTML)));
  await check(theme+': group traps reverse tab inside overlay',async()=>{await page.locator('[data-group-page] button').first().focus();await page.keyboard.press('Shift+Tab');assert(await page.evaluate(()=>document.querySelector('[data-group-page]')?.contains(document.activeElement)),'focus escaped behind group');});
  await check(theme+': nested create Escape keeps group open',async()=>{await page.locator('[data-group-page]').getByRole('button',{name:'发起群聊',exact:true}).first().click();await page.getByRole('dialog',{name:'发起群聊',exact:true}).waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(100);assert(await page.getByRole('dialog',{name:'发起群聊',exact:true}).count()===0,'create stayed open');assert(await page.locator('[data-group-page]').count()===1,'parent closed with child');assert(await page.evaluate(()=>document.querySelector('[data-group-page]')?.contains(document.activeElement)),'focus not restored into group');});
  await check(theme+': nested create browser-back keeps group open',async()=>{await page.locator('[data-group-page]').getByRole('button',{name:'发起群聊',exact:true}).first().click();await page.getByRole('dialog',{name:'发起群聊',exact:true}).waitFor();await page.evaluate(()=>history.back());await page.waitForTimeout(150);assert(await page.getByRole('dialog',{name:'发起群聊',exact:true}).count()===0,'create stayed open');assert(await page.locator('[data-group-page]').count()===1,'parent closed with child');});
  await page.screenshot({path:out+'/'+theme+'-group.png'});
  await check(theme+': Escape returns to gallery trigger',async()=>{await page.keyboard.press('Escape');await page.waitForTimeout(100);assert(await page.locator('[data-group-page]').count()===0,'group remained open');assert(await trigger.evaluate(el=>document.activeElement===el),'trigger not restored');});
  if(await page.locator('[data-group-page]').count())await page.locator('[data-group-page]').getByRole('button',{name:'返回',exact:true}).click();
  await check(theme+': relationship back preserves gallery',async()=>{const button=page.getByRole('button',{name:'关系星图',exact:true});await button.click();await page.getByRole('dialog',{name:'关系星图',exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('vg:back-request',{cancelable:true})));await page.waitForTimeout(100);assert(await page.getByRole('dialog',{name:'关系星图',exact:true}).count()===0,'relationship remained');assert(await button.evaluate(el=>document.activeElement===el),'relationship trigger not restored');});
  await check(theme+': group browser-back closes only overlay',async()=>{await trigger.click();await page.locator('[data-group-page]').waitFor();await page.evaluate(()=>history.back());await page.waitForTimeout(150);assert(await page.locator('[data-group-page]').count()===0,'group remained');assert(await page.locator('.vg-gallery-shortcuts').count()===1,'gallery lost');});
  await check(theme+': assistant shortcut returns to characters',async()=>{await page.getByRole('button',{name:'打开生活助理',exact:true}).click();await page.waitForTimeout(500);const state=await page.evaluate(()=>window.productUpgradeTest.snapshot());assert(state.navigation.activeView==='actionCabin',state.navigation);await page.evaluate(()=>history.back());await page.locator('.vg-gallery-shortcuts').waitFor();assert((await page.evaluate(()=>window.productUpgradeTest.snapshot())).navigation.mobileTab==='characters','wrong return tab');});
  await context.close();
  report.videos.push({theme,path:await page.video().path()});
 }
}catch(error){report.errors.push(error.stack);}finally{report.pass=report.checks.length===16&&report.checks.every(c=>c.pass)&&report.errors.length===0;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();await new Promise(r=>preview.server.close(r));}
if(!report.pass)process.exitCode=1;
