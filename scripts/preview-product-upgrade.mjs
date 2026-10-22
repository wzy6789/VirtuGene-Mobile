import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync, cpSync } from 'node:fs';
import { resolve, join, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve('.');
const baseline = resolve('.tmp-preview/ui-overhaul-20261015/baseline');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function productPreview({ frozen = false, port = 5290, production = false, output } = {}) {
  const source = frozen ? join(baseline, 'src') : join(root, 'src');
  const rendererSource = frozen ? join(baseline, 'dist/renderer') : join(root, 'dist/renderer');
  const out = frozen ? baseline : resolve(output || '.tmp-preview/ui-overhaul-20261015/preview');
  mkdirSync(out, { recursive: true });
  // Vite clears dist on rebuild. Keep this server's CSS/fonts paired with its
  // compiled source even while another stage builds newer production assets.
  const renderer = frozen ? rendererSource : join(out, `renderer-${Date.now()}`);
  if (!frozen) cpSync(rendererSource, renderer, { recursive: true });
  const bundle = await build({ entryPoints: ['scripts/verify/product-upgrade-preview.tsx'], bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
    define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"isolated-preview"', ...(production ? {'process.env.NODE_ENV':'"production"'} : {}) },
    plugins: frozen ? [{ name: 'frozen-product-source', setup(builder) { builder.onResolve({ filter: /^\.{1,2}\// }, args => {
      const target = resolve(args.resolveDir, args.path);
      if (!target.startsWith(join(root, 'src') + '/'.replace('/', '\\')) && !target.replaceAll('\\', '/').startsWith(join(root, 'src').replaceAll('\\', '/') + '/')) return;
      const replaced = target.replace(join(root, 'src'), source);
      const file = [replaced, ...['.ts', '.tsx', '.js', '.jsx', '.css', '/index.ts', '/index.tsx'].map(s => replaced + s)].find(f => existsSync(f) && statSync(f).isFile());
      return file ? { path: file } : undefined;
    }); } }] : [],
  });
  const js = bundle.outputFiles[0].text;
  writeFileSync(join(out, 'product-preview.bundle.js'), js);
  const inputs = Object.keys(bundle.metafile.inputs).filter(p => existsSync(p)).map(p => ({ path: p.replaceAll('\\', '/'), sha256: hash(readFileSync(p)) }));
  writeFileSync(join(out, 'preview-build.json'), JSON.stringify({ frozen, production, builtAt: new Date().toISOString(), rendererSnapshot: renderer, bundleSha256: hash(js), entrySha256: hash(readFileSync('scripts/verify/product-upgrade-preview.tsx')), inputs }, null, 2));
  const css = readdirSync(join(renderer, 'assets')).filter(f => f.endsWith('.css'));
  const guards = `window.previewIsolation={fetchBlocked:0,xhrBlocked:0,socketBlocked:0,microphoneBlocked:0,audioBlocked:0,nativeBridgeBlocked:0};const g=window.previewIsolation;window.fetch=async()=>{g.fetchBlocked++;throw Error('Preview blocks network')};XMLHttpRequest.prototype.open=function(){g.xhrBlocked++;throw Error('Preview blocks XHR')};for(const name of ['WebSocket','EventSource','Worker','SharedWorker'])window[name]=class{constructor(){g.socketBlocked++;throw Error('Preview blocks socket or worker')}};navigator.sendBeacon=()=>false;if(navigator.mediaDevices){navigator.mediaDevices.getUserMedia=async()=>{g.microphoneBlocked++;throw Error('Preview microphone disabled')};navigator.mediaDevices.getDisplayMedia=async()=>{g.microphoneBlocked++;throw Error('Preview media disabled')}};HTMLMediaElement.prototype.play=async function(){g.audioBlocked++;throw Error('Preview playback disabled')};if(window.speechSynthesis)window.speechSynthesis.speak=()=>{g.audioBlocked++};for(const name of ['SpeechRecognition','webkitSpeechRecognition'])window[name]=class{start(){g.microphoneBlocked++;throw Error('Preview recognition disabled')}};for(const name of ['AudioContext','webkitAudioContext'])window[name]=class{constructor(){g.audioBlocked++;throw Error('Preview audio context disabled')}};window.Capacitor={getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>false,nativePromise:async()=>{g.nativeBridgeBlocked++;throw Error('Preview bridge disabled')},nativeCallback:()=>{g.nativeBridgeBlocked++;throw Error('Preview bridge disabled')}};`;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript;charset=utf-8'); res.end(js); return; }
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
      const file = resolve(renderer, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(renderer + '\\') && !file.startsWith(renderer + '/')) { res.writeHead(403).end(); return; }
      try { res.setHeader('Content-Type', extname(file) === '.css' ? 'text/css' : extname(file) === '.woff2' ? 'font/woff2' : 'application/octet-stream'); res.end(readFileSync(file)); } catch { res.writeHead(404).end(); } return;
    }
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'self'");
    if (url.pathname === '/app') {
      res.end(`<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="utf-8"><title>VirtuGene 实际组件隔离预览</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#14121c">${css.map(f => `<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body{height:100%;margin:0}#app{height:100%}#preview-isolation-label{position:fixed;right:8px;bottom:82px;z-index:2147483647;pointer-events:none;font:10px/1.4 system-ui;background:#14121ce0;color:#fff;border-radius:5px;padding:3px 6px;max-width:185px}html[data-preview-call] #preview-isolation-label{bottom:auto;top:8px}</style><script>${guards}</script></head><body><div id="app"></div><aside id="preview-isolation-label">模拟资料 · 模型/麦克风/音频均隔离</aside><script src="/fixture.js"></script></body></html>`); return;
    }
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>VirtuGene UI 升级 · 隔离体验</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#090b12;color:#ede9f4;font:13px system-ui;height:100dvh;display:flex;flex-direction:column}header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #313146}header strong{margin-right:8px}button,select{font:inherit;background:#202135;border:1px solid #44445d;color:inherit;padding:7px 9px;border-radius:8px}main{min-height:0;flex:1;display:flex;justify-content:center;overflow:auto}iframe{flex:none;height:844px;border:0;width:390px;background:#14121c}p{margin:0;font-size:12px;color:#bbb5cb}</style></head><body><header><strong>实际组件 · 隔离预览</strong><select id="page" aria-label="预览页面" onchange="go(this.value)"><option value="home">消息首页</option><option value="characters">角色画廊</option><option value="profile">角色资料</option><option value="style">角色造型间</option><option value="create">创建角色与草稿</option><option value="edit">编辑角色与草稿</option><option value="chat">聊天</option><option value="call">通话准备</option><option value="call-connected">通话已连接（模拟）</option><option value="world">世界</option><option value="memory"${url.searchParams.get('page') === 'memory' ? ' selected' : ''}>记忆馆（模拟）</option><option value="timeline"${url.searchParams.get('page') === 'timeline' ? ' selected' : ''}>时间线（模拟）</option><option value="world-reading"${url.searchParams.get('page') === 'world-reading' ? ' selected' : ''}>剧情阅读（模拟）</option><option value="me"${url.searchParams.get('page') === 'me' ? ' selected' : ''}>我的</option><option value="todo"${url.searchParams.get('page') === 'todo' ? ' selected' : ''}>待办</option><option value="diary">日记</option><option value="moments">动态</option><option value="assistant">助理</option><option value="auth">登录与注册（本地模拟）</option></select><select aria-label="角色" id="role" onchange="go(document.getElementById('page').value)"><option value="a">知微</option><option value="b">程砚</option><option value="c">闻川</option></select><button onclick="mode=mode==='dark'?'light':'dark';api()?.theme(mode)">深/浅主题</button><select aria-label="视口宽度" onchange="const f=document.querySelector('iframe');f.style.width=this.value+'px';f.style.height=({320:640,360:800,390:844,430:932})[this.value]+'px'"><option>320</option><option>360</option><option selected>390</option><option>430</option></select><p>固定模拟资料；无模型外网、麦克风、播放或原生桥。本机浏览器不代表 Android。</p></header><main><iframe title="实际应用界面" src="/app?virtugene-preview=mobile&amp;page=${['home','characters','profile','style','create','edit','chat','call','call-connected','world','world-reading','timeline','memory','me','todo','diary','moments','assistant','auth'].includes(url.searchParams.get('page')) ? url.searchParams.get('page') : 'home'}&amp;theme=${url.searchParams.get('theme')==='light'?'light':'dark'}" allow="microphone 'none'; camera 'none'; autoplay 'none'"></iframe></main><script>document.getElementById('page').value=new URLSearchParams(location.search).get('page')||'home';let mode='${url.searchParams.get('theme')==='light'?'light':'dark'}';function api(){return document.querySelector('iframe').contentWindow.productUpgradeTest}function go(page){const frame=document.querySelector('iframe');if(page==='auth'||new URL(frame.src).searchParams.get('page')==='auth'){frame.src='/app?virtugene-preview=mobile&theme='+mode+'&page='+page;return;}api()?.go(page,document.getElementById('role').value)}</script></body></html>`);
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  const address = `http://127.0.0.1:${server.address().port}`;
  const info = { pid: process.pid, address, frozen, startedAt: new Date().toISOString(), command: `node scripts/preview-product-upgrade.mjs${frozen ? ' --frozen' : ''} --port=${server.address().port}`, stop: `Stop-Process -Id ${process.pid}` };
  writeFileSync(join(out, port === 0 ? 'capture-server.json' : 'server.json'), JSON.stringify(info, null, 2));
  return { server, address, info, production };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const frozen = process.argv.includes('--frozen');
  const portArg = process.argv.find(a => a.startsWith('--port='));
  const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
  const preview = await productPreview({ frozen, port: portArg ? Number(portArg.slice(7)) : 5290, output, production:process.argv.includes('--production') });
  console.log(JSON.stringify(preview.info));
}
