// Real gateway process, synthetic local upstream. Never reads credentials.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const input=process.argv[2];if(!input)throw Error('Pass a baseline.json');
const baseline=JSON.parse(readFileSync(input,'utf8'));
if(!baseline.complete||baseline.rows.length!==24)throw Error('Complete synthetic baseline required');
const output=resolve('release','chat-continuity-gateway-'+new Date().toISOString().replace(/[:.]/gu,'-'));
mkdirSync(output,{recursive:true});
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const close=s=>new Promise(r=>s.close(r));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const received=[];
const upstream=createServer(async(req,res)=>{
 let raw='';for await(const data of req)raw+=data;
 received.push(JSON.parse(raw));
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({model:'synthetic-local-upstream',choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}));
});
let child;
const report={baseline:input,scope:'Real gateway -> local mock; no provider calls, no real credentials',paidCalls:0,rows:[],errors:[],complete:false};
try{
 const port=await listen(upstream);
 const reservation=createServer();const gatewayPort=await listen(reservation);await close(reservation);
 child=spawn(process.execPath,['server/gateway.mjs'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(gatewayPort),DEEPSEEK_API_KEY:'synthetic-not-a-credential',DEEPSEEK_BASE_URL:`http://127.0.0.1:${port}`,GATEWAY_ALLOW_ANONYMOUS:'true',GATEWAY_DATA_DIR:join(output,'isolated-data'),GATEWAY_RATE_LIMIT:'100'},stdio:'ignore'});
 let ready=false;
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)throw Error('Isolated gateway exited before ready');
  try{if((await fetch(`http://127.0.0.1:${gatewayPort}/health`)).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!ready)throw Error('Isolated gateway startup timed out');
 const submit=async(id,messages)=>{
  const body={systemPrompt:messages[0].content,history:messages.slice(1,-1),message:messages.at(-1).content};
  const response=await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw Error('Synthetic gateway request failed '+response.status);
  const wire=received.at(-1);
  report.rows.push({id,browserMessages:messages,gatewayBody:body,upstreamMessages:wire.messages,browserHash:hash(messages),upstreamHash:hash(wire.messages),alias:wire.model,returnedModel:'synthetic-local-upstream',gatewayReportedModel:result.modelId,thinking:wire.thinking,reasoningEffort:wire.reasoning_effort,historyUnchanged:JSON.stringify(messages.slice(1))===JSON.stringify(wire.messages.slice(1)),systemPrefixKept:wire.messages[0].content.includes(messages[0].content)});
 };
 for(const row of baseline.rows)await submit(row.id+'-'+row.character,row.turns.at(-1).attempts.at(-1).messages);
 await submit('budget-tail-within-24000',[{role:'system',content:'背景'.repeat(11000)+'\n[尾部纠正]当前约在周四15点[/尾部纠正]'},{role:'user',content:'确认一下时间。'}]);
 await submit('raw-over-limit-current',[{role:'system',content:'合成边界探测'},{role:'user',content:'前情'.repeat(2050)+'最后纠正：周四15点。'}]);
 report.gatewaySha256=createHash('sha256').update(readFileSync('server/gateway.mjs')).digest('hex');
 if(report.rows.slice(0,24).some(row=>!row.historyUnchanged))throw Error('Gateway changed a captured ordinary final history');
 report.complete=true;
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
 if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
 await close(upstream);
 writeFileSync(join(output,'gateway.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({complete:report.complete,requests:report.rows.length,ordinaryHistoryUnchanged:report.rows.slice(0,24).every(r=>r.historyUnchanged),overLimitClipped:report.rows.at(-1)?.historyUnchanged===false,paidCalls:0,evidence:join(output,'gateway.json'),errors:report.errors}));
}
