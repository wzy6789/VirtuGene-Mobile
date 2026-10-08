import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
const [proxy,token]=process.argv.slice(2);
if(!proxy||!token||!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy))throw Error('Explicit bounded local proxy required');
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const scenarios=[
  {name:'艾莉',input:'今天解释了三遍还是被误解了。我只是吐槽，不想要建议。'},
  {name:'苏格拉底',input:'刚才发现买的袜子左右颜色不一样😂'},
  {name:'林霜',input:'我喜欢你，不过今天不想聊大道理，就想听你自己的反应。'},
];
const report={date:new Date().toISOString(),model:'deepseek-flash',scope:'three scenarios, identical persona and user message per thinking/direct pair; isolated production send and DB, no summary/extraction/settlement; nonstreaming upstream; direct mode uses temperature .8',complete:false,rows:[],errors:[]};
const output='docs/CHAT-FLASH-MODE-COMPARISON-2026-10-08.json';
let stopped=false;
for(const mode of ['thinking','direct']) {
  const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{LIVE_PROXY:JSON.stringify(proxy),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_GENERATION_MODE:JSON.stringify(mode),'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"mode-comparison"'}});
  const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><script src="/test.js"></script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression);
    const roles=await page.evaluate(()=>window.liveExpression.presets(true));
    for(const scenario of scenarios) {
      const role=roles.find(role=>role.name===scenario.name);if(!role)throw Error('Missing preset');
      await page.evaluate(p=>window.liveExpression.setup(p),role);
      const row=await page.evaluate(text=>window.liveExpression.turn(text),scenario.input);
      report.rows.push({mode,name:role.name,persona:role,...row});writeFileSync(output,JSON.stringify(report,null,2));
      console.log(JSON.stringify({mode,name:role.name,reply:row.replies,calls:row.calls.length,failed:row.failed}));
      if(row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length')){stopped=true;break;}
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
  if(stopped)break;
}
report.complete=report.rows.length===6&&!report.errors.length&&!report.rows.some(row=>row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length'));
report.comparisons=scenarios.map(scenario=>{
  const thinking=report.rows.find(row=>row.name===scenario.name&&row.mode==='thinking');
  const direct=report.rows.find(row=>row.name===scenario.name&&row.mode==='direct');
  return {name:scenario.name,input:scenario.input,
    samePersona:!!thinking&&!!direct&&JSON.stringify(thinking.persona)===JSON.stringify(direct.persona),
    sameMessages:!!thinking&&!!direct&&JSON.stringify(thinking.calls[0]?.messages)===JSON.stringify(direct.calls[0]?.messages),
    oneCallPerCondition:thinking?.calls.length===1&&direct?.calls.length===1,
    actualThinkingMode:thinking?.calls[0]?.generation?.thinking?.type,
    actualDirectMode:direct?.calls[0]?.generation?.thinking?.type,
    directTemperature:direct?.calls[0]?.generation?.temperature};
});
report.cleanPairs=report.comparisons.filter(pair=>pair.samePersona&&pair.sameMessages&&pair.oneCallPerCondition&&pair.actualThinkingMode==='enabled'&&pair.actualDirectMode==='disabled').length;
writeFileSync(output,JSON.stringify(report,null,2));
console.log('LIVE mode comparison: '+report.rows.length+'/6; complete='+report.complete+'; cleanPairs='+report.cleanPairs);
