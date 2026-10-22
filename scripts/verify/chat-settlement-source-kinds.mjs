import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-settlement-source-kinds-20261019',frozen=process.argv.includes('--before');
const files=['src/store/emotion-store.ts','src/lib/ai/context-consolidator.ts'];
mkdirSync(root,{recursive:true});
if(process.argv.includes('--freeze'))for(const path of files){const target=join(root,'before',path);if(existsSync(target))throw Error('Frozen source already exists');mkdirSync(dirname(target),{recursive:true});copyFileSync(path,target);}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),hashes=()=>Object.fromEntries(files.map(p=>[p,hash(p)])),before=hashes();
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-settlement-source-kinds.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"synthetic-not-a-credential"',LIVE_RESPONSES:'[]','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"source-kind-offline"'},plugins:frozen?[{name:'frozen-source-kinds',setup(builder){for(const path of files)builder.onLoad({filter:new RegExp(path.replaceAll('/','[\\\\/]')+'$')},()=>({loader:'ts',contents:readFileSync(join(root,'before',path),'utf8')}));}}]:[]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[],timezoneId:'Asia/Shanghai'});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runSettlementSourceKinds);report=await page.evaluate(()=>window.runSettlementSourceKinds());if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:error.stack??String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const after=hashes(),path=root+'/'+(frozen?'before-':'checks-')+Date.now()+'.json';writeFileSync(path,JSON.stringify({...report,beforeMode:frozen,sourceHashesBefore:before,sourceHashesAfter:after,stableSources:JSON.stringify(before)===JSON.stringify(after)},null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(r=>r.name),error:report.error,paidCalls:0}));}
