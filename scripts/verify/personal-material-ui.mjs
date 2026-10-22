import { createRequire } from 'node:module';
import { dirname,join,resolve,extname,sep } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const output=`.tmp-preview/starfield-upgrade-20261017/P8d-personal/${process.env.VG_PERSONAL_MATERIAL_PHASE??'after'}-${Date.now()}`; mkdirSync(output,{recursive:true});
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
const report={checks:[],errors:[],externalBlocked:0,scope:'Actual App/MobileLayout with synthetic IndexedDB; no real model, update download, microphone or Android.'};
const check=async(name,fn)=>{try{report.checks.push({name,pass:true,detail:await fn()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/')&&r.request().method()==='GET')return r.continue();report.externalBlocked++;return r.abort();});
 await page.addInitScript(version=>{localStorage.setItem('virtugene:lastSeenVersion',version);localStorage.setItem('virtugene:onboarded:ui-shell-user','1');window.personalMediaAttempts=0;navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=async()=>{window.personalMediaAttempts++;throw Error('No capture');});HTMLMediaElement.prototype.play=async()=>{window.personalMediaAttempts++;throw Error('No playback');};},version);
 await page.goto(origin+'/bootstrap?virtugene-preview=mobile');await page.evaluate(()=>window.shellSeed());await page.goto(origin+'/?virtugene-preview=mobile');const nav=page.getByRole('navigation',{name:'主导航'});await nav.waitFor({timeout:90000});await page.getByRole('button',{name:'稍后再说',exact:true}).click();await nav.getByRole('button',{name:'我的',exact:true}).click();
 const personal=page.locator('.vg-personal-space');await personal.waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.documentElement.dataset.vgFont==='variable');
 for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
  await page.setViewportSize({width,height:width===320?740:844});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
  for(const scale of [1,1.25,1.5]){
   await page.evaluate(async s=>{document.documentElement.style.fontSize=`${15*s}px`;document.querySelector('.vg-personal-space').scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},scale);
   await check(`${theme}-${width}-${scale}: readable text, stable targets and scroll access`,async()=>{
    const m=await personal.evaluate(n=>{const text=n.querySelector('.vg-personal-identity strong');return{overflow:n.scrollWidth>n.clientWidth+1,font:parseFloat(getComputedStyle(text).fontSize),targets:[...n.querySelectorAll(':scope>button,.vg-personal-links>button')].map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})),scrollHeight:n.scrollHeight,height:n.clientHeight};});assert(!m.overflow,JSON.stringify(m));assert(m.font>=22*scale-.1,JSON.stringify(m));assert(m.targets.every(b=>b.w>=44&&b.h>=44),JSON.stringify(m));await personal.getByRole('button',{name:'断开灵魂链接',exact:true}).scrollIntoViewIfNeeded();const b=await personal.getByRole('button',{name:'断开灵魂链接',exact:true}).boundingBox(),n=await nav.boundingBox();assert(b&&n&&b.y+b.height<=n.y+1,JSON.stringify({b,n}));await personal.evaluate(n=>n.scrollTop=0);return m;
   });
   if(scale===1||scale===1.5)await page.screenshot({path:join(output,`${theme}-${width}-font${scale*100}.png`)});
  }
  await check(`${theme}-${width}: matte profile, review and preferences share elevation`,async()=>{const m=await personal.evaluate(n=>['.vg-personal-identity','.vg-personal-weekly','.vg-personal-links'].map(selector=>{const s=getComputedStyle(n.querySelector(selector));return{selector,image:s.backgroundImage,color:s.backgroundColor,shadow:s.boxShadow};}));for(const s of m){assert.equal(s.image,'none',JSON.stringify(s));assert(!s.color.endsWith(', 0)'),JSON.stringify(s));}return m;});
 }
 await page.evaluate(()=>document.documentElement.style.fontSize='15px');await page.setViewportSize({width:390,height:844});
 for(const [label,title] of [['AI 连接','AI 连接'],['设置','设置'],['外观与阅读','外观与阅读']]){
  await personal.getByRole('button',{name:new RegExp('^'+label)}).click();const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();await check(`settings route retained: ${label}`,async()=>assert.equal(await dialog.count(),1));await page.keyboard.press('Escape');if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 }
 await personal.getByRole('button',{name:'断开灵魂链接',exact:true}).click();const logout=page.getByRole('dialog',{name:'断开灵魂链接？',exact:true});await logout.waitFor();await check('disconnect is a centered confirmation and explains retained records',async()=>{assert(await logout.getByText(/本地数据/).count());const b=await logout.boundingBox();assert(b&&b.height<500);assert.equal(await logout.getByRole('button',{name:'确认断开',exact:true}).count(),1);});await logout.getByRole('button',{name:'取消',exact:true}).click();await logout.waitFor({state:'hidden'});
 await check('cancel preserves personal identity, mobile layout and media isolation',async()=>{assert.equal(await personal.getByText('星域旅人',{exact:true}).count(),1);assert.equal(await page.locator('.mobile-layout').count(),1);assert.equal(await page.evaluate(()=>window.personalMediaAttempts),0);assert.equal(report.externalBlocked,0);});
}catch(e){report.errors.push(String(e));}
finally{await browser.close();await new Promise(r=>server.close(r));report.pass=report.errors.length===0&&report.checks.every(c=>c.pass);writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1;}
