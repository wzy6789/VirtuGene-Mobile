import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=`.tmp-preview/starfield-upgrade-20261017/P8a/${process.env.VG_NAV_PHASE??'after'}-${Date.now()}`;mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],limits:['Actual mobile shell with synthetic isolated IndexedDB, not the logged-in sidebar.','Keyboard/insets are DOM visualViewport/CSS-variable simulations, not Android IME evidence.']};
const check=async(name,run)=>{try{report.checks.push({name,pass:true,detail:await run()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
let preview,browser;
try{
 preview=await starfieldPreview({port:0,output:out+'/server'});browser=await chromium.launch({channel:'chrome'});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'no-preference'}),page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(preview.address+'/app?virtugene-preview=mobile');await page.waitForFunction(()=>window.starfieldReady);await page.evaluate(()=>starfieldPreview.setState('six'));await page.evaluate(()=>document.fonts.ready);
 const nav=page.getByRole('navigation',{name:'主导航',exact:true});
 for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
  await page.setViewportSize({width,height:width===320?740:844});await page.evaluate(theme=>starfieldPreview.theme(theme),theme);
  for(const [index,label] of ['消息','世界','角色','我的'].entries()){
   await nav.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(240);
   await check(`${theme}-${width}-${label}: real destination and aligned selected rail`,async()=>{
    assert.equal(await nav.locator('[aria-current=page]').count(),1);assert.equal(await nav.getByRole('button',{name:label,exact:true}).getAttribute('aria-current'),'page');
    const d=await nav.evaluate(n=>{const r=n.getBoundingClientRect(),indicator=n.querySelector('.vg-nav-indicator'),i=indicator.getBoundingClientRect();const ink=getComputedStyle(n.querySelector('[aria-current=page]')).color,bg=getComputedStyle(indicator,'::before').backgroundColor;
     const lum=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const a=lum(ink),b=lum(bg);
     return{width:r.width,x:i.x-r.x,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),slots:[...n.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return{w:r.width,h:r.height};})};});
    assert(Math.abs(d.x-d.width*index/4)<1);assert(d.slots.every(s=>s.w>=48&&s.h>=48));assert(d.contrast>=4.5);return d;
   });
  }
  for(const scale of [1,1.25,1.5]){
   await page.evaluate(scale=>document.documentElement.style.fontSize=15*scale+'px',scale);
   await check(`${theme}-${width}-${scale}: labels stay readable inside stable touch targets`,async()=>{const d=await nav.evaluate(n=>[...n.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),s=b.lastElementChild.getBoundingClientRect();return{top:r.top,bottom:r.bottom,labelTop:s.top,labelBottom:s.bottom,font:parseFloat(getComputedStyle(b.lastElementChild).fontSize)};}));assert(d.every(s=>s.font>=12&&s.labelTop>=s.top&&s.labelBottom<=s.bottom));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));return d;});
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='15px');await nav.getByRole('button',{name:'世界',exact:true}).click();
  await page.locator('.vg-world-page').waitFor();await page.getByRole('status',{name:'正在读取你的世界',exact:true}).waitFor({state:'hidden'});
  await page.screenshot({path:out+`/${theme}-${width}.png`});
 }
 await page.setViewportSize({width:390,height:844});
 await check('navigation uses a matte moving selection instead of a gradient glow',async()=>{const style=await nav.locator('.vg-nav-indicator').evaluate(n=>({image:getComputedStyle(n).backgroundImage,before:getComputedStyle(n,'::before').backgroundColor}));assert.equal(style.image,'none');assert(!['transparent','rgba(0, 0, 0, 0)'].includes(style.before));return style;});
 await check('selected SVG has a distinct fill and decorative-only semantics',async()=>{const d=await nav.locator('[aria-current=page] svg').evaluate(n=>({hidden:n.getAttribute('aria-hidden'),filled:[...n.querySelectorAll('path,circle')].some(p=>p.getAttribute('fill')==='currentColor'&&Number(p.getAttribute('fill-opacity'))>0)}));assert.equal(d.hidden,'true');assert(d.filled);return d;});
 for(const inset of [0,20,34]){
  await page.evaluate(inset=>document.documentElement.style.setProperty('--safe-area-inset-bottom',inset+'px'),inset);
  await check(`bottom inset ${inset}: counted exactly once outside tab targets`,async()=>{const d=await nav.evaluate(n=>({padding:parseFloat(getComputedStyle(n).paddingBottom),height:n.getBoundingClientRect().height,button:n.querySelector('button').getBoundingClientRect().height}));assert.equal(d.padding,inset);assert(Math.abs(d.height-(d.button+inset+1))<1);return d;});
 }
 await page.evaluate(()=>document.documentElement.style.removeProperty('--safe-area-inset-bottom'));
 await nav.getByRole('button',{name:'消息',exact:true}).click();const search=page.getByRole('textbox',{name:'搜索聊天',exact:true});await search.waitFor();
 await check('actual search focus removes navigation immediately',async()=>{await search.focus();await nav.waitFor({state:'hidden'});});
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:500});visualViewport.dispatchEvent(new Event('resize'));document.activeElement.blur();});await page.waitForTimeout(300);
 await check('keyboard-sized viewport keeps navigation hidden after blur',async()=>{assert(await nav.isHidden());});
 await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
 await check('navigation returns when the simulated keyboard is gone',async()=>{await nav.waitFor({state:'visible'});});
 await nav.getByRole('button',{name:'世界',exact:true}).click();await page.getByRole('button',{name:'星域',exact:true}).click();await page.locator('[data-scene-row]').first().click();await page.locator('.vg-sector-detail').waitFor();
 await check('world destination remains selected through scene detail and return',async()=>{assert.equal(await nav.getByRole('button',{name:'世界',exact:true}).getAttribute('aria-current'),'page');await page.getByRole('button',{name:'返回星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();await nav.getByRole('button',{name:'世界',exact:true}).click();await page.getByRole('button',{name:'星域',exact:true}).waitFor();});
 await page.evaluate(()=>starfieldPreview.motion(true));await page.emulateMedia({reducedMotion:'reduce'});await nav.getByRole('button',{name:'消息',exact:true}).click();
 await check('reduced motion moves selected rail directly without a transition',async()=>{const duration=await nav.locator('.vg-nav-indicator').evaluate(n=>getComputedStyle(n).transitionDuration);assert(duration.split(',').every(s=>parseFloat(s)===0));assert.equal(await nav.locator('[aria-current=page] .vg-nav-icon').evaluate(n=>getComputedStyle(n).transform),'none');});
 await check('real mobile identity and all isolation counters remain intact',async()=>{const s=await page.evaluate(()=>starfieldPreview.snapshot());assert(s.IS_MOBILE&&s.mobileLayout&&!s.native);assert(Object.values(s.isolation).every(n=>n===0));return s.isolation;});
 await context.close();
}catch(e){report.errors.push(String(e));}
finally{await browser?.close();if(preview)await new Promise(r=>preview.server.close(r));report.pass=report.errors.length===0&&report.checks.length>0&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
