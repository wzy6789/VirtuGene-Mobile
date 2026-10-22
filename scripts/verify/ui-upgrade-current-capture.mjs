import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='.tmp-preview/ui-overhaul-20261015/current';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try{
 for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:5290/app?theme=${theme}`);await page.waitForFunction(()=>window.productUpgradeReady);await page.evaluate(()=>document.fonts.ready);
  for(const screen of ['home','characters','profile','chat','call-connected']){
   await page.evaluate(screen=>window.productUpgradeTest.go(screen),screen);await page.waitForTimeout(500);await page.screenshot({path:`${out}/${screen}-${theme}.png`});
  }
  await page.close();
 }
 writeFileSync(`${out}/result.json`,JSON.stringify({errors,viewport:[390,844],scope:'Latest live source + production CSS, synthetic actual components, no real model/audio.'},null,2));
 console.log(JSON.stringify({errors,out}));
}finally{await browser.close();}
