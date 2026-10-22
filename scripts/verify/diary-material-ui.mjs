import { createRequire } from 'node:module';
import { dirname,join,resolve,extname,sep } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const output=process.env.VG_DIARY_MATERIAL_OUT??`.tmp-preview/starfield-upgrade-20261017/P8f-diary/${process.env.VG_DIARY_MATERIAL_PHASE??'after'}-${Date.now()}`; mkdirSync(output,{recursive:true});
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
const report={checks:[],errors:[],externalBlocked:0,scope:'Actual App/MobileLayout with synthetic local IndexedDB; no model, microphone, export/import, share or Android'};
const check=async(name,fn)=>{try{report.checks.push({name,pass:true,detail:await fn()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/')&&r.request().method()==='GET')return r.continue();report.externalBlocked++;return r.abort();});
 await page.addInitScript(version=>{localStorage.setItem('virtugene:lastSeenVersion',version);localStorage.setItem('virtugene:onboarded:ui-shell-user','1');window.diaryMediaAttempts=0;navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=async()=>{window.diaryMediaAttempts++;throw Error('No capture');});HTMLMediaElement.prototype.play=async()=>{window.diaryMediaAttempts++;throw Error('No playback');};},version);
 await page.goto(origin+'/bootstrap?virtugene-preview=mobile');await page.evaluate(()=>window.shellSeed());await page.goto(origin+'/?virtugene-preview=mobile');const nav=page.getByRole('navigation',{name:'主导航'});await nav.waitFor({timeout:90000});await page.getByRole('button',{name:'稍后再说',exact:true}).click();await nav.getByRole('button',{name:'世界',exact:true}).click();await page.getByRole('button',{name:'日记',exact:true}).click();const diary=page.locator('.vg-diary').first();await diary.getByRole('heading',{name:'日记',exact:true}).waitFor();await diary.getByRole('status',{name:'正在唤醒日记'}).waitFor({state:'hidden'});await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.documentElement.dataset.vgFont==='variable');
 for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
  await page.setViewportSize({width,height:width===320?740:844});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
  for(const scale of [1,1.25,1.5]){
   await page.evaluate(async s=>{document.documentElement.style.fontSize=`${15*s}px`;document.querySelector('.vg-diary-index-scroll').scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},scale);
   await check(`${theme}-${width}-${scale}: stats, view tabs and search fit without shrinking targets`,async()=>{const m=await diary.evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,font:parseFloat(getComputedStyle(n.querySelector('.vg-diary-stats span')).fontSize),targets:[...n.querySelectorAll('.vg-diary-header button,.vg-diary-index-views button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})),}));assert(!m.overflow&&m.font>=13*scale-.1,JSON.stringify(m));assert(m.targets.every(b=>b.w>=44&&b.h>=44),JSON.stringify(m));return m;});
   if(scale===1&&(width===320||width===390)||scale===1.5&&width===320)await page.screenshot({path:join(output,`${theme}-${width}-index-font${scale*100}.png`)});
  }
 }
 await page.evaluate(()=>document.documentElement.style.fontSize='15px');await page.setViewportSize({width:390,height:844});await diary.getByRole('button',{name:'写日记',exact:true}).click();const input=page.getByRole('textbox',{name:'写下日记片段',exact:true});await input.waitFor();const text='傍晚的风穿过窗台，我把今天想记住的小事写在这里。长段落也需要安静、清晰地展示。';await input.fill(text);await page.getByRole('button',{name:'保存日记片段',exact:true}).click();await page.locator('.vg-diary-segment').filter({hasText:text}).waitFor();await input.filter({hasText:''}).waitFor();
 await check('real diary write completes and clears only the saved input',async()=>assert.equal(await input.inputValue(),''));
 for(const theme of ['dark','light'])for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
  await check(`${theme}-${width}: segment and composer use opaque reading surfaces`,async()=>{const m=await page.locator('.vg-diary-segment').last().evaluate(n=>{const s=getComputedStyle(n);return{image:s.backgroundImage,color:s.color,background:s.backgroundColor};});assert.equal(m.image,'none');assert(!m.background.endsWith(', 0)'));const button=await page.getByRole('button',{name:'保存日记片段',exact:true}).boundingBox();assert(button&&button.width>=44&&button.height>=44);return m;});
  await page.screenshot({path:join(output,`${theme}-${width}-writer.png`)});
  await page.getByRole('button',{name:'日记视图',exact:true}).click();await page.locator('.vg-diary-paper').waitFor();
  await page.evaluate(async()=>{document.documentElement.style.fontSize='22.5px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await check(`${theme}-${width}: reading paper remains matte and long paragraphs reflow`,async()=>{const m=await page.locator('.vg-diary-paper').evaluate(n=>({image:getComputedStyle(n).backgroundImage,overflow:n.scrollWidth>n.clientWidth+1,content:n.textContent}));assert.equal(m.image,'none');assert(!m.overflow);assert(m.content.includes(text));return{image:m.image,overflow:m.overflow};});await page.screenshot({path:join(output,`${theme}-${width}-reading-font150.png`)});
  await page.evaluate(()=>document.documentElement.style.fontSize='15px');await page.getByRole('button',{name:'回到写作',exact:true}).click();await input.waitFor();
 }
 await page.getByRole('button',{name:'删除这一天',exact:true}).click();const confirm=page.getByRole('dialog',{name:'弹窗',exact:true});await confirm.getByRole('button',{name:'确认删除',exact:true}).waitFor();await check('deletion remains a cancelable centered confirmation with recovery explanation',async()=>{assert(await confirm.getByText(/7 天内可以恢复/).count());const b=await confirm.boundingBox();assert(b&&b.height<500);});await confirm.getByRole('button',{name:'取消',exact:true}).click();await confirm.waitFor({state:'hidden'});
 await check('cancelling deletion preserves content and no model/media requests occurred',async()=>{assert.equal(await page.locator('.vg-diary-segment').filter({hasText:text}).count(),1);assert.equal(report.externalBlocked,0);assert.equal(await page.evaluate(()=>window.diaryMediaAttempts),0);assert.equal(await page.locator('.mobile-layout').count(),1);});
 const longTitle='把这一段很长很长的日记标题完整地保留下来，不让它挤出手机屏幕。'.repeat(3)+' UnbrokenTitleWithoutSpacesForWrapping';
 await page.evaluate(({text,title})=>new Promise((resolve,reject)=>{const request=indexedDB.open('virtugene');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('diaries','readwrite'),store=tx.objectStore('diaries'),rows=store.index('userId').getAll('ui-shell-user');rows.onsuccess=()=>{const row=rows.result.find(d=>d.content.includes(text));if(!row){tx.abort();return;}store.put({...row,title});};tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>{db.close();reject(Error('Synthetic diary not found'));};};}),{text,title:longTitle});
 await page.reload();await nav.waitFor();const later=page.getByRole('button',{name:'稍后再说',exact:true});if(await later.count())await later.click();await nav.getByRole('button',{name:'世界',exact:true}).click();await page.getByRole('button',{name:'日记',exact:true}).click();await diary.getByRole('heading',{name:'日记',exact:true}).waitFor();await diary.getByRole('status',{name:'正在唤醒日记'}).waitFor({state:'hidden'});await diary.getByRole('button',{name:'时间线',exact:true}).click();await diary.getByText(longTitle,{exact:true}).click();await page.getByRole('button',{name:'日记视图',exact:true}).click();await page.locator('.vg-diary-paper').waitFor();
 for(const theme of ['dark','light']){
  await page.setViewportSize({width:320,height:740});await page.evaluate(async t=>{document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.fontSize='22.5px';await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},theme);
  await check(`${theme}: full long title and unbroken words reflow at 320px and 150%`,async()=>{const title=page.locator('.vg-diary-paper h1');assert.equal(await title.textContent(),longTitle);assert(await title.evaluate(n=>n.scrollWidth<=n.clientWidth+1));});await page.screenshot({path:join(output,`${theme}-320-long-title-font150.png`)});
 }
}catch(e){report.errors.push(String(e));try{const p=browser.contexts()[0]?.pages()[0];if(p){await p.screenshot({path:join(output,'failure.png')});report.failureText=(await p.locator('body').innerText()).slice(0,3000);}}catch{}}
finally{await browser.close();await new Promise(r=>server.close(r));report.pass=report.errors.length===0&&report.checks.every(c=>c.pass);writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1;}
