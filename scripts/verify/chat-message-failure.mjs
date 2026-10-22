import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const output='release/chat-reply-commit-20261018';mkdirSync(output,{recursive:true});
const reportPath=output+'/message-failure-'+Date.now()+'.json';
const sourceFiles=['src/db/message-repo.ts','src/components/chat/ChatWindow.tsx','src/lib/chat/send-service.ts','scripts/verify/chat-message-failure.tsx','scripts/verify/chat-message-failure.mjs'];
const hashes=()=>Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashes=hashes();
const bundle=await build({entryPoints:['scripts/verify/chat-message-failure.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"message-failure-fixture"'}});
const assets='dist/renderer/assets';
const css=readdirSync(assets).filter(file=>file.endsWith('.css')).map(file=>'<link rel="stylesheet" href="/assets/'+file+'">').join('');
const server=createServer((req,res)=>{
 if(req.url==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
 else if(req.url.startsWith('/assets/')){try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(readFileSync(join(assets,basename(req.url))));}catch{res.writeHead(404);res.end();}}
 else {res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+css+'<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style><div id="app"></div><script src="/test.js"></script>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],rows=[];let report,blockedRequests=0,page;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},permissions:[],reducedMotion:'reduce'});
 const origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();blockedRequests++;return route.abort();});
 page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.failureGuard&&!!window.chatStreamTest);
 const test=(method,...args)=>page.evaluate(({method,args})=>window.chatStreamTest[method](...args),{method,args});
 const probe=(method,...args)=>page.evaluate(({method,args})=>window.failureGuard[method](...args),{method,args});
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 const ready=async()=>{await test('setup',0);await page.getByRole('textbox',{name:'消息内容'}).waitFor();await page.waitForTimeout(100);};
 const waitRequest=()=>page.waitForFunction(()=>window.chatStreamTest.requests().length===1);
 const done=()=>page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
 await ready();await test('submit','这轮原请求。');await waitRequest();
 const edited=await probe('editCurrent');
 await test('push',0,'嗯，听见了。');await test('finish',0);await done();
 const afterEdit=await probe('state');rows.push({case:'actual-ChatWindow-edit-after-request-before-200-completion',edited,...afterEdit});
 const saved=afterEdit.rows.find(row=>row.id===edited.id),visible=afterEdit.store.find(row=>row.id===edited.id);
 check(saved?.revision===2&&!saved.failed,'late old request cannot mark edited database revision failed');
 check(visible?.revision===2&&!visible.failed,'late old request cannot mark edited UI revision failed');
 await ready();await test('failUserWrite');await test('submit','这条先遇到本地写入失败。');
 await page.getByRole('button',{name:'重新发送失败的消息',exact:true}).waitFor();
 const afterWriteFailure=await probe('state');rows.push({case:'local-user-write-failure',...afterWriteFailure});
 check(afterWriteFailure.rows.filter(row=>row.role==='user').length===0&&afterWriteFailure.store.some(row=>row.role==='user'&&row.failed),'unsaved local request remains visible as retryable failed bubble');
 check((await test('requests')).length===0,'failed local write does not start a provider request');
 await page.getByRole('button',{name:'重新发送失败的消息',exact:true}).click();await waitRequest();
 await test('push',0,'收到。');await test('finish',0);await done();
 const afterRetry=await probe('state');rows.push({case:'retry-local-user-write-failure',...afterRetry});
 check(afterRetry.rows.filter(row=>row.role==='user').length===1&&afterRetry.rows.some(row=>row.role==='assistant')&&afterRetry.rows.every(row=>!row.failed),'retry persists the same local request and receives a normal reply');
 check(afterRetry.store.filter(row=>row.role==='user').length===1&&afterRetry.store.every(row=>!row.failed),'retry clears local failed state without duplicate user bubbles');
 const repository=await probe('repositoryChecks');checks.push(...repository.checks);rows.push({case:'repository-source-and-account-guards',rows:repository.rows});
 check((await test('extraNetwork'))===0&&blockedRequests===0,'all traffic uses isolated local SSE and no external API');
 report={complete:true,checks,rows,paidCalls:0,scope:'Actual ChatWindow at 390 CSS px and native isolated IndexedDB; locally controlled SSE, no real model or microphone.'};
 console.log(JSON.stringify({complete:true,checks:checks.length,reportPath,paidCalls:0}));
}catch(error){report={complete:false,checks,rows,error:{name:error.name,message:error.message},paidCalls:0};process.exitCode=1;console.log(JSON.stringify({complete:false,error:report.error,checks:checks.length,reportPath}));}
finally{
 if(page)await page.close();await browser.close();await new Promise(resolve=>server.close(resolve));
 const sourceHashesAtEnd=hashes(),changedDuringRun=sourceFiles.filter(path=>sourceHashes[path]!==sourceHashesAtEnd[path]);
 if(changedDuringRun.length)process.exitCode=1;
 writeFileSync(reportPath,JSON.stringify({...report,blockedRequests,sourceHashes,sourceHashesAtEnd,changedDuringRun},null,2));
}
