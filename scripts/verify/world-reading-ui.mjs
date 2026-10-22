import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Actual WorldCanvas + actual scrolling hook. Only data/network and child
// content are fixtures. No database, microphone or model request is available.
const reduced = process.env.VG_WORLD_REDUCED !== '0';
const out = process.env.VG_WORLD_SCROLL_OUTPUT || `.tmp-preview/ui-overhaul-20261015/world-reading-${reduced ? 'reduced' : 'animated'}`;
mkdirSync(out, { recursive: true });
const stubs = {
  'world-db': `export const db={worldScenes:{},transaction:async(_mode,...args)=>args.at(-1)()};`,
  'feedback': `export const useFeedback=()=>window.worldTest.toast;`,
  'auth-store': `import {create} from 'zustand';export const useAuthStore=create(()=>({userId:'reader'}));`,
  'chat-store': `const state={characters:[],loadCharacters:async()=>{}};export const useChatStore=Object.assign(s=>s(state),{getState:()=>state});`,
  'ui-store': `import {create} from 'zustand';export const useUIStore=create(()=>({activeView:'canvas',canvasSceneId:'scene',setCanvasSheetOpen:()=>{},setActiveView:()=>{},setMobileTab:()=>{}}));`,
  'world-repo': `export const worldRepo={ensureDefaultWorld:async()=>({id:'world'})};`,
  'world-scene-repo': `export const worldSceneRepo={getScene:async()=>window.worldTest.scene,getEntriesById:async ids=>window.worldTest.entries.filter(e=>ids.includes(e.id))};`,
  'world-location-repo': `export const worldLocationRepo={ensureFromScene:async()=>({id:'location'}),listForWorld:async()=>[]};`,
  'world-agent-repo': `export const worldAgentRepo={listAtLocation:async()=>[],listStates:async()=>[]};`,
  'world-event-repo': `export const worldEventRepo={};`,
  'world-canvas': `export const canvasPresence=async()=>{},ensureCanvasScene=async()=>window.worldTest.scene,isSavedAsStory=async()=>false,latestSuggestions=()=>null,loadCanvas=async()=>({scene:window.worldTest.scene,entries:window.worldTest.entries,total:window.worldTest.entries.length+1,hasMore:true}),loadEarlier=()=>window.worldTest.earlier(),moveSceneToLocation=async()=>null,pauseCanvas=async()=>{},saveAsStory=async()=>null,worldTimeLabel=()=> '傍晚';`,
  'world-turn': `export const runWorldTurn=async options=>{window.worldTest.onEvent=options.onEvent;return new Promise(resolve=>window.worldTest.turns.push({onEvent:options.onEvent,resolve}));},retryWorldTurn=async()=>null;`,
  'scene-runtime': `export const finishSceneAndSettle=async()=>({});`,
  'world-ai-client': `export const worldAiAvailability=async()=>({status:'AVAILABLE'});`,
  'world-kernel': `export const ensureWorldKernel=async()=>{};`,
  'world-autonomy': `export const runWorldPulse=async()=>({eventIds:[]});`,
  'world-immersion': `export const deriveWorldVisualState=()=>({}),visualCss=()=>({}),revealDelayFor=entry=>entry.meta?.delay||0;`,
  'Avatar': `export const Avatar=()=>null;`,
  'Icon': `export const Icon=()=>null;`,
  'WorldStream': `import React from 'react';export const WorldCharacterAvatar=()=>null;export const WorldStream=({entries})=><>{entries.map(e=><p key={e.id} data-entry={e.id} style={{height:48,margin:0}}>{e.id}</p>)}</>;`,
  'WorldControls': `import React from 'react';export const WorldComposer=p=><div><textarea aria-label="输入" value={p.value} onChange={e=>p.onChange(e.target.value)} onFocus={p.onFocusInput}/><button onClick={p.onSend}>发送</button></div>;export const WorldControlSheet=()=>null,WorldSuggestions=()=>null;`,
  'WorldExplorePanel': `export const WorldExplorePanel=()=>null;`,
  'StoryCompass': `export const StoryCompass=()=>null;`,
};
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {WorldCanvas} from './src/components/world/WorldCanvas';import {useUIStore} from './src/store/ui-store';import {useAuthStore} from './src/store/auth-store';
const make=(start,n)=>Array.from({length:n},(_,i)=>({id:'entry-'+(start+i),index:start+i,sceneId:'scene',kind:'dialogue',speakerId:'role',text:'真实组件阅读夹具'}));
window.worldTest={scene:{id:'scene',worldId:'world',userId:'reader',status:'active',title:'阅读验证',place:'窗边',characterIds:[],state:{}},entries:make(100,80),calls:0,messages:[],turns:[],toast:text=>window.worldTest.messages.push(text),switchScene(id){this.scene={...this.scene,id,title:id};this.entries=make(100,80).map(e=>({...e,id:id+'-'+e.id,sceneId:id}));useUIStore.setState({canvasSceneId:id});},logout(){useAuthStore.setState({userId:null});},earlier(){this.calls++;return new Promise((resolve,reject)=>{this.resolve=()=>resolve(make(40,60));this.reject=()=>reject(Error('isolated failure'));});}};
createRoot(document.getElementById('root')).render(<WorldCanvas/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'},plugins:[{name:'isolated-world',setup(b){b.onResolve({filter:/.*/},args=>{if(args.path.endsWith('/db/index'))return {path:'world-db',namespace:'world-stub'};const name=args.path.split('/').at(-1);if(stubs[name])return {path:name,namespace:'world-stub'};});b.onLoad({filter:/.*/,namespace:'world-stub'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const js=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?js:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px sans-serif;background:#141726;color:#eee}.vg-canvas{height:100dvh;display:flex;flex-direction:column}.vg-canvas-scroll{overflow:auto;flex:1;min-height:0}.vg-canvas-top,.vg-canvas-bottom{flex:none;padding:12px}textarea{height:44px}button{min-height:44px}</style><div id="root"></div><script src="/test.js"></script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],checks=[];let external=0;
try {
  const page=await browser.newPage({viewport:{width:320,height:740},reducedMotion:reduced?'reduce':'no-preference'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external++;return route.abort();});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const stream=page.locator('.vg-canvas-scroll');
  await page.locator('[data-entry]').last().waitFor();await page.waitForTimeout(500);
  await stream.evaluate(el=>{el.scrollTop=400;el.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(100);
  const before=await stream.evaluate(el=>el.scrollTop);
  await page.getByRole('textbox').focus();await page.waitForTimeout(450);
  assert.equal(await stream.evaluate(el=>el.scrollTop),before);checks.push('Focus while reading does not pull to latest');
  await page.setViewportSize({width:320,height:520});await page.waitForTimeout(450);
  assert.equal(await stream.evaluate(el=>el.scrollTop),before);checks.push('Keyboard-like viewport shrink preserves history position');
  await page.getByRole('button',{name:'查看更早内容'}).click();
  assert.equal(await page.evaluate(()=>worldTest.calls),1);
  assert.ok(await page.getByRole('button',{name:'正在读取更早内容…'}).isDisabled());checks.push('Earlier-content request disables duplicate submission');
  // Move again while the simulated request is pending. The anchor must use
  // this new position rather than the position at click time.
  await stream.evaluate(el=>el.scrollTop=560);
  const anchor=await page.locator('[data-entry="entry-112"]').evaluate(el=>el.getBoundingClientRect().top);
  await page.evaluate(()=>worldTest.resolve());await page.locator('[data-entry="entry-40"]').waitFor();await page.waitForTimeout(450);
  assert.ok(Math.abs(await page.locator('[data-entry="entry-112"]').evaluate(el=>el.getBoundingClientRect().top)-anchor)<1);checks.push('Prepending preserves visible row including movement during request');
  await page.getByRole('button',{name:'查看更早内容'}).click();await page.evaluate(()=>worldTest.reject());
  await page.getByRole('button',{name:'查看更早内容'}).waitFor();
  assert.equal(await page.evaluate(()=>worldTest.messages.length),1);checks.push('Failure restores retry without an unhandled rejection');
  await page.getByRole('textbox').fill('继续');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(()=>worldTest.onEvent);
  await stream.evaluate(el=>{el.scrollTop=500;el.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(100);
  await page.evaluate(()=>worldTest.onEvent({type:'entry',entry:{id:'new-reply',sceneId:'scene',index:180,kind:'dialogue',speakerId:'role',text:'新回复'}}));
  await page.locator('[data-entry="new-reply"]').waitFor();await page.waitForTimeout(450);
  assert.equal(await stream.evaluate(el=>el.scrollTop),500);assert.ok(await page.getByRole('button',{name:'↓ 新内容'}).isVisible());checks.push('Incoming reply leaves history still and exposes explicit return action');
  await page.screenshot({path:`${out}/reading-320.png`});
  await page.getByRole('button',{name:'↓ 新内容'}).click();await page.waitForTimeout(450);
  assert.ok(await stream.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<2));checks.push('Explicit new-content action returns to latest');
  await page.getByRole('textbox').focus();await page.setViewportSize({width:320,height:450});await page.waitForTimeout(450);
  assert.ok(await stream.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<2));checks.push('Viewport shrink still follows when already at latest');
  await page.getByRole('textbox').fill('不带去下一幕的草稿');
  await page.evaluate(()=>worldTest.onEvent({type:'entry',entry:{id:'delayed-old-reply',sceneId:'scene',kind:'dialogue',speakerId:'role',meta:{delay:300},text:'旧场景延迟内容'}}));
  await page.waitForTimeout(30);
  await page.evaluate(()=>worldTest.switchScene('scene-b'));
  await page.locator('.vg-canvas-title').filter({hasText:'scene-b'}).waitFor();
  await page.evaluate(()=>worldTest.turns[0].onEvent({type:'partial',turnId:'old',sceneId:'scene',speakerId:'role',field:'dialogue',text:'STALE_PRIVATE_PARTIAL'}));
  await page.waitForTimeout(400);
  assert.equal(await page.getByRole('textbox').inputValue(),'');
  assert.equal(await page.locator('[data-entry="delayed-old-reply"]').count(),0);
  assert.ok(!(await page.locator('body').innerText()).includes('STALE_PRIVATE_PARTIAL'));checks.push('Scene switch clears draft and rejects queued old reply and late stream');
  await page.evaluate(()=>worldTest.switchScene('scene'));
  await page.locator('.vg-canvas-title').filter({hasText:/^scene$/}).waitFor();
  await page.getByRole('textbox').fill('新一轮');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(()=>worldTest.turns.length===2);
  await page.evaluate(()=>{
    worldTest.turns[1].onEvent({type:'partial',turnId:'fresh',sceneId:'scene',speakerId:'role',field:'dialogue',text:'FRESH_CURRENT_PARTIAL'});
    worldTest.turns[0].onEvent({type:'entry',entry:{id:'aba-old-reply',sceneId:'scene',kind:'dialogue',speakerId:'role',text:'old'}});
    worldTest.turns[0].resolve({status:'completed',suggestions:['OLD_SUGGESTION']});
  });
  await page.waitForTimeout(450);
  assert.equal(await page.locator('[data-entry="aba-old-reply"]').count(),0);
  assert.ok((await page.locator('body').innerText()).includes('FRESH_CURRENT_PARTIAL'));checks.push('A-B-A rejects old lifetime and old completion cannot clear current stream');
  await page.getByRole('button',{name:'查看更早内容'}).click();
  await page.evaluate(()=>{worldTest.oldResolve=worldTest.resolve;worldTest.switchScene('scene-c');});
  await page.locator('.vg-canvas-title').filter({hasText:'scene-c'}).waitFor();
  await page.evaluate(()=>worldTest.oldResolve());await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-entry="entry-40"]').count(),0);
  assert.ok(await page.getByRole('button',{name:'查看更早内容'}).isEnabled());checks.push('Old pagination cannot enter new scene or lock its loading control');
  await page.evaluate(()=>worldTest.logout());await page.waitForTimeout(100);
  assert.equal(await page.locator('.vg-canvas').count(),0);checks.push('Logout immediately removes scene content');
  assert.deepEqual(errors,[]);assert.equal(external,0);
} finally {
  writeFileSync(`${out}/result.json`,JSON.stringify({recordedAt:new Date().toISOString(),reducedMotion:reduced,checks,errors,externalRequests:external,scope:'Actual WorldCanvas and scrolling hook; isolated fixture child rows and data, no Android keyboard or model calls'},null,2));
  await browser.close();await new Promise(r=>server.close(r));
}
console.log(`PASS ${checks.length} world reading checks`);
