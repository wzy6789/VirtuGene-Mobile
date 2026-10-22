import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='.tmp-preview/default-starfield-20261021';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,colorScheme:'dark'});
const page=await context.newPage(),errors=[],checks=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5337/?view=chat');await page.waitForFunction(()=>window.cinematicReady);await page.waitForFunction(()=>document.querySelector('.vg-chat-scene')?.dataset.sceneLoad==='ready');
 const defaults=await page.evaluate(()=>({row:window.backgroundTest.rows().globalRow,scene:document.querySelector('.vg-chat-scene').dataset.sceneId,mode:document.querySelector('[data-background-mode]').dataset.backgroundMode}));
 assert.equal(defaults.row.config.mode,'scene');assert.equal(defaults.scene,'orbital-observatory');assert.equal(defaults.row.config.scene.renderer,'layered');checks.push('fresh actual chat defaults to authored starfield scene without fixture override');
 await page.screenshot({path:out+'/chat-starfield-dark-390.png'});
 const result=await page.evaluate(async()=>{
  const t=window.backgroundTest,owner=window.cinematicTest.snapshot().userId;
  const original=t.rows().globalRow;
  const legacy={schemaVersion:1,mode:'atmosphere',themeId:'cool',focalPoint:{x:.5,y:.5},zoom:1,mask:.4,blur:0,effect:'glow',strength:'gentle',lightDarkPolicy:'app'};
  const customRole={id:JSON.stringify([owner,'a']),userId:owner,roleId:'a',revision:2,config:{...legacy,mode:'clean'}};
  const loadGlobal=async()=>{const rows=await t.repo.load(owner);return rows.find(r=>r.roleId==='');};
  await t.db.settings.put({...original,revision:1,cinematicDefaultVersion:undefined,config:legacy,strategy:'characterRecommended'});
  const migrated=await loadGlobal(),again=await loadGlobal();
  await t.db.settings.put(customRole);
  const role=await t.db.settings.get(customRole.id);
  await t.db.settings.put({...original,revision:2,choice:'user',config:legacy,strategy:'characterRecommended'});const customized=await loadGlobal();
  await t.db.settings.put({...original,revision:1,config:{...legacy,themeId:'warm'},strategy:'characterRecommended'});const nondefault=await loadGlobal();
  await t.db.settings.put({...original,revision:1,config:legacy,strategy:'fixed'});const fixed=await loadGlobal();
  await t.db.settings.put({...original,revision:1,config:{...legacy,presentation:{preset:'focus',transparency:'solid',ambient:false,avatar:false}},strategy:'characterRecommended'});const preference=await loadGlobal();
  await t.db.settings.put(original);await t.db.settings.delete(customRole.id);await t.reload();
  return {migrated,again,role,customized,nondefault,fixed,preference,isolation:window.cinematicTest.snapshot()};
 });
 assert.equal(result.migrated.config.scene.id,'orbital-observatory');assert.equal(result.migrated.revision,2);assert.equal(result.again.revision,2);checks.push('untouched old default migrates once through real indexed repository');
 assert.equal(result.role.config.mode,'clean');assert.equal(result.customized.config.mode,'atmosphere');assert.equal(result.nondefault.config.themeId,'warm');assert.equal(result.fixed.config.mode,'atmosphere');assert.equal(result.preference.config.presentation.preset,'focus');checks.push('role override, saved revision, changed color, fixed strategy and motion choice stay unchanged');
 assert.equal(result.isolation.mediaAttempts,0);assert.equal(result.isolation.extraNetwork,0);
 const auth=await context.newPage();auth.on('pageerror',e=>errors.push(e.message));await auth.goto('http://127.0.0.1:5184/?virtugene-preview=mobile');await auth.locator('.vg-auth-scene-backdrop').waitFor();await auth.waitForFunction(()=>{const e=document.querySelector('.vg-auth-scene-backdrop');return e?.complete&&e.naturalWidth===841;});
 await auth.evaluate(async()=>{await document.fonts.ready;const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='知道了');b?.click();});await auth.waitForTimeout(250);await auth.screenshot({path:out+'/auth-starfield-dark-390.png'});assert.equal(await auth.evaluate(()=>document.documentElement.scrollWidth),390);checks.push('actual built login loads original sharp starfield image at mobile width');
 await auth.locator('button').filter({hasText:'注册你的基因'}).click();await auth.getByLabel('账号登录与注册').waitFor();assert.equal(await auth.locator('.vg-auth-scene-backdrop').count(),1);checks.push('same static backdrop remains through login/register transition');
 assert.deepEqual(errors,[]);writeFileSync(out+'/result.json',JSON.stringify({pass:true,checks,defaults,migration:result,errors,scope:'actual components and repository; separate synthetic database; actual built auth without login; no project model/microphone'},null,2));console.log(JSON.stringify({pass:true,checks:checks.length,errors}));
}catch(e){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});writeFileSync(out+'/failure.json',JSON.stringify({error:String(e),stack:e.stack,checks,errors},null,2));console.error(e);process.exitCode=1;}finally{await browser.close();}
