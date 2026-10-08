import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

// The real provider secret remains in an independently authorized in-memory
// proxy. This runner only receives a disposable local authorization token.
const proxy=process.env.VG_LIVE_PROXY,token=process.env.VG_LIVE_TOKEN;
if(!proxy||!token||!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy))throw Error('Requires an explicit bounded local live proxy');
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const previous=JSON.parse(readFileSync('docs/CHAT-FLASH-CONTINUOUS-SAMPLE-2026-10-08.json','utf8'));
const persona=previous.personas[1];
const replayCount=Number(process.env.VG_REPLAY_PREFIX??0);
if(!Number.isInteger(replayCount)||replayCount<0||replayCount>27)throw Error('Invalid replay prefix');
const replay=replayCount?JSON.parse(readFileSync('docs/CHAT-FLASH-LIVE-PIPELINE-2026-10-08.json','utf8')).rows.slice(0,replayCount).flatMap(row=>row.calls.map(c=>({input:row.input,raw:c.raw}))):[];
const inputs=[
  '我最近晚上不喝咖啡了，喝了睡不着。','今天好累，先别给建议，陪我聊两句。',
  '不是工作累，是解释半天还没被听懂。','算了，换个话题。你怎么看猫和老鼠？',
  '是老版短片，不是动画电影。','你小时候也看过吗？',
  '不用编你小时候的事，说你现在觉得哪里有意思就好。','哈哈哈哈汤姆每次都好惨。',
  '对了，我下周五下午三点面试。只聊天，不用设置提醒。','不是下周五，我看错邮件了，是下周四下午三点。',
  '突然有点紧张，但我今天不想分析这事。','先聊别的，我想买个杯子。',
  '你更喜欢简单的还是花里胡哨的？','我偏喜欢简单的，刚才那句我说得太笼统了。',
  '你不同意我也可以直说，不用每次都顺着我。','我觉得朋友聊天就该一直秒回。',
  '我不太同意你，不过我自己忙的时候也不回消息。','好像是我刚才说绝对了。',
  '哈哈，这话题先放一放。今天晚饭吃什么还没想好。','嗯，今天倒也没那么累了。',
  '我爱你。','哈哈，先别肉麻，我想听你自己的看法。',
  '对不起，刚才说别肉麻可能有点冲。','谢谢你听我说。',
  '换个话题。你知道我昨晚几点睡的吗？','两点，刷视频刷过头了。',
  '你把我刚才那句再说一遍。','我前面更正过面试时间，最后是哪天几点？',
  '今晚想喝点东西，结合我开头说的习惯，你会建议什么？','行，今晚就这样。晚安啦。',
];
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{LIVE_PROXY:JSON.stringify(proxy),LIVE_TOKEN:JSON.stringify(token),LIVE_RESPONSES:JSON.stringify(replay),'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"isolated-live-test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><script src="/test.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={date:new Date().toISOString(),model:'deepseek-flash',persona,scope:'Real private send pipeline and isolated IndexedDB; non-streaming upstream; settlement, summarization and extraction disabled; provider output capped at 320 tokens',replayPrefix:replayCount,complete:false,rows:[],errors:[]};
const output=replayCount?'docs/CHAT-FLASH-LIVE-PIPELINE-REPAIR-2026-10-08.json':'docs/CHAT-FLASH-LIVE-PIPELINE-2026-10-08.json';
try{
  const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.liveExpression);
  await page.evaluate(persona=>window.liveExpression.setup(persona),persona);
  for(let i=0;i<inputs.length;i++){
    const row=await page.evaluate(input=>window.liveExpression.turn(input),inputs[i]);report.rows.push({turn:i+1,...row});
    writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({turn:i+1,reply:row.replies.join(' | '),calls:row.calls.length,failed:row.failed}));
    if(row.failed||!row.replies.length||row.calls.some(c=>c.finish==='length'))break;
  }
  report.complete=report.rows.length===inputs.length&&!report.rows.some(r=>r.failed)&&!report.errors.length;
}finally{
  writeFileSync(output,JSON.stringify(report,null,2));await browser.close();server.close();
}
console.log(`LIVE pipeline: ${report.rows.length}/30 turns; complete=${report.complete}`);
