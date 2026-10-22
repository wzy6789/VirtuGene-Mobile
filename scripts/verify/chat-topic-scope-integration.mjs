import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/chat-stream.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><div id="app"></div><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={complete:false,scope:'Actual ChatWindow/send-service/IndexedDB; simulated complete responses; component remount only, not application restart or real emotional acceptance',paidCalls:0,turns:[],errors:[]};
try{
 const context=await browser.newContext({permissions:[]});
 const origin=`http://127.0.0.1:${server.address().port}`;
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(origin);await page.waitForFunction(()=>!!window.chatStreamTest);
 const call=(name,...args)=>page.evaluate(({name,args})=>window.chatStreamTest[name](...args),{name,args});
 await call('setup',0);await page.getByRole('textbox',{name:'消息内容'}).waitFor();
 const inputs=['今天想吐槽临时改需求。','先别分析，让我说完。','还有，需求晚上才发来。','现在说完了，告诉我怎么办。','换个话题，聊聊电影吧。','以后聊天不用分析，默认先听我说。'];
 for(let i=0;i<inputs.length;i++){
  await call('useCompleteResponses',[i===1?'好，那就结束吧。':'嗯，知道了。']);
  await call('submit',inputs[i]);
  await page.waitForFunction(expected=>window.chatStreamTest.completeRequests().length===expected,i+1);
  await page.waitForFunction(async expected=>(await window.chatStreamTest.conversationState())?.turnCount>=expected,i+1);
  const state=await call('conversationState');
  const request=(await call('completeRequests')).at(-1);
  report.turns.push({input:inputs[i],state,messages:request.messages,generation:{model:request.model,thinking:request.thinking,reasoningEffort:request.reasoning_effort}});
  if(i===1&&(state.topicAdvice!=='listen'||state.topicStatus==='closed'||state.preferences.adviceStyle!=='mixed'||state.currentTopic!==report.turns[0].state.currentTopic))throw Error('Local listening did not preserve actual subject independently of assistant closure');
  if(i===2){
   if(state.topicAdvice!=='listen')throw Error('Listening scope lost on a related follow-up');
   await call('remount');await page.getByRole('textbox',{name:'消息内容'}).waitFor();
   if((await call('conversationState')).topicAdvice!=='listen')throw Error('Stored scope lost on component remount');
  }
  if(i===3&&(state.topicAdvice!==undefined||request.messages[0].content.includes('这件事用户目前不求建议')))throw Error('Later explicit help still blocked by stale local listening');
  if(i===4&&state.topicAdvice!==undefined)throw Error('New subject inherited local restriction');
  if(i===5&&state.preferences.adviceStyle!=='listen')throw Error('Explicit enduring preference was not retained');
 }
 if(report.errors.length)throw Error('Page errors during integration');
 report.complete=true;
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync('release/chat-topic-scope-20261018/integration.json',JSON.stringify(report,null,2));console.log(JSON.stringify({complete:report.complete,turns:report.turns.length,errors:report.errors,paidCalls:0}));}
