import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Preview-only fixture. The production host, dialog, controls, captions and orb
// are bundled without replacement. Only native access and call-store actions
// are substituted; no controller, microphone, audio or model session is run.
const evidence = resolve(process.env.VG_CALL_REFERENCE_OUTPUT || '.tmp-preview/ui-overhaul-20261016/call-fidelity/preview');
const portArg = process.argv.find(argument => argument.startsWith('--port='));
const port = portArg ? Number(portArg.slice(7)) : 5396;
const verify = process.argv.includes('--verify');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid preview port');
mkdirSync(evidence, { recursive: true });
const assets = new Map();
for (const name of readdirSync('dist/renderer/assets')) {
  if (/\.(?:woff2|png|webp|svg)$/.test(name)) assets.set(`/assets/${name}`, readFileSync(join('dist/renderer/assets', name)));
}
for (const name of readdirSync('src/assets/fonts').filter(name => name.endsWith('.woff2'))) {
  assets.set(`/font/${name}`, readFileSync(join('src/assets/fonts', name)));
}
// Snapshot all input bytes before listening. A later renderer rebuild cannot
// delete a font/CSS file underneath an already-running preview.
const rendererCss = readdirSync('dist/renderer/assets').filter(name => name.endsWith('.css')).sort().map(name => readFileSync(join('dist/renderer/assets', name), 'utf8')).join('\n').replace(/url\(\.\/([^)]*)\)/g, 'url(/assets/$1)');
const fontCss = readFileSync('src/styles/ui-fonts.css', 'utf8').replaceAll('../assets/fonts/', '/font/');
const input = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {db} from './src/db';
import {VoiceCallHost} from './src/components/chat/VoiceCallHost';
import {useVoiceCallUIStore} from './src/store/voice-call-ui-store';
import {useVoiceCallStore} from './src/store/voice-call-store';
import {useAuthStore} from './src/store/auth-store';
import {useChatBackgroundStore} from './src/store/chat-background-store';
import {backgroundSettingKey} from './src/db/chat-background-repo';
import {DEFAULT_CHAT_BACKGROUND} from './src/lib/chat-background-config';
import {CHAT_ATMOSPHERE_THEMES} from './src/lib/chat-atmosphere';
import {installUiFont} from './src/lib/ui-font';
import {useSettingsStore} from './src/store/settings-store';
const theme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
document.documentElement.classList.toggle('dark',theme==='dark');
document.documentElement.dataset.vgReducedMotion='false';
installUiFont();
const role={id:'call-reference-role-'+theme,name:'知微',avatar:'',createdBy:'call-reference-user',createdAt:1,isPreset:false,isCustom:true,published:false,tags:[],proactivity:0,systemPrompt:''};
const owner={userId:role.createdBy,characterId:role.id,sessionId:'call-reference-session-'+theme};
const mutate=patch=>{const state=useVoiceCallStore.getState();useVoiceCallStore.setState({view:{...state.view,...patch}});};
async function boot(){
  await db.open();
  useAuthStore.setState({userId:role.createdBy});
  useSettingsStore.setState({chatBackgroundEnabled:true});
  await db.characters.put(role);
  await db.sessions.put({id:owner.sessionId,characterId:role.id,userId:role.createdBy,title:role.name,createdAt:1,updatedAt:1,unreadCount:0});
  const key=backgroundSettingKey(role.createdBy,role.id);
  useChatBackgroundStore.setState({ready:{[role.createdBy]:true},rows:{[key]:{id:key,userId:role.createdBy,roleId:role.id,revision:1,config:{...DEFAULT_CHAT_BACKGROUND,themeId:theme==='dark'?'cool':'steady'}}},errors:{}});
  useVoiceCallStore.setState({owner,busy:true,saving:false,finishing:undefined,error:undefined,
    record:{...owner,id:'call-reference-record-'+theme,startedAt:Date.now()-134000,voice:'茉莉',status:'active',exchanges:[],messageIds:[],summaryState:'pending'},
    view:{phase:'listening',inputMode:'voice',userText:'今天有点累，想和你说说话。',generatedText:'',heardText:'那就慢慢说，我在听。',level:0,muted:false,capabilities:{sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[{id:2,type:2,label:'扬声器',selected:true}]}},
    start:async()=>{throw Error('preview:start-blocked');},
    end:async()=>{mutate({phase:'ended'});useVoiceCallStore.setState({busy:false,record:{...useVoiceCallStore.getState().record,status:'ended',endedAt:Date.now()}});},
    mute:async()=>mutate({muted:!useVoiceCallStore.getState().view.muted}),
    setInputMode:async inputMode=>mutate({inputMode}),
    sendText:async text=>{mutate({userText:text,phase:'listening'});return true;},
    interrupt:async()=>mutate({phase:'listening',speakingText:undefined}),
    resume:async()=>mutate({phase:'listening',error:undefined}),
    routes:async()=>{},route:async()=>{},cancelRouteWait:async()=>{},
    summarize:async()=>{throw Error('preview:summary-blocked');}
  });
  useVoiceCallUIStore.getState().open({character:role,...owner});
  createRoot(document.getElementById('root')).render(<VoiceCallHost/>);
  window.callReferencePreview={ready:true,theme,expectedAccent:CHAT_ATMOSPHERE_THEMES.find(p=>p.id===(theme==='dark'?'cool':'steady'))[theme].accent,boundary:'UI fixture; no actual microphone, audio, model, native bridge or call success',phase:phase=>mutate({phase}),color:id=>useSettingsStore.setState({orbColor:id}),restore:()=>useVoiceCallUIStore.getState().restore()};
}
boot().catch(error=>{document.getElementById('root').textContent='隔离预览未能启动：'+error.message;throw error;});
`;
const nativeGuard = `
export const Capacitor={getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>false,convertFileSrc:()=>{throw Error('preview:native-blocked')}};
export const registerPlugin=name=>new Proxy({}, {get:(_target,method)=>()=>{window.__previewIsolation.native++;return Promise.reject(Error('preview:native-blocked:'+name+'.'+String(method)));}});
export class WebPlugin{addListener(){window.__previewIsolation.native++;return Promise.reject(Error('preview:native-blocked'));}unavailable(){return Error('preview:native-blocked');}unimplemented(){return Error('preview:native-blocked');}}
export function buildRequestInit(){window.__previewIsolation.native++;throw Error('preview:native-blocked');}
`;
const bundled = await build({ stdin: { contents: input, loader: 'tsx', resolveDir: process.cwd(), sourcefile: 'call-reference-fixture.tsx' }, outfile: 'preview.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{"DEV":false}', 'import.meta.hot': 'false', __APP_VERSION__: '"isolated-ui-preview"' }, plugins: [{ name: 'preview-native-boundary', setup(builder) { builder.onResolve({ filter: /^@capacitor\/core$/ }, () => ({ path: 'native-preview-guard', namespace: 'preview' })); builder.onLoad({ filter: /.*/, namespace: 'preview' }, () => ({ contents: nativeGuard, loader: 'js' })); } }] });
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const componentCss = bundled.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const css = `${rendererCss}\n${componentCss}\n${fontCss}`;
const isolation = `
window.__previewIsolation={fetch:0,xhr:0,socket:0,media:0,audio:0,native:0};
const previewUrl=new URL(location.href);previewUrl.searchParams.set('virtugene-preview','mobile');history.replaceState(null,'',previewUrl);
window.fetch=()=>{window.__previewIsolation.fetch++;return Promise.reject(Error('preview:fetch-blocked'));};
XMLHttpRequest.prototype.open=function(){window.__previewIsolation.xhr++;throw Error('preview:xhr-blocked');};
for(const name of ['WebSocket','EventSource','RTCPeerConnection'])if(name in window)window[name]=class{constructor(){window.__previewIsolation.socket++;throw Error('preview:socket-blocked');}};
for(const name of ['AudioContext','webkitAudioContext','OfflineAudioContext','Audio'])if(name in window)window[name]=class{constructor(){window.__previewIsolation.audio++;throw Error('preview:audio-blocked');}};
HTMLMediaElement.prototype.play=function(){window.__previewIsolation.audio++;return Promise.reject(Error('preview:playback-blocked'));};
if(navigator.mediaDevices){navigator.mediaDevices.getUserMedia=()=>{window.__previewIsolation.media++;return Promise.reject(Error('preview:microphone-blocked'));};navigator.mediaDevices.getDisplayMedia=()=>{window.__previewIsolation.media++;return Promise.reject(Error('preview:capture-blocked'));};}
if(navigator.sendBeacon)navigator.sendBeacon=()=>{window.__previewIsolation.fetch++;return false;};
window.Android=undefined;window.android=undefined;window.webkit=undefined;window.cordova=undefined;
try{localStorage.removeItem('virtugene-auth');}catch{}
`;
const single = theme => `<!doctype html><html class="${theme === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>真实通话组件 · 模拟状态 · ${theme}</title><style>${css}\nhtml,body,#root{margin:0;min-height:100%;width:100%}#preview-disclosure{position:fixed;bottom:2px;left:0;right:0;z-index:2147483647;text-align:center;font:10px/1.4 sans-serif;color:${theme === 'dark' ? '#b7afcf' : '#625d72'};pointer-events:none}</style><script>${isolation}</script></head><body><div id="root"></div><aside id="preview-disclosure">模拟通话界面 · 无麦克风 / 声音 / 模型连接</aside><script src="/preview.js"></script></body></html>`;
const compare = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>实际通话组件 · 深浅对照</title><style>body{margin:0;background:#10111b;color:#eee;font:14px/1.7 system-ui,sans-serif}header{padding:16px 24px;max-width:850px;margin:auto}h1{font-size:19px;margin:0 0 5px}p{margin:3px 0;color:#c2c2cf}a{color:#bde7e7}main{display:flex;justify-content:center;gap:28px;padding:12px 20px 32px}iframe{display:block;width:390px;height:844px;border:1px solid #424251;border-radius:28px;background:#15131e}figure{margin:0}figcaption{text-align:center;padding:8px}nav{display:flex;gap:20px}@media(max-width:700px){main{padding:0;display:block}figure{display:none}header{padding:12px 16px}}</style></head><body><header><h1>真实通话组件 · 深浅主题对照</h1><p>以下为实际 VoiceCallHost / SoulOrb，使用模拟“正在听你说”状态，不是通话实测或概念绘图。</p><p>本地独立来源、合成角色与文字；网络、麦克风、音频、原生桥已禁用。计时从 02:14 运行。</p><nav><a href="/single?theme=dark">打开深色手机页面</a><a href="/single?theme=light">打开浅色手机页面</a></nav></header><main><figure><iframe title="深色实际组件 · 模拟状态" src="/single?theme=dark"></iframe><figcaption>雾月 · 深色</figcaption></figure><figure><iframe title="浅色实际组件 · 模拟状态" src="/single?theme=light"></iframe><figcaption>青岚 · 浅色</figcaption></figure></main><script>if(innerWidth<=700)location.replace('/single?theme='+((new URLSearchParams(location.search).get('theme')==='light')?'light':'dark'));</script></body></html>`;
const manifest = { generatedAt: new Date().toISOString(), component: 'Actual VoiceCallHost, VoiceCallDialog, VoiceCallControlIcon, VoiceCallCaptions, SoulOrb; source imports bundled unchanged', simulated: ['call-store lifecycle and user actions', 'listening phase', 'two caption strings', '134-second elapsed start', 'capabilities: echoCancellation true'], isolation: ['127.0.0.1 binding, independent preview origin', 'synthetic role/user/session only; no app credentials imported', 'fetch/XHR/WebSocket/EventSource/WebRTC/sendBeacon blocked', 'getUserMedia/getDisplayMedia/Audio/AudioContext/play blocked', 'Capacitor native modules replaced with rejecting preview guards', 'CSP connect-src none, media-src none, worker-src none', 'CSS and font/image bytes snapshotted in server memory'], cssSha256: createHash('sha256').update(css).digest('hex'), jsSha256: createHash('sha256').update(js).digest('hex'), assetCount: assets.size, source: resolve('scripts/preview-call-reference.mjs'), command: 'node scripts/preview-call-reference.mjs --port=5396', urls: { compare: 'http://127.0.0.1:5396/', dark: 'http://127.0.0.1:5396/single?theme=dark', light: 'http://127.0.0.1:5396/single?theme=light' }, limits: 'Desktop Chromium fixture only. Not Android, microphone, actual dialogue, playback, hardware routes, installed APK or model quality validation.' };
writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2));
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; frame-src 'self'; connect-src 'none'; media-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'");
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/preview.js') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(js); return; }
  const asset = assets.get(url.pathname);
  if (asset) { response.setHeader('Content-Type', url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.webp') ? 'image/webp' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png'); response.end(asset); return; }
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (!['/', '/single'].includes(url.pathname)) { response.writeHead(404); response.end('Not found'); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(url.pathname === '/single' ? single(url.searchParams.get('theme') === 'light' ? 'light' : 'dark') : compare);
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(verify ? 0 : port, '127.0.0.1', resolveListen); });
const address = `http://127.0.0.1:${server.address().port}`;
if (!verify) {
  console.log(`Isolated actual component preview: ${address}/; mobile: ${address}/single?theme=dark`);
  console.log('Synthetic UI state only. No microphone, sound, native bridge or model calls. Stop this process to close this preview.');
} else {
  const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
  let browser; const results = []; let external = 0;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await context.route('**/*', route => new URL(route.request().url()).origin === address ? route.continue() : (external++, route.abort()));
      const page = await context.newPage(), errors = [], fontResponses = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().endsWith('.woff2')) fontResponses.push({ status: response.status(), url: response.url() }); });
      await page.goto(`${address}/single?theme=${theme}`);
      await page.waitForFunction(() => window.callReferencePreview?.ready);
      await page.getByRole('button', { name: '挂断', exact: true }).waitFor();
      const loadedFaces = await page.evaluate(async () => { await document.fonts.ready; return (await document.fonts.load('400 16px "VG Sans"', '知微正在听你说今天有点累')).map(face => ({ family: face.family, status: face.status })); });
      await page.waitForFunction(() => document.documentElement.dataset.vgFont === 'variable');
      const data = await page.evaluate(() => ({
        isolation: window.__previewIsolation, font: document.documentElement.dataset.vgFont, fontCheck: document.fonts.check('400 16px "VG Sans"', '知微正在听你说'),
        captionRows: document.querySelectorAll('.vg-voice-caption-current .vg-voice-caption-line').length,
        buttons: [...document.querySelectorAll('.vg-voice-call-controls button')].map(node => { const r = node.getBoundingClientRect(), svg = node.querySelector('svg'), s = svg.getBoundingClientRect(); return { text: node.textContent, x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, iconSize: s.width }; }),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        disclosure: document.getElementById('preview-disclosure').textContent,
        accent:getComputedStyle(document.querySelector('.vg-voice-call-modal')).getPropertyValue('--chat-accent').trim(),expectedAccent:window.callReferencePreview.expectedAccent,
      }));
      assert.equal(data.captionRows, 2); assert.equal(data.buttons.length, 4); assert.equal(data.overflow, false);
      assert.equal(await page.locator('.vg-voice-call-modal.vg-mobile-page').count(),1);
      assert.equal(data.accent,data.expectedAccent);
      if(process.argv.includes('--material')) {
        const rim=await page.locator('.vg-voice-call-soul .vg-soul-orb').evaluate(node=>({actual:getComputedStyle(node).getPropertyValue('--orb-cyan').trim(),expected:getComputedStyle(node).getPropertyValue('--chat-cyan').trim()}));
        writeFileSync(join(evidence,`rim-${theme}.json`),JSON.stringify(rim,null,2));
        assert.equal(rim.actual,rim.expected,'Automatic voice rim follows the actual room theme in both schemes');
        await page.evaluate(()=>window.callReferencePreview.color('rose'));
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('.vg-voice-call-soul .vg-soul-orb')).getPropertyValue('--orb-cyan').trim()==='#ffc5dc');
        const custom=await page.locator('.vg-voice-call-soul .vg-soul-orb').evaluate(node=>({body:getComputedStyle(node).getPropertyValue('--orb-body').trim(),rim:getComputedStyle(node).getPropertyValue('--orb-cyan').trim()}));
        assert.deepEqual(custom,{body:'#cf7ba3',rim:'#ffc5dc'},'Explicit user colour stays above voice theme defaults');
        await page.evaluate(()=>window.callReferencePreview.color('auto'));
        await page.waitForFunction(()=>{const node=document.querySelector('.vg-voice-call-soul .vg-soul-orb');return getComputedStyle(node).getPropertyValue('--orb-cyan').trim()===getComputedStyle(node).getPropertyValue('--chat-cyan').trim();});
        writeFileSync(join(evidence,`custom-${theme}.json`),JSON.stringify(custom,null,2));
      }
      assert.ok(data.buttons.every(button => button.width >= 48 && button.height >= 48 && button.y >= 0 && button.bottom <= 844));
      assert.equal(data.font, 'variable'); assert.equal(data.fontCheck, true); assert.ok(loadedFaces.length > 0 && loadedFaces.every(face => face.status === 'loaded')); assert.ok(fontResponses.length > 0 && fontResponses.every(response => response.status === 200));
      assert.ok(Object.values(data.isolation).every(value => value === 0), JSON.stringify(data.isolation));
      assert.deepEqual(errors, []); assert.equal(external, 0);
      await page.screenshot({ path: join(evidence, `actual-${theme}-390.png`) });
      const responsive=[];
      for(const width of [320,430]){
        await page.setViewportSize({width,height:844});
        const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:[...document.querySelectorAll('.vg-voice-call-controls button')].map(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height,bottom:r.bottom,top:r.top,iconSize:node.querySelector('svg').getBoundingClientRect().width};})}));
        assert.equal(layout.overflow,false);assert.ok(layout.buttons.length===4&&layout.buttons.every(button=>button.width>=48&&button.height>=48&&button.top>=0&&button.bottom<=844));
        await page.screenshot({path:join(evidence,`actual-${theme}-${width}.png`)});responsive.push({width,...layout});
      }
      results.push({ theme, viewport: { width: 390, height: 844 }, checks: 14, ...data, loadedFaces, fontResponses, errors,responsive });
      await context.close();
    }
    const comparePage=await browser.newPage({viewport:{width:1000,height:1050},reducedMotion:'reduce'});
    await comparePage.route('**/*',route=>new URL(route.request().url()).origin===address?route.continue():(external++,route.abort()));
    await comparePage.goto(address);await comparePage.frameLocator('iframe').first().getByRole('button',{name:'挂断',exact:true}).waitFor();await comparePage.frameLocator('iframe').last().getByRole('button',{name:'挂断',exact:true}).waitFor();
    assert.equal(await comparePage.locator('iframe').count(),2);assert.equal(external,0);
    await comparePage.screenshot({path:join(evidence,'actual-side-by-side.png')});await comparePage.close();
    const report = { status: 'pass', checks: 2+results.reduce((sum, result) => sum + result.checks, 0), externalRequests: external, realModelCalls: 0, realMicrophoneCalls: 0, realPlaybackCalls: 0, results, limits: manifest.limits };
    writeFileSync(join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, checks: report.checks, externalRequests: external, evidence }));
  } finally { await browser?.close(); await new Promise(resolveClose => server.close(resolveClose)); }
}
