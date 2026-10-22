import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
const output=process.argv[3]??'docs/APK-6.1.0-LATENCY-LIVE-2026-10-13.json';
if(existsSync(output))throw Error('Evidence path already used');
const keyFile=process.argv[2];if(!keyFile)throw Error('Credential file required');
let credential=readFileSync(keyFile,'utf8');const lines=credential.split(/\r?\n/u),start=lines.findIndex(line=>/deepseek/iu.test(line));
const end=lines.findIndex((line,index)=>index>start&&/silicon|硅基|openai|anthropic|qwen/iu.test(line));
const keys=lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[];
let secret=keys[1];credential='';lines.fill('');keys.fill('');if(!secret)throw Error('Configured credential unavailable');
const token=randomUUID(),calls=[],active=new Set();let tokens=0,unknown=false;
const report={date:new Date().toISOString(),scope:'Actual 6.1.0 APK assets unmodified in mobile-sized desktop Chrome. No Android device. Three fresh isolated UI conversations, provider SSE. APK SHA256 verified. Not current-source send service.',apkSha256:'b2a3eee467cc837726fa4916c22b7ace1828ae776db174be296b08249dfdb888',budget:{maxCalls:6,maxTokensPerCall:900,maxTotalTokens:40000},rows:[],calls,complete:false,errors:[]};
const proxy=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end();return;}
  let settle;const work=new Promise(resolve=>settle=resolve);active.add(work);let call;
  try{
    let data='';for await(const chunk of req){data+=chunk;if(data.length>128000)throw Error('Oversized payload');}
    const body=JSON.parse(data);
    if(body.model!=='deepseek-flash'||!body.stream||calls.length>=6||unknown||tokens+Buffer.byteLength(JSON.stringify(body.messages))+900>40000){(report.rejectedRequests??=[]).push({model:body.model,stream:body.stream,lastMessage:body.messages?.at(-1)?.content});throw Error('Live budget/model guard');}
    body.max_tokens=Math.min(900,body.max_tokens??900);
    call={attempt:calls.length+1,startedAt:Date.now(),model:body.model,payload:body,bodyHash:createHash('sha256').update(JSON.stringify(body.messages)).digest('hex'),pending:true};calls.push(call);
    const upstream=process.env.LATENCY_MOCK==='1'?new Response('data: '+JSON.stringify({choices:[{delta:{content:'终于写完了，出去走走吧。'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}):await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    call.status=upstream.status;res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')??'text/event-stream'});
    const reader=upstream.body.getReader(),decoder=new TextDecoder();let raw='';
    for(;;){const {done,value}=await reader.read();if(done)break;call.firstChunkMs??=Date.now()-call.startedAt;raw+=decoder.decode(value,{stream:true});res.write(value);}
    raw+=decoder.decode();call.rawSse=raw;
    for(const line of raw.split(/\r?\n/u)){if(!line.startsWith('data:'))continue;try{const event=JSON.parse(line.slice(5));if(event.usage)call.usage=event.usage;if(event.choices?.[0]?.finish_reason)call.finish=event.choices[0].finish_reason;}catch{}}
    if(Number.isFinite(call.usage?.total_tokens))tokens+=call.usage.total_tokens;else unknown=true;
    res.end();
  }catch(error){if(call){call.error=error.message;unknown=true;}else report.errors.push('Rejected before provider: '+error.message);if(!res.headersSent)res.writeHead(502);res.end();}
  finally{if(call){call.pending=false;call.durationMs=Date.now()-call.startedAt;}active.delete(work);settle();}
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');let browser;

const assets=resolve('release/apk-6.1.0-speed-assets');
const seed=await build({stdin:{contents: String.raw`import {db} from "./src/db/index.ts"; Object.assign(window,{seedAPK:async()=>{await db.open(); const owner="apk-speed-owner";await db.users.put({id:owner,username:"独立测试",createdAt:Date.now()});await db.characters.put({id:"apk-speed-role",name:"林舟速度测试",avatar:"🌙",systemPrompt:"你是林舟，成年朋友，说话自然直率，观点独立，回答短一些。\n对话样本：对方说今天下雨，你说：鞋没湿吧？我这边刚停。",tags:["直率"],createdBy:owner,isCustom:true,isPreset:false,createdAt:Date.now(),proactivity:0});await db.sessions.put({id:"apk-speed-session",userId:owner,characterId:"apk-speed-role",title:"林舟速度测试",createdAt:Date.now(),updatedAt:Date.now(),modelAsked:true,model:{provider:"deepseek",model:"deepseek-flash"},unreadCount:0});}});`,resolveDir:resolve('.'),loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'}});
const server=createServer((req,res)=>{
 const path=req.url.split('?')[0];if(path==='/seed.js'){res.setHeader('Content-Type','application/javascript');res.end(seed.outputFiles[0].text);return;}
 if(path==='/seed'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/seed.js"></script>');return;}
 const file=join(assets,path==='/'?'index.html':path.slice(1));
 if(!resolve(file).startsWith(assets)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(let iteration=0;iteration<3;iteration++){
  const context=await browser.newContext({viewport:{width:412,height:915}});
  try{
   const page=await context.newPage();
   await page.addInitScript(({proxy,token})=>{
    localStorage.setItem('virtugene-auth',JSON.stringify({state:{userId:'apk-speed-owner',username:'独立测试',apiKey:token,isLoggedIn:true,avatar:'🧬'},version:0}));
    localStorage.setItem('virtugene-settings',JSON.stringify({state:{aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}},version:0}));
    localStorage.setItem('virtugene:onboarded:apk-speed-owner','1');localStorage.setItem('virtugene:secretary-intro:v2:apk-speed-owner','1');localStorage.setItem('virtugene:lastSeenVersion','6.1.0');
    const native=window.fetch.bind(window);
    window.fetch=(url,init)=>String(url).includes('/chat/completions')?native(proxy,{...init,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}}):String(url).startsWith('/')||String(url).startsWith(location.origin)?native(url,init):Promise.resolve(new Response('{}',{status:503}));
   },{proxy:'http://127.0.0.1:'+proxy.address().port+'/chat/completions',token});
   await page.goto('http://127.0.0.1:'+server.address().port+'/seed');await page.waitForFunction(()=>!!window.seedAPK);await page.evaluate(()=>window.seedAPK());
   await page.goto('http://127.0.0.1:'+server.address().port+'/?virtugene-preview=mobile');
   await page.getByRole('button',{name:'消息',exact:true}).click();
   await page.getByText('林舟速度测试',{exact:true}).first().click();
   const input=page.getByRole('textbox',{name:'消息内容'});await input.waitFor();
   await page.evaluate(()=>{window.apkTiming={started:0,firstVisible:null};const watch=new MutationObserver(()=>{const previews=document.querySelectorAll('[data-streamed="true"] [data-length]');if(window.apkTiming.started&&window.apkTiming.firstVisible===null&&[...previews].some(node=>node.textContent.trim()))window.apkTiming.firstVisible=performance.now()-window.apkTiming.started;});watch.observe(document.body,{childList:true,subtree:true,characterData:true});});
   const from=calls.length;await input.fill('我是陈若，今天终于把报告写完了，想出去走走。');await page.evaluate(()=>window.apkTiming.started=performance.now());await input.press('Enter');
   await page.waitForFunction(()=>document.querySelector('[aria-label="停止生成"]'),{},{timeout:10000});
   await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden',timeout:90000});
   const timing=await page.evaluate(()=>({...window.apkTiming,totalMs:performance.now()-window.apkTiming.started}));
   const texts=await page.locator('[data-streamed="true"] [data-length]').allTextContents();
   report.rows.push({iteration:iteration+1,...timing,replies:texts,callIds:calls.slice(from).map(call=>call.attempt)});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report.rows.at(-1)));
   if(!texts.length||unknown||calls.length>=6)break;
  }catch(error){report.errors.push(error.message);await pageDiagnostic(context,iteration);break;}finally{await context.close();}
 }
 report.complete=report.rows.length===3&&report.rows.every(row=>row.replies.length&&row.firstVisible!==null)&&calls.every(call=>call.finish==='stop'&&!call.error)&&!unknown;
}catch(error){report.errors.push(error.message);}finally{await browser?.close();await Promise.all([...active]);secret='';await new Promise(resolve=>proxy.close(resolve));await new Promise(resolve=>server.close(resolve));report.usage={requests:calls.length,totalKnownTokens:tokens,unknownUsage:unknown,pendingCalls:active.size};writeFileSync(output,JSON.stringify(report,null,2));}
async function pageDiagnostic(context,iteration){const page=context.pages()[0];report.diagnostic=await page?.locator('body').innerText().catch(()=>null);await page?.screenshot({path:'release/apk-speed-'+iteration+'.png'}).catch(()=>{});}
console.log(JSON.stringify({complete:report.complete,usage:report.usage,errors:report.errors,evidence:output}));
if(!report.complete)process.exitCode=1;
