import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {writeFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';

const [proxy,token,condition]=process.argv.slice(2);
if(!['baseline','revised','traveler','rhythm','follow','reaction'].includes(condition)||!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy??'')||!token)throw Error('Explicit bounded local proxy and known condition required');
const output=`docs/CHAT-FLASH-ANECDOTE-${condition.toUpperCase()}-2026-10-08.json`;
if(existsSync(output))throw Error('Preserve the existing evidence; this condition has already been recorded');
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{LIVE_PROXY:JSON.stringify(proxy),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:'[]',LIVE_VOICE_EARLIER:'false',LIVE_EMOTION_COMPACT:'false','import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"anecdote-live"'}});
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><script src="/test.js"></script></body></html>');});
const inputs=['我刚发现两只袜子穿的不是一对😂','刚收到的快递，包装比里面的东西大了三倍。','刚吃了一瓣特别酸的橘子。'];
if(['rhythm','follow'].includes(condition))inputs.push('那有什么办法能让橘子不那么酸？');
const roleNames=['traveler','rhythm','follow','reaction'].includes(condition)?['艾莉']:['艾莉','顾清寒'];
const expectedRows=roleNames.length*inputs.length;
const report={date:new Date().toISOString(),model:'deepseek-flash',condition,scope:`${roleNames.join('、')}; three fresh same anecdotes${['rhythm','follow'].includes(condition)?', then an explicit practical question':''}; fixed proactivity 0.5; actual private send and IndexedDB, summary/settlement/extraction mocked; nonstreaming upstream; completion measures transport only`,complete:false,roles:[],rows:[],errors:[]};
let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression);
  report.roles=await page.evaluate(names=>window.liveExpression.presets(true).filter(role=>names.includes(role.name)),roleNames);
  if(report.roles.length!==roleNames.length)throw Error('Expected selected shipped personas');
  let stopped=false;
  for(const role of report.roles){
    await page.evaluate(p=>window.liveExpression.setup(p),role);
    for(const input of inputs){
      const row=await page.evaluate(text=>window.liveExpression.turn(text),input);
      report.rows.push({name:role.name,...row});writeFileSync(output,JSON.stringify(report,null,2));
      console.log(JSON.stringify({name:role.name,input,reply:row.replies,failed:row.failed,calls:row.calls.length}));
      if(row.failed||!row.replies.length||row.calls.some(call=>call.finish==='length')){stopped=true;break;}
    }
    if(stopped)break;
  }
  report.complete=report.rows.length===expectedRows&&!report.errors.length&&!stopped;
}finally{
  writeFileSync(output,JSON.stringify(report,null,2));await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
}
console.log(`LIVE anecdote ${condition}: ${report.rows.length}/${expectedRows}; complete=${report.complete}`);
