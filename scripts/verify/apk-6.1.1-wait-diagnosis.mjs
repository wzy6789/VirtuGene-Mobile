import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve,sep} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

const output=process.argv[2]??'docs/APK-6.1.1-WAIT-DIAGNOSIS-2026-10-13.json';
if(existsSync(output))throw Error('Do not overwrite diagnostic evidence');
const assets=resolve('release/apk-6.1.1-diagnostic-assets');
const report={date:new Date().toISOString(),scope:'Unmodified 6.1.1 APK UI in desktop Chrome at 412x915; isolated local DB; simulated SSE; not Android or actual provider timing',apkSha256:createHash('sha256').update(readFileSync('release/apk/VirtuGene-6.1.1.apk')).digest('hex'),paidModelCalls:0,realModelTokens:0,rows:[],errors:[],complete:false};
const seed=await build({stdin:{contents:`import {db} from './src/db/index.ts';import {LU_XUE_QI_PRESET} from './src/lib/lu-xue-qi-preset.ts';Object.assign(window,{seedAPK:async(role)=>{await db.open();const userId='apk-wait-owner',now=Date.now();await db.users.put({id:userId,username:'隔离测试',createdAt:now});const character=role==='reviewed'?{...LU_XUE_QI_PRESET,id:'apk-wait-role',createdBy:userId,isPreset:false,isCustom:true,sourcePresetId:'preset-luxueqi',createdAt:now}:{id:'apk-wait-role',name:'林舟',avatar:'🌙',systemPrompt:'你是林舟，成年朋友，说话自然直率。对话样本：对方说你好，你说：嗨。',tags:['直率'],createdBy:userId,isCustom:true,isPreset:false,createdAt:now,proactivity:0};await db.characters.put(character);await db.sessions.put({id:'apk-wait-session',userId,characterId:character.id,title:character.name,createdAt:now,updatedAt:now,modelAsked:true,model:{provider:'deepseek',model:'deepseek-flash'},unreadCount:0});return character.name;}});`,resolveDir:resolve('.'),loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',define:{'import.meta.env':'{}',__APP_VERSION__:'"diagnostic"'},loader:{'.png':'dataurl','.webp':'dataurl'}});
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/seed.js'){res.setHeader('Content-Type','application/javascript');return res.end(seed.outputFiles[0].text);}
 if(pathname==='/seed'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><script src="/seed.js"></script>');}
 const file=resolve(assets,pathname==='/'?'index.html':pathname.slice(1));
 if(!file.startsWith(assets+sep)){res.writeHead(403);return res.end();}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const role of ['ordinary','reviewed']){
  const context=await browser.newContext({viewport:{width:412,height:915}});
  try{
   const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    localStorage.setItem('virtugene-auth',JSON.stringify({state:{userId:'apk-wait-owner',username:'隔离测试',apiKey:'test-only-no-provider-key',isLoggedIn:true,avatar:'🧬'},version:0}));
    localStorage.setItem('virtugene-settings',JSON.stringify({state:{aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}},version:0}));
    localStorage.setItem('virtugene:onboarded:apk-wait-owner','1');localStorage.setItem('virtugene:secretary-intro:v2:apk-wait-owner','1');localStorage.setItem('virtugene:lastSeenVersion','6.1.1');
    window.waitDiagnostic={calls:[],blockedAuxiliary:0,started:null,firstVisibleMs:null};
    const native=window.fetch.bind(window),encoder=new TextEncoder();
    window.fetch=async(url,init)=>{
     if(!String(url).includes('/chat/completions')){
      if(String(url).startsWith('/')||String(url).startsWith(location.origin))return native(url,init);
      window.waitDiagnostic.blockedAuxiliary++;return new Response('{}',{status:503});
     }
     const body=JSON.parse(init.body);
     if(!body.stream){window.waitDiagnostic.blockedAuxiliary++;return new Response('{}',{status:503});}
     const call={model:body.model,thinking:body.thinking,reasoningEffort:body.reasoning_effort,stream:body.stream,promptChars:body.messages.reduce((sum,message)=>sum+(typeof message.content==='string'?message.content.length:0),0),requestAt:performance.now()};
     window.waitDiagnostic.calls.push(call);
     return new Response(new ReadableStream({start(controller){
      const emit=data=>controller.enqueue(encoder.encode('data: '+JSON.stringify(data)+'\n\n'));
      setTimeout(()=>{call.reasoningAt=performance.now();emit({choices:[{delta:{reasoning_content:'simulated-private-reasoning'},finish_reason:null}]});},100);
      setTimeout(()=>{call.answerAt=performance.now();emit({choices:[{delta:{content:'嗯，我在。'},finish_reason:null}]});},350);
      setTimeout(()=>{call.finishedAt=performance.now();emit({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();},1800);
     }}),{headers:{'Content-Type':'text/event-stream'}});
    };
   });
   await page.goto(origin+'/seed');await page.waitForFunction(()=>!!window.seedAPK);const name=await page.evaluate(role=>window.seedAPK(role),role);
   await page.goto(origin+'/?virtugene-preview=mobile');
   await page.getByRole('button',{name:'消息',exact:true}).click();await page.getByText(name,{exact:true}).first().click();
   const input=page.getByRole('textbox',{name:'消息内容'});await input.waitFor();
   await page.evaluate(()=>{const observer=new MutationObserver(()=>{const state=window.waitDiagnostic;if(state.started!==null&&state.firstVisibleMs===null&&[...document.querySelectorAll('[data-streamed="true"] [data-length]')].some(node=>node.textContent.trim()))state.firstVisibleMs=performance.now()-state.started;});observer.observe(document.body,{childList:true,subtree:true,characterData:true});});
   await input.fill('你好');await page.evaluate(()=>window.waitDiagnostic.started=performance.now());await input.press('Enter');
   await page.waitForFunction(()=>window.waitDiagnostic.calls.length>0);await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden',timeout:15000});
   const row=await page.evaluate(()=>{const d=window.waitDiagnostic;return {calls:d.calls.map(c=>({...c,preRequestMs:c.requestAt-d.started,answerFromStartMs:c.answerAt-d.started,finishFromStartMs:c.finishedAt-d.started})),firstVisibleMs:d.firstVisibleMs,blockedAuxiliary:d.blockedAuxiliary,quality:window.virtugeneChatQuality.report().events.at(-1),replies:[...document.querySelectorAll('[data-streamed="true"] [data-length]')].map(node=>node.textContent.trim())};});
   if(row.calls.length!==1||row.replies.join('')!=='嗯，我在。'||row.firstVisibleMs===null||errors.length)throw Error('Unexpected UI/retry/error result: '+JSON.stringify({role,row,errors}));
   const call=row.calls[0];
   if(call.model!=='deepseek-flash'||call.thinking?.type!=='enabled'||call.reasoningEffort!=='low'||!call.stream)throw Error('Unexpected captured request settings');
   if(role==='ordinary'&&row.firstVisibleMs>=call.finishFromStartMs)throw Error('Ordinary reply unexpectedly waits for completion');
   if(role==='reviewed'&&row.firstVisibleMs<call.finishFromStartMs)throw Error('Reviewed reply was displayed before checking the complete draft');
   await page.screenshot({path:'release/apk-6.1.1-wait-'+role+'.png'});report.rows.push({role,...row});
   console.log(JSON.stringify({role,preRequestMs:call.preRequestMs,answerFromStartMs:call.answerFromStartMs,finishFromStartMs:call.finishFromStartMs,firstVisibleMs:row.firstVisibleMs,model:call.model,thinking:call.thinking,effort:call.reasoningEffort}));
   writeFileSync(output,JSON.stringify(report,null,2));
  }finally{await context.close();}
 }
 report.complete=report.rows.length===2;
}catch(error){report.errors.push(error.message);}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(output,JSON.stringify(report,null,2));}
console.log(JSON.stringify({complete:report.complete,errors:report.errors,evidence:output}));if(!report.complete)process.exitCode=1;
