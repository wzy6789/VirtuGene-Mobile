import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
const root=resolve('release/apk-6.1.0-speed-assets');
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
createServer((req,res)=>{
  let path;try{path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end();return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}
  catch{res.writeHead(404);res.end();}
}).listen(6180,'127.0.0.1',()=>console.log('6.1.0 APK assets preview: http://127.0.0.1:6180/?virtugene-preview=mobile'));
