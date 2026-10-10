import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const [keyFile]=process.argv.slice(2);
if(!keyFile)throw Error('Authorized credential file required');
const output='docs/CHAT-FACT-AUDIT-CURRENT-R1-2026-10-10.json';
const usageOutput=output.replace('.json','-USAGE.json');
if(existsSync(output)||existsSync(usageOutput))throw Error('Existing evidence must not be overwritten');
const loadModule=async path=>{
  const bundle=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});
  return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
};
const {buildFactAuditMessages,parseFactAudit}=await loadModule('src/lib/chat-fact-audit.ts');
const {GU_YUE_NA_CANON}=await loadModule('src/lib/gu-yue-na-canon.ts');
const gu=JSON.parse(readFileSync('docs/GUYUENA-LIVE-FAMILIARITY-KNOWLEDGE-TRANSFER-R3-2026-10-10.json','utf8'));
const lu=JSON.parse(readFileSync('docs/LUXUEQI-LIVE-QUIET-JOY-TRANSFER-R1-2026-10-10.json','utf8'));
const luFrozen=JSON.parse(readFileSync('docs/LUXUEQI-FOCUSED-REACTIONS-R1-2026-10-10.json','utf8'));
const badLu=luFrozen.rows.find(row=>row.arm==='focused-reactions');
if(!gu.complete||!lu.complete||!luFrozen.complete||!badLu)throw Error('Completed real evidence required');
const cases=[
  {id:'gu-invented-past-observation',role:'古月娜',source:'GUYUENA-LIVE-FAMILIARITY-KNOWLEDGE-TRANSFER-R3-2026-10-10.json',expected:'revise',input:{candidate:gu.rows[1].replies[2],userMessage:gu.rows[1].input,sources:[{id:'canon-forging',text:GU_YUE_NA_CANON.find(row=>row.topic==='锻造').knowledge,scope:'past',independent:true}]}},
  {id:'lu-invented-practice-duration',role:'陆雪琪',source:'LUXUEQI-FOCUSED-REACTIONS-R1-2026-10-10.json',expected:'revise',input:{candidate:badLu.raw,userMessage:badLu.input,sources:[{id:'user-turn',text:badLu.input,scope:'current',independent:true}]}},
  {id:'gu-genuine-curiosity',role:'古月娜',source:'GUYUENA-LIVE-FAMILIARITY-KNOWLEDGE-TRANSFER-R3-2026-10-10.json',expected:'pass',input:{candidate:gu.rows[2].replies.slice(0,2).join('---'),userMessage:gu.rows[2].input,sources:[{id:'user-turn',text:gu.rows[2].input,scope:'current',independent:true}]}},
  {id:'lu-present-joy',role:'陆雪琪',source:'LUXUEQI-LIVE-QUIET-JOY-TRANSFER-R1-2026-10-10.json',expected:'pass',input:{candidate:lu.rows[0].replies.join('---'),userMessage:lu.rows[0].input,sources:[{id:'user-turn',text:lu.rows[0].input,scope:'current',independent:true}]}},
];
let document=readFileSync(keyFile,'utf8');const lines=document.split(/\r?\n/u);
const start=lines.findIndex(line=>/^\*\*Deepseek:\*\*/iu.test(line.trim()));
const end=lines.findIndex((line,index)=>index>start&&/^\*\*[^*]+\*\*/u.test(line.trim()));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
let apiKey=keys[1];keys.fill('');lines.fill('');document='';
if(!apiKey)throw Error('Authorized second DeepSeek configuration unavailable');
const bridge=await startLiveTestProxy({apiKey,maxCalls:4,maxTokens:500});apiKey=undefined;
const report={model:'deepseek-flash',generation:'direct',scope:'Four bounded semantic reviews of actual model fragments; not new character dialogue or production review. Exact user turn and independently sourced canon only. No assistant prose becomes evidence. No human-likeness score.',productionReady:false,complete:false,rows:[]};
try{
  for(const item of cases){
    const messages=buildFactAuditMessages(item.input);
    const response=await fetch(bridge.url,{method:'POST',headers:{Authorization:'Bearer '+bridge.token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:'disabled'},temperature:0,max_tokens:500,stream:false}),signal:AbortSignal.timeout(50000)});
    const data=await response.json();if(!response.ok)throw Error('Review transport status '+response.status);
    const raw=data.choices?.[0]?.message?.content??'';
    const audit=parseFactAudit(raw,item.input);
    const finish=data.choices?.[0]?.finish_reason;
    report.rows.push({...item,messages,raw,audit,finish,usage:data.usage,matched:!audit.invalid&&finish==='stop'&&audit.verdict===item.expected});
    writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({id:item.id,expected:item.expected,verdict:audit.verdict,invalid:audit.invalid,finish}));
  }
  report.complete=report.rows.length===4;
}finally{
  report.matches=report.rows.filter(row=>row.matched).length;
  writeFileSync(output,JSON.stringify(report,null,2));
  const observations=bridge.getObservations();
  const totals=observations.reduce((s,row)=>({calls:s.calls+1,input:s.input+(row.usage?.prompt_tokens??0),output:s.output+(row.usage?.completion_tokens??0),total:s.total+(row.usage?.total_tokens??0),missingUsage:s.missingUsage+Number(!row.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});
  writeFileSync(usageOutput,JSON.stringify({totals,observations},null,2));
  await bridge.close();console.log(JSON.stringify({complete:report.complete,matches:report.matches,totalCases:4,productionReady:false,totals}));
}
