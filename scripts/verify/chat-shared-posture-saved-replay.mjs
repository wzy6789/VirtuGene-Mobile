import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
const file='docs/CHAT-SHARED-POSTURE-SAVED-REPLAY-2026-10-10.json';
if(existsSync(file))throw Error('Existing evidence must not be overwritten');
const source='docs/LUXUEQI-LIVE-CARE-WITHOUT-VERDICT-TRANSFER-R1-2026-10-10.json';
const saved=JSON.parse(readFileSync(source,'utf8'));
const row=saved.rows?.[0];
if(!saved.complete||row?.failed||row?.calls?.length!==1||row.calls[0].replayed||row.calls[0].finish!=='stop')throw Error('Completed original paid draft required');
const replay=Array.from({length:2},()=>({characterName:'陆雪琪',input:row.input,raw:row.calls[0].raw}));
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://network-forbidden.invalid"',LIVE_TOKEN:'"local-replay-only"',LIVE_RESPONSES:JSON.stringify(replay),LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:'"production"','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"habit-replay"'}});
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
let server,browser;
const report={source,modelCalls:0,scope:'The same real failed draft deliberately replayed twice through the existing single retry and actual private send/IndexedDB; no previous turns restored; no fresh model correction, no network model call, not the original timed session',complete:false};
try{
 server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.liveExpression);
 await page.evaluate(()=>{const role=window.liveExpression.presets().find(role=>role.name==='陆雪琪');return window.liveExpression.setup(role);});
 report.restoredMessages=await page.evaluate(rows=>window.liveExpression.restoreSavedTurns(rows),saved.rows.slice(0,0));
 report.row=await page.evaluate(input=>window.liveExpression.turn(input),row.input);
 const delivered=report.row.replies.join('');
 report.complete=!report.row.failed&&report.row.calls.length===2&&report.row.calls.every(call=>call.replayed)
   &&delivered.includes('不用急着说哪里错')&&!/陪你坐着说/u.test(delivered);
 if(!report.complete)throw Error('Uninvited shared posture survived actual publish fallback');
}catch(error){report.error=error.message;process.exitCode=1;}finally{writeFileSync(file,JSON.stringify(report,null,2));await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({complete:report.complete,replies:report.row?.replies,replayed:report.row?.calls.length,modelCalls:0,evidence:file}));
