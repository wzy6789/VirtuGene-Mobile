import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync,mkdirSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-world-source-20261019';mkdirSync(root,{recursive:true});
const suites=process.argv.slice(2).length?process.argv.slice(2):['worldB','worldC','worldE','worldF','world-stream'];
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
try{for(const suite of suites){
 const bundled=await build({entryPoints:['scripts/verify/'+suite+'.ts'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.webp':'dataurl','.png':'dataurl','.css':'empty'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"world-source-regression"'}});
 let finish;const done=new Promise(resolve=>{finish=resolve;});
 const server=createServer((req,res)=>{
  if(req.method==='POST'&&req.url.startsWith('/result')){let body='';req.on('data',part=>{body+=part;});req.on('end',()=>{res.end('ok');finish(body);});return;}
  res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundled.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[]});let timeout;
 try{
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();page.on('pageerror',error=>finish('FAIL '+error.stack));await page.goto(origin);
  const body=await Promise.race([done,new Promise(resolve=>{timeout=setTimeout(()=>resolve('FAIL timeout'),120000);})]);
  const complete=(body.includes('ALL PASS')||body.startsWith('PASS'))&&!/FAILED|^FAIL/m.test(body),checks=(body.match(/^ok\s/gm)||[]).length||Number(body.match(/^PASS (\d+) /m)?.[1]??0);
  const path=root+'/regression-'+suite+'.txt';writeFileSync(path,body);results.push({suite,complete,checks,path});console.log(JSON.stringify(results.at(-1)));
  if(!complete)process.exitCode=1;
 }finally{clearTimeout(timeout);await context.close();await new Promise(resolve=>server.close(resolve));}
}}catch(error){results.push({error:error.stack});process.exitCode=1;}
finally{await browser.close();const path=root+'/regressions-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({complete:results.every(row=>row.complete),results,apiCalls:0},null,2));console.log(JSON.stringify({path,complete:results.every(row=>row.complete)}));}
