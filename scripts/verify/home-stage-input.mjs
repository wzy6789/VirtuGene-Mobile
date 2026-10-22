import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const out=process.env.VG_STAGE_INPUT_OUTPUT||'.tmp-preview/ui-overhaul-20261016/home-stage-input/before';
fs.mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0,output:out+'/server'}),browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],scope:'Actual homepage components; Chrome mouse, wheel and synthetic touch, not Android.'};
const check=(ok,label)=>{assert.ok(ok,label);report.checks.push(label);};
try {
 for(const width of [320,390,430]) {
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,recordVideo:{dir:out,size:{width,height:844}}});
  try {
   const page=await context.newPage();
   await page.goto(preview.address+'/app');
   await page.evaluate(async()=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);await productUpgradeTest.go('home');});
   const stage=page.locator('.vg-today-stage[data-stage-character]'),viewport=page.locator('.vg-today-viewport'),rail=page.locator('.vg-today-rail');
   await stage.waitFor();await page.waitForTimeout(500);
   const initial=await stage.getAttribute('data-stage-character'),box=await viewport.boundingBox();
   const offset=()=>rail.evaluate(n=>new DOMMatrixReadOnly(getComputedStyle(n).transform).m41);
   // A small diagonal start must remain undecided until the thumb's intent is clear.
   await page.mouse.move(box.x+box.width*.8,box.y+100);await page.mouse.down();
   await page.mouse.move(box.x+box.width*.8-8,box.y+108);
   await page.mouse.move(box.x+box.width*.25,box.y+109,{steps:10});
   check(await offset()<-30,width+' diagonal start can resolve into horizontal drag');
   await page.mouse.up();await page.waitForTimeout(330);
   check(await stage.getAttribute('data-stage-character')!==initial,width+' diagonal-start swipe selects next card');
   await page.locator('.vg-today-selectors button').first().click();await page.waitForTimeout(330);
   const cdp=await context.newCDPSession(page),startX=box.x+box.width*.8,y=box.y+100;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:startX,y}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:startX-8,y:y+8}]});
   for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:startX-8-box.width*.05*i,y:y+9}]});await page.waitForTimeout(12);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(350);
   check(await stage.getAttribute('data-stage-character')!==initial,width+' actual Chrome touch resolves diagonal start into horizontal swipe');
   await page.locator('.vg-today-selectors button').first().click();await page.waitForTimeout(330);
   await page.mouse.move(box.x+box.width*.5,box.y+100);
   await page.mouse.wheel(box.width*4,0);await page.waitForTimeout(30);
   check(await offset()>=-box.width-1,width+' large trackpad momentum cannot flash several cards before snapping back');
   await page.waitForTimeout(450);await page.locator('.vg-today-selectors button').first().click();await page.waitForTimeout(330);
   await page.mouse.move(box.x+box.width*.5,box.y+100);
   await page.mouse.wheel(box.width*.35,0);await page.waitForTimeout(30);
   check(await offset()<-20,width+' horizontal trackpad scroll follows before snapping');
   await page.waitForTimeout(450);
   check(await stage.getAttribute('data-stage-character')!==initial,width+' horizontal trackpad scroll changes recommendation');
   const selected=await stage.getAttribute('data-stage-character');
   await page.mouse.wheel(0,80);await page.waitForTimeout(400);
   check(await stage.getAttribute('data-stage-character')===selected,width+' vertical wheel does not select another recommendation');
   await page.locator('.vg-today-selectors button').first().click();await page.waitForTimeout(330);
   await page.mouse.move(box.x+box.width*.5,box.y+100);
   await page.mouse.wheel(box.width*.3,0);await page.waitForTimeout(20);
   await page.mouse.down();await page.mouse.move(box.x+box.width*.85,box.y+100,{steps:8});await page.mouse.up();
   await page.waitForTimeout(500);
   check(await stage.getAttribute('data-stage-character')===initial,width+' pointer takes over wheel drag without a stale delayed commit');
   await page.keyboard.down('Shift');await page.mouse.wheel(0,box.width*.35);await page.keyboard.up('Shift');await page.waitForTimeout(450);
   check(await stage.getAttribute('data-stage-character')!==initial,width+' shift wheel supports horizontal selection');
   await page.locator('.vg-today-selectors button').first().click();await page.waitForTimeout(330);
   await page.mouse.move(box.x+box.width*.5,box.y+100);
   await page.mouse.wheel(box.width*.3,0);await page.waitForTimeout(20);
   await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(450);
   check(await stage.getAttribute('data-stage-character')===initial&&Math.abs(await offset())<1,width+' losing window focus cancels pending wheel selection');
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.mouse.wheel(box.width*.35,0);await page.waitForTimeout(150);
   check(await stage.getAttribute('data-stage-character')!==initial&&await rail.evaluate(n=>n.getAnimations().length===0),width+' reduced motion retains wheel control without snap animation');
   check((await page.evaluate(()=>productUpgradeTest.snapshot())).navigation.mobileTab==='chat',width+' local gestures preserve selected navigation tab');
   check(await page.locator('.chat-room').count()===0,width+' dragging never activates continue conversation');
   await page.screenshot({path:out+'/'+width+'.png'});
  } finally {await context.close();}
 }
 report.pass=true;
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally {await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
