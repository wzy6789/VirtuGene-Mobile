// Actual chat components on a separate local origin. All model transport is
// controlled by the chat fixture; no real account or microphone is used.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
const bundle = await build({ entryPoints: ['scripts/verify/chat-background-complete.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty', '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"preview"' } });
const assets = 'dist/renderer/assets', css = readdirSync(assets).filter(f => f.endsWith('.css'));
const demo = `
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('隔离演示不使用麦克风');};
let seen=0,generation=0;
async function prepare(){const byRole=atmosphereTest.records(),mode=document.documentElement.classList.contains('dark')?'dark':'light';await atmosphereTest.demo();await atmosphereTest.rehydrate({byRole});atmosphereTest.theme(mode);while(!document.querySelector('[aria-label="消息内容"]'))await new Promise(requestAnimationFrame);}
window.replyDemo=async(mode='slow')=>{generation++;seen=0;await prepare();if(mode==='fast')chatStreamTest.useCompleteResponses(['来了。---你说，我在。']);chatStreamTest.submit('你好');};
setInterval(()=>{const rows=chatStreamTest.requests();if(rows.length<=seen)return;const index=seen++,token=generation;const alive=()=>token===generation&&!chatStreamTest.requests()[index]?.aborted;setTimeout(()=>{if(!alive())return;chatStreamTest.push(index,'来');setTimeout(()=>{if(!alive())return;chatStreamTest.push(index,'了。');setTimeout(()=>{if(!alive())return;chatStreamTest.push(index,'---你说，我在。');chatStreamTest.finish(index);},600);},600);},1100);},40);
prepare().then(()=>{window.demoReady=true;});
`;
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text + '\n' + demo); return; }
  if (req.url.startsWith('/assets/')) { try { const file = basename(req.url); res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(readFileSync(join(assets, file))); } catch { res.writeHead(404).end(); } return; }
  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  res.end(`<!doctype html><html lang="zh-CN" class="dark"><head><title>聊天背景本地预览</title><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f => `<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body{height:100%;margin:0;background:var(--bg);color:var(--text)}#app{height:calc(100% - 40px)}.demo-bar{height:40px;display:flex;align-items:center;justify-content:center;gap:8px;font:12px system-ui;background:var(--bg-panel)}.demo-bar button{min-height:28px;padding:4px 8px;border:1px solid var(--border);border-radius:8px}</style></head><body><header class="demo-bar"><span>隔离演示 · 无模型/麦克风</span><button onclick="atmosphereTest.theme(document.documentElement.classList.contains('dark')?'light':'dark')">深/浅</button><button onclick="replyDemo('slow')">慢回复</button><button onclick="replyDemo('fast')">即时</button></header><main id="app" class="mobile-layout"></main><script src="/fixture.js"></script></body></html>`);
});
server.listen(5184, '127.0.0.1', () => console.log('Role atmosphere preview: http://127.0.0.1:5184/ — chat settings > 聊天外观'));
