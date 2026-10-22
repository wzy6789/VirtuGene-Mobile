import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const stamp=Date.now(),out=resolve('release/chat-continuity-mobile-'+stamp),tmp='.tmp-preview/continuity-mobile';
mkdirSync(out,{recursive:true});mkdirSync(tmp,{recursive:true});
const css=[...readFileSync('src/main.tsx','utf8').matchAll(/import '(\.\/styles\/[^']+\.css)'/g)].map(match=>match[1]);
// Import the actual current cascade through PostCSS/Tailwind, not a stale dist build.
writeFileSync(tmp+'/entry.tsx',css.map(path=>`import '../../src/${path.slice(2)}';`).join('\n')+`
import '../../scripts/verify/chat-stream.tsx';
import {useSettingsStore} from '../../src/store/settings-store';
import {installUiPreferences} from '../../src/lib/ui-preferences';
import {installThemePreferences} from '../../src/lib/theme';
import {installUiFont} from '../../src/lib/ui-font';
installUiPreferences();installThemePreferences();installUiFont();
const harness=(window as any).chatStreamTest;
(window as any).continuityPreview={ready:async()=>{await harness.setup(24);useSettingsStore.setState({ttsEnabled:false,aiVoiceMode:false,chatFontSize:16});await harness.useReviewedCharacter('preset-guyuena');},font:(size:number)=>useSettingsStore.setState({chatFontSize:size})};
await (window as any).continuityPreview.ready();
`);
const isolation=`<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; connect-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; media-src 'none'; object-src 'none'; frame-src 'none'"><script>(()=>{window.__fixtureIsolation={network:'same-origin-only',microphone:'blocked',audio:'blocked'};window.__fixtureAudioAttempts=0;const deny=()=>{window.__fixtureAudioAttempts++;return Promise.reject(Error('Audio disabled in isolated preview'));};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=deny;HTMLMediaElement.prototype.play=deny;for(const name of ['AudioContext','webkitAudioContext'])if(window[name])window[name]=function(){window.__fixtureAudioAttempts++;throw Error('Audio disabled in isolated preview');};window.speechSynthesis?.cancel();if(window.speechSynthesis)window.speechSynthesis.speak=function(){window.__fixtureAudioAttempts++;throw Error('Audio disabled in isolated preview');};})();</script>`;
writeFileSync(tmp+'/index.html',('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VirtuGene · 隔离聊天验收（模拟回复）</title><style>html,body,#app{height:100%;margin:0}body{background:var(--bg);color:var(--text)}#fixture-note{position:fixed;top:0;left:0;right:0;z-index:9999;font:10px/16px sans-serif;text-align:center;background:#24293a;color:#eee;pointer-events:none}#app{height:calc(100% - 16px);margin-top:16px}</style></head><body><div id="fixture-note">隔离验收 · 模拟回复 · 无麦克风／真实模型调用</div><div id="app" class="mobile-layout relative w-full flex flex-col bg-app overflow-hidden"></div><script type="module" src="./entry.tsx"></script></body></html>').replace('<head>','<head>'+isolation));
const server=await createServer({configFile:false,plugins:[react()],cacheDir:tmp+'/vite-cache',optimizeDeps:{entries:[tmp+'/index.html']},define:{__APP_VERSION__:JSON.stringify(JSON.parse(readFileSync('package.json','utf8')).version)},server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false,watch:{ignored:['**/release/**','**/.tmp-preview/**']}}});
await server.listen();
const origin='http://127.0.0.1:'+server.httpServer.address().port,url=origin+'/'+tmp+'/index.html?virtugene-preview=mobile';
console.log(JSON.stringify({preview:url,out,phase:'starting isolated browser'}));
const report={workspace:process.cwd(),url,out,complete:false,checks:[],views:[],errors:[],blockedExternal:[],apiCalls:0,audio:false,microphone:false,codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,scope:'Actual ChatWindow/send-service/native isolated DB and current CSS/PostCSS cascade. Synthetic local model transport. Viewport resize is not an Android IME/physical device test.',sources:['src/main.tsx','src/components/chat/ChatWindow.tsx','src/components/chat/MessageBubble.tsx','src/lib/chat/send-service.ts','scripts/verify/chat-stream.tsx'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))};
const browser=await chromium.launch({channel:'chrome',headless:true});
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});if(!ok)throw Error(name);};
let context;
try{
 context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce',permissions:[],recordVideo:{dir:out,size:{width:390,height:844}}});
 await context.route('**/*',route=>{const requestUrl=new URL(route.request().url());if(requestUrl.origin===origin||requestUrl.protocol==='data:')return route.continue();report.blockedExternal.push(requestUrl.origin);return route.abort();});
 await context.addInitScript(()=>{window.__fixtureAudioAttempts=0;const deny=()=>{window.__fixtureAudioAttempts++;return Promise.reject(Error('Audio disabled in isolated acceptance'));};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=deny;HTMLMediaElement.prototype.play=deny;window.speechSynthesis?.cancel();});
 report.videoTimeline={pageCreatedAt:Date.now()};
 const page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(url);await page.waitForFunction(()=>!!window.continuityPreview&&!!document.querySelector('[aria-label="消息内容"]'));
 const call=(name,...args)=>page.evaluate(({name,args})=>window.chatStreamTest[name](...args),{name,args});
 const input=page.getByRole('textbox',{name:'消息内容',exact:true});
 await input.waitFor({state:'visible'});
 await page.waitForTimeout(300);await page.screenshot({path:join(out,'390-before-send.png')});
 report.videoTimeline.beforeSendMs=Date.now()-report.videoTimeline.pageCreatedAt;
 const reply='数学这一场已经考完了。---英语是周三，听力还要准备，先分开看。';
 await call('submit','有两场考试，数学和英语。数学周一，英语周三。数学考完了，英语还没考。');
 await page.waitForFunction(()=>window.chatStreamTest.requests().length===1);
 const beforePush=await page.evaluate(()=>performance.now());
 await call('push',0,reply);
 // Reviewed preset replies deliberately wait for the complete provider draft.
 // Do not deadlock the fixture by withholding DONE until a guarded bubble appears.
 await call('finish',0);
 await page.getByText('数学这一场已经考完了。',{exact:true}).waitFor();
 const visibleAt=await page.evaluate(()=>performance.now());
 await page.waitForTimeout(300);await page.screenshot({path:join(out,'390-first-body.png')});
 report.videoTimeline.firstBodyMs=Date.now()-report.videoTimeline.pageCreatedAt;
 await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
 const rows=await call('records');
 check('real send persisted user and two independently rendered reply rows',rows.filter(row=>row.role==='user').length===1&&rows.filter(row=>row.role==='assistant'&&!row.id.startsWith('history-')).length===2);
 report.localSimulatedFirstDisplay={beforePush,visibleAt,elapsedMs:visibleAt-beforePush,meaning:'Local simulated arrival to observed DOM, not provider TTFT or decoded video timing'};
 for(const width of [320,360,390,414]){
  for(const font of [16,22]){
   await page.setViewportSize({width,height:844});await page.evaluate(font=>window.continuityPreview.font(font),font);
   await input.fill('一条长输入'.repeat(35));await page.waitForTimeout(120);
   const geometry=await page.evaluate(()=>{const input=document.querySelector('[aria-label="消息内容"]'),thread=document.querySelector('[aria-label="聊天记录"]'),last=[...document.querySelectorAll('.vg-chat-message-row')].at(-1);const rect=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,input:rect(input),thread:rect(thread),last:rect(last),threadWidth:thread.clientWidth,threadScrollWidth:thread.scrollWidth,font:getComputedStyle(document.querySelector('.vg-message-bubble')).fontSize};});
   check(`${width}/${font} actual bubble font applied`,Number.parseFloat(geometry.font)===font,geometry.font);
   check(`${width}/${font} no document or chat horizontal overflow`,geometry.documentWidth<=width+1&&geometry.threadScrollWidth<=geometry.threadWidth+1,geometry);
   check(`${width}/${font} input remains onscreen`,geometry.input.bottom<=844+1&&geometry.input.left>=0&&geometry.input.right<=width+1&&geometry.input.height>0,geometry.input);
   await input.fill('');await page.screenshot({path:join(out,`${width}-font${font}.png`)});
   report.views.push({width,font,geometry});
  }
 }
 await page.setViewportSize({width:390,height:480});await input.focus();await page.waitForTimeout(150);
 const reduced=await page.evaluate(()=>{const r=document.querySelector('[aria-label="消息内容"]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};});
 check('reduced-height input remains visible (resize proxy only)',reduced.bottom<=reduced.height+1&&reduced.top>=0,reduced);
 await page.setViewportSize({width:390,height:844});
 // Exercise long content through the real composer/transport, not a painted screenshot.
 await call('submit','最后补一句：给我看一段较长的说明。');await page.waitForFunction(()=>window.chatStreamTest.requests().length===2);
 await call('push',1,'先把数学和英语分开看。数学是周一的那场，已经考完；英语是周三的，还留着听力要准备。数学的结果不能算到英语头上。你刚才补充的日期也分别保留，之后只改其中一场，就沿用另一场已有的信息。要是只说“考试结束了”，两场都有可能，我会先问你指的是哪场。');await call('finish',1);
 await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
 const final=await page.evaluate(()=>{const input=document.querySelector('[aria-label="消息内容"]').getBoundingClientRect(),last=[...document.querySelectorAll('.vg-chat-message-row')].at(-1).getBoundingClientRect();return {inputTop:input.top,lastTop:last.top,lastBottom:last.bottom,viewport:innerHeight};});
 check('latest long reply is above composer after arrival',final.lastBottom<=final.inputTop+1&&final.lastBottom>0,final);
 check('no audio or microphone attempt',await page.evaluate(()=>window.__fixtureAudioAttempts===0));
 check('no unexpected application fetch',await call('extraNetwork')===0);
 check('no uncaught application page error',report.errors.length===0,report.errors);
 await page.screenshot({path:join(out,'390-final.png')});
 const video=page.video();await context.close();context=undefined;report.video=await video.path();
 report.complete=true;
}catch(error){report.errors.push(error.stack??String(error));process.exitCode=1;}
finally{if(context)await context.close();await browser.close();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,failures:report.checks.filter(check=>!check.ok).map(check=>check.name),errors:report.errors,url,out,video:report.video,paidCalls:0}));if(!process.argv.includes('--serve')||!report.complete)await server.close();else console.log('Preview service stays live; stop this exact process to close it.');}
