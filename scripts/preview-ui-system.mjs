import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const renderer = resolve('dist/renderer');
const evidence = resolve('.tmp-preview/ui-overhaul-20261015/ui-system');
const digest = value => createHash('sha256').update(value).digest('hex');
const layoutCss = `
html,body{min-height:100%;height:auto;margin:0;overflow:auto}*{box-sizing:border-box}body{background:var(--bg);color:var(--text)}button,input,select{font-family:inherit}.contract-shell{max-width:1240px;margin:auto;padding:0 28px}.contract-header{display:flex;gap:32px;justify-content:space-between;padding:38px 0 24px;border-bottom:1px solid var(--border)}.contract-header>div:first-child{max-width:650px}.contract-kicker{display:block;color:var(--text-secondary);font-size:12px;line-height:1.6}.contract-header h1{margin:12px 0;font-size:30px;line-height:1.35;letter-spacing:0;font-weight:var(--vg-weight-heading)}.contract-header p,.contract-section-heading p{margin:0;color:var(--text-secondary);font-size:14px;line-height:1.8}.contract-toolbar{display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;flex-wrap:wrap}.contract-toolbar button{font-size:13px;white-space:nowrap}.contract-nav{display:flex;flex-wrap:wrap;gap:4px 20px;padding:12px 0;border-bottom:1px solid var(--border)}.contract-nav a{display:flex;align-items:center;min-height:44px;color:var(--text-secondary);font-size:13px;text-decoration:none}.contract-nav a:focus-visible{outline:2px solid var(--vg-accent);outline-offset:2px}.contract-section{padding:32px 0;border-bottom:1px solid var(--border);scroll-margin-top:12px}.contract-section-heading{margin-bottom:22px}.contract-section-heading h2{font-size:22px;line-height:1.4;margin:0 0 8px;font-weight:var(--vg-weight-heading)}.contract-two-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px}.contract-type-samples{display:flex;flex-direction:column;gap:20px}.contract-type-samples p{margin:0}.contract-materials{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.contract-materials>div{padding:22px 18px;border:1px solid var(--vg-elev-edge);border-radius:18px}.contract-materials strong{font-size:15px;line-height:1.6}.contract-materials code{display:block;color:var(--text-secondary);font-size:12px;line-height:1.6;margin:10px 0;overflow-wrap:anywhere}.contract-materials p{font-size:13px;line-height:1.7;color:var(--text-secondary);margin:0}.contract-button-row{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.contract-state-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin-top:28px}.contract-state-grid h3{font-size:14px;line-height:1.6;margin:0 0 14px}.contract-state-grid p,.contract-caption{font-size:12px;line-height:1.7;color:var(--text-secondary);margin:10px 0 0}.contract-state-grid button{max-width:100%;font-size:14px}.contract-chat-sample{display:flex;flex-direction:column;gap:18px;min-width:0}.contract-chat-sample .is-user-bubble{align-self:flex-end;max-width:88%}.contract-status{font-size:13px;line-height:1.7;color:var(--text-secondary)}.contract-storyboard+.contract-storyboard{margin-top:32px;padding-top:32px;border-top:1px solid var(--border)}.contract-storyboard-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:18px}.contract-storyboard h3{font-size:18px;line-height:1.5;margin:0}.contract-storyboard-heading>span{font-size:12px;line-height:1.5;color:var(--text-secondary)}.contract-frames{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;max-width:720px}.contract-frames figure{margin:0}.contract-frame{display:block;width:100%;max-height:210px}.contract-frames figcaption{display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:1.6;margin-top:12px}.contract-frames figcaption>span{color:var(--text-secondary)}.contract-storyboard ol{margin:22px 0;padding-left:20px;font-size:14px;line-height:1.9}.contract-storyboard dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:0;padding-top:16px;border-top:1px solid var(--border);font-size:13px;line-height:1.8}.contract-storyboard dt{font-weight:600}.contract-storyboard dd{margin:6px 0 0;color:var(--text-secondary)}.contract-dialog-actions{display:flex;justify-content:flex-end;gap:12px;padding:14px 20px}.contract-footer{padding:28px 0;font-size:12px;line-height:1.8;color:var(--text-secondary)}
@media(max-width:700px){.contract-shell{padding:0 18px}.contract-header{flex-direction:column;gap:20px;padding-top:24px}.contract-header h1{font-size:26px}.contract-toolbar{justify-content:flex-start}.contract-two-columns{grid-template-columns:1fr;gap:24px}.contract-state-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 14px}.contract-materials{gap:12px}.contract-materials>div{padding:18px 14px}.contract-section{padding:26px 0}.contract-storyboard-heading{flex-direction:column;gap:6px}.contract-frames{gap:10px}.contract-frames figcaption{font-size:12px}.contract-storyboard dl{grid-template-columns:1fr;gap:14px}.contract-button-row .vg-button{font-size:14px}.contract-nav{gap:0 16px}}
`;
const guards = `window.uiContractIsolation={network:0,microphone:0,playback:0,native:0};const g=window.uiContractIsolation;window.fetch=async()=>{g.network++;throw Error('UI contract blocks network')};XMLHttpRequest.prototype.open=function(){g.network++;throw Error('UI contract blocks XHR')};for(const name of ['WebSocket','EventSource','Worker','SharedWorker'])window[name]=class{constructor(){g.network++;throw Error('UI contract blocks network worker')}};navigator.sendBeacon=()=>false;navigator.vibrate=()=>false;if(navigator.mediaDevices){navigator.mediaDevices.getUserMedia=async()=>{g.microphone++;throw Error('UI contract microphone disabled')};navigator.mediaDevices.getDisplayMedia=async()=>{g.microphone++;throw Error('UI contract media disabled')}};HTMLMediaElement.prototype.play=async function(){g.playback++;throw Error('UI contract playback disabled')};if(window.speechSynthesis)window.speechSynthesis.speak=()=>{g.playback++};for(const name of ['SpeechRecognition','webkitSpeechRecognition'])window[name]=class{start(){g.microphone++;throw Error('UI contract recognition disabled')}};for(const name of ['AudioContext','webkitAudioContext'])window[name]=class{constructor(){g.playback++;throw Error('UI contract audio disabled')}};window.Capacitor={getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>false,nativePromise:async()=>{g.native++;throw Error('UI contract native bridge disabled')},nativeCallback:()=>{g.native++;throw Error('UI contract native bridge disabled')}};`;

export async function uiSystemPreview({ port = 5291, watch = true, material = false, output } = {}) {
  const evidence = resolve(output || (material ? '.tmp-preview/starfield-upgrade-20261017/P1/preview' : '.tmp-preview/ui-overhaul-20261015/ui-system'));
  if (!existsSync(join(renderer, 'assets'))) throw Error('Missing dist/renderer assets; use the project renderer build before this preview.');
  mkdirSync(evidence, { recursive: true });
  let javascript = '', currentBuild;
  const bundler = await context({ entryPoints: [material ? 'scripts/verify/starfield-material-sample.tsx' : 'scripts/verify/ui-system-contract.tsx'], bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css':'empty','.svg':'dataurl','.png':'dataurl','.webp':'dataurl','.jpg':'dataurl' },
    define: { 'import.meta.env':'{"DEV":true}', 'import.meta.hot':'undefined', __APP_VERSION__:'"ui-contract-preview"' },
    plugins: [{name:'record-ui-contract-build',setup(build){build.onEnd(result=>{
      if(result.errors.length) return;
      javascript=result.outputFiles[0].text;
      currentBuild={builtAt:new Date().toISOString(),bundleSha256:digest(javascript),inputs:Object.keys(result.metafile.inputs).filter(path=>existsSync(path)).map(path=>({path:path.replaceAll('\\','/'),sha256:digest(readFileSync(path))}))};
      writeFileSync(join(evidence,'preview-build.json'),JSON.stringify(currentBuild,null,2));
    });}}],
  });
  await bundler.rebuild();
  if(watch)await bundler.watch();
  const server = createServer((req,res)=>{
    const url=new URL(req.url||'/','http://127.0.0.1');
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript;charset=utf-8');res.end(javascript);return;}
    if(url.pathname==='/preview-manifest.json'){
      const css=readdirSync(join(renderer,'assets')).filter(name=>name.endsWith('.css')).map(name=>({path:`dist/renderer/assets/${name}`,sha256:digest(readFileSync(join(renderer,'assets',name)))}));
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...currentBuild,css,isolation:'Synthetic state only; fetch/XHR/sockets/microphone/playback/native bridge blocked.'}));return;
    }
    if(url.pathname.startsWith('/assets/')||url.pathname.startsWith('/fonts/')){
      const file=resolve(renderer,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(renderer+'\\')&&!file.startsWith(renderer+'/')){res.writeHead(403).end();return;}
      try{res.setHeader('Content-Type',extname(file)==='.css'?'text/css':extname(file)==='.woff2'?'font/woff2':'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}return;
    }
    if(url.pathname!=='/'){res.writeHead(404).end();return;}
    const css=readdirSync(join(renderer,'assets')).filter(name=>name.endsWith('.css'));
    const mode=url.searchParams.get('theme')==='light'?'light':'dark';
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'");
    res.end(`<!doctype html><html lang="zh-CN" class="${mode==='dark'?'dark':''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VirtuGene · ${material ? 'P1静态材质样板' : '组件状态与转场合同'}</title>${css.map(name=>`<link rel="stylesheet" href="/assets/${name}">`).join('')}<style>${material ? readFileSync('scripts/verify/starfield-material-sample.css','utf8') : layoutCss}</style><script>${guards}</script></head><body><div id="app"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
  const address=`http://127.0.0.1:${server.address().port}`;
  const info={pid:process.pid,address,watch,material,startedAt:new Date().toISOString(),command:`node scripts/preview-ui-system.mjs --port=${server.address().port}${material ? ' --starfield-material' : ''}`,isolation:'本地模拟状态，模型/麦克风/音频/原生桥隔离。'};
  writeFileSync(join(evidence,port===0?'capture-server.json':'server.json'),JSON.stringify(info,null,2));
  const close=async()=>{await new Promise(done=>server.close(done));await bundler.dispose();};
  return {server,address,info,close};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const argument=process.argv.find(value=>value.startsWith('--port='));
  const preview=await uiSystemPreview({port:argument?Number(argument.slice(7)):5291,material:process.argv.includes('--starfield-material')});
  console.log(JSON.stringify(preview.info));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void preview.close().finally(()=>process.exit(0)));
}
