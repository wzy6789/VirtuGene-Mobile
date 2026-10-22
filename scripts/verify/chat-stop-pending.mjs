import fs from 'node:fs';import {build} from 'esbuild';import {createServer} from 'node:http';import {chromium} from 'playwright';import assert from 'node:assert/strict';
const before=process.argv.includes('--before'),root='.tmp-preview/ui-overhaul-20261016/chat-stop-pending',out=root+(before?'/before':'/after');fs.mkdirSync(out,{recursive:true});
if(before)for(const file of ['ChatWindow.tsx','ChatInput.tsx'])fs.copyFileSync('src/components/chat/'+file,out+'/'+file);
const bundle=await build({entryPoints:['scripts/verify/chat-stream-ui.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.hot':'undefined','import.meta.env':'{"DEV":true,"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"stop-local"'}});
const assets='dist/renderer/assets',names=fs.readdirSync(assets),css=names.filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(assets+'/'+n,'utf8')).join('\n');
const server=createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname.split('/').pop();if(name==='fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}else if(names.includes(name)){res.setHeader('Content-Type','font/woff2');res.end(fs.readFileSync(assets+'/'+name));}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html lang="zh-CN" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#app{height:100%;margin:0}</style><div id="app" class="mobile-layout"></div><script src="/fixture.js"></script></html>`);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],errors:[],external:0,modelCalls:0,microphone:0};const check=(value,label)=>{report.checks.push({label,pass:!!value});assert.ok(value,label);};
let page;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',recordVideo:{dir:out+'/video',size:{width:390,height:844}}});page=await context.newPage();
 await page.addInitScript(()=>{window.stopMediaCalls={microphone:0,audio:0};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.stopMediaCalls.microphone++;throw Error('Microphone isolated');};HTMLMediaElement.prototype.play=async function(){window.stopMediaCalls.audio++;throw Error('Audio isolated');};});
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(report.external++,r.abort()));page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.chatStreamTest);
 const test=(name,...args)=>page.evaluate(({name,args})=>window.chatStreamTest[name](...args),{name,args});const input=page.getByRole('textbox',{name:'消息内容'}),send=page.getByRole('button',{name:'发送消息',exact:true});
 const pending=async()=>{await test('setup');await input.waitFor();await test('holdUserWrite');await test('submit','这条已经停止回应');await page.waitForFunction(()=>window.chatStreamTest.userWriteHeld());await page.waitForTimeout(650);await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.waitForTimeout(80);};
 await pending();await page.screenshot({path:out+'/stopped.png'});
 check(await page.getByRole('button',{name:'停止生成',exact:true}).count()===0,'Stopping pending local write exits generating controls immediately');
 check(!await input.isDisabled(),'Stopping lets the user edit the next draft');
 check(await page.getByRole('status',{name:'正在回应',exact:true}).count()===0,'Stopped local write has no false reply-waiting status');
 await input.fill('下一条草稿保留');check(await send.isDisabled(),'Unfinished local write still blocks a second submission');
 await input.press('Enter');check((await test('requests')).length===0&&await input.inputValue()==='下一条草稿保留','Blocked Enter preserves draft and sends no model request');
 await test('releaseUserWrite');await send.waitFor();await page.waitForFunction(()=>!document.querySelector('.chat-composer-send').disabled);
 check(await input.inputValue()==='下一条草稿保留'&&(await test('records')).filter(r=>r.role==='user').length===1,'Late save keeps next draft and persists stopped message once');
 await send.click();await page.waitForFunction(()=>window.chatStreamTest.requests().length===1);await test('push',0,'这次正常回应。');await test('finish',0);await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
 check((await test('records')).filter(r=>r.role==='user').length===2,'New send works once after old local write settles');
 await pending();await test('failUserWrite');await test('releaseUserWrite');await page.getByRole('button',{name:'重新发送失败的消息',exact:true}).waitFor();
 check(!await input.isDisabled(),'Late local save failure releases editing and exposes retry');
 check((await test('requests')).length===0,'Late local failure after stop does not start the model');
 await page.getByRole('button',{name:'重新发送失败的消息',exact:true}).click();await page.waitForFunction(()=>window.chatStreamTest.requests().length===1);await test('push',0,'重试收到。');await test('finish',0);await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
 check((await test('records')).filter(r=>r.role==='user').length===1,'Retry saves the stopped failed sender exactly once');
 await pending();await test('switchTo','b');await input.waitFor();await page.waitForTimeout(100);check(!await input.isDisabled(),'Another conversation is not locked by old cleanup');
 await test('switchTo','a');await input.waitFor();await page.waitForTimeout(100);check(!await input.isDisabled()&&await page.getByRole('button',{name:'停止生成',exact:true}).count()===0,'Returning to stopped work restores cleanup rather than generating');
 await input.fill('返回后的下一条草稿');check(await send.isDisabled(),'Returning preserves the pending write lock without disabling editing');
 await test('switchTo','b');await test('releaseUserWrite');await page.waitForTimeout(150);check(!await input.isDisabled()&&(await test('requests')).length===0,'Late old cleanup does not start or lock the new conversation');
 for(const theme of ['dark','light'])for(const width of [320,390,430]){
  await page.setViewportSize({width,height:568});await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);await pending();await input.fill('保存完成后再发送这一条。');
  const bounds=await input.boundingBox();check(!!bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=568,`${theme}/${width}: editable cleanup composer stays within the short viewport`);
  await page.screenshot({path:`${out}/cleanup-${theme}-${width}.png`});await test('releaseUserWrite');await page.waitForFunction(()=>!document.querySelector('.chat-composer-send').disabled);
 }
 const media=await page.evaluate(()=>window.stopMediaCalls);report.microphone=media.microphone;report.audio=media.audio;
 check(await test('extraNetwork')===0&&report.external===0&&report.errors.length===0&&media.microphone===0&&media.audio===0,'All checks isolated from real transport and media');report.status='pass';await context.close();
}catch(error){report.status='failed';report.failure=String(error);await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,out}));}
