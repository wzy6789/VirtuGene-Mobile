import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync,mkdirSync} from 'node:fs';
const output=process.env.VG_MEMORY_REGRESSION_OUTPUT||'release/chat-settlement-guard-20261018';
mkdirSync(output,{recursive:true});
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{for(const suite of ['memory-continuity','memory-final','character-memory']){
 const bundle=await build({entryPoints:[`scripts/verify/${suite}.ts`],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"DEV":true,"VITE_AI_GATEWAY_URL":"","VITE_AI_GATEWAY_TOKEN":""}',__APP_VERSION__:'"settlement-regression"'}});
 let terminal;const completed=new Promise(resolve=>{terminal=resolve;});
 const server=createServer((req,res)=>{
  if(req.method==='POST'&&req.url.startsWith('/result')){let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{res.end('ok');if(/ALL PASS|FAILED|^FAIL/m.test(body))terminal(body);});return;}
  res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><div id="app"></div><script src="/test.js"></script>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const context=await browser.newContext({permissions:[]});let timeout;
 try{const origin=`http://127.0.0.1:${server.address().port}`;await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();page.on('pageerror',error=>terminal('FAIL '+error.message));await page.goto(origin);const body=await Promise.race([completed,new Promise(resolve=>{timeout=setTimeout(()=>resolve('FAIL timeout'),60000);})]);
  const passed=body.includes('ALL PASS')&&!/FAILED|^FAIL/m.test(body);writeFileSync(`${output}/${suite}.txt`,body);results.push({suite,passed,checks:Number(body.match(/ok\s+(\d+)\s+assertions/)?.[1])||(body.match(/^ok\s/gm)||[]).length});if(!passed)throw Error(suite+': '+body);console.log(JSON.stringify(results.at(-1)));
 }finally{clearTimeout(timeout);await context.close();await new Promise(resolve=>server.close(resolve));}
 }}catch(error){process.exitCode=1;results.push({error:error.message});}
finally{await browser.close();writeFileSync(`${output}/memory-regressions.json`,JSON.stringify(results,null,2));}
