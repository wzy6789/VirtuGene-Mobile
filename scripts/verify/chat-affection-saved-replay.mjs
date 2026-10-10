import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
const file='docs/CHAT-AFFECTION-SAVED-DRAFT-REPLAY-R2-2026-10-10.json';
if(existsSync(file))throw Error('Existing evidence');
const sources=['docs/GUYUENA-LIVE-SHY-AFFECTION-TRANSFER-R1-2026-10-10.json','docs/GUYUENA-LIVE-SHY-AFFECTION-TRANSFER-R2-2026-10-10.json'];
const [first,second]=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(!first.complete||!second.complete||second.rows[0].calls.length!==2||!second.rows[0].calls[0].replayed||second.rows[0].calls[1].replayed)throw Error('Expected real initial and paid correction evidence');
const input=first.rows[0].input;
if(input!==second.rows[0].input)throw Error('Different source message');
const replay=[first.rows[0].calls[0],second.rows[0].calls[1]].map(call=>({characterName:'古月娜',input,raw:call.raw}));
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://network-forbidden.invalid"',LIVE_TOKEN:'"local-replay-only"',LIVE_RESPONSES:JSON.stringify(replay),LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:'"production"','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"saved-replay"'}});
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
let server,browser;
const report={sources,modelCalls:0,scope:'Two saved real drafts replayed through actual isolated private send service and IndexedDB; no paid or network model calls; not fresh generation',complete:false};
try{
 server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.liveExpression);
 await page.evaluate(()=>{const role=window.liveExpression.presets().find(role=>role.name==='古月娜');return window.liveExpression.setup(role);});
 report.row=await page.evaluate(input=>window.liveExpression.turn(input),input);
 report.complete=!report.row.failed&&report.row.calls.length===2&&report.row.calls.every(call=>call.replayed)&&report.row.replies.join('').includes('我也想你')&&!/难得|窗边|发呆/u.test(report.row.replies.join(''));
 if(!report.complete)throw Error('Saved draft source fallback failed');
}catch(error){report.error=error.message;process.exitCode=1;}finally{writeFileSync(file,JSON.stringify(report,null,2));await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({complete:report.complete,replies:report.row?.replies,replayed:report.row?.calls.length,modelCalls:0,evidence:file}));
