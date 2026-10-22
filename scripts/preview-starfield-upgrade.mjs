import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function starfieldPreview({ port = 5293, output, materialTransport = 'inline', stage2Samples = false, samplePresentation = true } = {}) {
  const out = resolve(output || `.tmp-preview/starfield-upgrade-20261017/P0/runs/${Date.now()}`);
  mkdirSync(out, { recursive: true });
  const renderer = join(out, 'renderer');
  cpSync('dist/renderer', renderer, { recursive: true });
  const material = materialTransport === 'http' ? readdirSync(join(renderer,'assets')).find(name=>/^mineral-world-.*\.webp$/.test(name)) : undefined;
  const materialWindow = materialTransport === 'http' ? readdirSync(join(renderer,'assets')).find(name=>/^orbit-window-.*\.webp$/.test(name)) : undefined;
  if(materialTransport==='http'&&!material)throw Error('Build the actual mineral-world asset before HTTP fault tests');
  const samplePlugin={name:'stage2-preview-opt-in',setup(b){
    b.onLoad({filter:/[\\/]pages[\\/]ChatPage\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace('<ChatWindow />','<ChatWindow surface="light-paper" />'),loader:'tsx'}));
    b.onLoad({filter:/[\\/]world[\\/]WorldMemoryPage\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace('<TimelineRecordDialog key=','<TimelineRecordDialog surface="light-paper" key='),loader:'tsx'}));
  }};
  const bundle = await build({ entryPoints:[stage2Samples?'scripts/verify/stage2-samples-preview.tsx':'scripts/verify/starfield-upgrade-preview.tsx'], bundle:true, write:false, metafile:true, format:'iife', platform:'browser', jsx:'automatic',
    loader:{'.css':'empty','.png':'dataurl','.webp':'dataurl','.jpg':'dataurl','.svg':'dataurl'},
    define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined','process.env.NODE_ENV':'"production"',__APP_VERSION__:'"starfield-test-only"'},
    plugins:[...(stage2Samples&&samplePresentation?[samplePlugin]:[]),...(material?[{name:'actual-material-http',setup(b){b.onLoad({filter:/(mineral-world|orbit-window)\.webp$/},args=>{const file=args.path.endsWith('orbit-window.webp')?materialWindow:material;if(!file)throw Error('Missing current built visual asset');return {contents:`export default ${JSON.stringify('/assets/'+file)}`,loader:'js'};});}}]:[])] });
  const js = bundle.outputFiles[0].text;
  const inputs = Object.keys(bundle.metafile.inputs).filter(p => existsSync(p)).map(path => ({path,sha256:sha(readFileSync(path))}));
  const css = readdirSync(join(renderer,'assets')).filter(p=>p.endsWith('.css'));
  const nonce = randomUUID();
  const manifest = {at:new Date().toISOString(),purpose:'P0 isolated actual-component test, not the signed-in product',stage2Samples,samplePresentation,previewOnlyPropInjection:stage2Samples&&samplePresentation?'ChatPage → ChatWindow.surface=light-paper; legacy memory caller only if needed':undefined,inputs,bundleSha256:sha(js),materialTransport,material,materialWindow,
    styles:css.map(path=>({path,sha256:sha(readFileSync(join(renderer,'assets',path)))})),native:false};
  writeFileSync(join(out,'source-hashes.json'),JSON.stringify(manifest,null,2));
  writeFileSync(join(out,'fixture.js'),js);
  const guards = `window.__starfieldTestOrigin=${JSON.stringify(nonce)};window.previewIsolation={fetchBlocked:0,xhrBlocked:0,socketBlocked:0,microphoneBlocked:0,audioBlocked:0,nativeBridgeBlocked:0,modelBlocked:0};const g=window.previewIsolation;
  window.fetch=async()=>{g.fetchBlocked++;throw Error('Test blocks network')};XMLHttpRequest.prototype.open=function(){g.xhrBlocked++;throw Error('Test blocks XHR')};navigator.sendBeacon=()=>{g.socketBlocked++;return false};
  for(const name of ['WebSocket','EventSource','Worker','SharedWorker'])window[name]=class{constructor(){g.socketBlocked++;throw Error('Test blocks sockets/workers')}};
  if(navigator.mediaDevices)for(const name of ['getUserMedia','getDisplayMedia'])navigator.mediaDevices[name]=async()=>{g.microphoneBlocked++;throw Error('Test blocks capture')};
  HTMLMediaElement.prototype.play=async()=>{g.audioBlocked++;throw Error('Test blocks playback')};if(window.speechSynthesis)window.speechSynthesis.speak=()=>{g.audioBlocked++};
  for(const name of ['SpeechRecognition','webkitSpeechRecognition'])window[name]=class{start(){g.microphoneBlocked++;throw Error('Test blocks recognition')}};
  for(const name of ['AudioContext','webkitAudioContext'])window[name]=class{constructor(){g.audioBlocked++;throw Error('Test blocks audio')}};
  window.Capacitor={getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>false,nativePromise:async()=>{g.nativeBridgeBlocked++;throw Error('Test blocks native')},nativeCallback:()=>{g.nativeBridgeBlocked++;throw Error('Test blocks native')}};
  window.__starfieldSourceHashes=${JSON.stringify({bundleSha256:manifest.bundleSha256,inputCount:inputs.length,styles:manifest.styles})};`;
  const server=createServer((req,res)=>{
    const url=new URL(req.url||'/','http://localhost');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; frame-src 'self'; object-src 'none'");
    if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(js);return;}
    if(url.pathname.startsWith('/assets/')||url.pathname.startsWith('/fonts/')){
      const file=resolve(renderer,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(renderer+'\\')&&!file.startsWith(renderer+'/')){res.writeHead(403).end();return;}
      try{res.setHeader('Content-Type',({'.css':'text/css','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}return;
    }
    res.setHeader('Content-Type','text/html;charset=utf-8');
    if(url.pathname==='/app'){
      res.end(`<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0e16"><title>星域P0 · 独立测试资料</title>${css.map(p=>`<link rel="stylesheet" href="/assets/${p}">`).join('')}<style>html,body,#app{height:100%;margin:0}</style><script>${guards}</script></head><body><div id="app"></div><script src="/fixture.js"></script></body></html>`);return;
    }
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>星域P0测试入口</title><style>body{margin:0;background:#0b0e16;color:#ecebf3;font:14px system-ui}header{padding:12px}iframe{display:block;margin:auto;width:390px;height:844px;border:0}a{color:#bca8ef}</style></head><body><header>独立测试资料 · 真实组件 · 无模型/麦克风/音频。非用户已登录页面。<a href="/app?virtugene-preview=mobile">打开实际组件测试</a></header><iframe title="390×844星域测试" src="/app?virtugene-preview=mobile&amp;${new URLSearchParams(url.searchParams).toString().replaceAll('&','&amp;')}"></iframe></body></html>`);
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  const address=`http://127.0.0.1:${server.address().port}`;
  const info={pid:process.pid,address,out,startedAt:new Date().toISOString(),testOnly:true};
  writeFileSync(join(out,'server.json'),JSON.stringify(info,null,2));
  return {server,address,out,manifest,info};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7)||5293);
  const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
  console.log(JSON.stringify((await starfieldPreview({port,output,stage2Samples:process.argv.includes('--samples'),samplePresentation:!process.argv.includes('--production-chat')})).info));
}
