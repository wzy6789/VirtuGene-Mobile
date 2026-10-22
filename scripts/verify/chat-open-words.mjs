import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-open-words-20261019',frozen=process.argv.includes('--before'),file='src/lib/chat-expression-boundary.ts';
mkdirSync(root,{recursive:true});
if(process.argv.includes('--freeze')){const target=join(root,'before',file);if(existsSync(target))throw Error('Frozen source exists');mkdirSync(dirname(target),{recursive:true});copyFileSync(file,target);}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),before=hash(file);
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-open-words.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"open-words-offline"'},plugins:frozen?[{name:'frozen-open-words',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]lib[\\/]chat-expression-boundary\.ts$/},()=>({loader:'ts',contents:readFileSync(join(root,'before',file),'utf8')}));}}]:[]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[],timezoneId:'Asia/Shanghai'});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runOpenWords);report=await page.evaluate(()=>window.runOpenWords());if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:error.stack??String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const after=hash(file),path=root+'/'+(frozen?'before-':'checks-')+Date.now()+'.json';writeFileSync(path,JSON.stringify({...report,beforeMode:frozen,sourceHashesBefore:{[file]:before},sourceHashesAfter:{[file]:after},stableSources:before===after},null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(r=>r.name),error:report.error,paidCalls:0}));}
