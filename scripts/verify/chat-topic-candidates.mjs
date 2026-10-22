import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-core-implementation-20261021/candidates';
const sourceFiles=['src/lib/chat/topic-candidates.ts','src/lib/chat-topic-replies.ts','src/lib/chat-humanizer.ts','src/db/chat-topic-state-repo.ts'];
const before=process.argv.includes('--before');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,hash(file)]));
const startHashes=sourceHashes();
const bundle=await build({entryPoints:['scripts/verify/chat-topic-candidates.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"core-topics-test"'},plugins:before?[{name:'frozen-topics',setup(b){b.onLoad({filter:/\.ts$/},args=>{const file=sourceFiles.find(file=>resolve(file)===resolve(args.path));if(file)return {contents:readFileSync(join(root,'before',file),'utf8'),loader:'ts'};});}}]:[]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let report;const origin='http://127.0.0.1:'+server.address().port;
try{const context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);report=await page.evaluate(()=>window.runTopicCandidates());if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const endHashes=sourceHashes();const file=join(root,(before?'before':'current')+'-'+Date.now()+'.json');mkdirSync(root,{recursive:true});writeFileSync(file,JSON.stringify({...report,sourceHashesBefore:startHashes,sourceHashesAfter:endHashes,sourcesStable:JSON.stringify(startHashes)===JSON.stringify(endHashes),apiCalls:0,model:'未确认',reasoning:'未确认'},null,2));console.log(JSON.stringify({file,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(x=>x.name),error:report.error},null,2));}
