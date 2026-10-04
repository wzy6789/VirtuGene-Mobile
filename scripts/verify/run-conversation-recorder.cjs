const {createRequire}=require('node:module');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=createRequire(path.join(path.dirname(process.execPath),'package.json'))('playwright');
const dir=path.resolve('.tmp-preview/conversation-recorder');fs.mkdirSync(dir,{recursive:true});
let count=0;const check=(condition,label)=>{assert.ok(condition,label);count++;};
(async()=>{
  const html=fs.readFileSync('docs/prototypes/conversation-recorder.html');
  const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];let requests=0;
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(['fetch','xhr'].includes(request.resourceType()))requests++;});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const orb=()=>page.locator('.cr-orb-entry button');
    await orb().waitFor();await page.waitForTimeout(200);
    check(await page.locator('.cr-chat-identity').textContent()==='月小月好友','character identity remains separate from the recorder');
    check(await orb().getAttribute('aria-label')==='查看与小月的对话记录','small orb communicates its actual action');
    await page.screenshot({path:path.join(dir,'desktop-chat.png')});
    await orb().click();await page.waitForTimeout(350);
    check(await page.locator('.cr-desktop-panel').count()===1,'desktop opens a side panel');
    check(await page.locator('.cr-orb-entry .vg-soul-orb').getAttribute('data-orb-motion')==='paused','opening records pauses the background orb while the panel portrait remains static');
    check(await page.getByRole('tabpanel').textContent().then(text=>text.includes('书店')),'overview shows the selected conversation summary');
    await page.screenshot({path:path.join(dir,'desktop-overview.png')});
    await page.getByRole('tab',{name:'情绪',exact:true}).click();
    check(await page.getByRole('tabpanel').locator('.cr-chart svg').count()===1,'emotion tab reuses the actual project radar chart');
    await page.getByRole('tab',{name:'情绪',exact:true}).focus();await page.keyboard.press('ArrowRight');
    check(await page.getByRole('tab',{name:'回忆',exact:true}).getAttribute('aria-selected')==='true','tabs support keyboard arrow navigation');
    await page.getByRole('button',{name:'查看原文',exact:true}).click();
    check(await page.locator('.cr-source').textContent().then(text=>text.includes('我一直更喜欢安静')),'memory can be checked against its original message');
    await page.getByRole('button',{name:'返回记录',exact:true}).click();
    await page.getByRole('button',{name:'与小月的全部回忆',exact:true}).click();
    check(await page.locator('.cr-memory-card').count()===2,'role-wide memories are an explicit separate scope');
    await page.getByRole('tab',{name:'故事',exact:true}).click();
    check(await page.locator('.cr-timeline li').count()===3,'story combines dated events and relationship milestones');
    await page.locator('.cr-conversation').filter({hasText:'陈言'}).click();
    check(await page.locator('.cr-desktop-panel').count()===0,'switching characters closes the prior records');
    await orb().click();
    check(await page.getByRole('tabpanel').textContent().then(text=>text.includes('项目完成')&&!text.includes('书店')),'new character receives only its own sample records');
    await page.getByRole('button',{name:'空记录',exact:true}).click();
    for(const name of ['概览','情绪','回忆','故事']){
      await page.getByRole('tab',{name,exact:true}).click();
      check(await page.locator('.cr-empty').count()===1,`${name} has a readable empty state`);
    }
    await page.getByRole('button',{name:'空记录',exact:true}).click();
    await page.locator('.cr-conversation').filter({hasText:'小月'}).click();
    for(const width of [820,1024]){
      await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
      check(await page.locator('.cr-chat').evaluate(el=>el.getBoundingClientRect().width>=320),`narrow desktop chat retains reading width at ${width}px`);
      await orb().click();await page.waitForTimeout(400);
      check(await page.getByRole('dialog').count()===1,`narrow desktop uses an overlay instead of squeezing chat at ${width}px`);
      await page.screenshot({path:path.join(dir,`tablet-${width}-overview.png`)});
      await page.keyboard.press('Escape');await page.waitForTimeout(300);
    }
    for(const width of [320,390,430]){
      await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`chat has no horizontal overflow at ${width}px`);
      check(await orb().evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;}),`orb keeps a 44px target at ${width}px`);
      await orb().click();await page.waitForTimeout(400);
      check(await page.getByRole('dialog').count()===1,`mobile uses the shared Modal at ${width}px`);
      for(const name of ['概览','情绪','回忆','故事']){
        await page.getByRole('tab',{name,exact:true}).click();
        check(await page.getByRole('tabpanel').evaluate(el=>el.scrollWidth<=el.clientWidth),`${name} fits its ${width}px mobile panel`);
      }
      await page.getByRole('tab',{name:'概览',exact:true}).click();
      await page.screenshot({path:path.join(dir,`mobile-${width}-overview.png`)});
      if(width===390){await page.getByRole('tab',{name:'情绪',exact:true}).click();await page.screenshot({path:path.join(dir,'mobile-390-emotion.png')});}
      await page.keyboard.press('Escape');await page.waitForTimeout(300);
      check(await orb().evaluate(el=>el===document.activeElement),`dismissal restores focus to the orb at ${width}px`);
    }
    await page.setViewportSize({width:390,height:900});await page.getByRole('button',{name:'切换预览主题',exact:true}).click();await page.waitForTimeout(250);
    await orb().click();await page.waitForTimeout(400);await page.screenshot({path:path.join(dir,'mobile-light-overview.png')});
    check(await page.evaluate(()=>!document.documentElement.classList.contains('dark')),'light theme remains supported');
    await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
    check(await page.locator('.cr-orb-entry .vg-soul-orb').getAttribute('data-orb-motion')==='paused','system reduced motion stops the recorder animation');
    await orb().focus();await page.keyboard.press('Enter');await page.waitForTimeout(100);
    check(await page.getByRole('dialog').count()===1,'keyboard opening remains available with reduced motion');
    check(requests===0,'design prototype never invokes analysis or chat APIs');
    const offline=await browser.newPage({viewport:{width:390,height:900}});let external=0;
    await offline.route(/^https?:/,route=>{external++;return route.abort();});
    await offline.goto(require('node:url').pathToFileURL(path.resolve('docs/prototypes/conversation-recorder.html')).href);
    await offline.locator('.cr-orb-entry button').click();await offline.getByRole('tab',{name:'回忆',exact:true}).click();
    check(await offline.getByRole('button',{name:'查看原文',exact:true}).count()===1,'standalone preview opens and works offline');
    check(external===0,'offline preview requests no remote assets');await offline.close();
    check(errors.length===0,`no prototype runtime errors: ${errors.join('; ')}`);
    console.log(`PASS ${count} conversation recorder design checks; screenshots: ${dir}`);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
