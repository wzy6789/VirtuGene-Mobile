const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {chromium}=createRequire(path.join(path.dirname(process.execPath),'package.json'))('playwright');
const server=http.createServer((req,res)=>{const name=path.basename(new URL(req.url,'http://local').pathname);const file=path.join(__dirname,name||'ui-v2.html');fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.woff2')?'font/woff2':'text/html;charset=utf-8');res.end(data);});});
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/ui-v2.html`);await page.getByRole('heading',{name:'同一件事，全新的质感'}).waitFor();
 await page.addStyleTag({content:'html,body,#root{height:auto!important;overflow:visible!important}'});
 for(const theme of ['dark','light']){
  await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await page.waitForTimeout(350);
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} ${width}px has no horizontal overflow`);check(await page.locator('.vg-cabin-stats strong').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=32),'hero numbers are at least 32px');await page.screenshot({path:path.join(__dirname,`ui-v2-${theme}-${width}.png`),fullPage:true});}
  const contrast=await page.getByRole('button',{name:'保存',exact:true}).evaluate(e=>{const c=getComputedStyle(e);const luminance=s=>{const a=s.match(/[0-9.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;};const a=luminance(c.color),b=luminance(c.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});check(contrast>=4.5,`${theme} action text meets contrast 4.5`);
  check(await page.locator('.vg-preference-copy small').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=13),`${theme} settings descriptions remain readable`);
  check(await page.locator('.vg-preference-icon svg').first().evaluate(e=>getComputedStyle(e).strokeWidth==='1.5px'),`${theme} settings share the 1.5px icon language`);
  check(await page.locator('.vg-cabin-task-actions button').first().evaluate(e=>e.getBoundingClientRect().height>=44),`${theme} compact task actions have 44px touch targets`);
  await page.getByRole('textbox',{name:'输入框预览'}).focus();check(await page.getByRole('textbox',{name:'输入框预览'}).evaluate(e=>getComputedStyle(e).outlineStyle==='none'&&getComputedStyle(e.parentElement).boxShadow!=='none'),`${theme} input shell owns its focus feedback`);
  const tabs=page.getByRole('navigation',{name:'页签动效预览'});await tabs.getByRole('button',{name:'待处理',exact:true}).click();await page.waitForTimeout(240);check(await tabs.locator('i').evaluate(e=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(e).transform).m41-e.getBoundingClientRect().width*2)<1),`${theme} indicator lands beneath the selected tab`);
  await page.setViewportSize({width:320,height:844});
  const world=page.getByRole('region',{name:'世界入口对照'});
  check(await world.locator('.vg-world-hero p').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=13),`${theme} world descriptions remain readable`);
  await world.screenshot({path:path.join(__dirname,`ui-v2-world-${theme}.png`)});
  await page.evaluate(()=>uiV2.useCharacterStateStore.setState({milestone:{prevLevel:'初次相识',level:'彼此信赖，故事还在继续'}}));
  const receipt=page.locator('.vg-relation-receipt');await receipt.waitFor();
  check(await receipt.evaluate(e=>getComputedStyle(e).pointerEvents==='none'&&e.getBoundingClientRect().right<=innerWidth),`${theme} milestone does not block input or overflow`);
  check(await receipt.locator('.vg-relation-receipt-card').evaluate(e=>e.getAnimations().every(a=>a.effect.getTiming().duration<=320&&a.effect.getTiming().iterations===1)),`${theme} milestone uses finite short motion`);
  await page.waitForTimeout(350);await receipt.screenshot({path:path.join(__dirname,`ui-v2-milestone-${theme}.png`)});
  await page.evaluate(()=>uiV2.useCharacterStateStore.setState({milestone:null}));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(__dirname,`ui-v2-${theme}.png`),fullPage:true});
 }
 await page.emulateMedia({reducedMotion:'reduce'});check(await page.locator('.vg-loading-skeleton i').first().evaluate(e=>getComputedStyle(e).animationName==='none'),'system reduced-motion keeps skeleton static');
 check(await page.locator('.vg-assistant-tab-track i').evaluate(e=>getComputedStyle(e).transitionDuration==='0s'),'system reduced-motion settles tab indicator without movement');
 await page.evaluate(()=>uiV2.useCharacterStateStore.setState({milestone:{prevLevel:'相识',level:'信赖'}}));await page.locator('.vg-relation-receipt').waitFor();
 check(await page.locator('.vg-relation-receipt-card').evaluate(e=>e.getAnimations().length===0),'reduced-motion milestone presents final state without movement');
 await page.waitForTimeout(1800);await page.evaluate(()=>uiV2.useCharacterStateStore.setState({milestone:{prevLevel:'信赖',level:'新的里程碑'}}));await page.waitForTimeout(1100);
 check(await page.locator('.vg-relation-receipt strong').textContent()==='新的里程碑','previous milestone timer cannot clear its replacement');
 await page.waitForTimeout(1800);check(await page.locator('.vg-relation-receipt').count()===0,'milestone dismisses after its own display interval');
 await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>uiV2.useSettingsStore.setState({reduceMotion:true}));check(await page.locator('.vg-loading-skeleton i').first().evaluate(e=>getComputedStyle(e).animationName==='none'),'app reduced-motion keeps skeleton static');
 check(await page.locator('.vg-assistant-tab-track i').evaluate(e=>getComputedStyle(e).transitionDuration==='0s'),'app reduced-motion settles tab indicator without movement');
 await page.getByRole('button',{name:'完成：整理今天的生活记录'}).click();check(await page.locator('.vg-cabin-check svg').count()===1,'complete state uses the shared check icon');check(await page.locator('.vg-cabin-check svg').evaluate(e=>getComputedStyle(e).animationName==='none'),'reduced-motion completion preserves its final state');
 check(errors.length===0,`no runtime errors ${errors.join('; ')}`);console.log(`PASS ${checks} UI v2 checks`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
