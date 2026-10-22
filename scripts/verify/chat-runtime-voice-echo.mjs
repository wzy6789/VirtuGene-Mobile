import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-runtime-voice-echo-20261019',frozen=process.argv.includes('--before'),files=['src/lib/chat-owned-judgment-compaction.ts','src/lib/gu-yue-na-runtime.ts'];
mkdirSync(root,{recursive:true});
if(process.argv.includes('--freeze'))for(const p of files){const target=join(root,'before',p);if(existsSync(target))throw Error('Frozen source exists');mkdirSync(dirname(target),{recursive:true});copyFileSync(p,target);}
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),hashes=()=>Object.fromEntries(files.map(p=>[p,hash(p)])),before=hashes();
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-runtime-voice-echo.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"runtime-echo-offline"'},plugins:frozen?[{name:'frozen-runtime-echo',setup(builder){for(const p of files)builder.onLoad({filter:new RegExp(p.replaceAll('/','[\\\\/]')+'$')},()=>({loader:'ts',contents:readFileSync(join(root,'before',p),'utf8')}));}}]:[]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[],timezoneId:'Asia/Shanghai'});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());await context.addInitScript(()=>{const native=Date,clock=native.UTC(2026,9,19,9,0);globalThis.Date=new Proxy(native,{construct(target,args){return Reflect.construct(target,args.length?args:[clock]);},get(target,key,receiver){return key==='now'?()=>clock:Reflect.get(target,key,receiver);}});});const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runRuntimeVoiceEcho);report=await page.evaluate(()=>window.runRuntimeVoiceEcho());if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:error.stack??String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const after=hashes(),path=root+'/'+(frozen?'before-':'checks-')+Date.now()+'.json';writeFileSync(path,JSON.stringify({...report,beforeMode:frozen,sourceHashesBefore:before,sourceHashesAfter:after,stableSources:JSON.stringify(before)===JSON.stringify(after)},null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(r=>r.name),error:report.error,paidCalls:0}));}
