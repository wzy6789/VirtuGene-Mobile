import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Actual MobileStagePage and shipped renderer CSS. Only scene persistence/model
// boundaries and store fixtures are replaced. No microphone, model or Android.
const before = process.env.VG_STAR_BEFORE === '1';
const guardsOnly = process.env.VG_STAR_GUARDS_ONLY === '1';
const sourceBefore = process.env.VG_STAR_SOURCE_BEFORE || '.tmp-preview/ui-overhaul-20261016/star-flow/before/MobileStagePage.tsx';
const out = process.env.VG_STAR_FLOW_OUTPUT || `.tmp-preview/ui-overhaul-20261016/star-flow/${before ? 'before-check' : 'after'}`;
mkdirSync(out, { recursive: true });
const original = resolve('src/components/world/MobileStagePage.tsx');
const stubs = {
  'auth-store': `import {create} from 'zustand';export const useAuthStore=create(()=>({userId:'owner',username:'测试',apiKey:'not-a-real-key'}));`,
  'chat-store': `import {create} from 'zustand';export const useChatStore=create(()=>({characters:[{id:'a',createdBy:'owner',name:'知微',avatar:'月'},{id:'b',createdBy:'owner',name:'一位名字很长的同行者',avatar:'星'}],loadCharacters:async()=>{}}));`,
  'ui-store': `import {create} from 'zustand';export const useUIStore=create(set=>({activeView:'stage',mobileTab:'world',worldCreateIntent:false,setWorldCreateIntent:value=>set({worldCreateIntent:value}),setActiveView:value=>set({activeView:value}),setMobileTab:value=>set({mobileTab:value}),openCanvas:id=>{window.starTest.opens.push(id);set({activeView:'canvas'});}}));`,
  'world-repo': `export const worldRepo={ensureDefaultWorld:async userId=>({id:'world-'+userId,userId}),getById:async id=>({id,userId:id.slice(6)})};`,
  'world-scene-repo': `export const worldSceneRepo={getScene:id=>window.starTest.defer('authorize',id),getByIds:async ids=>window.starTest.scenes.filter(scene=>ids.includes(scene.id)),listScenes:async()=>window.starTest.scenes};`,
  'scene-runtime': `export const listScenes=async()=>window.starTest.scenes;
export const loadScene=id=>window.starTest.defer('read',id);
export const startScene=options=>window.starTest.defer('create',options);
export const finishSceneAndSettle=options=>window.starTest.defer('finish',options);
export const deleteScene=id=>window.starTest.defer('delete',id);`,
  'useAiAvailability': `export const useAiAvailability=()=>true;`,
  'Avatar': `export const Avatar=()=>null;`,
  'avatar': `export const avatarImageSrc=()=>undefined;`,
};
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MobileStagePage} from './src/components/world/MobileStagePage';import {useAuthStore} from './src/store/auth-store';import {useUIStore} from './src/store/ui-store';
const scene=(id,title,status,characterIds)=>({id,title,status,characterIds,userId:'owner',worldId:'world-owner',place:'雨后的站台',timeLabel:'傍晚',mood:'安静'});
window.starTest={scenes:[scene('s1','旧时光','paused',['a']),scene('s2','很长很长的世界名称','finished',[])],pending:[],opens:[],
defer(kind,value){return new Promise((resolve,reject)=>this.pending.push({kind,value,resolve,reject}));},
complete(kind,value){const op=this.pending.find(p=>p.kind===kind&&!p.done);op.done=true;if(kind==='read'&&value.scene)value={...value,scene:{...scene(value.scene.id,value.scene.title,value.scene.status,value.scene.characterIds),...value.scene}};op.resolve(value);},
fail(kind){const op=this.pending.find(p=>p.kind===kind&&!p.done);op.done=true;op.reject(Error('isolated failure'));},
account(id){useAuthStore.setState({userId:id});},snapshot(){return {view:useUIStore.getState().activeView,pending:this.pending.map(p=>({kind:p.kind,done:p.done,value:p.value})),opens:this.opens};}};
createRoot(document.getElementById('root')).render(<MobileStagePage/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'},plugins:[{name:'star-isolated',setup(b){b.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1);if(stubs[name])return {path:name,namespace:'star-stub'};});b.onLoad({filter:/.*/,namespace:'star-stub'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));if(before)b.onLoad({filter:/MobileStagePage\.tsx$/},args=>args.path===original?{contents:readFileSync(sourceBefore,'utf8'),loader:'tsx',resolveDir:resolve('src/components/world')}:undefined);}}]});
const assets=resolve('dist/renderer/assets');
const css=readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>readFileSync(resolve(assets,f),'utf8')).join('\n');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:`<html class="dark" lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root" class="mobile-layout"></div><script src="/test.js"></script></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={checks:[],errors:[],failures:[],external:0,scope:'Actual component; deferred local scene/model boundary fixtures; shipped CSS; no model/microphone/audio/Android.'};
const check=(value,name)=>{if(!value)result.failures.push(name);else result.checks.push(name);};
try {
 const page=await browser.newPage({viewport:{width:320,height:740},reducedMotion:'reduce'});
 page.on('pageerror',e=>result.errors.push(e.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();if(route.request().resourceType()!=='font')result.external++;return route.abort();});
 const start=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByText('旧时光',{exact:true}).waitFor();};
 const invoke=(name,...args)=>page.evaluate(({name,args})=>starTest[name](...args),{name,args});
 const guards=async()=>{
  await start();const continueButton=page.getByRole('button',{name:'继续',exact:true});
  await continueButton.evaluate(button=>{button.click();button.click();});
  const pending=(await invoke('snapshot')).pending.filter(p=>p.kind==='authorize');
  check(pending.length===1,'continue is synchronously locked and reauthorizes the selected primary key');
  if(pending.length!==1)return;
  check((await invoke('snapshot')).opens.length===0,'continue waits for authorization before navigation');
  await invoke('fail','authorize');await page.getByRole('alert').filter({hasText:'暂未读到'}).waitFor();
  check((await invoke('snapshot')).opens.length===0,'failed authorization does not navigate');
  await page.getByRole('button',{name:'继续',exact:true}).click();
  await invoke('complete','authorize',{id:'s1',title:'旧时光',status:'paused',userId:'owner',worldId:'world-owner',characterIds:['a']});
  await page.waitForFunction(()=>starTest.opens.length===1);
  check(JSON.stringify((await invoke('snapshot')).opens)==='["s1"]','successful retry enters only the authorized selected scene');
  for(const mismatch of [{userId:'another-user',worldId:'world-owner'},{userId:'owner',worldId:'world-other'}]){
   await start();await page.getByRole('button',{name:'继续',exact:true}).click();
   await invoke('complete','authorize',{id:'s1',title:'外部场景',status:'paused',characterIds:[],...mismatch});
   await page.getByRole('alert').filter({hasText:'不可用'}).waitFor();
   check((await invoke('snapshot')).opens.length===0,`continue rejects mismatched scope ${JSON.stringify(mismatch)}`);
  }
  await start();await page.getByRole('button',{name:'继续',exact:true}).click();
  await page.getByRole('button',{name:'返回世界',exact:true}).click();
  await invoke('complete','authorize',{id:'s1',title:'旧时光',status:'paused',userId:'owner',worldId:'world-owner',characterIds:['a']});
  check((await invoke('snapshot')).opens.length===0,'late primary-key authorization cannot reopen a scene after leaving');
  await start();await page.getByRole('button',{name:'删除',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'删除场景记录',exact:true});await dialog.waitFor();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});
  check((await invoke('snapshot')).pending.filter(p=>p.kind==='delete').length===0,'cancelled confirmation performs no delete');
  await page.getByRole('button',{name:'删除',exact:true}).first().click();
  await dialog.getByRole('button',{name:'确认删除',exact:true}).evaluate(button=>{button.click();button.click();});
  check((await invoke('snapshot')).pending.filter(p=>p.kind==='delete').length===1,'confirmation double-click performs one delete');
  await invoke('fail','delete');await dialog.getByRole('button',{name:'确认删除',exact:true}).waitFor();
  check(await dialog.isVisible(),'failed deletion keeps the confirmation available for retry');
  await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await invoke('complete','delete');
  await dialog.waitFor({state:'hidden'});check(true,'successful delete retry closes the confirmation');
 };
 if(guardsOnly){await guards();}else{
 await start();
 for(const theme of ['dark','light']) {
  await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
  check(await page.locator('.vg-stage-room').evaluate(n=>n.scrollWidth<=n.clientWidth+1),`${theme}/320: list fits viewport`);
  const sizes=await page.locator('li button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,w:r.width,h:r.height};}));
  check(sizes.every(r=>r.w>=44&&r.h>=44),`${theme}/320: list actions have 44px targets ${JSON.stringify(sizes)}`);
  await page.screenshot({path:`${out}/list-${theme}-320.png`});
 }
 await page.getByRole('button',{name:'回看',exact:true}).first().click();
 await invoke('fail','read');await page.waitForTimeout(50);
 check(await page.getByRole('alert').filter({hasText:'没能打开这个场景'}).isVisible(),'failed read exposes visible accessible retry context in list');
 await page.getByRole('button',{name:'结束并保存',exact:true}).click();await invoke('complete','finish',{error:'network failed'});await page.waitForTimeout(50);
 check(await page.getByRole('alert').filter({hasText:'网络恢复后'}).isVisible(),'failed settlement is visible in list and localized');
 await page.getByRole('button',{name:'结束并保存',exact:true}).click();await invoke('complete','finish',{});await page.waitForTimeout(50);
 check(await page.getByRole('status').filter({hasText:'经历已经写入世界'}).isVisible(),'successful finish confirms result in list');
 await page.screenshot({path:`${out}/finish-light-320.png`});
 await start();
 await page.getByRole('button',{name:'回看',exact:true}).first().evaluate(n=>{n.dispatchEvent(new MouseEvent('click',{bubbles:true}));n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 check((await invoke('snapshot')).pending.filter(p=>p.kind==='read').length===1,'same-frame read submit is locked synchronously');
 await page.getByRole('button',{name:'返回世界',exact:true}).click();
 await invoke('complete','read',{scene:{id:'late',title:'不应返回的旧世界',status:'paused',characterIds:[],place:'旧地方'},entries:[]});await page.waitForTimeout(50);
 check(await page.locator('.vg-stage-active').count()===0,'late read cannot reopen review after exit');
 check((await invoke('snapshot')).view==='chat','exit intent stays on world landing route');
 await start();await page.getByRole('button',{name:'回看',exact:true}).first().click();
 await invoke('account','other');await invoke('complete','read',{scene:{id:'private',title:'旧账号的世界',status:'paused',characterIds:[],place:'旧地方'},entries:[]});await page.waitForTimeout(50);
 check(await page.locator('.vg-stage-active').count()===0,'old-account read cannot show previous account transcript');
 await start();await page.getByRole('button',{name:'回看',exact:true}).first().click();
 await invoke('complete','read',{scene:{id:'s1',title:'旧时光',status:'paused',characterIds:['a'],place:'雨后的站台',timeLabel:'傍晚',mood:'安静'},entries:[{id:'entry',kind:'narration',content:'雨停了，你们沿着街角慢慢走。'}]});
 await page.getByText('雨停了，你们沿着街角慢慢走。',{exact:true}).waitFor();
 check(await page.locator('.vg-stage-transcript').getAttribute('tabindex')==='0','review remains directly keyboard-scrollable');
 await page.getByRole('button',{name:'返回',exact:true}).click();check(await page.getByRole('heading',{name:'场景管理',exact:true}).isVisible(),'review returns to preserved scene list');
 await start();await page.getByRole('button',{name:'开启新场景',exact:true}).click();
 await page.getByRole('button',{name:/一位名字很长的同行者/}).click();await page.getByPlaceholder('起始地点（例如：凌晨的便利店）').fill('下过雨的街角');
 const submit=page.getByRole('button',{name:'开启场景',exact:true});
 await submit.evaluate(n=>{n.dispatchEvent(new MouseEvent('click',{bubbles:true}));n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 check((await invoke('snapshot')).pending.filter(p=>p.kind==='create').length===1,'same-frame create submits one scene');
 check(await page.getByRole('button',{name:'取消',exact:true}).isDisabled(),'cancel cannot abandon an active local creation write');
 await invoke('fail','create');await page.waitForTimeout(50);
 check(await page.getByRole('alert').filter({hasText:'没能开启这个场景'}).isVisible(),'failed creation keeps form and exposes retry error');
 check(await page.getByPlaceholder('起始地点（例如：凌晨的便利店）').inputValue()==='下过雨的街角','failed creation keeps location draft');
 await page.getByRole('button',{name:'开启场景',exact:true}).click();await invoke('complete','create','created-scene');await page.waitForTimeout(50);
 check(JSON.stringify((await invoke('snapshot')).opens)==='["created-scene"]','successful retry opens the unified canvas exactly once');
 await start();await page.getByRole('button',{name:'开启新场景',exact:true}).click();await page.getByRole('button',{name:/一位名字很长的同行者/}).click();
 await page.getByRole('button',{name:'开启场景',exact:true}).click();await invoke('account','other');await invoke('complete','create','old-owner-scene');await page.waitForTimeout(50);
 check((await invoke('snapshot')).opens.length===0,'old-account creation completion cannot navigate current account');
 check(await page.getByPlaceholder('起始地点（例如：凌晨的便利店）').count()===0,'account change clears previous creation draft');
 await start();await page.getByRole('button',{name:'开启新场景',exact:true}).click();await page.getByRole('button',{name:/一位名字很长的同行者/}).click();
 await page.getByRole('button',{name:'开启场景',exact:true}).click();await page.getByRole('button',{name:'返回世界',exact:true}).click();await invoke('complete','create','late-created-scene');await page.waitForTimeout(50);
 check((await invoke('snapshot')).opens.length===0&&(await invoke('snapshot')).view==='chat','finished local creation cannot pull user back after leaving');
 await guards();
 }
 check(result.errors.length===0,'no browser runtime errors');check(result.external===0,'no model or other external requests');
 result.status=result.failures.length?'failed':'pass';
} catch(error) {result.status='failed';result.error=error.stack;} finally {
 await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:result.checks.length,failures:result.failures,error:result.error}));
}
if(result.status!=='pass')process.exitCode=1;
