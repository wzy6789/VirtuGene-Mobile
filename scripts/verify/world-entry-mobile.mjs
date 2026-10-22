import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const out='.tmp-preview/ui-overhaul-20261015/world-entry/mobile';
mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0});
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={checks:[],errors:[],screenshots:[],scope:'Desktop Chrome portrait viewport emulation. Doubled computed text sizes/line heights are a stress test, not Android font scaling. No real keyboard, display cutout or Android device.',isolation:[]};
try {
 for(const [width,height] of [[320,568],[390,844],[430,932]])for(const theme of ['dark','light'])for(const scale of [1,2]){
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message));
  await page.goto(`${preview.address}/app`);
  await page.evaluate(async(theme)=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);await productUpgradeTest.seedWorld();productUpgradeTest.theme(theme);await productUpgradeTest.go('world');},theme);
  await page.getByRole('button',{name:'继续这一幕',exact:true}).waitFor();
  if(scale===2)await page.evaluate(()=>{
   const sizes=[...document.querySelectorAll('body *')].filter(n=>!n.closest('svg,#preview-isolation-label')&&[...n.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim())).map(n=>{const s=getComputedStyle(n);return [n,parseFloat(s.fontSize),parseFloat(s.lineHeight)];});
   for(const [n,size,line] of sizes){n.style.setProperty('font-size',`${size*2}px`,'important');if(Number.isFinite(line))n.style.setProperty('line-height',`${line*2}px`,'important');}
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const label=`${width}x${height}/${theme}/text-${scale}`;
  const dimensions=await page.locator('.vg-world-page').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));
  assert.ok(dimensions.scroll<=dimensions.width+1,`${label} horizontal overflow: ${JSON.stringify(dimensions)}`);result.checks.push(`${label}: no horizontal overflow`);
  const targets=await page.locator('.vg-world-daily-entry,.vg-world-resume-actions>button,.vg-world-records nav button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,width:r.width,height:r.height};}));
  assert.ok(targets.length>=10&&targets.every(n=>n.width>=44&&n.height>=44),`${label}: undersized touch target ${JSON.stringify(targets)}`);result.checks.push(`${label}: primary targets at least 44x44`);
  const nav=page.locator('.mobile-bottom-nav');await nav.waitFor();
  const navBounds=await nav.boundingBox();assert.ok(navBounds&&navBounds.y>=0&&navBounds.y+navBounds.height<=height+1,`${label}: bottom navigation outside portrait viewport`);result.checks.push(`${label}: bottom navigation remains in viewport`);
  const path=`${out}/world-${theme}-${width}-text-${scale}.png`;await page.screenshot({path});result.screenshots.push(path);
  const action=page.getByRole('button',{name:'记忆',exact:true});await action.scrollIntoViewIfNeeded();await action.click();
  assert.equal(await page.evaluate(()=>productUpgradeTest.snapshot().navigation.activeView),'memory');result.checks.push(`${label}: lower record action remains reachable`);
  const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);assert.ok(Object.values(isolation).every(n=>n===0));result.isolation.push({label,...isolation});await context.close();
 }
 assert.equal(result.errors.length,0);result.status='pass';
}catch(error){result.status='failed';result.failure=error.stack;throw error;}
finally{await browser.close();await new Promise(resolve=>preview.server.close(resolve));writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:result.checks.length,failure:result.failure}));}
