import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
const { chromium }=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-stream.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><div id="app"></div><script src="/test.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let checks=0;
try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>!!window.chatStreamTest);
  const call=(name,...args)=>page.evaluate(({name,args})=>window.chatStreamTest[name](...args),{name,args});
  const check=(condition,label)=>{if(!condition)throw Error(label);checks++;console.log('ok '+label);};
  for(const [state,relevant,namedDecline] of ['orphan','unversioned','stale','valid'].flatMap(state=>[[state,true,false],[state,false,false],[state,false,true]])) {
    await call('setup',30);
    await page.getByRole('textbox',{name:'消息内容'}).waitFor();
    await call('seedSummaryEvidence',state);
    await call('useCompleteResponses',['嗯，知道了。']);
    await call('submit',relevant?'薄荷偏好这个话题，接着聊两句吧。':namedDecline?'不聊薄荷了，聊聊电影吧。':'换个话题，聊聊电影吧。');
    await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===1);
    await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
    const request=(await call('completeRequests'))[0];
    const prompt=request.messages[0].content;
    check(prompt.includes('旧摘要内容标记')===(state==='valid'&&relevant),state+' actual private request injects summary only with live versions and current relevance='+relevant);
    // The full-turn selector may already carry this source in native history.
    // Require evidence in the final request, not a redundant system copy.
    if(state!=='valid')check(request.messages.some(message=>typeof message.content==='string'&&message.content.includes('早前已确认的薄荷偏好')),state+' unusable summary cannot hide uncovered original speech in final payload');
    check((await call('records')).filter(m=>m.role==='assistant'&&!m.id.startsWith('history-')).map(m=>m.content).join('')==='嗯，知道了。',state+' actual DB saves one reply');
    check((await call('completeRequests')).length===1,state+' local source validation adds no generation');
  }
  for(const [input,seed,expected] of [['还记得没有记录的北港约定吗？',false,'没有选出可引用'],['你还记得薄荷偏好吗？',true,'候选资料'],['你好',false,'']]) {
    await call('setup',30);await page.getByRole('textbox',{name:'消息内容'}).waitFor();
    if(seed)await call('seedSummaryEvidence','valid');
    await call('useCompleteResponses',['嗯，知道了。']);await call('submit',input);
    await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===1);
    await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
    const request=(await call('completeRequests'))[0];
    const prompt=request.messages[0].content;
    if(seed){
      check(prompt.includes('[本轮记忆检索状态]')&&prompt.includes('额外记忆检索')&&prompt.includes('近期对话原文'),'additional retrieval outcome does not negate already supplied current history');
      check(request.messages.some(message=>typeof message.content==='string'&&message.content.includes('早前已确认的薄荷偏好')),'known answer remains supplied even when additional retrieval has no new candidates');
    }else check(expected?prompt.includes('[本轮记忆检索状态]')&&prompt.includes(expected):!prompt.includes('[本轮记忆检索状态]'),'actual private request receives the current retrieval outcome: '+input);
    check((await call('completeRequests')).length===1,'retrieval outcome is local and adds no model request: '+input);
  }
  for(const mode of ['keep','edit','delete']) {
    await call('setup',0);await page.getByRole('textbox',{name:'消息内容'}).waitFor();
    await call('useCompleteResponses',['嗯，知道了。']);
    const state=await call('dispatchMemoryChange',mode);
    const outgoing=await call('completeRequests');
    check(state.validations>=2,mode+' actual send changes the source after prompt assembly');
    check(outgoing.length===1,mode+' source revalidation uses no extra generation');
    if(mode!=='keep'&&outgoing[0].messages[0].content.includes('OUTBOUND_MEMORY_OLD')){
      const prompt=outgoing[0].messages[0].content,index=prompt.indexOf('OUTBOUND_MEMORY_OLD');
      console.log('stale source diagnostic',JSON.stringify({mode,validations:state.validations,source:state.source,promptFragment:prompt.slice(Math.max(0,index-160),index+100)}));
    }
    check(outgoing[0].messages[0].content.includes('OUTBOUND_MEMORY_OLD')===(mode==='keep'),mode+' actual outbound prompt cannot include changed or deleted memory text');
    check(mode==='keep'||(mode==='edit'?state.source?.content==='OUTBOUND_MEMORY_NEW':!state.source),mode+' actual source state matches the selected mutation');
    const saved=await call('records');
    check(saved.some(message=>message.role==='assistant'&&message.content==='嗯，知道了。'),mode+' removing stale context still completes the reply and database write');
    const reply=saved.find(message=>message.role==='assistant'&&message.content==='嗯，知道了。');
    check(Boolean(reply.contextTrace?.memoryIds?.includes('outbound-memory'))===(mode==='keep'),mode+' saved reply provenance agrees with the actual outgoing memory block');
  }
  check(!errors.length,'no page errors');
  const timings=await page.evaluate(()=>window.virtugeneChatQuality.report().events.filter(event=>event.mode==='private'&&event.totalDurationMs!==undefined));
  check(timings.length>0&&timings.every(event=>Number.isFinite(event.preparationMs)&&Number.isFinite(event.providerMs)&&event.totalDurationMs>=event.preparationMs&&event.totalDurationMs>=event.providerMs),'actual send records finite preparation, request and whole-turn timing separately');
  check(timings.every(event=>!('prompt' in event)&&!('content' in event)&&!('apiKey' in event)),'latency diagnostics contain no message text or credentials');
  console.log(`PASS chat-summary-entry: ${checks} checks (real private send and IndexedDB, mocked transport)`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
