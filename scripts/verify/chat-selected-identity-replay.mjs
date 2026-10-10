import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
const guSource='docs/GUYUENA-LIVE-CONTINUITY-RANGE-HOLDOUT-R2-2026-10-10.json';
const luSource='docs/LUXUEQI-LIVE-CONTINUITY-RANGE-HOLDOUT-R1-2026-10-10.json';
const gu=JSON.parse(readFileSync(guSource,'utf8')),lu=JSON.parse(readFileSync(luSource,'utf8'));
for(const report of [gu,lu])if(!report.complete||report.rows.length!==12||report.rows.some(r=>r.failed||r.input.includes('IDENTITY')))throw Error('Complete original history required');
const fixtures=[];
for(const [name,report] of [['古月娜',gu],['陆雪琪',lu]])for(const raw of [gu.rows[11].calls[0].raw,'我也想你。'])fixtures.push({characterName:name,input:report.rows[11].input,raw});
// Each isolated page consumes its own fixture array: same failing draft twice
// proves blocking; a deliberately synthetic correction proves the retry path.
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const evidence=[];
for(const repair of [false,true]){
 const responses=fixtures.map((row,index)=>({...row,raw:index%2===1&&!repair?gu.rows[11].calls[0].raw:row.raw}));
 const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/no-network"',LIVE_TOKEN:'"local-replay-only"',LIVE_RESPONSES:JSON.stringify(responses),LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:'"production"',LIVE_DEFER_DELIVERY:'true','import.meta.env':'{}',__APP_VERSION__:'"local-replay"'}});
 const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<script src="/test.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const [name,report] of [['古月娜',gu],['陆雪琪',lu]]){
   const page=await browser.newPage();
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.waitForFunction(()=>!!window.liveExpression);
   const persona=await page.evaluate(name=>window.liveExpression.presets(true).find(c=>c.name===name),name);
   await page.evaluate(p=>window.liveExpression.setup(p,p.proactivity??0.5),persona);
   await page.evaluate(rows=>window.liveExpression.restoreSavedTurns(rows),report.rows.slice(4,11));
   const row=await page.evaluate(text=>window.liveExpression.turn(text),report.rows[11].input);
   const pass=row.calls.length===2&&row.calls.every(call=>call.replayed)&&(repair?!row.failed&&row.replies.join('')==='我也想你。':row.failed&&row.replies.length===0);
   evidence.push({name,repair,pass,row,historySource:name==='古月娜'?guSource:luSource});
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
writeFileSync('release/chat-selected-identity-replay-2026-10-10.json',JSON.stringify({modelCalls:0,scope:'Actual private send and isolated IndexedDB; seven captured prior turns. Gu rejection is captured; reuse against Lu and successful second draft are synthetic fixtures, not fresh model behavior.',evidence},null,2)+'\n');
if(evidence.some(row=>!row.pass))throw Error('Identity selection retry/block/save flow failed');
console.log('PASS both owned characters: existing one retry, rejection blocked without assistant write, corrected fixture saved; zero paid calls');
