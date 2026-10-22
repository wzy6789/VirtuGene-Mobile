// One focused P9 gap: stock-data reads and per-send timing through real ChatWindow.
// Reuses the existing transport-isolated stream fixture; no production overrides.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=process.env.VG_STOCK_SEND_OUT??`.tmp-preview/starfield-upgrade-20261017/P9/stock-send-${Date.now()}`;
mkdirSync(out,{recursive:true});
const instrumentation=`
let stockReads=[];
db.use({stack:'dbcore',name:'p9-stock-read-counter',create:down=>({...down,table:name=>{
 const table=down.table(name);return {...table,
 get:async req=>{const result=await table.get(req);stockReads.push({table:name,method:'get',rows:Number(!!result)});return result;},
 getMany:async req=>{const result=await table.getMany(req);stockReads.push({table:name,method:'getMany',rows:result.filter(Boolean).length});return result;},
 query:async req=>{const result=await table.query(req);stockReads.push({table:name,method:'query',rows:result.result.length,values:req.values});return result;}
 };}})});
Object.assign(window.chatStreamTest,{
 seedStock:async dense=>{
  const now=Date.now();
  await db.diaries.bulkPut(Array.from({length:600},(_,i)=>({id:'p9-diary-'+i,userId:uid,date:'2026-10-16',title:'本地验收记录'+i,content:'今天把事情整理好了。'.repeat(30),characterId:'a',visibility:i<6?'selected':'private',visibleTo:i<6?['a']:[],createdAt:now-86400000,updatedAt:now-86400000,revision:1,tags:[],mood:3})));
  await db.characterKnowledge.bulkPut(Array.from({length:6},(_,i)=>({id:'p9-knowledge-'+i,userId:uid,worldId:'w',characterId:'a',eventId:'diary:p9-diary-'+i,knowledgeLevel:'full',canMention:true,learnedAt:now})));
  await db.memorySourceTombstones.bulkPut(Array.from({length:2},(_,i)=>({id:'p9-matched-'+i,userId:uid,characterId:'a',sourceType:'message',sourceId:'p9-deleted-'+i,sourceRevision:1,status:'deleted',updatedAt:now,suppressedMessageIds:['p9-old-deleted-'+i]})));
  if(dense){
   await db.characterKnowledge.bulkPut(Array.from({length:10000},(_,i)=>({id:'p9-unrelated-knowledge-'+i,userId:i%2?uid:'other-account',worldId:'other-world',characterId:'b',eventId:'unrelated:'+i,knowledgeLevel:'full',canMention:true,learnedAt:now})));
   await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'p9-unrelated-tombstone-'+i,userId:i%2?uid:'other-account',characterId:'b',sourceType:'message',sourceId:'p9-unrelated-'+i,sourceRevision:1,status:'deleted',updatedAt:now,suppressedMessageIds:['p9-unrelated-message-'+i]})));
  }
  stockReads=[];
  return {history:await db.messages.count(),diaries:await db.diaries.count(),knowledge:await db.characterKnowledge.count(),tombstones:await db.memorySourceTombstones.count()};
 },
 beginStockRead:()=>{stockReads=[];},stockReads:()=>stockReads
});`;
const bundle=await build({entryPoints:['scripts/verify/chat-stream.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"test"'},plugins:[{name:'p9-read-observation',setup(b){b.onLoad({filter:/[\\/]verify[\\/]chat-stream\.tsx$/},args=>({contents:readFileSync(args.path,'utf8')+instrumentation,loader:'tsx'}));}}]});
const assets='dist/renderer/assets',css=readdirSync(assets).filter(f=>f.endsWith('.css'));
const server=createServer((req,res)=>{
 if(req.url==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
 else if(req.url.startsWith('/assets/')){try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(readFileSync(join(assets,basename(req.url))));}catch{res.writeHead(404).end();}}
 else {res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script src="/test.js"></script></html>`);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
const report={at:new Date().toISOString(),samples:[],errors:[],externalRequests:[],paidModelCalls:0,microphoneCalls:0,limits:['Real ChatWindow/send pipeline and IndexedDB with synthetic stock; existing SSE transport mock. Not the signed-in sidebar or Android.','Two independent stock sends, not a latency guarantee or a full old/new application comparison.','Exact request payload hashes retained; timing boundaries use each individual production event, never differences of window averages.']};
try{
 for(const dense of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/*',route=>{const req=route.request();if(req.url().startsWith(origin+'/')&&req.method()==='GET')return route.continue();report.externalRequests.push(req.url());return route.abort();});
  await page.goto(origin+'/?virtugene-preview=mobile');await page.waitForFunction(()=>!!window.chatStreamTest);
  const test=(name,...args)=>page.evaluate(({name,args})=>window.chatStreamTest[name](...args),{name,args});
  await test('setup',512);await page.getByRole('textbox',{name:'消息内容',exact:true}).waitFor();
  const stock=await test('seedStock',dense);await test('beginStockRead');
  await test('submit','你好，今天聊点什么');await page.waitForFunction(()=>window.chatStreamTest.requests().length===1);
  const payload=(await test('requests'))[0].body;
  await test('push',0,'嗯，收到了。');await page.locator('[data-streaming-reply]').waitFor();await test('finish',0);
  await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
  await page.waitForFunction(()=>window.virtugeneChatQuality.report().events.some(e=>Number.isFinite(e.totalDurationMs)));
  const timing=await page.evaluate(()=>window.virtugeneChatQuality.report().events.at(-1));
  const reads=await test('stockReads'),tombstoneReads=reads.filter(r=>r.table==='memorySourceTombstones');
  assert.equal(stock.history,512);assert.equal(stock.diaries,600);assert.equal(stock.tombstones,dense?8107:2);
  assert(tombstoneReads.length>0&&tombstoneReads.every(r=>r.rows<=2),'No unrelated tombstone bodies read during any send precheck');
  for(const key of ['preparationMs','providerMs','firstAnswerMs','sendToFirstVisibleMs','answerToVisibleMs','totalDurationMs'])assert(Number.isFinite(timing[key]),key);
  assert.equal(timing.sendToFirstVisibleMs,timing.firstAnswerMs+timing.answerToVisibleMs);
  assert.equal((await test('requests')).length,1);assert.equal(await test('extraNetwork'),0);
  report.samples.push({dense,stock,payloadSha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),timing,reads,tombstoneReads});
  await context.close();
 }
 report.requestPayloadUnchanged=report.samples[0].payloadSha256===report.samples[1].payloadSha256;
 assert(report.requestPayloadUnchanged,'Unrelated records must not change the complete transmitted request payload');
 assert.equal(report.errors.length,0);assert.equal(report.externalRequests.length,0);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{report.sourceHashes=Object.fromEntries(Object.keys(bundle.metafile.inputs).filter(p=>!p.startsWith('<')).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({out,pass:report.pass,failure:report.failure,samples:report.samples.map(s=>({dense:s.dense,stock:s.stock,timing:s.timing,tombstoneRows:s.tombstoneReads.reduce((n,r)=>n+r.rows,0)}))}));
