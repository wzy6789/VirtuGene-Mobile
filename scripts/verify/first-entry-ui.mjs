import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve,extname,sep} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const includeAnnouncement=process.env.VG_FIRST_ENTRY_ANNOUNCEMENT==='1';
const root=resolve('dist/renderer'),output=resolve(includeAnnouncement?'.tmp-preview/first-entry-announcement-ui-20261013':'.tmp-preview/first-entry-ui-20261013');mkdirSync(output,{recursive:true});
const entry=readFileSync(join(root,'index.html'),'utf8');
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}
 try{res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],screenshots=[],errors=[],external=[];
const check=(ok,label,detail)=>{assert.ok(ok,label+': '+JSON.stringify(detail));checks.push({label,detail});console.log('PASS '+label);};
const dbRows=page=>page.evaluate(async()=>{
 const database=await new Promise((resolve,reject)=>{const req=indexedDB.open('virtugene');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 const rows=await Promise.all(['users','characters','secretaryBindings'].map(name=>new Promise((resolve,reject)=>{const req=database.transaction(name).objectStore(name).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);})));database.close();return {users:rows[0],characters:rows[1],bindings:rows[2],auth:JSON.parse(localStorage.getItem('virtugene-auth')),flags:Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes('onboarded')||k.includes('secretary-intro')).map(k=>[k,localStorage.getItem(k)]))};
});
try{
 for(const theme of ['dark','light'])for(const width of [320,390,430]){
  const mode=width===390?'skip':'create',height=width===320?568:844;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push({theme,width,message:e.message}));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||url.protocol==='data:')return route.continue();external.push({theme,width,url:url.origin+url.pathname});return route.abort();});
  // Suppress the release announcement only; do not seed login, onboarding or database rows.
  await page.addInitScript(({theme,includeAnnouncement})=>{if(!includeAnnouncement)localStorage.setItem('virtugene:lastSeenVersion','6.1.0');localStorage.setItem('virtugene-theme',JSON.stringify({state:{preference:theme},version:1}));},{theme,includeAnnouncement});
  await page.goto(origin+'/?virtugene-preview=mobile');
  if(includeAnnouncement){const announcement=page.getByRole('dialog',{name:'更新说明',exact:true});await announcement.waitFor();check(await page.getByRole('dialog').count()===1,`${theme}-${width}首启更新公告没有重复叠层`);await announcement.getByRole('button',{name:'知道了',exact:true}).click();await announcement.waitFor({state:'hidden'});}
  await page.getByRole('button',{name:'注册你的基因',exact:true}).click();
  await page.getByLabel('用户名',{exact:true}).fill(`首启${theme}${width}`);
  await page.getByLabel('密码',{exact:true}).fill('local-entry-password');
  await page.getByLabel('确认密码',{exact:true}).fill('local-entry-password');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'注册',exact:true}).click();
  const welcome=page.getByRole('dialog',{name:'先认识你的私人助理',exact:true});await welcome.waitFor();
  await page.getByLabel('助理名字',{exact:true}).waitFor();
  check(await page.getByRole('dialog').count()===1,`${theme}-${width}注册后只出现一个欢迎创建弹窗`);
  const layout=await welcome.evaluate(node=>{const r=node.getBoundingClientRect();const buttons=[...node.querySelectorAll('button')].filter(x=>['创建助理','稍后再说'].includes(x.textContent.trim())).map(x=>{const r=x.getBoundingClientRect();return {text:x.textContent.trim(),height:r.height,top:r.top,bottom:r.bottom};});return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,buttons,overflow:document.documentElement.scrollWidth>innerWidth};});
  check(layout.left>=-1&&layout.right<=width+1&&!layout.overflow,`${theme}-${width}首启弹窗不横向越界`,layout);
  check(layout.buttons.length===2&&layout.buttons.every(x=>x.height>=44&&x.top>=0&&x.bottom<=height+1),`${theme}-${width}短屏底部主操作可见且44px`,layout.buttons);
  const shot=join(output,`${theme}-${width}-welcome.png`);await page.screenshot({path:shot});screenshots.push(shot);
  if(mode==='skip'){await page.getByRole('button',{name:'稍后再说',exact:true}).click();}
  else{await page.getByLabel('助理名字',{exact:true}).fill('小星');await page.getByRole('button',{name:'创建助理',exact:true}).click();}
  await page.getByRole('dialog').waitFor({state:'hidden'});
  if(mode==='create')await page.getByRole('navigation',{name:'助理页面'}).waitFor();
  let rows=await dbRows(page);const owner=rows.auth.state.userId;
  check(rows.users.length===1&&rows.auth.state.isLoggedIn,`${theme}-${width}注册真实落库并进入应用`);
  check(rows.flags['virtugene:onboarded:'+owner]==='1'&&rows.flags['virtugene:secretary-intro:v2:'+owner]==='1',`${theme}-${width}首启完成标记归属当前账号`);
  check(mode==='skip'?rows.bindings.length===0:rows.bindings.length===1&&rows.bindings[0].status==='active',`${theme}-${width}${mode==='skip'?'稍后不创建助理':'创建仅一个有效助理绑定'}`);
  await page.reload();await page.locator('.mobile-layout').waitFor();await page.waitForTimeout(600);
  check(await page.getByRole('dialog').count()===0,`${theme}-${width}重启不重复弹出欢迎或聘用`);
  const last=join(output,`${theme}-${width}-${mode}-reloaded.png`);await page.screenshot({path:last});screenshots.push(last);
  await context.close();
 }
 check(errors.length===0,'完整首启页面异常为零',errors);
 writeFileSync(join(output,'result.json'),JSON.stringify({passed:checks.length,checks,screenshots,errors,external,actualIndex:[...entry.matchAll(/(?:src|href)="([^" ]+)"/g)].map(m=>m[1]),scope:'Uninterrupted actual production registration without API Key → welcome → create/skip → reload; real isolated browser IndexedDB; no real model calls'},null,2));
}catch(e){writeFileSync(join(output,'failure.json'),JSON.stringify({checks,errors,error:String(e)},null,2));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
