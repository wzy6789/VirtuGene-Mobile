import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync,cpSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createHash} from 'node:crypto';

const out=resolve(process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-scene-plan-20261019/ui');mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/chat-scene-preview.tsx'],bundle:true,write:false,metafile:true,outfile:out+'/fixture.js',assetNames:'scene-assets/[name]-[hash]',publicPath:'/',format:'iife',platform:'browser',jsx:'automatic',loader:{'.webp':'file','.png':'file','.css':'empty'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:'"scene-isolated"','process.env.NODE_ENV':'"production"'}});
const files=new Map(bundle.outputFiles.map(f=>['/'+f.path.slice(out.length+1).replaceAll('\\','/'),f.contents]));
// Only this public local model catalog may be fetched; remote/model/mic transport stays isolated.
for(const id of readdirSync('public/chat-scenes'))for(const file of readdirSync('public/chat-scenes/'+id))if(file.endsWith('.glb'))files.set('/chat-scenes/'+id+'/'+file,readFileSync('public/chat-scenes/'+id+'/'+file));
// Keep this preview's source and CSS paired when a later Vite build clears dist.
const assets=resolve(out,`renderer-${Date.now()}`);cpSync(resolve('dist/renderer'),assets,{recursive:true});
const css=readdirSync(join(assets,'assets')).filter(f=>f.endsWith('.css'));
writeFileSync(out+'/source-hashes.json',JSON.stringify({inputs:Object.fromEntries(Object.keys(bundle.metafile.inputs).filter(existsSync).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))},null,2));
const server=createServer((req,res)=>{const path=new URL(req.url,'http://local').pathname;let data=files.get(path);
 if(!data&&(path.startsWith('/assets/')||path.startsWith('/fonts/'))){const file=resolve(assets,'.'+path);if(file.startsWith(assets)&&existsSync(file))data=readFileSync(file);}
 if(data){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webp')?'image/webp':path.endsWith('.woff2')?'font/woff2':'application/octet-stream');if(path.startsWith('/scene-assets/')||path.startsWith('/chat-scenes/'))res.setHeader('Cache-Control','public,max-age=31536000,immutable');res.end(data);return;}
 if(path!=='/'){res.writeHead(404).end();return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'none'; object-src 'none'");res.end(`<!doctype html><html class="dark" lang="zh-CN"><head><meta charset="utf-8"><title>VirtuGene 场景 · 实际聊天组件手机预览</title><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}#app{display:flex;flex-direction:column}.chat-room{flex:1;min-height:0}</style></head><body><main id="app" class="mobile-layout"></main><script src="/fixture.js"></script></body></html>`);
});
await new Promise(r=>server.listen(process.argv.includes('--serve')?Number(process.env.VG_SCENE_PORT??5321):0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
writeFileSync(out+(process.argv.includes('--serve')?'/server.json':'/test-server.json'),JSON.stringify({pid:process.pid,origin,scope:'Actual ChatWindow; separate origin, synthetic DB and simulated transport; no paid model/microphone/native access.'},null,2));
if(process.argv.includes('--serve')){console.log(JSON.stringify({origin,pid:process.pid}));}
else{
 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,recordVideo:{dir:out+'/video',size:{width:390,height:844}}}),page=await context.newPage();
 const report={checks:[],errors:[],screenshots:[],performance:[],external:0,limitations:['Desktop Chrome mobile emulation, not Android GPU/IME, heat or battery evidence.','Simulated model transport, no actual model calls.']};
 const check=(value,name,detail)=>{report.checks.push({pass:!!value,name,detail});if(!value)throw Error(name);console.log('PASS '+name);};
 const api=(object,name,...args)=>page.evaluate(({object,name,args})=>window[object][name](...args),{object,name,args});
 const save=(...args)=>api('sceneTest','scene',...args),settle=()=>page.waitForTimeout(120);
 const scene=()=>page.locator('.chat-room .vg-chat-scene'),snap=async name=>{await page.screenshot({path:out+'/'+name+'.png'});report.screenshots.push(name+'.png');};
 const ready=async()=>{await page.waitForFunction(()=>document.querySelector('.chat-room .vg-chat-scene')?.dataset.sceneLoad==='ready');await page.waitForTimeout(550);};
 page.on('pageerror',e=>report.errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(report.external++,route.abort()));
 try{
  await page.goto(origin);await page.waitForFunction(()=>window.sceneTest&&window.backgroundTest);await api('backgroundTest','setup',3);await api('sceneTest','stock',3);await page.getByRole('textbox',{name:'消息内容'}).waitFor();await settle();await snap('legacy-dark-390');
  await save();await ready();await snap('afternoon-dark-390');
  check(await scene().count()===1,'one scene host; no duplicate legacy halo',await page.locator('.chat-room .vg-chat-background-halo,.chat-room .vg-chat-particles').count());
  check(await page.locator('.chat-room .vg-chat-background-halo,.chat-room .vg-chat-particles').count()===0,'scene suppresses old full-field effects');
  await page.waitForFunction(()=>window.sceneTest.inspect()[0]?.particles?.particles>0);
  const idle=await api('sceneTest','inspect');await page.waitForTimeout(400);const advancing=await api('sceneTest','inspect');check(advancing[0].particles.frames>idle[0].particles.frames,'local particles visibly advance while idle',advancing);
  const input=page.getByRole('textbox',{name:'消息内容'});await input.focus();await page.waitForTimeout(120);const frozen=await api('sceneTest','inspect');await page.waitForTimeout(500);const frozen2=await api('sceneTest','inspect');
  check(frozen2[0].inputFocused&&!frozen2[0].keyboardOpen&&frozen2[0].particles.frames===frozen[0].particles.frames,'focus alone freezes particle frames without reporting keyboard',frozen2);
  check(JSON.stringify(frozen2[0].animations)===JSON.stringify(frozen[0].animations)&&JSON.stringify(frozen2[0].pose)===JSON.stringify(frozen[0].pose),'focus freezes light/steam clocks and preserves parallax pose');
  const crop=await scene().boundingBox();await page.setViewportSize({width:390,height:560});await settle();check(Math.abs((await scene().boundingBox()).height-crop.height)<1,'focused viewport shrink keeps camera crop');await page.evaluate(()=>document.activeElement.blur());await page.setViewportSize({width:390,height:844});await settle();
  for(const phase of ['waiting','streaming']){await page.locator('.chat-room').evaluate((n,p)=>n.dataset.chatPhase=p,phase);await settle();const a=await api('sceneTest','inspect');await page.waitForTimeout(250);const b=await api('sceneTest','inspect');check(a[0].particles.frames===b[0].particles.frames&&b[0].reason===phase,phase+' freezes all environment activity');}
  await page.locator('.chat-room').evaluate(n=>n.dataset.chatPhase='idle');await page.evaluate(()=>document.documentElement.setAttribute('data-vg-background',''));await settle();const background=await api('sceneTest','inspect');await page.waitForTimeout(250);check((await api('sceneTest','inspect'))[0].particles.frames===background[0].particles.frames,'background pauses environment');await page.evaluate(()=>document.documentElement.removeAttribute('data-vg-background'));
  const sceneIds=await page.evaluate(()=>window.sceneTest.scenes.map(scene=>scene.id));
  for(const id of sceneIds)for(const theme of ['dark','light'])for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});await api('backgroundTest','theme',theme);await save(id);await ready();
   check(await page.locator('.chat-room').evaluate(n=>n.scrollWidth<=n.clientWidth+1),id+'/'+theme+'/'+width+' fits without horizontal overflow');
   await snap(`${id}-${theme}-${width}`);
  }
  await page.setViewportSize({width:390,height:844});await api('backgroundTest','theme','dark');await save();await ready();
  await input.fill('切换场景时保留的草稿');await page.evaluate(()=>document.activeElement.blur());await save('cafe-rain-night');await ready();check(await input.inputValue()==='切换场景时保留的草稿','scene switch retains draft');await input.fill('');await page.evaluate(()=>document.activeElement.blur());
  const before=await api('sceneTest','resources');
  for(let i=0;i<20;i++){await api('chatStreamTest','unmount');await settle();const released=await api('sceneTest','resources');check(released.entries===0&&released.runtimes===0&&released.subscriptions===0,'unmount '+(i+1)+' releases image leases and subscriptions',released);await api('chatStreamTest','remount');await ready();}
  const after=await api('sceneTest','resources');check(after.entries===before.entries&&after.runtimes===before.runtimes,'20 cycles retain bounded live resource counts',{before,after});
  await api('backgroundTest','reduced',true);await ready();check((await api('sceneTest','inspect'))[0].effectiveQuality==='static'&&await page.locator('.vg-scene-particle-slot').count()===0,'reduced motion uses complete poster without particle executor');await api('backgroundTest','reduced',false);await ready();
  await api('sceneTest','stock',500);await settle();check(await api('backgroundTest','messageCount')===500,'500 mixed messages loaded in actual conversation');check(await page.locator('.vg-message-bubble').count()<80,'actual list remains virtualized for 500 messages');
  for(const mode of ['legacy','static','dynamic']){
   if(mode==='legacy')await api('backgroundTest','save',{mode:'atmosphere',strength:'gentle'});else{await save('cafe-rain-night',mode==='static'?'power-save':'auto');await ready();}
   const timing=await page.evaluate(async()=>{const input=document.querySelector('[aria-label="消息内容"]');const thread=document.querySelector('.chat-thread');thread.scrollTop=6000;await new Promise(r=>setTimeout(r,220));const samples=[];for(let i=0;i<25;i++){const start=performance.now();const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'固定长度输入测试'+i);input.dispatchEvent(new Event('input',{bubbles:true}));thread.scrollTop=Math.max(0,6000-(i+1)*90);await new Promise(r=>requestAnimationFrame(()=>r()));samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return{p95:samples[Math.floor(samples.length*.95)],samples};});report.performance.push({mode,...timing});
  }
  await save('cafe-rain-night');await ready();await input.fill('');await api('chatStreamTest','submit','今天想听你慢慢说。');await page.waitForFunction(()=>window.chatStreamTest.requests().length>0);const initial=(await api('sceneTest','inspect'))[0].instance;
  for(let i=0;i<12;i++){await api('chatStreamTest','push',0,(i?'慢慢聊。':'这里有一段真正可展示的回复。'));await page.waitForTimeout(35);}
  check((await api('sceneTest','inspect'))[0].instance===initial,'streaming tokens never rebuild the scene host');await api('chatStreamTest','finish',0);await page.waitForTimeout(500);await snap('500-messages-stream-complete');
  check(report.errors.length===0,'no browser errors',report.errors);check(report.external===0,'no external model or media transport',report.external);report.status='pass';
 }catch(error){report.status='failed';report.failure=String(error);await snap('failure').catch(()=>{});console.error(error);process.exitCode=1;}
 finally{await context.close();await browser.close();await new Promise(r=>server.close(r));writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,out}));}
}
