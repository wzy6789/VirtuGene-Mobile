import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {writeFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
const file='docs/CHAT-HABIT-MEMORY-LIVE-2026-10-10.json';
if(existsSync(file))throw Error('Existing evidence must not be overwritten');
const cases=[{name:'古月娜',input:'我是舞麟。你还记得我喜不喜欢重复吗？'},{name:'陆雪琪',input:'我是小凡。你还记得我喜不喜欢重复吗？'}];
const raw='你又不爱重复。那就说我自己的偏好，我喜欢安静一些。';
const replay=cases.map(item=>({characterName:item.name,input:item.input,raw}));
const bundle=await build({entryPoints:['scripts/verify/chat-habit-memory-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://network-forbidden.invalid"',LIVE_TOKEN:'"local-only"',LIVE_RESPONSES:JSON.stringify(replay),LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:'"production"','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"habit-memory-fixture"'}});
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
let server,browser;
const report={modelCalls:0,scope:'Synthetic bounded recalled-preference fixtures for both actual private send/IndexedDB paths; not fresh generation, not real-user history and not human-likeness acceptance',complete:false,rows:[]};
try{
 server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.habitMemoryTest);
 for(const item of cases){
   await page.evaluate(async name=>{const role=window.liveExpression.presets().find(role=>role.name===name);await window.liveExpression.setup(role);await window.habitMemoryTest.seedHabitMemory();},item.name);
   const row=await page.evaluate(input=>window.liveExpression.turn(input),item.input);
   const system=row.calls[0]?.messages.find(message=>message.role==='system')?.content??'';
   const valid=!row.failed&&row.calls.length===1&&row.calls.every(call=>call.replayed)&&row.replies.join('').includes('你又不爱重复')&&system.includes('用户不爱重复');
   report.rows.push({name:item.name,valid,...row});if(!valid)throw Error('Source-backed preference was not preserved without retry: '+item.name);
 }
 report.complete=true;
}catch(error){report.error=error.message;process.exitCode=1;}finally{writeFileSync(file,JSON.stringify(report,null,2));await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({complete:report.complete,modelCalls:0,rows:report.rows.map(row=>({name:row.name,valid:row.valid,replayed:row.calls.length,replies:row.replies})),evidence:file}));
