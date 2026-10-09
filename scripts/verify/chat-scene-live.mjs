import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';

const [proxy,token,roleName,trajectory,revision,generation='production',prefixMode,prefixRevision='r1']=process.argv.slice(2);
const names=['艾莉','顾清寒','林霜','夏晚星','苏格拉底','古月娜'];
const scenes=['repair','affection','tired','joy','opinion','continuity','everyday','mishap','smalltalk','guyuena-daily','guyuena-softness','guyuena-ease','guyuena-canon','guyuena-present','guyuena-outsider','guyuena-taste','guyuena-fresh-view'];
if(!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy??'')||!token||!names.includes(roleName)||!scenes.includes(trajectory)||!/^r\d{1,2}$/u.test(revision??'')||!['production','thinking','direct'].includes(generation)||prefixMode&&!['replay-first-five','replay-first-four','replay-first-three','replay-first-two','replay-first-one'].includes(prefixMode))throw Error('Explicit local bounded proxy, known persona, scene, evidence revision and generation mode required');
const reportDay=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
const output=`docs/CHAT-FLASH-SCENE-${names.indexOf(roleName)}-${trajectory.toUpperCase()}-${revision.toUpperCase()}${generation==='direct'?'-DIRECT':''}-${reportDay}.json`;
if(existsSync(output))throw Error('Existing evidence must not be overwritten');
if(!/^r\d{1,2}$/u.test(prefixRevision)||prefixMode&&prefixRevision===revision)throw Error('Invalid distinct source revision');
const currentPrefix=`docs/CHAT-FLASH-SCENE-${names.indexOf(roleName)}-${trajectory.toUpperCase()}-${prefixRevision.toUpperCase()}${generation==='direct'?'-DIRECT':''}-${reportDay}.json`;
const prefixFile=prefixMode?(existsSync(currentPrefix)?currentPrefix:`docs/CHAT-FLASH-SCENE-${names.indexOf(roleName)}-${trajectory.toUpperCase()}-${prefixRevision.toUpperCase()}${generation==='direct'?'-DIRECT':''}-2026-10-08.json`):undefined;
const prefix=prefixFile?JSON.parse(readFileSync(prefixFile,'utf8')):undefined;
if(prefix&&(!prefix.complete||prefix.roleName!==roleName||prefix.trajectory!==trajectory||prefix.generation!==generation||prefix.rows.length!==6))throw Error('Replay requires a completed matching real six-turn source');
const prefixCount=prefixMode==='replay-first-one'?1:prefixMode==='replay-first-two'?2:prefixMode==='replay-first-three'?3:prefixMode==='replay-first-four'?4:prefixMode==='replay-first-five'?5:0;
const replay=prefix?prefix.rows.slice(0,prefixCount).map(row=>{
  if(row.failed||row.calls.length!==1||row.calls[0].replayed||row.calls[0].finish!=='stop'||!row.calls[0].raw?.trim())throw Error('Replay prefix must have exactly one completed real provider reply per turn');
  return {characterName:roleName,input:row.input,raw:row.calls[0].raw};
}):[];
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{LIVE_PROXY:JSON.stringify(proxy),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:JSON.stringify(replay),LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false',LIVE_GENERATION_MODE:JSON.stringify(generation),'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"scene-live"'}});
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><script src="/test.js"></script></body></html>');});
const report={date:new Date().toISOString(),model:'deepseek-flash',roleName,trajectory,revision,generation,scope:'six fresh consecutive turns, shipped persona, actual private send and IndexedDB; fixed proactivity 0.5; summary/settlement/extraction mocked, nonstream upstream; completion is transport only, no scoring hints sent to model; production and the legacy thinking label preserve application selection and native recovery; direct is an evaluation-only override; each actual request mode is captured',complete:false,rows:[],errors:[]};
if(prefix){report.prefixSource=prefixFile;report.prefixCount=prefixCount;report.scope=report.scope.replace('six fresh consecutive turns',`${prefixCount} replayed real prefix turns, then ${6-prefixCount} fresh provider turns; replay is not a new paid reply`);}
let browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression);
  report.persona=await page.evaluate(name=>window.liveExpression.presets(true).find(role=>role.name===name),roleName);
  if(!report.persona)throw Error('Missing shipped persona');
  if(prefix&&JSON.stringify(prefix.persona)!==JSON.stringify(report.persona))throw Error('Persona changed; fixed-prefix comparison is not applicable');
  const inputs=await page.evaluate(id=>window.liveExpression.trajectoryInputs(id),trajectory);
  if(inputs.length!==6)throw Error('Expected six whole-scene turns');
  if(replay.some((row,index)=>row.input!==inputs[index]))throw Error('Replay inputs do not match the current fixed scene');
  await page.evaluate(persona=>window.liveExpression.setup(persona),report.persona);
  for(const input of inputs){
    const row=await page.evaluate(text=>window.liveExpression.turn(text),input);
    report.rows.push(row);writeFileSync(output,JSON.stringify(report,null,2));
    if(prefix&&report.rows.length<=prefixCount&&row.calls.some(call=>!call.replayed))throw Error('Prefix unexpectedly performed a paid request');
    console.log(JSON.stringify({input,reply:row.replies,failed:row.failed,calls:row.calls.length}));
    if(row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length'))break;
  }
  report.complete=report.rows.length===6&&!report.errors.length&&!report.rows.some(row=>row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length'));
}finally{
  writeFileSync(output,JSON.stringify(report,null,2));await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
}
console.log(`LIVE scene: ${roleName}/${trajectory}/${revision}; ${report.rows.length}/6; complete=${report.complete}`);
