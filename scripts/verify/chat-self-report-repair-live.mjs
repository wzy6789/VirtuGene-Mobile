import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
const [proxy,token,delivery='streaming',revision='r1']=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy??'')||!token)throw Error('Bounded local test proxy required');
if(!['streaming','deferred'].includes(delivery))throw Error('Known diagnostic delivery mode required');
if(!/^r\d{1,2}$/u.test(revision))throw Error('Explicit evidence revision required');
const root='F:/VirtuGene-Mobile/';
const output=root+`docs/CHAT-SELF-REPORT-REPAIR-LIVE${delivery==='deferred'?'-DEFERRED':''}${revision==='r1'?'':'-'+revision.toUpperCase()}-2026-10-09.json`;
if(existsSync(output))throw Error('Existing real evidence must not be overwritten');
const sourcePath='docs/CHAT-FLASH-SCENE-2-EVERYDAY-R5-2026-10-09.json';
const source=JSON.parse(readFileSync(root+sourcePath,'utf8'));
if(!source.complete||source.roleName!=='林霜'||source.rows.length!==6)throw Error('Completed six-turn source required');
const replay=source.rows.slice(0,2).map(row=>{
  if(row.calls.length!==1||row.calls[0].finish!=='stop'||row.calls[0].replayed)throw Error('Expected one completed paid original per source turn');
  return {characterName:source.roleName,input:row.input,raw:row.calls[0].raw};
});
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{LIVE_PROXY:JSON.stringify(proxy),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:JSON.stringify(replay),LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_DEFER_DELIVERY:String(delivery==='deferred'),LIVE_GENERATION_MODE:'"production"','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"source-risk-live"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><script src="/test.js"></script></body></html>');});
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const report={source:sourcePath,delivery,revision,scope:'two saved actual provider drafts replayed through current private send and IndexedDB; measures whether source-risk triggers a fresh real retry; replay is not a new model reply; nonstream provider, memory extraction/summary/settlement mocked; deferred is an explicit test-only removal of onDelta, not production streaming; complete means retry mechanism observed, not semantic acceptance',rows:[],complete:false,errors:[]};
let browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression);
  const persona=await page.evaluate(()=>window.liveExpression.presets(true).find(c=>c.name==='林霜'));
  if(JSON.stringify(persona)!==JSON.stringify(source.persona))throw Error('Persona changed from the saved real source');
  await page.evaluate(p=>window.liveExpression.setup(p),persona);
  for(const row of replay){const result=await page.evaluate(input=>window.liveExpression.turn(input),row.input);report.rows.push(result);console.log(JSON.stringify({input:row.input,reply:result.replies,calls:result.calls.map(call=>({replayed:call.replayed,finish:call.finish}))}));}
  const fresh=report.rows.flatMap(row=>row.calls).filter(call=>!call.replayed);
  report.quality=await page.evaluate(()=>window.virtugeneChatQuality.report());
  report.complete=report.rows.length===2&&report.rows.every(row=>!row.failed&&row.replies.length>0)&&fresh.length===1&&fresh.every(call=>call.finish==='stop')&&!report.errors.length;
}finally{writeFileSync(output,JSON.stringify(report,null,2));await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));}
console.log('LIVE saved-draft repair transport complete='+report.complete);
