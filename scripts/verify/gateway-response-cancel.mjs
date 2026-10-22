import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { responseCancellation } from '../../server/response-cancellation.mjs';

const out=resolve('.tmp-preview/ui-overhaul-20261015/create-cancellation');mkdirSync(out,{recursive:true});
const dataDir=resolve(out,'gateway-data',String(Date.now()));mkdirSync(dataDir,{recursive:true});
const checks=[],bodies=[],closed=new Set();let gatewayLog='',gateway;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(test,label)=>{for(let i=0;i<100;i++){if(test())return;await wait(20);}throw Error('Timeout: '+label);};
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const upstream=createServer((req,res)=>{
 let raw='';req.on('data',data=>raw+=data);req.on('end',()=>{
  const body=JSON.parse(raw);const marker=JSON.stringify(body.messages.at(-1).content).match(/hold-[a-z-]+/)?.[0];bodies.push({body,marker});
  if(marker){res.once('close',()=>{if(!res.writableEnded)closed.add(marker);});if(marker.includes('body')){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"choices":');}return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:body.response_format?'{"text":"fixture"}':'normal-fixture'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}));
 });
});
let report;
try{
 const response=new EventEmitter();response.writableEnded=false;response.destroyed=false;
 const linked=responseCancellation(response,1000);response.emit('close');assert.equal(linked.signal.aborted,true);linked.cleanup();assert.equal(response.listenerCount('close'),0);checks.push('Client close aborts signal and cleanup removes listener');
 const completed=new EventEmitter();completed.writableEnded=true;completed.destroyed=false;const completeScope=responseCancellation(completed,1000);completed.emit('close');assert.equal(completeScope.signal.aborted,false);completeScope.cleanup();checks.push('Normal completed response is not treated as cancellation');
 const timeout=new EventEmitter();timeout.writableEnded=false;timeout.destroyed=false;const timed=responseCancellation(timeout,5);await wait(15);assert.equal(timed.signal.reason.name,'TimeoutError');timed.cleanup();checks.push('Provider timeout remains active until cleanup');
 const upstreamPort=await listen(upstream),reservation=createServer();const port=await listen(reservation);await new Promise(r=>reservation.close(r));
 gateway=spawn(process.execPath,['server/gateway.mjs'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DEEPSEEK_API_KEY:'fake-provider-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${upstreamPort}`,VIRTUGENE_GATEWAY_TOKEN:'fixture-token',GATEWAY_AUTH_SECRET:'fixture-secret',GATEWAY_ALLOW_ANONYMOUS:'false',GATEWAY_DATA_DIR:dataDir,GATEWAY_RATE_LIMIT:'1000',GATEWAY_AUX_RATE_LIMIT:'1000',GATEWAY_DAILY_LIMIT:'1000'},stdio:['ignore','pipe','pipe']});
 gateway.stdout.on('data',d=>gatewayLog+=d);gateway.stderr.on('data',d=>gatewayLog+=d);
 let ready=false;for(let i=0;i<50;i++){if(gateway.exitCode!==null)throw Error('Gateway exited: '+gatewayLog);try{ready=(await fetch(`http://127.0.0.1:${port}/health`)).ok;if(ready)break;}catch{}await wait(50);}assert.ok(ready,'Gateway must be live; do not restart on timeout');
 const request=(path,body,signal,authorized=true)=>fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer fixture-token'}:{})},body:JSON.stringify(body),signal});
 const plain=await request('/v1/chat',{systemPrompt:'fixture persona',message:'normal'});assert.equal((await plain.json()).content,'normal-fixture');checks.push('Normal non-streaming response still succeeds');
 const aux=await request('/v1/aux',{operation:'memory',payload:{text:'fixture fact'}});assert.equal((await aux.json()).text,'fixture');checks.push('Normal auxiliary response still succeeds');
 const beforeAuth=bodies.length;assert.equal((await request('/v1/chat',{systemPrompt:'s',message:'m'},undefined,false)).status,401);assert.equal(bodies.length,beforeAuth);checks.push('Authorization failure still starts no provider request');
 const markers=[['/v1/chat','hold-chat-headers'],['/v1/chat','hold-chat-body'],['/v1/aux','hold-aux-headers'],['/v1/aux','hold-aux-body']];
 for(const [path,marker] of markers){
  const controller=new AbortController();const body=path==='/v1/chat'?{systemPrompt:'fixture persona',message:marker}:{operation:'memory',payload:{text:marker}};
  const pending=request(path,body,controller.signal);await until(()=>bodies.some(row=>row.marker===marker),marker+' upstream start');
  // The body case has already sent provider headers but not complete JSON.
  if(marker.endsWith('body'))await wait(30);controller.abort();await assert.rejects(pending);await until(()=>closed.has(marker),marker+' upstream close');
  checks.push(`${path} ${marker.endsWith('body')?'during body':'before headers'}: client abort closes actual local upstream connection`);
 }
 const final=await request('/v1/chat',{systemPrompt:'fixture persona',message:'after-cancel'});assert.equal((await final.json()).content,'normal-fixture');checks.push('Gateway remains usable after cancellations');
 assert.equal(gateway.exitCode,null);report={complete:true,checks,upstreamRequests:bodies.length,upstreamCancelled:[...closed],actualModelCalls:0,scope:'Actual gateway child and localhost fake upstream; no deployment or real provider billing claim'};
}catch(error){report={complete:false,checks,error:error.stack};process.exitCode=1;}
finally{
 if(gateway&&gateway.exitCode===null){const exited=new Promise(r=>gateway.once('exit',r));gateway.kill();await exited;}
 upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
 writeFileSync(resolve(out,'gateway-cancellation-result.json'),JSON.stringify({recordedAt:new Date().toISOString(),...report,dataDir},null,2));writeFileSync(resolve(out,'gateway-cancellation-process.log'),gatewayLog);
}
console.log(JSON.stringify(report));
