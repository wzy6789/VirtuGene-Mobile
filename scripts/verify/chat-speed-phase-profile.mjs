import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const output='docs/CHAT-SPEED-PHASE-PROFILE-2026-10-14.json';
if(existsSync(output))throw Error('Evidence exists');
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const report={scope:'Desktop Chrome 4x CPU, instrumented archived production functions, synthetic DB, no provider calls. Nested timings overlap.',versions:[],complete:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const [label,root] of [['6.0.14','release/speed-source-6.0.14'],['6.1.3','release/speed-source-6.1.3'],['working-source','.']]){
 const bundle=await build({entryPoints:['scripts/verify/chat-speed-versions.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"profile"'},plugins:[{name:'profile',setup(b){
 b.onResolve({filter:/^@release\//},a=>({path:join(resolve(root),'src',a.path.slice(9)+'.ts')}));
 b.onLoad({filter:/chat-speed-versions\.ts$/},a=>({loader:'ts',contents:readFileSync(a.path,'utf8').replace('const started=performance.now();','(window as any).__phaseTimes=[];const started=performance.now();').replace('samples.push({count,text,','samples.push({phaseTimes:(window as any).__phaseTimes,count,text,')}));
 b.onLoad({filter:/(character-memory|chat-summary-evidence)\.ts$/},a=>{
 let contents=readFileSync(a.path,'utf8');
 for(const name of ['buildCharacterMemoryContext','revalidateCharacterMemoryContext','hasLivePrivateSummarySources']){
  const needle='export async function '+name+'(';
  if(!contents.includes(needle))continue;
  contents=contents.replace(needle,'async function '+name+'ProfileOriginal(');
  contents+=`\nexport async function ${name}(...args:any[]) {const start=performance.now();try{return await ${name}ProfileOriginal(...args);}finally{((window as any).__phaseTimes??=[]).push({name:'${name}',ms:performance.now()-start});}}\n`;
 }return {contents,loader:'ts'};
 });
 }}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const context=await browser.newContext();
 try{const page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.releaseSpeed);const data=await page.evaluate(()=>window.releaseSpeed());report.versions.push({label,...data});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({label,samples:data.samples.map(s=>({count:s.count,text:s.text,preparationMs:s.preparationMs,phaseTimes:s.phaseTimes}))}));}
 finally{await context.close();await new Promise(r=>server.close(r));}
}report.complete=true;}finally{await browser.close();writeFileSync(output,JSON.stringify(report,null,2));}
