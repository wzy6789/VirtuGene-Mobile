import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { productPreview } from '../preview-product-upgrade.mjs';
const before=process.argv.includes('--before');
const out=process.env.VG_CREATE_V2_OUT??`.tmp-preview/ui-overhaul-20261015/create-v2/${before?'before':'after'}`;mkdirSync(out,{recursive:true});
if(before&&['dark','light'].every(theme=>[320,390,430].every(width=>existsSync(`${out}/identity-${theme}-${width}.png`))))throw Error('Before capture already exists. Preserve it; the current preview has since been upgraded.');
// Before uses the still-running, verified earlier startup snapshot. No source
// files are rolled back to manufacture a comparison.
if(before&&!existsSync(`${out}/startup-build.json`))copyFileSync('.tmp-preview/ui-overhaul-20261015/preview/preview-build.json',`${out}/startup-build.json`);
const preview=before?null:await productPreview({port:0,output:out+'/server'});const address=preview?.address||'http://127.0.0.1:5290';
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[],checks=[];let external=0;
try{
 for(const theme of ['dark','light'])for(const width of [320,390,430]){
  const record=!before&&theme==='dark'&&width===390;
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:record?'no-preference':'reduce',...(record?{recordVideo:{dir:out,size:{width,height:844}}}:{})}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external++;return route.abort();});
  await page.goto(`${address}/app?virtugene-preview=mobile&theme=${theme}`);await page.waitForFunction(()=>window.productUpgradeReady);
  await page.evaluate(()=>window.productUpgradeTest.go('create'));
  await page.getByRole('button',{name:'创造基因',exact:true}).click();await page.getByPlaceholder('为数字灵魂命名').waitFor();
  await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
  await page.screenshot({path:`${out}/identity-${theme}-${width}.png`});
  if(before){await context.close();continue;}
  const dialog=page.getByRole('dialog',{name:'创建角色',exact:true});
  const nav=page.getByRole('navigation',{name:'创建角色步骤'});assert.equal(await nav.getByRole('button').count(),5);
  const selector='[aria-labelledby="'+await dialog.getAttribute('aria-labelledby')+'"]';
  const accessibility=await new AxeBuilder({page}).include(selector).analyze();writeFileSync(`${out}/axe-${theme}-${width}.json`,JSON.stringify(accessibility,null,2));assert.deepEqual(accessibility.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);checks.push(`${theme}/${width}: identity axe no violations (incomplete retained)`);
  await page.getByPlaceholder('为数字灵魂命名').fill('岚');await page.getByPlaceholder('例如：嘴硬心软的修理师，住在海边小城').fill('嘴硬心软的修理师，住在海边小城');
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  if(record)await page.waitForTimeout(350);
  await page.screenshot({path:`${out}/personality-${theme}-${width}.png`});
  await page.getByRole('textbox',{name:'快速描述人物'}).fill('嘴硬心软，习惯先动手帮忙，再慢慢说出自己的想法。');
  await page.getByRole('button',{name:'直接使用我的设定',exact:true}).click();
  await page.getByRole('textbox',{name:'说话风格',exact:true}).fill('说话简洁，不用长比喻。');
  if(record)await page.waitForTimeout(350);
  await page.screenshot({path:`${out}/expression-${theme}-${width}.png`});
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  if(record)await page.waitForTimeout(350);
  await page.screenshot({path:`${out}/relationship-${theme}-${width}.png`});
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  if(record)await page.waitForTimeout(350);
  await page.screenshot({path:`${out}/encounter-${theme}-${width}.png`});
  const save=page.getByRole('button',{name:'让 TA 来到我的世界',exact:true});assert.equal(await save.count(),1);assert.ok(await save.isEnabled());
  assert.ok(await save.evaluate(el=>{const r=el.getBoundingClientRect();return !!el.closest('.vg-modal-footer')&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el;}));
  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
  assert.equal(await nav.locator('[aria-current="step"]').getAttribute('aria-label'),'相遇');checks.push(`${theme}/${width}: five-step manual flow, single visible fixed save, no overflow`);
  assert.ok(Object.values(await page.evaluate(()=>window.previewIsolation)).every(value=>value===0));
  const video=record?await page.video()?.path():undefined;
  await context.close();
  if(video)writeFileSync(`${out}/recording.json`,JSON.stringify({video,viewport:{width,height:844},reducedMotion:false,scope:'Actual manual five-step creation preview; no save/model/mic, synthetic fields, intentional reading holds'},null,2));
 }
 if(!before){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'no-preference'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${address}/app?virtugene-preview=mobile&theme=dark`);await page.waitForFunction(()=>window.productUpgradeReady);await page.evaluate(()=>window.productUpgradeTest.go('create'));
  await page.getByRole('button',{name:'创造基因',exact:true}).click();await page.getByPlaceholder('为数字灵魂命名').fill('动效验收角色');
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  const first=await page.evaluate(()=>{const panel=document.querySelector('[data-create-step]:not([hidden])');window.createStepAnimation=panel.getAnimations()[0];return {duration:window.createStepAnimation?.effect?.getTiming().duration,frames:window.createStepAnimation?.effect?.getKeyframes()};});
  assert.equal(first.duration,240);checks.push('Normal step enters once over 240ms with immediate readable content');
  await page.evaluate(()=>document.querySelector('[aria-label="创建角色步骤"] [aria-label="身份"]').click());
  await page.waitForFunction(()=>document.querySelector('[aria-label="创建角色步骤"] [aria-label="身份"]').getAttribute('aria-current')==='step');
  const reversed=await page.evaluate(()=>{const animations=document.querySelector('[data-create-step]:not([hidden])').getAnimations();window.reverseStepAnimation=animations[0];return {oldState:window.createStepAnimation.playState,frames:animations[0]?.effect?.getKeyframes()};});
  assert.ok(['idle','finished'].includes(reversed.oldState));assert.equal(reversed.frames[0].transform,'translateX(-4px)');checks.push('Rapid reverse cancels old step animation and reverses direction');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(50);assert.ok(await page.evaluate(()=>window.reverseStepAnimation.playState!=='running'));checks.push('Enabling reduced motion cancels in-flight step movement');
  writeFileSync(`${out}/motion.json`,JSON.stringify({first,reversed},null,2));await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(external,0);
}finally{writeFileSync(`${out}/result.json`,JSON.stringify({recordedAt:new Date().toISOString(),before,checks,errors,externalRequests:external,address,scope:'Actual full-product components; synthetic local data, no model/mic/audio. Before from earlier running preview, after from current source.'},null,2));await browser.close();if(preview)await new Promise(r=>preview.server.close(r));}
console.log(before?'Captured six honest before screenshots':`PASS ${checks.length} create v2 checks`);
