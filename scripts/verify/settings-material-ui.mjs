import { createRequire } from 'node:module';
import { dirname,join,resolve,extname,sep } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const output=`.tmp-preview/starfield-upgrade-20261017/P8e-settings/${process.env.VG_SETTINGS_MATERIAL_PHASE??'after'}-${Date.now()}`; mkdirSync(output,{recursive:true});
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
const report={checks:[],errors:[],externalBlocked:0,scope:'Actual App/MobileLayout, synthetic local records, no models/microphone/downloads/Android'};
const check=async(name,fn)=>{try{report.checks.push({name,pass:true,detail:await fn()});}catch(e){report.checks.push({name,pass:false,error:String(e)});}};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/')&&r.request().method()==='GET')return r.continue();report.externalBlocked++;return r.abort();});
 await page.addInitScript(version=>{localStorage.setItem('virtugene:lastSeenVersion',version);localStorage.setItem('virtugene:onboarded:ui-shell-user','1');window.settingsMediaAttempts=0;navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=async()=>{window.settingsMediaAttempts++;throw Error('No capture');});HTMLMediaElement.prototype.play=async()=>{window.settingsMediaAttempts++;throw Error('No playback');};},version);
 await page.goto(origin+'/bootstrap?virtugene-preview=mobile');await page.evaluate(()=>window.shellSeed());await page.goto(origin+'/?virtugene-preview=mobile');const nav=page.getByRole('navigation',{name:'主导航'});await nav.waitFor({timeout:90000});await page.getByRole('button',{name:'稍后再说',exact:true}).click();await nav.getByRole('button',{name:'我的',exact:true}).click();await page.locator('.vg-personal-space').getByRole('button',{name:'设置',exact:true}).click();
 const home=()=>page.getByRole('dialog',{name:'设置',exact:true});await home().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.documentElement.dataset.vgFont==='variable');
 for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
  await page.setViewportSize({width,height:width===320?740:844});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
  for(const view of ['设置','AI 连接','外观与阅读']){
   if(view!=='设置')await home().getByRole('button').filter({hasText:view}).click();const dialog=page.getByRole('dialog',{name:view,exact:true});await dialog.waitFor();
   for(const scale of [1,1.25,1.5]){
    await page.evaluate(async s=>{document.documentElement.style.fontSize=`${15*s}px`;document.querySelector('.vg-settings-panel [data-modal-scroll]').scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},scale);
    await check(`${theme}-${width}-${view}-${scale}: inner content and header targets fit`,async()=>{
     const m=await dialog.evaluate(n=>{const inner=n.querySelector('.vg-settings-design'),content=n.querySelector('.vg-settings-detail'),scroller=n.querySelector('[data-modal-scroll]'),r=content.getBoundingClientRect(),s=scroller.getBoundingClientRect();return{overflow:inner.scrollWidth>inner.clientWidth+1,right:r.right,left:r.left,scrollRight:s.right,scrollLeft:s.left,headerFont:parseFloat(getComputedStyle(n.querySelector('.vg-page-header h2')).fontSize),font:parseFloat(getComputedStyle(n.querySelector('.vg-preference-copy strong')).fontSize),buttons:[...n.querySelectorAll(':scope>div:first-child>button')].map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))};});assert(!m.overflow&&m.right<=m.scrollRight+1&&m.left>=m.scrollLeft-1,JSON.stringify(m));assert(m.headerFont>=17*scale-.1,JSON.stringify(m));assert(m.buttons.every(b=>b.w>=44&&b.h>=44),JSON.stringify(m));assert(m.font>=(width<=350?14:16)*scale-.1,JSON.stringify(m));return m;
    });
    if(scale===1&&(width===390||width===320)||scale===1.5&&width===320)await page.screenshot({path:join(output,`${theme}-${width}-${view}-font${scale*100}.png`)});
   }
   if(view==='AI 连接')await check(`${theme}-${width}: model summary uses opaque shared material`,async()=>{const m=await dialog.locator('.vg-settings-model-summary').evaluate(n=>{const s=getComputedStyle(n);return{image:s.backgroundImage,color:s.backgroundColor,shadow:s.boxShadow,top:getComputedStyle(n,'::before').backgroundImage};});assert.equal(m.image,'none');assert.equal(m.top,'none');assert(!m.color.endsWith(', 0)'));assert.notEqual(m.shadow,'none');return m;});
   await page.evaluate(()=>document.documentElement.style.fontSize='15px');if(view!=='设置'){await page.getByRole('button',{name:'返回设置',exact:true}).click();await home().waitFor();}
  }
 }
 await check('all original settings categories and search remain available',async()=>{for(const title of ['个人与账号','聊天与语音','内容与隐私','数据与设备','关于与更新'])assert.equal(await home().getByRole('button').filter({hasText:title}).count(),1);assert.equal(await home().getByRole('searchbox',{name:'搜索设置'}).count(),1);});
 const search=home().getByRole('searchbox',{name:'搜索设置'});await search.fill('不存在的设置');await home().getByRole('status').filter({hasText:'没有找到'}).waitFor();await search.fill('密钥');await home().getByRole('button').filter({hasText:'服务商密钥'}).click();await page.getByRole('dialog',{name:'服务商密钥',exact:true}).waitFor();await page.getByRole('button',{name:'返回设置',exact:true}).click();await home().waitFor();
 await home().getByRole('searchbox').fill('');
 for(const theme of ['dark','light'])for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await home().getByRole('button').filter({hasText:'AI 连接'}).click();await page.getByRole('dialog',{name:'AI 连接',exact:true}).getByRole('button').filter({hasText:'服务商密钥'}).click();const providers=page.getByRole('dialog',{name:'服务商密钥',exact:true});await providers.getByRole('button',{name:'配置 OpenAI',exact:true}).waitFor();
  await page.evaluate(async()=>{document.documentElement.style.fontSize='22.5px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await check(`${theme}-${width}: enlarged provider directory fits without clipped role names`,async()=>{const m=await providers.locator('.vg-provider-directory').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,font:parseFloat(getComputedStyle(n.querySelector('strong')).fontSize)}));assert(!m.overflow&&m.font>=21-.1,JSON.stringify(m));return m;});
  await page.screenshot({path:join(output,`${theme}-${width}-providers-font150.png`)});await page.evaluate(()=>document.documentElement.style.fontSize='15px');await providers.getByRole('button',{name:'配置 OpenAI',exact:true}).click();
  for(const scale of [1,1.5]){
   await page.evaluate(async s=>{document.documentElement.style.fontSize=`${15*s}px`;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},scale);
   await check(`${theme}-${width}-${scale}: provider editor keeps readable labels, fields and save action`,async()=>{const m=await providers.evaluate(n=>{const content=n.querySelector('.vg-provider-editor'),label=n.querySelector('.vg-provider-field>span');return{overflow:content.scrollWidth>content.clientWidth+1,font:parseFloat(getComputedStyle(label).fontSize)};});assert(!m.overflow&&m.font>=13*scale-.1,JSON.stringify(m));assert.equal(await providers.getByRole('textbox',{name:'API 根地址',exact:true}).count(),1);assert.equal(await providers.locator('input[aria-label="OpenAI API Key"]').count(),1);return m;});
   await page.screenshot({path:join(output,`${theme}-${width}-provider-font${scale*100}.png`)});
   await providers.getByRole('textbox',{name:'API 根地址',exact:true}).scrollIntoViewIfNeeded();
   await check(`${theme}-${width}-${scale}: explanations and actions do not cover the focused API field`,async()=>{const field=await providers.getByRole('textbox',{name:'API 根地址',exact:true}).boundingBox(),actions=await providers.locator('.vg-provider-actions').boundingBox();assert(field&&actions&&(field.y+field.height<=actions.y||actions.y+actions.height<=field.y),JSON.stringify({field,actions}));});
   await providers.getByRole('button',{name:'保存配置',exact:true}).scrollIntoViewIfNeeded();
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='15px');await page.getByRole('button',{name:'返回设置',exact:true}).click();await providers.getByRole('button',{name:'配置 OpenAI',exact:true}).waitFor();await page.getByRole('button',{name:'返回设置',exact:true}).click();const connection=page.getByRole('dialog',{name:'AI 连接',exact:true});await connection.waitFor();await connection.getByRole('button',{name:'选择模型',exact:true}).click();const model=page.getByRole('dialog',{name:'默认对话模型',exact:true});await model.waitFor();
  await check(`${theme}-${width}: model selection and search retained`,async()=>{assert.equal(await model.locator('.vg-model-search input').count(),1);assert(await model.locator('.vg-model-option').count()>0);assert(await model.evaluate(n=>n.scrollWidth<=n.clientWidth+1));});await page.screenshot({path:join(output,`${theme}-${width}-model.png`)});await page.getByRole('button',{name:'返回设置',exact:true}).click();await connection.waitFor();await page.getByRole('button',{name:'返回设置',exact:true}).click();await home().waitFor();
 }
 await check('reduced motion, mobile layout and isolation remain intact',async()=>{assert.equal(await page.locator('.vg-settings-detail-exit').count(),0);assert.equal(await page.locator('.mobile-layout').count(),1);assert.equal(await page.evaluate(()=>window.settingsMediaAttempts),0);assert.equal(report.externalBlocked,0);});
}catch(e){report.errors.push(String(e));}
finally{await browser.close();await new Promise(r=>server.close(r));report.pass=report.errors.length===0&&report.checks.every(c=>c.pass);writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors,pass:report.pass}));if(!report.pass)process.exitCode=1;}
