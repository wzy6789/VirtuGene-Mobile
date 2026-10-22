import {build} from 'esbuild';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
const port=6194;
const output='docs/OPPO-VERSION-SPEED-2026-10-14.json';
if(existsSync(output))throw Error('Evidence exists; do not overwrite');
const versions=[['6.0.14','release/speed-source-6.0.14'],['6.1.3','release/speed-source-6.1.3'],['working-source','.']];
const bundles=[];
for(const [label,root] of versions){
 const b=await build({entryPoints:['scripts/verify/chat-speed-versions.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"isolated-phone-speed"'},plugins:[{name:'version',setup(builder){
 builder.onResolve({filter:/^@release\//},args=>({path:join(resolve(root),'src',args.path.slice(9)+'.ts')}));
 builder.onLoad({filter:/chat-speed-versions\.ts$/},args=>({contents:readFileSync(args.path,'utf8').replace('[0,5000,20000]','[0,5000]').replace('actual send pipeline; isolated IndexedDB; CPU throttled 4x; transport simulated 100ms; no Android or real model','Actual OPPO browser; isolated IndexedDB; native CPU; 100ms simulated transport; no real model'),loader:'ts'}));
 }}]});bundles.push(b.outputFiles[0].text);
}
const report={date:new Date().toISOString(),scope:'same OPPO browser, isolated synthetic DB, real version send pipelines, no installed app data, no provider calls',versions:[],errors:[],complete:false,modelCalls:0};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2));save();
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const i=Number(url.searchParams.get('v')??0);
 if(!Number.isInteger(i)||i<0||i>=versions.length){res.writeHead(400);res.end();return;}
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundles[i]);return;}
 if(url.pathname==='/result'&&req.method==='POST'){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000){res.writeHead(413);res.end();return;}}
  const data=JSON.parse(body);report.versions.push({label:versions[i][0],...data});if(data.error)report.errors.push(data.error);report.complete=report.versions.length===3&&!report.errors.length;save();
  console.log(JSON.stringify({label:versions[i][0],error:data.error,samples:data.samples?.map(s=>({count:s.count,text:s.text,preparationMs:s.preparationMs,firstVisibleMs:s.firstVisibleMs,reads:s.reads}))}));
  res.end('ok');return;
 }
 res.setHeader('Content-Type','text/html;charset=utf-8');
 res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>VirtuGene 静默性能诊断</title><body style="background:#111827;color:#eee;font:20px sans-serif;padding:24px"><h2>OPPO 本地性能对照</h2><p id="state">正在测试 ${versions[i][0]}，请保持页面前台。没有模型、声音或真实聊天数据。</p><script>const reportFetch=window.fetch.bind(window);</script><script src="/bundle.js?v=${i}"></script><script>(async()=>{let result;try{result=await window.releaseSpeed();result.browser=navigator.userAgent;}catch(e){result={error:String(e.stack||e)}}await reportFetch('/result?v=${i}',{method:'POST',body:JSON.stringify(result)});${i<2?`location.href='/?v=${i+1}';`:`document.getElementById('state').textContent='三组测试结束，结果已保存到电脑。';`}})();</script>`);
});
server.listen(port,'127.0.0.1',()=>console.log('Listening on 127.0.0.1:'+port));
