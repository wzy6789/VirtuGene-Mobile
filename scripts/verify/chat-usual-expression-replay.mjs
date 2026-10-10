import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
const mode=process.argv[2]??'usual';
if(!['usual','performance','domestic'].includes(mode))throw Error('Known bounded captured replay only');
const source=mode==='domestic'?'docs/LUXUEQI-LIVE-TINY-CURIOSITY-HOLDOUT-R1-2026-10-10.json':mode==='performance'?'docs/LUXUEQI-LIVE-QUIET-JOY-TRANSFER-R2-2026-10-10.json':'docs/LUXUEQI-LIVE-MIXED-TURN-HOLDOUT-R1-2026-10-10.json';
const report=JSON.parse(readFileSync(source,'utf8'));
if(!report.complete||report.rows.length!==(mode==='domestic'?2:mode==='performance'?1:3)||report.rows.some(r=>r.failed||r.calls.length!==1||r.calls[0].finish!=='stop'||!r.calls[0].raw))throw Error('Exact complete captured original group required');
const responses=report.rows.flatMap((row,index)=>Array.from({length:mode==='domestic'?index===0?2:1:mode==='performance'||index===2?2:1},()=>({input:row.input,raw:row.calls[0].raw})));
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/no-network"',LIVE_TOKEN:'"local-replay-only"',LIVE_RESPONSES:JSON.stringify(responses),LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:'"production"',LIVE_DEFER_DELIVERY:'true','import.meta.env':'{}',__APP_VERSION__:'"local-replay"'}});
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>!!window.liveExpression);
 const persona=await page.evaluate(()=>window.liveExpression.presets(true).find(c=>c.name==='陆雪琪'));
 await page.evaluate(p=>window.liveExpression.setup(p,p.proactivity),persona);
 const rows=[];
 for(const original of report.rows)rows.push(await page.evaluate(text=>window.liveExpression.turn(text),original.input));
 const pass=rows.every(row=>!row.failed&&row.calls.every(call=>call.replayed))&&(mode==='domestic'
  ?rows[0].calls.length===2&&rows[0].replies.join('')==='给一盆小葱取名……倒也认真。'&&rows[1].calls.length===1
  :mode==='performance'
  ?rows[0].calls.length===2&&!rows[0].replies.join('').includes('先前听你')&&rows[0].replies.join('').includes('我替你高兴')
  :rows[0].calls.length===1&&rows[1].calls.length===1&&rows[2].calls.length===2&&rows[2].replies.join('')==='我也想你。你这样说，我心里是暖的。');
 writeFileSync(`release/chat-${mode==='domestic'?'domestic-reference':mode==='performance'?'past-performance':'usual-expression'}-replay-2026-10-10.json`,JSON.stringify({source,pass,rows,modelCalls:0,scope:'Captured whole Lu group through isolated actual private send and IndexedDB. The affected actual draft replayed for both attempts to prove existing retry and omission. Not fresh model expression or original live DB.'},null,2)+'\n');
 if(!pass)throw Error('Captured history claim did not follow existing retry and warm-sentence preservation');
 console.log(`PASS actual private-send captured replay: ${report.rows.length} turns, ${responses.length} fixtures, zero paid calls`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
