import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const out='.tmp-preview/starfield-visible-20261021';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
try{
 await page.goto('http://127.0.0.1:5340/?view=messages');await page.waitForFunction(()=>window.cinematicReady);
 await page.waitForFunction(()=>{const e=document.querySelector('.vg-home-scene-backdrop img');return e?.complete&&e.naturalWidth>0;});
 const home=await page.locator('[data-home-scene]').evaluate(e=>({id:e.dataset.homeScene,imageWidth:e.querySelector('img').naturalWidth,overflow:document.documentElement.scrollWidth>innerWidth}));
 assert.equal(home.id,'orbital-observatory');assert.equal(home.overflow,false);
 assert.deepEqual(await page.getByRole('tablist',{name:'聊天频道'}).getByRole('tab').allTextContents(),['对话','助理']);
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:out+'/home-dark-390.png'});checks.push('actual message home displays sharp starfield; only dialogue and assistant tabs');
 await page.evaluate(()=>window.backgroundTest.theme('light'));await page.screenshot({path:out+'/home-light-390.png'});
 await page.evaluate(()=>window.backgroundTest.enabled(false));assert.equal(await page.locator('.vg-home-scene-backdrop').count(),1);await page.evaluate(()=>window.backgroundTest.enabled(true));checks.push('chat-only background switch does not remove the independent static home scene');
 const migration=await page.evaluate(async()=>{
  const t=window.backgroundTest,initial=t.rows().globalRow,owner=window.cinematicTest.snapshot().userId;
  const legacy={schemaVersion:1,mode:'atmosphere',themeId:'cool',focalPoint:{x:.5,y:.5},zoom:1,mask:.4,blur:0,effect:'glow',strength:'gentle',lightDarkPolicy:'app'};
  const global=async()=> (await t.repo.load(owner)).find(r=>r.roleId==='');
  await t.db.settings.put({...initial,revision:7,cinematicDefaultVersion:undefined,config:legacy,strategy:'characterRecommended'});
  const upgraded=await global(),again=await global();
  const explicit=await t.repo.save(owner,'',legacy,upgraded.revision,'characterRecommended'),preserved=await global();
  await t.db.settings.put({...initial,revision:4,config:{...legacy,themeId:'warm'}});const color=await global();
  await t.db.settings.put({...initial,revision:4,config:{...legacy,mode:'clean'}});const clean=await global();
  await t.db.settings.put({...initial,revision:4,config:{...legacy,presentation:{preset:'focus',transparency:'solid',ambient:false,avatar:false}}});const focus=await global();
  await t.db.settings.put(initial);await t.reload();
  return {upgraded:upgraded.config.scene?.id,revision:upgraded.revision,again:again.revision,explicit:explicit.choice,preserved:preserved.config.mode,color:color.config.themeId,clean:clean.config.mode,focus:focus.config.presentation.preset};
 });
 assert.deepEqual(migration,{upgraded:'orbital-observatory',revision:8,again:8,explicit:'user',preserved:'atmosphere',color:'warm',clean:'clean',focus:'focus'});checks.push('old exact automatic default upgrades regardless revision; new explicit choice, custom color, clean and focus stay intact');
 await page.evaluate(()=>{window.backgroundTest.theme('dark');window.cinematicTest.open('chat');});
 await page.waitForFunction(()=>document.querySelector('.vg-chat-scene')?.dataset.sceneLoad==='ready');
 assert.equal(await page.locator('.vg-chat-scene').getAttribute('data-scene-id'),'orbital-observatory');await page.screenshot({path:out+'/chat-dark-390.png'});checks.push('real chat still defaults to same orbital scene');
 const isolation=await page.evaluate(()=>window.cinematicTest.snapshot());assert.equal(isolation.mediaAttempts,0);assert.equal(isolation.extraNetwork,0);assert.deepEqual(errors,[]);
 writeFileSync(out+'/result.json',JSON.stringify({pass:true,checks,home,migration,errors,scope:'Actual components with isolated synthetic database and controlled transport; no actual user data/model/microphone; not Android'},null,2));console.log(JSON.stringify({pass:true,checks}));
}catch(e){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});writeFileSync(out+'/failure.json',JSON.stringify({error:String(e),stack:e.stack,checks,errors},null,2));console.error(e);process.exitCode=1;}finally{await browser.close();}
