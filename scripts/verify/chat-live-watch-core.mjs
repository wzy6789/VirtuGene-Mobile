import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {writeFileSync,mkdirSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root='release/chat-live-source-20261019';mkdirSync(root,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/chat-live-watch-core.ts'],bundle:true,write:false,platform:'browser',format:'iife',define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-watch-core"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><title>Isolated live source watcher mechanism</title><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{
  const context=await browser.newContext({permissions:[]});const origin=`http://127.0.0.1:${server.address().port}`;
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runWatchCore==='function');
  report=await page.evaluate(async()=>{try{return await window.runWatchCore();}catch(error){throw Error(JSON.stringify({name:error.name,message:error.message,inner:error.inner?.message,lastPassed:window.watchCoreProgress}));}});
  const second=await context.newPage();await second.goto(origin);await second.waitForFunction(()=>typeof window.writeCrossSource==='function');
  report.crossPage=[];
  for(const mode of ['selected-edit','unrelated-edit']){
    await page.evaluate(mode=>window.setupCrossWatch(mode),mode);
    const written=await second.evaluate(id=>window.writeCrossSource(id),mode==='selected-edit'?'selected':'unrelated');
    await page.waitForFunction(mode=>{const state=window.crossWatchSnapshot();return state.notifications>=1&&(mode==='selected-edit'?state.invalidations===1:state.resumes>=2);},mode,{timeout:20000});
    const result=await page.evaluate(()=>window.crossWatchSnapshot());
    const check=(ok,label)=>{if(!ok)throw Error(label);report.checks.push(label);};
    check(written.revision===2&&result.notifications>=1&&result.validated>=2,'real same-origin second-page commit reaches the receiving watcher on '+mode);
    check(result.observedText==='跨页前段。','receiving storage callback is synchronously paused before a following text chunk on '+mode);
    if(mode==='selected-edit')check(result.error==='chat:history_changed'&&result.snapshot.join('')==='跨页前段。','cross-page selected-source edit blocks the remaining text after notification');
    else check(result.invalidations===0&&result.snapshot.join('')==='跨页前段。跨页通知后的后段。','cross-page unrelated-source edit resumes the same accumulated text after fresh validation');
    report.crossPage.push({mode,written,result});await page.evaluate(()=>window.disposeCrossWatch());
  }
  report.limitations=['The watcher can pause only once a local storage notification arrives; BroadcastChannel delivery is asynchronous, so this is not a claim of zero cross-page delivery lag or global atomic visibility.','No actual model, Android, audio/microphone, real account, or private chat data was used.','This mechanism suite injects the validation function and complements the actual sender/provenance regression; it does not substitute for those checks.'];
  console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,crossPageCases:report.crossPage.length,paidCalls:0}));
}catch(error){report={...report,complete:false,error:error.message};process.exitCode=1;console.log(JSON.stringify(report));}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(`${root}/watch-core-${Date.now()}.json`,JSON.stringify(report,null,2));}
