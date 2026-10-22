import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync,cpSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createHash} from 'node:crypto';

const out=resolve(process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-scene-plan-20261019/ui');mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/ui-cinematic-preview.tsx'],bundle:true,write:false,metafile:true,outfile:out+'/fixture.js',assetNames:'scene-assets/[name]-[hash]',publicPath:'/',format:'iife',platform:'browser',jsx:'automatic',loader:{'.webp':'file','.png':'file','.css':'empty'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:'"scene-isolated"','process.env.NODE_ENV':'"production"'}});
const files=new Map(bundle.outputFiles.map(f=>['/'+f.path.slice(out.length+1).replaceAll('\\','/'),f.contents]));
// Only this public local model catalog may be fetched; remote/model/mic transport stays isolated.
for(const id of readdirSync('public/chat-scenes'))for(const file of readdirSync('public/chat-scenes/'+id))if(file.endsWith('.glb'))files.set('/chat-scenes/'+id+'/'+file,readFileSync('public/chat-scenes/'+id+'/'+file));
// Keep this preview's source and CSS paired when a later Vite build clears dist.
const assets=resolve(out,`renderer-${Date.now()}`);cpSync(resolve('dist/renderer'),assets,{recursive:true});
const css=readdirSync(join(assets,'assets')).filter(f=>f.endsWith('.css'));
writeFileSync(out+'/source-hashes.json',JSON.stringify({inputs:Object.fromEntries(Object.keys(bundle.metafile.inputs).filter(existsSync).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))},null,2));
const server=createServer((req,res)=>{const path=new URL(req.url,'http://local').pathname;let data=files.get(path);
 if(!data&&(path.startsWith('/assets/')||path.startsWith('/fonts/'))){const file=resolve(assets,'.'+path);if(file.startsWith(assets)&&existsSync(file))data=readFileSync(file);}
 if(data){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webp')?'image/webp':path.endsWith('.woff2')?'font/woff2':'application/octet-stream');if(path.startsWith('/scene-assets/')||path.startsWith('/chat-scenes/'))res.setHeader('Cache-Control','public,max-age=31536000,immutable');res.end(data);return;}
 if(path!=='/'){res.writeHead(404).end();return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'none'; object-src 'none'");res.end(`<!doctype html><html class="dark" lang="zh-CN"><head><meta charset="utf-8"><title>VirtuGene 场景 · 实际聊天组件手机预览</title><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}#app{display:flex;flex-direction:column}.chat-room{flex:1;min-height:0}</style></head><body><main id="app" class="mobile-layout"></main><script src="/fixture.js"></script></body></html>`);
});
await new Promise(r=>server.listen(process.argv.includes('--serve')?Number(process.env.VG_SCENE_PORT??5321):0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
writeFileSync(out+(process.argv.includes('--serve')?'/server.json':'/test-server.json'),JSON.stringify({pid:process.pid,origin,scope:'Actual ChatWindow; separate origin, synthetic DB and simulated transport; no paid model/microphone/native access.'},null,2));
if(process.argv.includes('--serve')){console.log(JSON.stringify({origin,pid:process.pid}));}