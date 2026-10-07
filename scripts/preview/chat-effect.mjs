import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {join,basename} from 'node:path';
const bundle=await build({entryPoints:['scripts/preview/chat-effect.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.hot':'undefined','import.meta.env':'{"DEV":true,"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"preview"'}});
const assets='dist/renderer/assets';
const css=readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('');
createServer((req,res)=>{
  if(req.url.startsWith('/effect.js')){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
  else if(req.url.startsWith('/assets/')){try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(readFileSync(join(assets,basename(req.url))));}catch{res.writeHead(404);res.end();}}
  else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="zh-CN" class="dark"><head><title>VirtuGene · 聊天效果</title><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}body{overflow:hidden}</style></head><body><div id="app" class="mobile-layout"></div><script src="/effect.js"></script></body></html>`);}
}).listen(4174,'127.0.0.1',()=>console.log('Chat effect: http://127.0.0.1:4174/?virtugene-preview=mobile'));
