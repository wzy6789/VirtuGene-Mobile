import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-core-implementation-20261021/delivery',before=process.argv.includes('--before');
const frozen=JSON.parse(readFileSync(join(root,'baseline.json'),'utf8')).files;
const files=[...Object.keys(frozen),'src/lib/chat/output-contract.ts','src/lib/chat-topic-replies.ts'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const sourceHashesBefore=hashes();
const bundle=await build({entryPoints:['scripts/verify/chat-reviewed-delivery.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"reviewed-delivery"',LIVE_PROXY:'"http://127.0.0.1:1/blocked"',LIVE_TOKEN:'"isolated-no-paid-token"',LIVE_RESPONSES:'[]'},plugins:before?[{name:'frozen-delivery-source',setup(b){b.onLoad({filter:/[\\/]src[\\/].*\.tsx?$/},args=>{const p=Object.keys(frozen).find(p=>resolve(p)===resolve(args.path));if(p&&existsSync(join(root,'before',p)))return {loader:p.endsWith('tsx')?'tsx':'ts',contents:readFileSync(join(root,'before',p),'utf8')};});}}]:[]});
const buildStamp=Date.now();mkdirSync(root,{recursive:true});
const bundlePath=join(root,`${before?'before':'current'}-${buildStamp}.bundle.js`);writeFileSync(bundlePath,bundle.outputFiles[0].text);
const bundleEvidence={artifact:bundlePath,sha256:createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'),dependencyHashes:Object.fromEntries(Object.keys(bundle.metafile.inputs).filter(p=>existsSync(p)).map(p=>{const frozenPath=Object.keys(frozen).find(file=>resolve(file)===resolve(p));return [p,createHash('sha256').update(readFileSync(before&&frozenPath?join(root,'before',frozenPath):p)).digest('hex')];})),providerKeyIncluded:false};
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});let report,external=0;
try{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external++;return route.abort();});const page=await context.newPage();
await page.exposeFunction('probeReviewedReload',async()=>{const fresh=await context.newPage();try{await fresh.goto(origin);await fresh.waitForFunction(()=>!!window.settleReviewedReload);return await fresh.evaluate(()=>window.settleReviewedReload());}finally{await fresh.close();}});
await page.goto(origin);await page.waitForFunction(()=>!!window.runReviewedDelivery);report=await page.evaluate(()=>window.runReviewedDelivery());}
catch(error){report={complete:false,error:String(error)};}
finally{await browser.close();await new Promise(r=>server.close(r));}
mkdirSync(root,{recursive:true});const path=join(root,`${before?'before':'current'}-${Date.now()}.json`);
writeFileSync(path,JSON.stringify({...report,sourceHashesBefore,sourceHashesAfter:hashes(),bundleEvidence,externalRequests:external,before,apiCalls:0,microphoneUsed:false,deviceTested:false},null,2));
console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(c=>c.name),error:report.error},null,2));if(!report.complete)process.exitCode=1;
