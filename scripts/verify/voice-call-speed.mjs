import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const evidence='.tmp-preview/voice-call-rhythm-20261013';mkdirSync(evidence,{recursive:true});
const output=process.argv[2]??evidence+'/speed-'+Date.now()+'.json';
const browser=await chromium.launch({channel:'chrome',headless:true});const report={versions:[],errors:[],modelCalls:0};
try{for(const [label,root] of [['before',evidence+'/before'],['after','.']]){
 const bundle=await build({entryPoints:['scripts/verify/voice-call-speed.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'},plugins:[{name:'source-root',setup(b){b.onResolve({filter:/^@release\//},a=>({path:join(resolve(root),'src',a.path.slice(9)+'.ts')}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext();
 try{const page=await context.newPage();await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.voiceSpeed);const data=await page.evaluate(()=>window.voiceSpeed());report.versions.push({label,...data});console.log(JSON.stringify({label,...data}));}
 finally{await context.close();await new Promise(r=>server.close(r));}
}report.promptContentUnchanged=new Set(report.versions.flatMap(v=>v.samples.map(s=>s.promptFingerprint))).size===1;if(!report.promptContentUnchanged)throw Error('Prompt changed');}
catch(e){report.errors.push(e.message);process.exitCode=1;}
finally{await browser.close();writeFileSync(output,JSON.stringify(report,null,2));}
