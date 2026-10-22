import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,readdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';

const out=process.env.VG_CALL_MOTION_OUTPUT || '.tmp-preview/ui-overhaul-20261015/call-motion-v2';mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{contents:`import './scripts/verify/voice-call-ui';
import {useVoiceCallStore} from './src/store/voice-call-store';
import {useVoiceCallUIStore} from './src/store/voice-call-ui-store';
import {getChatAtmosphereVariables} from './src/lib/chat-atmosphere';
import {installUiPreferences} from './src/lib/ui-preferences';
installUiPreferences();
window.motionReady=false;
window.prepareMotion=async function(theme){
 await window.callUiTest.hosted();
 const call=useVoiceCallStore.getState();
 useVoiceCallStore.setState({view:{...call.view,phase:'listening',inputMode:'voice',speakingText:'',heardText:'那就慢慢说，我在听。',level:0},record:{...call.record,startedAt:Date.now()-134000,status:'active'}});
 const target=useVoiceCallUIStore.getState().target;
 useVoiceCallUIStore.setState({target:{...target,character:{...target.character,name:'知微'}}});
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const panel=document.querySelector('.vg-voice-call-modal');
 for(const [name,value] of Object.entries(getChatAtmosphereVariables(theme)))panel.style.setProperty(name,value);
 window.motionReady=true;
};`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:'"motion-preview"'},outfile:'fixture.js'});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const css=readdirSync('dist/renderer/assets').filter(f=>f.endsWith('.css')).map(f=>readFileSync(join('dist/renderer/assets',f),'utf8')).join('\n')+'\n'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(js);return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');
 if(url.pathname==='/app'){
  const dark=url.searchParams.get('theme')==='dark';
  res.end(`<!doctype html><html lang="zh-CN" class="${dark?'dark':''}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>navigator.mediaDevices.getUserMedia=async()=>{throw Error('Microphone disabled for animation preview')};window.fetch=async()=>{throw Error('External model transport disabled')};</script><script src="/fixture.js"></script><script>prepareMotion('${dark?'cool':'steady'}')</script></body></html>`);return;
 }
 res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0d0b14;font:12px system-ui;color:#e6e2f2}header{height:28px;display:flex;justify-content:center;align-items:center;letter-spacing:.04em}main{display:flex;gap:2px;height:844px}iframe{width:390px;height:844px;border:0;flex:none}</style></head><body><header>实际界面 · 模拟通话阶段 · 无录音或模型调用</header><main><iframe title="深色通话" src="/app?theme=dark"></iframe><iframe title="浅色通话" src="/app?theme=light"></iframe></main></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const recordings=[];
try{
 for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'no-preference',recordVideo:{dir:out,size:{width:390,height:844}}});
  const videoEpoch=Date.now(),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(address)&&!url.startsWith('data:')&&!url.startsWith('blob:')){external.push(url);return route.abort();}return route.continue();});
  await page.goto(`${address}/app?theme=${theme}`);await page.bringToFront();
  await page.waitForFunction(()=>window.motionReady);await page.waitForTimeout(700);
  const start=Date.now();await page.screenshot({path:join(out,`${theme}-start.png`)});
  const first=await page.locator('.vg-voice-call-soul svg').innerHTML();
  await page.waitForTimeout(4200);await page.screenshot({path:join(out,`${theme}-middle.png`)});
  await page.waitForTimeout(3800);await page.screenshot({path:join(out,`${theme}-end.png`)});
  const last=await page.locator('.vg-voice-call-soul svg').innerHTML();
  const state=await page.locator('.vg-voice-call-soul .vg-soul-orb').evaluate(n=>({motion:n.dataset.orbMotion,focus:document.hasFocus()}));
  await context.close();const video=await page.video().path();copyFileSync(video,join(out,`${theme}.webm`));
  recordings.push({theme,startOffsetMs:start-videoEpoch,recordedDurationMs:Date.now()-start,video,errors,external,motionChanged:first!==last,state});
  if(errors.length||external.length||first===last)throw Error(JSON.stringify(recordings.at(-1)));
 }
 writeFileSync(join(out,'recording.json'),JSON.stringify({recordings,scope:'Sequential actual production component captures; synthetic two-theme call state; capture=0; model and microphone disabled.'},null,2));
 console.log(JSON.stringify({out,recordings}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
