import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname,join,resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const output=resolve('.tmp-preview/chat-settings-preview-20261013'); mkdirSync(output,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/chat-settings-preview.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty','.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"6.1.0"'},plugins:[{name:'controlled-synthesis',setup(b){
  b.onLoad({filter:/[\\/]edge-tts\.ts$/},()=>({contents:'export const edgeTTSSynthesize = () => window.previewHarness.synthesize();',loader:'js'}));
  b.onLoad({filter:/[\\/]mimo-tts\.ts$/},()=>({contents:'export const mimoTTSSynthesize = () => window.previewHarness.synthesize(); export const mapEdgeVoiceToMimo = x => x;',loader:'js'}));
}}]});
const root=resolve('dist/renderer'),entry=readFileSync(join(root,'index.html'),'utf8');
const css=[...entry.matchAll(/href="([^" ]+\.css)"/g)].map(x=>x[1]);
const server=createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.end(bundle.outputFiles[0].text);return;}
  if(req.url.startsWith('/assets/')){res.setHeader('Content-Type','text/css');res.end(readFileSync(join(root,req.url)));return;}
  res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<html class="dark"><head>${css.map(x=>`<link rel="stylesheet" href="${x}">`).join('')}</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({reducedMotion:'reduce'});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  const state={calls:0,plays:0,pauses:0,revokes:0,speaks:0,cancels:0,mode:'deferred',resolve:null,audio:null,utterance:null};
  URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>state.revokes++;
  window.Audio=class{constructor(){state.audio=this;}pause(){state.pauses++;}removeAttribute(){}load(){}play(){state.plays++;return state.mode==='reject-play'?Promise.reject(Error('blocked')):Promise.resolve();}};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:u=>{state.speaks++;state.utterance=u;},cancel:()=>state.cancels++}});
  window.previewHarness={state,synthesize:()=>{state.calls++;return state.mode==='deferred'?new Promise(r=>state.resolve=r):Promise.resolve(new ArrayBuffer(8));},release:()=>state.resolve(new ArrayBuffer(8))};
});
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const fresh=async(mode='deferred')=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.previewFixture);await page.evaluate(m=>previewHarness.state.mode=m,mode);await page.getByRole('button',{name:'聊天设置',exact:true}).click();await page.getByRole('dialog').waitFor();};
try{
 await fresh();await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.getByRole('button',{name:'取消准备试听'}).click();await page.evaluate(()=>previewHarness.release());
 await page.waitForTimeout(80);check(await page.evaluate(()=>previewHarness.state.plays===0),'取消合成后迟到结果不播放');
 await fresh();await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.evaluate(()=>previewFixture.hide());await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(()=>previewHarness.release());await page.waitForTimeout(80);
 check(await page.evaluate(()=>previewHarness.state.plays===0),'卸载后迟到结果不播放');
 await fresh('immediate');await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.getByRole('button',{name:'停止试听'}).waitFor();check(await page.evaluate(()=>previewHarness.state.plays===1),'播放期间显示停止入口');
 await page.getByRole('button',{name:'停止试听'}).click();check(await page.evaluate(()=>previewHarness.state.pauses===1&&previewHarness.state.revokes===1),'停止释放音频和对象URL');
 await fresh('immediate');await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.getByRole('button',{name:'停止试听'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 check(await page.evaluate(()=>previewHarness.state.pauses===1&&previewHarness.state.revokes===1),'关闭设置停止试听并释放资源');
 await fresh();await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.evaluate(()=>previewFixture.changeOwner());await page.evaluate(()=>previewHarness.release());await page.waitForTimeout(80);
 check(await page.evaluate(()=>previewHarness.state.plays===0),'换账号不播放旧账号迟到试听');
 await fresh('reject-play');await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.getByRole('button',{name:'停止试听'}).waitFor();check(await page.evaluate(()=>previewHarness.state.revokes===1&&previewHarness.state.speaks===1),'播放拒绝释放URL并回退系统语音');
 await page.getByRole('button',{name:'停止试听'}).click();check(await page.evaluate(()=>previewHarness.state.cancels===1),'仅取消本组件启动的系统试听');
 await fresh('immediate');await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.getByRole('button',{name:'停止试听'}).waitFor();await page.evaluate(()=>previewHarness.state.audio.onerror());await page.getByRole('alert').waitFor();
 check(await page.getByRole('alert').innerText()==='试听播放失败，请再试一次。','音频加载失败有可达反馈');
 await page.locator('summary').filter({hasText:'角色方言'}).click();await page.getByRole('radio',{name:'东北话'}).click();await page.getByText('方言未保存，请再试一次。').waitFor();check(await page.evaluate(()=>previewFixture.writes())===1,'方言写入失败不静默且无未处理拒绝');
 check(await page.getByRole('radio',{name:'标准音色'}).isChecked(),'保存失败不把未落库方言显示为已保存');
 await page.getByRole('radio',{name:'陕西话'}).click();await page.waitForFunction(()=>previewFixture.writes()===2);check(true,'方言失败后允许重试');
 await fresh('immediate');await page.getByRole('button',{name:'试听女声默认音色'}).click();await page.getByRole('button',{name:'停止试听'}).waitFor();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 check(await page.evaluate(()=>previewHarness.state.pauses===1&&previewHarness.state.revokes===1),'页面隐藏停止播放并释放资源');
 check(errors.length===0,'页面异常为零');
 writeFileSync(join(output,'result.json'),JSON.stringify({passed:checks.length,checks,errors,productionCss:css,scope:'Actual components; controlled synthesis/audio/store failure, no real audio or cloud calls'},null,2));
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({checks,errors,error:String(error)},null,2));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
