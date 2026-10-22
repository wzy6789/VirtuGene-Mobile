import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out='.tmp-preview/ui-overhaul-20261015/world-cover-motion/visual';mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true}),result={screenshots:[],errors:[],isolation:[],scope:'Actual component WAAPI held at 120ms for visual inspection; before/after source layout is not fabricated. Synthetic scene and no model/audio/Android.'};
try{for(const width of [320,390,430])for(const theme of ['dark','light']){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 await page.goto(`${preview.address}/app`);await page.evaluate(async(theme)=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);await productUpgradeTest.seedWorld();productUpgradeTest.theme(theme);await productUpgradeTest.go('world');window.heldCover=false;new MutationObserver(records=>{
  if(!records.some(record=>[...record.addedNodes].some(n=>n instanceof HTMLElement&&n.matches('.vg-soul-surface'))))return;
  const nodes=[...document.querySelectorAll('[data-world-cover-flight],[data-world-cover-flight] *, .vg-soul-surface')];window.heldAnimations=nodes.flatMap(n=>n.getAnimations());
  for(const animation of window.heldAnimations){animation.pause();animation.currentTime=120;}
  window.heldCover=true;
 }).observe(document.body,{childList:true,subtree:true});},theme);
 await page.getByRole('button',{name:'继续这一幕',exact:true}).waitFor();const before=`${out}/${theme}-${width}-entry.png`;await page.screenshot({path:before});result.screenshots.push(before);
 await page.getByRole('button',{name:'继续这一幕',exact:true}).click();await page.waitForFunction(()=>window.heldCover);
 const mid=`${out}/${theme}-${width}-flight-120ms.png`;await page.screenshot({path:mid});result.screenshots.push(mid);
 const animations=await page.evaluate(()=>window.heldAnimations.map(animation=>({currentTime:animation.currentTime,duration:animation.effect.getTiming().duration})));assert.ok(animations.length>=2&&animations.every(a=>a.currentTime===120&&a.duration<=320));
 await page.evaluate(()=>window.heldAnimations.forEach(animation=>animation.play()));await page.locator('[data-world-cover-flight]').waitFor({state:'detached'});await page.locator('.vg-canvas-title').filter({hasText:'雨后的站台'}).waitFor();
 const after=`${out}/${theme}-${width}-canvas.png`;await page.screenshot({path:after});result.screenshots.push(after);
 const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);assert.ok(Object.values(isolation).every(n=>n===0));result.isolation.push({width,theme,...isolation});await context.close();
 }assert.equal(result.errors.length,0);result.status='pass';}catch(error){result.status='failed';result.failure=error.stack;throw error;}finally{await browser.close();await new Promise(resolve=>preview.server.close(resolve));writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,screenshots:result.screenshots.length,failure:result.failure}));}
