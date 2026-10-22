import { createRequire } from 'node:module';
import { dirname,join,resolve,extname,sep } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const output=process.env.VG_UI_EVIDENCE??'.tmp-preview/ui-shell-20261013'; mkdirSync(output,{recursive:true});
const seed=await build({entryPoints:['scripts/verify/ui-shell-seed.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.webp':'dataurl','.png':'dataurl','.css':'empty'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:JSON.stringify(version)}});
const root=resolve('dist/renderer');
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/bootstrap') {res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<html><body><script>${seed.outputFiles[0].text}</script></body></html>`);return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
let checks=0,external=0; const errors=[],evidence=[];
try {
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin&&!url.pathname.startsWith('/api/')&&route.request().method()==='GET')return route.continue();external++;return route.abort();});
  await page.addInitScript(version=>{localStorage.setItem('virtugene:lastSeenVersion',version); localStorage.setItem('virtugene:onboarded:ui-shell-user','1');},version);
  await page.goto(`${origin}/bootstrap?virtugene-preview=mobile`);
  await page.evaluate(()=>window.shellSeed());
  await page.goto(`${origin}/?virtugene-preview=mobile`,{waitUntil:'domcontentloaded',timeout:30000});
  const nav=page.getByRole('navigation',{name:'主导航'}); await nav.waitFor({timeout:90000});
  await page.getByRole('button',{name:'稍后再说',exact:true}).click();
  await page.getByRole('button',{name:'稍后再说',exact:true}).waitFor({state:'hidden'});
  // Simulate both Capacitor routes: native-inset WebView reports 0; an
  // edge-to-edge WebView reports the remaining status-bar/cutout height.
  for (const inset of [0,24,32,48]) {
    const metrics=await page.evaluate(inset=>{
      document.documentElement.style.setProperty('--safe-area-inset-top',`${inset}px`);
      const layout=document.querySelector('.mobile-layout'),host=layout.querySelector(':scope > [data-soul-host]');
      return {padding:parseFloat(getComputedStyle(host).paddingTop),bar:layout.querySelector('.mobile-statusbar').getBoundingClientRect().height,
        contentTop:host.querySelector(':scope > main').getBoundingClientRect().top-layout.getBoundingClientRect().top};
    },inset);
    assert.equal(metrics.padding,inset);assert.equal(metrics.bar,inset);assert.equal(metrics.contentTop,inset);checks++;
    evidence.push({page:'top-safe-area',inset,metrics});
  }
  await page.evaluate(()=>document.documentElement.style.removeProperty('--safe-area-inset-top'));
  for(const theme of ['dark','light']) for(const width of [320,390,430]) {
    await page.setViewportSize({width,height:844});
    await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
    for(const label of ['消息','世界','角色','我的']) {
      await nav.getByRole('button',{name:label,exact:true}).click();
      await page.waitForTimeout(400);
      assert.equal(await nav.getByRole('button',{name:label,exact:true}).getAttribute('aria-current'),'page'); checks++;
      const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,targets:[...document.querySelectorAll('.vg-nav-tab')].map(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,font:parseFloat(getComputedStyle(el.lastElementChild).fontSize)};})}));
      assert.ok(!metrics.overflow && metrics.targets.length===4 && metrics.targets.every(t=>t.width>=48 && t.height>=48 && t.font>=12)); checks++;
      const file=`${output}/${theme}-${width}-${label}.png`; await page.screenshot({path:file}); evidence.push({theme,width,page:label,file,metrics});
    }
    await page.locator('.vg-personal').getByRole('button',{name:'设置',exact:true}).click();
    const dialog=page.locator('[role="dialog"].vg-settings-panel'); await dialog.waitFor();
    await dialog.locator('.vg-settings-overview').waitFor();
    assert.ok(await dialog.locator('.vg-preference-row').count()>0); checks++;
    const settingsFile=`${output}/${theme}-${width}-设置.png`; await page.screenshot({path:settingsFile}); evidence.push({theme,width,page:'设置',file:settingsFile});
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
    await page.locator('.vg-personal').getByRole('button',{name:/外观与阅读/}).click();
    await dialog.waitFor(); await dialog.getByText('页面主题',{exact:true}).first().waitFor();
    assert.equal(await dialog.getByRole('radiogroup',{name:'页面主题',exact:true}).getByRole('radio').count(),3); checks++;
    assert.ok(await dialog.locator('.vg-settings-font-ruler').count()===1); checks++;
    const appearanceFile=`${output}/${theme}-${width}-外观.png`; await page.screenshot({path:appearanceFile}); evidence.push({theme,width,page:'外观',file:appearanceFile});
    await page.keyboard.press('Escape'); await dialog.locator('.vg-settings-overview').waitFor(); checks++;
    await dialog.getByRole('button',{name:'返回',exact:true}).click(); await dialog.waitFor({state:'hidden'});
    await nav.getByRole('button',{name:'消息',exact:true}).click();
    await page.locator('button.vg-conversation-row').filter({hasText:'星澜'}).click();
    await page.locator('.chat-header').waitFor();
    const chat=page.getByRole('region',{name:'聊天记录'}); await chat.locator('.vg-message-audio').waitFor();
    const chatMetrics=await chat.evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,font:parseFloat(getComputedStyle(el.querySelector('.vg-message-bubble')).fontSize),audioHeight:el.querySelector('.vg-message-audio').getBoundingClientRect().height}));
    await page.screenshot({path:`${output}/${theme}-${width}-聊天.png`});
    assert.ok(!chatMetrics.overflow && chatMetrics.font>=15 && chatMetrics.audioHeight>=44,JSON.stringify(chatMetrics)); checks++;
    const frame=await page.locator('.chat-header').evaluate(el=>{const r=el.getBoundingClientRect(),parents=[];for(let p=el.parentElement;p;p=p.parentElement){parents.push({class:p.className,height:p.clientHeight,scroll:p.scrollTop,top:p.getBoundingClientRect().top});}return{top:r.top,height:r.height,parents};});
    assert.ok(frame.top>=0 && frame.top+frame.height<=844,JSON.stringify(frame)); checks++;
    assert.ok(await chat.getByRole('button',{name:'播放语音消息'}).count()===1); checks++;
    const chatFile=`${output}/${theme}-${width}-聊天.png`; await page.screenshot({path:chatFile}); evidence.push({theme,width,page:'聊天',file:chatFile,metrics:chatMetrics});
    await page.locator('.chat-header').getByRole('button',{name:'返回',exact:true}).click(); await nav.waitFor();
    await nav.getByRole('button',{name:'世界',exact:true}).click();
    await page.getByRole('button',{name:'待办',exact:true}).click();
    await page.locator('.vg-todo-row').first().waitFor();
    const todoMetrics=await page.locator('.vg-todo-page').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,targets:[...el.querySelectorAll('.vg-todo-check')].map(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height};})}));
    assert.ok(!todoMetrics.overflow && todoMetrics.targets.length===3 && todoMetrics.targets.every(t=>t.width>=44&&t.height>=44),JSON.stringify(todoMetrics)); checks++;
    const todoFile=`${output}/${theme}-${width}-待办.png`; await page.screenshot({path:todoFile}); evidence.push({theme,width,page:'待办',file:todoFile,metrics:todoMetrics});
    await page.getByRole('button',{name:'返回世界',exact:true}).click();
    await page.getByRole('button',{name:'朋友圈',exact:true}).click();
    await page.locator('.vg-moment-text').first().waitFor();
    const momentsFile=`${output}/${theme}-${width}-朋友圈.png`; await page.screenshot({path:momentsFile}); evidence.push({theme,width,page:'朋友圈',file:momentsFile});
    assert.ok(await page.getByRole('button',{name:'发布动态',exact:true}).count()===1); checks++;
    await page.getByRole('button',{name:'发布动态',exact:true}).click();
    const composer=page.getByRole('dialog',{name:'发布动态',exact:true}); await composer.waitFor();
    await composer.getByPlaceholder('此刻想留下什么？').fill('只检查排版与颜色，不发布这条动态。');
    const publish=await composer.getByRole('button',{name:'发布',exact:true}).evaluate(el=>{
      const style=getComputedStyle(el),luma=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
      const a=luma(style.color),b=luma(style.backgroundColor);return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),height:el.getBoundingClientRect().height,image:style.backgroundImage};
    });
    assert.ok(publish.ratio>=4.5 && publish.height>=44 && publish.image==='none',JSON.stringify(publish)); checks++;
    const composerFile=`${output}/${theme}-${width}-发布动态.png`; await page.screenshot({path:composerFile}); evidence.push({theme,width,page:'发布动态',file:composerFile,metrics:publish});
    await page.keyboard.press('Escape'); await composer.waitFor({state:'hidden'});
    await nav.getByRole('button',{name:'消息',exact:true}).click();
  }
  assert.deepEqual(errors,[]); checks++;
  writeFileSync(`${output}/result.json`,JSON.stringify({checks,errors,externalBlocked:external,realModelCalls:0,deviceTested:false,evidence},null,2));
  console.log(JSON.stringify({checks,errors,externalBlocked:external,realModelCalls:0,deviceTested:false}));
} catch(error) {writeFileSync(`${output}/failure.json`,JSON.stringify({error:String(error),errors},null,2));throw error;}
finally{await browser.close();await new Promise(ok=>server.close(ok));}
