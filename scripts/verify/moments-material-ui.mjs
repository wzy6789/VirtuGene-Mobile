import { createRequire } from 'node:module';
import { dirname,join,resolve,extname,sep } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const output=process.env.VG_MOMENTS_MATERIAL_OUT??`.tmp-preview/starfield-upgrade-20261017/P8f-moments/${process.env.VG_MOMENTS_MATERIAL_PHASE??'after'}-${Date.now()}`; mkdirSync(output,{recursive:true});
const seed=await build({stdin:{contents:"import './scripts/verify/ui-shell-seed';import{db}from'./src/db';const original=window.shellSeed;window.shellSeed=async()=>{await original();await db.open();await db.moments.update('ui-shell-moment',{visibility:'private'});const now=Date.now();await db.momentReactions.bulkPut([{id:'ui-moment-comment',userId:'ui-shell-user',momentId:'ui-shell-moment',type:'comment',content:'这是一段留给自己的互动记录，长一点也要清晰地读下去。',status:'active',createdAt:now,updatedAt:now},{id:'ui-moment-like',userId:'ui-shell-user',momentId:'ui-shell-moment',type:'like',status:'active',createdAt:now,updatedAt:now}]);db.close();};",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.webp':'dataurl','.png':'dataurl','.css':'empty'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:JSON.stringify(version)}});
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
const report={checks:[],errors:[],externalBlocked:0,scope:'Actual App/MobileLayout, synthetic private post and self reactions; no model, microphone, real account, upload or Android'};
const check=async(name,fn)=>{try{report.checks.push({name,pass:true,detail:await fn()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/')&&r.request().method()==='GET')return r.continue();report.externalBlocked++;return r.abort();});
 await page.addInitScript(version=>{localStorage.setItem('virtugene:lastSeenVersion',version);localStorage.setItem('virtugene:onboarded:ui-shell-user','1');window.momentsMediaAttempts=0;navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=async()=>{window.momentsMediaAttempts++;throw Error('No capture');});HTMLMediaElement.prototype.play=async()=>{window.momentsMediaAttempts++;throw Error('No playback');};},version);
 await page.goto(origin+'/bootstrap?virtugene-preview=mobile');await page.evaluate(()=>window.shellSeed());await page.goto(origin+'/?virtugene-preview=mobile');const nav=page.getByRole('navigation',{name:'主导航'});await nav.waitFor({timeout:90000});await page.getByRole('button',{name:'稍后再说',exact:true}).click();await nav.getByRole('button',{name:'世界',exact:true}).click();await page.getByRole('button',{name:'朋友圈',exact:true}).click();await page.locator('.vg-moment-text').waitFor();await page.locator('.vg-moment-comment-row').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.documentElement.dataset.vgFont==='variable');
 const feed=page.locator('.vg-moments-page');
 for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
  await page.setViewportSize({width,height:width===320?740:844});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
  for(const scale of [1,1.25,1.5]){
   await page.evaluate(async s=>{document.documentElement.style.fontSize=`${15*s}px`;document.querySelector('.vg-moments-page').scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},scale);
   await check(`${theme}-${width}-${scale}: profile and post/comment text reflow with stable controls`,async()=>{const m=await feed.evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,font:parseFloat(getComputedStyle(n.querySelector('.vg-moment-text')).fontSize),commentFont:parseFloat(getComputedStyle(n.querySelector('.vg-moment-comment-row')).fontSize),controls:[...n.querySelectorAll('.vg-moments-header button,.vg-moment-bubble')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))}));assert(!m.overflow&&m.font>=15*scale-.1&&m.commentFont>=14*scale-.1,JSON.stringify(m));assert(m.controls.every(b=>b.w>=44&&b.h>=44),JSON.stringify(m));return m;});
   if(scale===1&&(width===320||width===390)||scale===1.5&&width===320)await page.screenshot({path:join(output,`${theme}-${width}-feed-font${scale*100}.png`)});
  }
  await check(`${theme}-${width}: identity and interaction use opaque neutral surfaces`,async()=>{const m=await feed.evaluate(n=>['.vg-moments-profile-row','.vg-moment-thread'].map(selector=>{const s=getComputedStyle(n.querySelector(selector));return{selector,image:s.backgroundImage,color:s.backgroundColor,filter:s.backdropFilter};}));for(const s of m){assert.equal(s.image,'none');assert(!s.color.endsWith(', 0)'));assert.equal(s.filter,'none');}return m;});
 }
 await page.evaluate(()=>document.documentElement.style.fontSize='15px');await page.setViewportSize({width:320,height:740});await feed.getByRole('button',{name:'展开朋友圈封面',exact:true}).click();await feed.getByRole('button',{name:'更换封面',exact:true}).waitFor();await check('cover expansion and existing replacement entry remain reachable',async()=>assert.equal(await feed.getByRole('button',{name:'收起朋友圈封面',exact:true}).getAttribute('aria-expanded'),'true'));await feed.getByRole('button',{name:'收起朋友圈封面',exact:true}).click();
 await feed.getByRole('button',{name:'赞或评论',exact:true}).click();await feed.getByRole('menuitem',{name:'评论',exact:true}).click();const comment=feed.getByRole('textbox',{name:'评论内容',exact:true});await comment.fill('这是一条未发送的评论草稿');await check('comment field preserves draft and fits narrow viewport',async()=>{assert.equal(await comment.inputValue(),'这是一条未发送的评论草稿');const b=await comment.boundingBox();assert(b&&b.width>44&&b.x>=0&&b.x+b.width<=321);});
 for(const theme of ['dark','light']){
  await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await feed.getByRole('button',{name:'发布动态',exact:true}).click();const composer=page.getByRole('dialog',{name:'发布动态',exact:true});await composer.waitFor();await composer.getByPlaceholder('此刻想留下什么？').fill('这段只检查排版，不发布。'.repeat(16));
  await page.evaluate(async()=>{document.documentElement.style.fontSize='22.5px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await check(`${theme}: composer, audience choices and publish target fit enlarged text`,async()=>{assert(await composer.evaluate(n=>n.scrollWidth<=n.clientWidth+1));for(const name of ['全部角色','部分可见','不给谁看','仅自己','发布']){const b=await composer.getByRole('button',{name,exact:true}).boundingBox();assert(b&&b.width>=44&&b.height>=44,JSON.stringify({name,b}));}const field=await composer.locator('textarea').evaluate(n=>{const s=getComputedStyle(n);return{radius:parseFloat(s.borderRadius),outline:parseFloat(s.outlineWidth),outlineStyle:s.outlineStyle,outlineColor:s.outlineColor,focusVisible:n.matches(':focus-visible'),forced:matchMedia('(forced-colors:active)').matches,shadow:s.boxShadow,focus:n===document.activeElement};});assert(field.focus&&field.radius>=12&&field.outlineStyle==='none'&&field.shadow!=='none',JSON.stringify(field));});await page.screenshot({path:join(output,`${theme}-320-composer-font150.png`)});await page.keyboard.press('Escape');await composer.waitFor({state:'hidden'});await page.evaluate(()=>document.documentElement.style.fontSize='15px');
 }
 await check('mobile shell and model/media isolation preserved',async()=>{assert.equal(await page.locator('.mobile-layout').count(),1);assert.equal(await page.evaluate(()=>window.momentsMediaAttempts),0);assert.equal(report.externalBlocked,0);});
}catch(e){report.errors.push(String(e));}
finally{await browser.close();await new Promise(r=>server.close(r));report.pass=report.errors.length===0&&report.checks.every(c=>c.pass);writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1;}
