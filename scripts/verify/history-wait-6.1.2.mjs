import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {writeFileSync,existsSync} from 'node:fs';
const output=process.argv[2]??'docs/HISTORY-WAIT-6.1.2-2026-10-13.json';
if(existsSync(output))throw Error('Do not overwrite evidence');
const fixture=process.argv[3]??'scripts/verify/history-wait-6.1.2.ts';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={date:new Date().toISOString(),versions:[],errors:[],complete:false,modelCalls:0};
try {
 for(const [label,root] of [['6.1.2-source','.']]) {
  const sourceRoot=resolve(root);
  const bundle=await build({entryPoints:[fixture],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'},plugins:[{name:'release-root',setup(builder){builder.onResolve({filter:/^@release\//},args=>({path:join(sourceRoot,'src',args.path.slice(9)+'.ts')}));}}]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const context=await browser.newContext();
  try {
   const page=await context.newPage();
   const cdp=await context.newCDPSession(page);
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.waitForFunction(()=>!!window.releaseSpeed);
   const data=await page.evaluate(()=>window.releaseSpeed());
   report.versions.push({label,...data});
   writeFileSync(output,JSON.stringify(report,null,2));
   console.log(JSON.stringify({label,samples:data.samples.map(({count,text,preparationMs,firstVisibleMs,reads,promptChars,historyChars})=>({count,text,preparationMs,firstVisibleMs,reads,promptChars,historyChars}))}));
  } finally {await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 report.complete=report.versions.length===1;
} catch(error) {report.errors.push(error.message);}
finally {await browser.close();writeFileSync(output,JSON.stringify(report,null,2));}
console.log(JSON.stringify({complete:report.complete,errors:report.errors,evidence:output}));
if(!report.complete)process.exitCode=1;
