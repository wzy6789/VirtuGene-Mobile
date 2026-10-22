import { productPreview } from '../preview-product-upgrade.mjs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.VG_TIMELINE_RECORD_OUT||'.tmp-preview/ui-overhaul-20261016/timeline-record';mkdirSync(out,{recursive:true});
const server=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});
const result={checks:[],errors:[],screenshots:[],axe:[],scope:'Actual UI and synthetic IndexedDB on ephemeral localhost; no model, microphone or Android.'};
const check=(value,label)=>{assert.ok(value,label);result.checks.push(label);};
try {
 for(const width of [320,390,430])for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message));
  await page.goto(server.address+'/app');await page.evaluate(async theme=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);await productUpgradeTest.seedWorld();await productUpgradeTest.seedWorldEvent();productUpgradeTest.theme(theme);await productUpgradeTest.go('world');productUpgradeTest.snapshot().navigation.setActiveView('timeline');},theme);
  const row=page.locator('.vg-timeline-item').filter({hasText:'这是一条本地模拟世界记录。'});await row.getByRole('button',{name:'查看记录'}).click();
  const dialog=page.getByRole('dialog',{name:'记录详情',exact:true});await dialog.getByText('这是一条本地模拟世界记录。',{exact:true}).waitFor();check(true,`${width}/${theme}: actual record opens in a dialog`);
  await dialog.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  const bounds=await dialog.boundingBox();check(bounds.width<=width&&bounds.x>=0&&bounds.x+bounds.width<=width+1,`${width}/${theme}: dialog fits portrait width`);
  await page.waitForTimeout(360);
  const path=`${out}/detail-${theme}-${width}.png`;await page.screenshot({path});result.screenshots.push(path);
  if(width===390){const axe=await new AxeBuilder({page}).analyze();result.axe.push({theme,violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,`${theme}: no axe violations`);}
  await page.evaluate(()=>productUpgradeTest.editWorldEvent('本地记录已经更改。'));await dialog.getByText('本地记录已经更改。',{exact:true}).waitFor();check(await dialog.getByText('这是一条本地模拟世界记录。',{exact:true}).count()===0,`${width}/${theme}: open detail replaces edited content`);
  await page.evaluate(()=>productUpgradeTest.removeWorldEvent());await dialog.getByText(/这条记录已不可用/).waitFor();check(await page.getByText('本地记录已经更改。',{exact:true}).count()===0,`${width}/${theme}: deletion removes body from both dialog and list`);
  await dialog.getByRole('button',{name:/^(关闭|返回)$/,exact:true}).click();check(await page.locator('.vg-modal-exit').count()===0,`${width}/${theme}: private content has no exit snapshot`);
  const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);check(Object.values(isolation).every(value=>value===0),`${width}/${theme}: external/model/audio isolation remains zero`);await context.close();
 }
 check(result.errors.length===0,'no runtime errors');result.status='pass';
}catch(error){result.status='failed';result.failure=error.stack;throw error;}finally{await browser.close();await new Promise(resolve=>server.server.close(resolve));writeFileSync(`${out}/ui.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:result.checks.length,failure:result.failure}));}
