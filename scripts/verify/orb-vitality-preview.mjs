import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync,readdirSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { orbPreviewGuard } from './orb-preview-guard.mjs';
const output='.tmp-preview/orb-vitality-20261013';mkdirSync(output,{recursive:true});
const result=await build({entryPoints:['scripts/verify/orb-vitality-ui.tsx'],bundle:true,write:false,outfile:'fixture.js',platform:'browser',format:'iife',jsx:'automatic',target:'es2020',
  loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"DEV":true,"VITE_AI_GATEWAY_URL":""}', 'import.meta.hot':'undefined',__APP_VERSION__:'"6.1.0"'}});
const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text,css=result.outputFiles.find(file=>file.path.endsWith('.css')).text;
const assets='dist/renderer/assets',assetNames=new Set(readdirSync(assets));
const base=[...assetNames].filter(name=>name.endsWith('.css')).map(name=>readFileSync(join(assets,name),'utf8')).join('\n');
const component=`<!doctype html><html lang="zh-CN" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}\n${css}html,body,#root{height:100%;margin:0;background:var(--bg);color:var(--text);font-family:var(--vg-font-ui,system-ui)}</style>${orbPreviewGuard}<div id="root"></div><script src="/fixture.js"></script></html>`;
const shell=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VirtuGene 小星 · 隔离预览</title><style>
*{box-sizing:border-box}body{margin:0;background:#0c1022;color:#e8eaf4;font:14px/1.5 system-ui,sans-serif}header{padding:12px 16px;max-width:1000px;margin:auto}h1{font-size:18px;margin:0}p{margin:4px 0;color:#b7c2d9}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}button,select{min-height:44px;padding:8px 12px;background:#232b45;border:1px solid #465374;border-radius:10px;color:inherit;font:inherit}iframe{display:block;border:0;width:430px;max-width:100%;height:calc(100dvh - 190px);min-height:420px;margin:12px auto}label{display:flex;align-items:center;gap:8px}input[type=range]{width:90px}
</style><header><h1>小星动态 · 隔离组件预览</h1><p>使用模拟资料；刷新会重置对话。模型、麦克风和音频操作均已封住。</p><nav>
<button data-mode="chat">实际聊天页</button><button data-mode="lab">放大看小星</button><button data-mode="settings">外观设置</button><button id="theme">浅／深主题</button>
<select id="state" aria-label="小星状态"><option value="idle">基础生命感</option><option value="thinking">思考</option><option value="working">回应准备</option><option value="success">完成</option><option value="error">遇到困难</option></select>
<select id="call" aria-label="模拟通话状态"><option value="none">无通话</option><option value="listening">模拟采集</option><option value="generating">模拟思考</option><option value="playing">模拟播放回执</option><option value="paused">模拟暂停</option></select>
<label>模拟音量<input id="level" type="range" min="0" max="1" step=".05" value="0"></label><button id="cue">单次到达回应</button>
</nav><p id="status">正在加载实际组件…</p></header><iframe title="VirtuGene 实际组件隔离画面" src="/components"></iframe><script>
const frame=document.querySelector('iframe'),status=document.getElementById('status');let light=false;
const api=()=>frame.contentWindow.vitalityTest;
const focusDemo=()=>frame.contentWindow.focus();
frame.addEventListener('load',()=>{const ready=setInterval(()=>{if(api()?.ready){clearInterval(ready);focusDemo();status.textContent='已就绪 · 可点击、按住、滚动、切换强度；通话信号是演示值。';}},100);});
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{api()?.mode(button.dataset.mode);focusDemo();});
document.getElementById('theme').onclick=()=>{light=!light;frame.contentDocument.documentElement.classList.toggle('dark',!light);};
document.getElementById('state').onchange=event=>{api()?.stopCall();api()?.mode('lab');api()?.emotion(event.target.value);focusDemo();};
document.getElementById('call').onchange=event=>{if(event.target.value==='none')api()?.stopCall();else api()?.call(event.target.value,{level:Number(document.getElementById('level').value),speakingText:event.target.value==='playing'?'模拟已播放片段':''});focusDemo();};
document.getElementById('level').oninput=event=>{if(api()?.callState().busy)api().level(Number(event.target.value));};
document.getElementById('cue').onclick=()=>{api()?.mode('lab');api()?.cue();};
</script></html>`;
let status;
const server=createServer((req,res)=>{const name=req.url.split('?')[0].slice(1);if(name==='health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(status));return;}
  if(assetNames.has(name)){res.setHeader('Content-Type',name.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(readFileSync(join(assets,name)));return;}
  res.setHeader('Content-Type',name==='fixture.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(name==='fixture.js'?js:name==='components'?component:shell);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
status={date:new Date().toISOString(),pid:process.pid,url:`http://127.0.0.1:${server.address().port}/preview`,host:'127.0.0.1',scope:'isolated actual components with fictional IndexedDB seed; not the whole App',realModelCalls:0,microphoneEnabled:false,requiresLocalServer:true,modelId:'unconfirmed',reasoningEffort:'unconfirmed'};
writeFileSync(join(output,'preview-status.json'),JSON.stringify(status,null,2)+'\n');console.log(status.url);
