import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
const serve=process.argv.includes('--serve');
const bundle=await build({entryPoints:['scripts/verify/resource-cache.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"DEV":true,"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"isolated-preview"'}});
const assets='dist/renderer/assets';
const css=readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>'<link rel="stylesheet" href="/assets/'+f+'">').join('');
const server=createServer((req,res)=>{
 if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}
 else if(req.url.startsWith('/assets/')){res.end(readFileSync(join(assets,basename(req.url))));}
 else {res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+css+'</head><body><div id="root"></div><script src="/test.js"></script></body></html>');}
});
await new Promise(r=>server.listen(serve?4196:0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/?virtugene-preview=mobile';
if(serve)console.log('Actual settings preview, isolated test DB, no models/microphone: '+url);
else {
 const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const report={checks:0,errors:[],modelCalls:0,androidVerified:false,cases:[]};
 const check=(v,s)=>{if(!v)throw Error(s);report.checks++;};
 try {
  for(const mode of ['web','native','native-failure','native-unavailable','web-failure']) {
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
   try {
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    if(mode.startsWith('native'))await page.addInitScript(({mode})=>{
     window.androidBridge={};window.cacheNativeCalls=0;
     window.Capacitor={PluginHeaders:mode==='native-unavailable'?[]:[{name:'ResourceCache',methods:[{name:'clear',rtype:'promise'}]}],nativePromise:async(name)=>{if(name!=='ResourceCache')throw Error('unsupported preview plugin');window.cacheNativeCalls++;await new Promise(r=>setTimeout(r,40));if(mode==='native-failure')throw Error('controlled native failure');return {requested:true};}};
    },{mode});
    await page.goto(url);await page.evaluate(()=>window.resourceCacheTest.ready);
    await page.getByRole('button',{name:'清理缓存 保留聊天与生活记录'}).click();
    await page.getByRole('button',{name:'清理资源缓存',exact:true}).waitFor();
    const before=await page.evaluate(()=>window.resourceCacheTest.snapshot());
    await page.evaluate(()=>window.resourceCacheTest.begin());
    if(mode==='web-failure')await page.evaluate(()=>window.resourceCacheTest.failedDelete());
    if(mode==='native-unavailable'){check(await page.getByRole('button',{name:'清理资源缓存',exact:true}).isDisabled(),'unavailable native version does not pretend to support system cleaning');}
    else {
     if(mode==='native') {
      const pair=await page.evaluate(async()=>Promise.all([window.resourceCacheTest.clear(),window.resourceCacheTest.clear()]));
      check(pair.every(r=>r.nativeRequested),'native request acknowledged');check(await page.evaluate(()=>window.cacheNativeCalls)===1,'concurrent clears share one native call');
     }
     await page.getByRole('button',{name:'清理资源缓存',exact:true}).click();
     await page.getByRole('status').waitFor();
     const status=await page.getByRole('status').innerText();
     check(!status.includes('加速')&&!status.includes('MB'),'no fabricated speed/bytes');
     check(mode.endsWith('failure')?status.includes('未能清理'):mode==='native'?status.includes('已发起'):status.includes('已清理'),'accurate success/partial failure feedback');
    }
    const reads=await page.evaluate(()=>window.resourceCacheTest.end());
    const after=await page.evaluate(()=>window.resourceCacheTest.snapshot());
    check(before===after,'all persisted records, voice samples, settings, credentials and cookies remain identical');
    check(reads===0,'cleaning never reads or scans user database');
    check(await page.evaluate(()=>window.resourceCacheTest.protectedCache())==='preserve','unknown offline record cache preserved');
    if(mode==='web') {
     check((await page.evaluate(()=>window.resourceCacheTest.inspect())).webCacheCount===0,'named disposable caches actually removed');
     await page.getByRole('button',{name:'清理资源缓存',exact:true}).click();
     await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('没有可清理'));
     check(true,'empty cache does not claim another cleanup success');
    }
    check(errors.length===0,'no uncaught page errors: '+errors.join(','));
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px settings page has no horizontal overflow');
    await page.screenshot({path:'release/resource-cache-'+mode+'.png'});
    report.cases.push({mode,databaseReads:reads,recordsPreserved:true});
   } finally {await context.close();}
  }
 }catch(e){report.errors.push(e.message);}
 finally {await browser.close();server.close();writeFileSync('docs/RESOURCE-CACHE-VERIFY-2026-10-13.json',JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report));if(report.errors.length)process.exitCode=1;
}
