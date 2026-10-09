import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/guyuena-care.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{"DEV":true}',__APP_VERSION__:'"test"'}});
let result;const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/result')){let text='';for await(const b of req)text+=b.toString();result=text;res.end('ok');}
 else if(req.url==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
 else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><script src="/test.js"></script>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);const deadline=Date.now()+30000;while(result===undefined&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));if(!result?.includes('ALL PASS')||errors.length)throw Error(result??errors.join('\n')??'No test result');console.log(result);}
finally{await browser?.close();await new Promise(r=>server.close(r));}
