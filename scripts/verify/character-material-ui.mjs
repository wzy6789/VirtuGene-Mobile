import { createRequire } from 'node:module';
import { dirname,join,resolve,extname,sep } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const output=`.tmp-preview/starfield-upgrade-20261017/P8d-characters/${process.env.VG_CHARACTER_MATERIAL_PHASE??'after'}-${Date.now()}`; mkdirSync(output,{recursive:true});
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
const report={checks:[],errors:[],externalBlocked:0,modelCalls:0,microphoneCalls:0,scope:'Actual App/MobileLayout with synthetic local IndexedDB; no signed-in account or Android acceptance'};
const check=async(name,run)=>{try{report.checks.push({name,pass:true,detail:await run()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});page.setDefaultTimeout(6000);
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/')&&r.request().method()==='GET')return r.continue();report.externalBlocked++;return r.abort();});
 await page.addInitScript(version=>{localStorage.setItem('virtugene:lastSeenVersion',version);localStorage.setItem('virtugene:onboarded:ui-shell-user','1');window.characterMediaAttempts=0;navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=async()=>{window.characterMediaAttempts++;throw Error('No microphone');});HTMLMediaElement.prototype.play=async()=>{window.characterMediaAttempts++;throw Error('No playback');};},version);
 await page.goto(origin+'/bootstrap?virtugene-preview=mobile');await page.evaluate(()=>window.shellSeed());
 await page.goto(origin+'/?virtugene-preview=mobile');const nav=page.getByRole('navigation',{name:'主导航'});await nav.waitFor({timeout:90000});await page.getByRole('button',{name:'稍后再说',exact:true}).click();
 await nav.getByRole('button',{name:'角色',exact:true}).click();await page.locator('.vg-character-cover').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.documentElement.dataset.vgFont==='variable');
 for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
  await page.setViewportSize({width,height:width===320?740:844});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
  for(const scale of [1,1.25,1.5]){
   await page.evaluate(async s=>{document.documentElement.style.fontSize=`${15*s}px`;document.querySelector('.vg-gallery-scroll').scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},scale);
   await check(`${theme}-${width}-${scale}: gallery, controls and names remain readable`,async()=>{
    const m=await page.locator('.vg-character-gallery').evaluate(n=>{const b=n.getBoundingClientRect(),buttons=[...n.querySelectorAll('.vg-gallery-add,.vg-character-cover-manage,.vg-gallery-shortcuts button')];return{overflow:n.scrollWidth>n.clientWidth+1,buttons:buttons.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})),font:parseFloat(getComputedStyle(n.querySelector('.vg-character-cover-copy>strong')).fontSize),right:b.right,viewport:innerWidth};});
    assert(!m.overflow&&m.right<=m.viewport+1,JSON.stringify(m));assert(m.buttons.every(b=>b.w>=44&&b.h>=44),JSON.stringify(m));assert(m.font>=(width<360?22:25)*scale-.1,JSON.stringify(m));return m;
   });
   if(scale===1.5&&(width===320||width===390))await page.screenshot({path:join(output,`${theme}-${width}-font150-gallery.png`)});
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='15px');
  await check(`${theme}-${width}: opaque shared surface and local character tint`,async()=>{const m=await page.locator('.vg-character-cover').first().evaluate(n=>{const s=getComputedStyle(n);return{background:s.backgroundColor,expected:s.getPropertyValue('--vg-elev-1').trim(),image:s.backgroundImage,shadow:s.boxShadow};});assert(!m.background.endsWith(', 0)'));assert.equal((m.image.match(/radial-gradient/g)??[]).length,1,JSON.stringify(m));assert.notEqual(m.shadow,'none');return m;});
  await page.screenshot({path:join(output,`${theme}-${width}-gallery.png`)});
 }
 const search=page.getByRole('textbox',{name:'搜索角色'});await search.fill('林间');await page.getByRole('button',{name:'打开林间的晚风的角色空间',exact:true}).waitFor();
 await check('search keeps actual matching role and excludes unrelated roles',async()=>{assert.equal(await page.getByRole('button',{name:'打开星澜的角色空间',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'打开林间的晚风的角色空间',exact:true}).count(),1);});
 await search.fill('完全不存在的名字');await page.getByRole('button',{name:'清除筛选',exact:true}).click();await page.locator('.vg-character-cover').first().waitFor();
 await page.getByRole('button',{name:'打开一个名字很长但仍然需要清晰展示的角色的角色空间',exact:true}).click();const profile=page.getByRole('dialog',{name:'角色空间',exact:true});await profile.waitFor();
 for(const theme of ['dark','light']){
  await page.setViewportSize({width:320,height:740});await page.evaluate(t=>{document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.fontSize='22.5px';},theme);
  await check(`${theme}: long identity, chat and voice stay in profile`,async()=>{assert.equal(await profile.getByRole('heading',{name:'一个名字很长但仍然需要清晰展示的角色',exact:true}).count(),1);for(const label of ['继续聊天','语音']){const b=await profile.getByRole('button',{name:label,exact:true}).boundingBox();assert(b&&b.width>=44&&b.height>=44&&b.x>=0&&b.x+b.width<=321);}assert(await profile.evaluate(n=>n.scrollWidth<=n.clientWidth+1));});
  await page.screenshot({path:join(output,`${theme}-320-font150-profile.png`)});
 }
 await page.keyboard.press('Escape');await profile.waitFor({state:'hidden'});await page.evaluate(()=>document.documentElement.style.fontSize='15px');
 await page.getByRole('button',{name:'管理星澜',exact:true}).click();const manage=page.getByRole('dialog',{name:'星澜',exact:true});await manage.waitFor();
 await check('management is a dialog with edit and delete retained',async()=>{assert.equal(await manage.getByRole('button',{name:'编辑角色',exact:true}).count(),1);assert.equal(await manage.getByRole('button',{name:'删除角色',exact:true}).count(),1);assert(await manage.evaluate(n=>n.getBoundingClientRect().height<innerHeight*.85));});
 await page.keyboard.press('Escape');await manage.waitFor({state:'hidden'});
 await check('mobile navigation, related tools and isolation remain intact',async()=>{assert.equal(await page.locator('.mobile-layout').count(),1);for(const name of ['关系星图','角色群聊','打开生活助理'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),1);assert.equal(report.externalBlocked,0);assert.equal(await page.evaluate(()=>window.characterMediaAttempts),0);});
}catch(e){report.errors.push(String(e));}
finally{await browser.close();await new Promise(r=>server.close(r));report.pass=report.errors.length===0&&report.checks.every(c=>c.pass);writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors,pass:report.pass}));if(!report.pass)process.exitCode=1;}
