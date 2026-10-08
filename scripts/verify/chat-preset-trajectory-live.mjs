import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
const [proxy,token,variant]=process.argv.slice(2);
if(variant&&!['--repair','--voice-earlier','--voice-tail','--view-exchange','--everyday-voice','--everyday-switch','--emotion-transition','--emotion-resume','--own-reaction','--listening-turns','--listening-cat','--relevant-voice','--single-draft','--remaining-voices','--receipt-repair','--compact-emotion','--quiet-reaction','--quiet-continuity','--quiet-isolated'].includes(variant))throw Error('Unsupported live-test variant');
const freshVariant=['--view-exchange','--everyday-voice','--emotion-transition','--own-reaction','--listening-turns','--listening-cat','--relevant-voice','--remaining-voices','--receipt-repair','--compact-emotion','--quiet-reaction','--quiet-continuity','--quiet-isolated'].includes(variant);
const previousFile=variant==='--single-draft'?'docs/CHAT-FLASH-RELEVANT-VOICE-2026-10-08.json':variant==='--emotion-resume'?'docs/CHAT-FLASH-EMOTION-TRANSITION-2026-10-08.json':variant==='--everyday-switch'?'docs/CHAT-FLASH-EVERYDAY-VOICE-2026-10-08.json':'docs/CHAT-FLASH-PRESET-TRAJECTORIES-2026-10-08.json';
const previous=variant&&!freshVariant?JSON.parse(readFileSync(previousFile,'utf8')):undefined;
const replay=variant==='--emotion-resume'
  ?previous.rows.slice(0,1).flatMap(row=>row.calls.filter(call=>call.finish==='stop'&&call.raw?.trim()).map(call=>({characterName:row.name,input:row.input,raw:call.raw})))
  :previous?previous.rows.filter((row,index,rows)=>rows.filter(earlier=>earlier.name===row.name).indexOf(row)<2).flatMap(row=>row.calls.map(call=>({characterName:row.name,input:row.input,raw:call.raw}))):[];
if(previous&&(replay.length!==(variant==='--emotion-resume'?1:4)||replay.some(row=>typeof row.raw!=='string')))throw Error('Unexpected original provider reply count for replay');
if(!proxy||!token||!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy))throw Error('Explicit bounded local live proxy required; never pass a real provider key');
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{LIVE_PROXY:JSON.stringify(proxy),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:JSON.stringify(replay),LIVE_VOICE_EARLIER:String(variant==='--voice-earlier'),LIVE_EMOTION_COMPACT:String(variant==='--compact-emotion'),'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"preset-trajectory-live"'}});
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><script src="/test.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const everydayInputs=['周末你更喜欢计划好，还是临时起意？','我觉得出门就该把行程排满，不然亏了。你怎么看？'];
const emotionVariant=['--emotion-transition','--emotion-resume','--own-reaction'].includes(variant);
const inputs=['--quiet-continuity','--quiet-isolated'].includes(variant)?['下雨天你更喜欢出门，还是待在家？','我刚发现两只袜子穿的不是一对😂','刚吃了一瓣特别酸的橘子。','刚收到的快递，包装比里面的东西大了三倍。','我把手机亮度调低了，眼睛舒服一点。','刚想找充电线，发现它就在手里。','窗边这盆植物终于冒新叶了。','今天晚饭的米饭有一点糊。','还记得前面我问的下雨天吗？你刚才更喜欢出门还是待在家？']:variant==='--quiet-reaction'?['今天讲了半天还是没被听懂，真累。我只是吐槽，不想要建议。','还有，我每次刚讲到一半，对方就急着说我想太多。','换个话题。下雨天你更喜欢出门，还是待在家？']:['--receipt-repair','--compact-emotion'].includes(variant)?['今天讲了半天还是没被听懂，真累。我只是吐槽，不想要建议。']:variant==='--remaining-voices'?['今天讲了半天还是没被听懂，真累。我只是吐槽，不想要建议。','换个话题。下雨天你更喜欢出门，还是待在家？']:['--listening-turns','--listening-cat','--relevant-voice','--single-draft'].includes(variant)
  ?['今天讲了半天还是没被听懂，真累。我只是吐槽，不想要建议。','还有，我每次刚讲到一半，对方就急着说我想太多。','现在帮我写一句回复，短一点，我想告诉他先听我说完。']
  :emotionVariant
  ?['今天讲了半天还是没被听懂，真累。','不是要建议，吐槽一下而已。对了，我刚拆了包饼干，碎得像沙子😂']
  :variant==='--everyday-switch'
  ?[...everydayInputs,'换个话题，我刚发现两只袜子穿的不是一对😂']
  :variant==='--everyday-voice'
  ?everydayInputs
  :variant==='--view-exchange'
  ?['周末约了朋友见面，后来临时想一个人待着。你怎么看？','我不是累，也不是朋友让我不舒服。只是今天不想出门。我觉得答应了就不能改主意，你同意吗？']
  :['周末约了朋友见面，后来临时想一个人待着。你怎么看？','不是朋友让我不舒服，就是我自己今天不想出门。','那我觉得答应了就不能改主意。你有不同意见也可以直说。'];
const names=['--quiet-reaction','--quiet-continuity','--quiet-isolated'].includes(variant)?['顾清寒']:['--remaining-voices','--receipt-repair','--compact-emotion'].includes(variant)?['林霜','顾清寒','夏晚星']:variant==='--listening-cat'?['苏格拉底']:['--listening-turns','--relevant-voice','--single-draft'].includes(variant)?['艾莉','苏格拉底']:emotionVariant?['艾莉','顾清寒','夏晚星']:['林霜','苏格拉底'];
const expectedRows=inputs.length*names.length;
const report={date:new Date().toISOString(),model:'deepseek-flash',scope:'two revised shipped personas, identical three-turn sequence; isolated production private send and DB; no settlement/extraction, nonstreaming upstream, max500 output',complete:false,rows:[],errors:[]};
const output=variant==='--quiet-isolated'?'docs/CHAT-FLASH-QUIET-ISOLATED-2026-10-08.json':variant==='--quiet-continuity'?'docs/CHAT-FLASH-QUIET-CONTINUITY-2026-10-08.json':variant==='--quiet-reaction'?'docs/CHAT-FLASH-QUIET-REACTION-2026-10-08.json':variant==='--compact-emotion'?'docs/CHAT-FLASH-COMPACT-EMOTION-2026-10-08.json':variant==='--receipt-repair'?'docs/CHAT-FLASH-RECEIPT-REPAIR-2026-10-08.json':variant==='--remaining-voices'?'docs/CHAT-FLASH-REMAINING-VOICES-2026-10-08.json':variant==='--single-draft'?'docs/CHAT-FLASH-SINGLE-DRAFT-2026-10-08.json':variant==='--relevant-voice'?'docs/CHAT-FLASH-RELEVANT-VOICE-2026-10-08.json':variant==='--listening-cat'?'docs/CHAT-FLASH-LISTENING-CAT-2026-10-08.json':variant==='--listening-turns'?'docs/CHAT-FLASH-LISTENING-TURNS-2026-10-08.json':variant==='--own-reaction'?'docs/CHAT-FLASH-OWN-REACTION-2026-10-08.json':variant==='--emotion-resume'?'docs/CHAT-FLASH-EMOTION-RESUMED-2026-10-08.json':variant==='--emotion-transition'?'docs/CHAT-FLASH-EMOTION-TRANSITION-2026-10-08.json':variant==='--everyday-switch'?'docs/CHAT-FLASH-EVERYDAY-SWITCH-2026-10-08.json':variant==='--everyday-voice'?'docs/CHAT-FLASH-EVERYDAY-VOICE-2026-10-08.json':variant==='--view-exchange'?'docs/CHAT-FLASH-VIEW-EXCHANGE-2026-10-08.json':variant==='--voice-earlier'?'docs/CHAT-FLASH-VOICE-EARLIER-2026-10-08.json':variant==='--voice-tail'?'docs/CHAT-FLASH-VOICE-TAIL-2026-10-08.json':variant?'docs/CHAT-FLASH-PRESET-TRAJECTORIES-REPAIR-2026-10-08.json':'docs/CHAT-FLASH-PRESET-TRAJECTORIES-2026-10-08.json';
if(freshVariant)report.scope='two revised shipped personas, fresh identical two-turn sequence; isolated production private send and DB; no settlement/extraction, nonstreaming upstream; bounded output by local proxy';
if(variant==='--emotion-transition'||variant==='--own-reaction')report.scope='three revised shipped personas, fresh identical two-turn fatigue to light topic transition; isolated production private send and DB; no settlement/extraction, nonstreaming upstream; bounded output by local proxy';
if(variant==='--listening-turns')report.scope='two revised shipped personas, fresh three-turn explicit venting, continued venting and later concrete help; isolated production private send and DB; no settlement/extraction, nonstreaming upstream; bounded output by local proxy';
if(variant==='--listening-cat')report.scope='one revised shipped philosophy cat, fresh three-turn venting, continuation and concrete help; no replay; isolated production private send and DB; no settlement/extraction, nonstreaming upstream; bounded output by local proxy';
if(variant==='--relevant-voice')report.scope='two revised shipped personas after relevant-only voice selection, fresh three-turn venting, continuation and concrete help; no replay; isolated production private send and DB; no settlement/extraction, nonstreaming upstream; bounded output by local proxy';
if(variant==='--single-draft')report.scope='two revised personas, replay exact two-turn prefix from relevant-voice and generate one fresh bounded single-message drafting turn each; isolated production private send and DB; no settlement/extraction, nonstreaming upstream';
if(variant==='--remaining-voices')report.scope='three other shipped revised personas, two fresh identical turns from explicit venting to rainy-day personal preference; no replay; isolated production private send and DB; no settlement/extraction, nonstreaming upstream';
if(variant==='--receipt-repair')report.scope='three other shipped personas, one fresh same venting message after reaction and capability-boundary guidance revision; no replay; isolated production private send and DB; no settlement/extraction, nonstreaming upstream';
if(variant==='--compact-emotion')report.scope='evaluation-only mood-hint removal ablation: three shipped personas, same fresh venting message; other prompt and generation behavior unchanged; isolated private send and DB; no settlement/extraction, nonstreaming upstream';
if(variant==='--quiet-reaction')report.scope='one revised quiet swordsman, fresh three-turn venting, continuation and rainy-day preference; normal production prompt, no ablation or replay; isolated private send and DB; no settlement/extraction, nonstreaming upstream';
if(variant==='--quiet-continuity')report.scope='one revised quiet swordsman, nine fresh turns; seven intervening everyday topics move initial personal preference beyond recent transport window, followed by explicit same-session recall; fixed proactivity 0.5, isolated private send and DB; summary/settlement/extraction mocked, nonstreaming upstream';
if(variant==='--quiet-isolated')report.scope='same nine fresh quiet-swordsman turns after source-example deduplication and short-receipt rhythm guidance; no replay, fixed proactivity 0.5; isolated private send and DB; summary/settlement/extraction mocked, nonstreaming upstream';
report.variant=variant??'fresh-trajectory';
if(previous)report.replayedPrefixPerRole=variant==='--emotion-resume'?{'艾莉':1}:2;
if(variant==='--emotion-resume')report.scope='three revised shipped personas, replay one successful Aili fatigue reply from the terminal incomplete run and generate remaining five turns; isolated production private send and DB; no settlement/extraction, nonstreaming upstream; bounded output by local proxy';
if(variant==='--everyday-switch')report.scope='two revised shipped personas, replay their exact two-turn everyday prefix and generate one fresh explicit topic switch each; isolated production private send and DB; no settlement/extraction, nonstreaming upstream; bounded output by local proxy';
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression);
  const roles=await page.evaluate(names=>window.liveExpression.presets(true).filter(role=>names.includes(role.name)),names);
  report.roles=roles;
  let stopped=false;
  for(const role of roles) {
    await page.evaluate(p=>window.liveExpression.setup(p),role);
    for(const input of inputs) {
      const row=await page.evaluate(text=>window.liveExpression.turn(text),input);report.rows.push({name:role.name,...row});writeFileSync(output,JSON.stringify(report,null,2));
      console.log(JSON.stringify({name:role.name,input,reply:row.replies,calls:row.calls.length,failed:row.failed}));
      const shouldReplay=variant==='--emotion-resume'?role.name==='艾莉'&&input===inputs[0]:previous&&input!==inputs[2];
      if(shouldReplay&&row.calls.some(call=>!call.replayed))throw Error('Expected prefix replay did not happen; stop paid test');
      if(row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length')){stopped=true;break;}
    }
    if(stopped)break;
  }
  report.complete=report.rows.length===expectedRows&&!report.errors.length&&!report.rows.some(row=>row.failed||row.calls.some(call=>call.finish==='length'));
}finally{writeFileSync(output,JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve));}
console.log('LIVE preset trajectories: '+report.rows.length+'/'+expectedRows+'; complete='+report.complete);
