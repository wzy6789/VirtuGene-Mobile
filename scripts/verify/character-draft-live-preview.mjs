import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out='.tmp-preview/ui-overhaul-20261015/character-draft';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];let external=0;
try {
 const context=await browser.newContext({viewport:{width:900,height:940},reducedMotion:'reduce'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external++;return route.abort();});
 await page.goto('http://127.0.0.1:5290/');
 const frame=page.frameLocator('iframe');
 const openCreate=async()=>{await page.waitForFunction(()=>!!document.querySelector('iframe').contentWindow.productUpgradeTest);await page.getByRole('combobox',{name:'预览页面'}).selectOption('create');await frame.getByRole('button',{name:'创造基因',exact:true}).click();};
 await openCreate();const name=frame.getByPlaceholder('为数字灵魂命名');await name.fill('刷新恢复验收角色');
 await frame.getByText('草稿已保存在本机',{exact:true}).waitFor();await page.reload();await openCreate();
 await frame.getByRole('button',{name:'恢复草稿',exact:true}).waitFor();
 for(const [theme,width] of [['dark','390'],['light','320']]){
   await page.evaluate(mode=>document.querySelector('iframe').contentWindow.productUpgradeTest.theme(mode),theme);
   await page.getByRole('combobox',{name:'视口宽度'}).selectOption(width);
   assert.ok(await frame.getByRole('dialog',{name:'创建角色',exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth));
   await page.locator('iframe').screenshot({path:`${out}/live-resume-${theme}-${width}.png`});checks.push(`${theme} ${width}: actual full-product draft recovery fits viewport`);
 }
 await frame.getByRole('button',{name:'恢复草稿',exact:true}).click();assert.equal(await name.inputValue(),'刷新恢复验收角色');checks.push('Full-product preview preserves and restores draft across fixture reload');
 const isolation=await page.evaluate(()=>document.querySelector('iframe').contentWindow.previewIsolation);
 assert.ok(Object.values(isolation).every(value=>value===0));assert.deepEqual(errors,[]);assert.equal(external,0);
 writeFileSync(`${out}/live-preview-isolation.json`,JSON.stringify(isolation,null,2));
}finally{writeFileSync(`${out}/live-preview-result.json`,JSON.stringify({recordedAt:new Date().toISOString(),checks,errors,externalRequests:external,scope:'Live 5290 actual product components; browser isolated records, no models/mic/audio; fixture reseeds business records but retains this simulated owner drafts'},null,2));await browser.close();}
console.log(`PASS ${checks.length} live draft preview checks`);
