import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
const serve=process.argv.includes('--serve');
const stamp=process.argv.includes('--current')?'2026-10-14':'2026-10-13';
const bundle=await build({entryPoints:['scripts/verify/chat-speed-settings-preview.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.webp':'dataurl','.png':'dataurl','.css':'empty'},define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-preview"'}});
const styles=readdirSync('dist/renderer/assets').filter(f=>f.endsWith('.css')).map(f=>'<link rel="stylesheet" href="/assets/'+f+'">').join('');
const server=createServer((req,res)=>{
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}
  else if(req.url.startsWith('/assets/')){try{const name=basename(req.url);res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'application/octet-stream');res.end(readFileSync(join('dist/renderer/assets',name)));}catch{res.writeHead(404);res.end();}}
  else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'</head><body><div id="root"></div><script src="/test.js"></script></body></html>');}
});
await new Promise(r=>server.listen(serve?4197:0,'127.0.0.1',r));
const address='http://127.0.0.1:'+server.address().port+'/?virtugene-preview=mobile';
if(serve)console.log(address+' (actual quality/settings component, isolated account, model and microphone blocked)');
else{
 const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
 const browser=await chromium.launch({channel:'chrome',headless:true});let report={complete:false,checks:0,modelCalls:0};
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(address);
  const toggle=page.getByRole('switch',{name:'DeepSeek 私聊思考模式'});await toggle.waitFor();
  if(await toggle.getAttribute('aria-checked')!=='false')throw Error('Preview mode must start disabled');report.checks++;
  await toggle.click();if(!await page.evaluate(()=>window.speedSettingsPreview.thinking()))throw Error('Toggle did not enable store');report.checks++;
  await toggle.click();if(await page.evaluate(()=>window.speedSettingsPreview.thinking()))throw Error('Toggle did not disable store');report.checks++;
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)||errors.length)throw Error('Preview overflow/error');report.checks++;
  await page.evaluate(()=>{document.querySelectorAll('*').forEach(node=>{if(node instanceof HTMLElement&&node.scrollTop)node.scrollTop=0;});});
  await page.screenshot({path:'release/chat-speed-thinking-settings-'+stamp+'.png'});report.complete=true;
 }catch(e){report.error=e.message;process.exitCode=1;}
 finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync('docs/CHAT-SPEED-SETTINGS-UI-'+stamp+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
