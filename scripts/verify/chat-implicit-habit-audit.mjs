import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const [keyFile]=process.argv.slice(2);
if(!keyFile)throw Error('Authorized credential file required');
const output='docs/CHAT-IMPLICIT-HABIT-AUDIT-R1-2026-10-11.json';
const usageOutput=output.replace('.json','-USAGE.json');
if(existsSync(output)||existsSync(usageOutput))throw Error('Existing evidence must not be overwritten');
const bundle=await build({entryPoints:['src/lib/chat-fact-audit.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {buildFactAuditMessages,parseFactAudit}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const paths={place:'docs/GUYUENA-LIVE-CANON-OPEN-OWN-CHOICE-HOLDOUT-R4-2026-10-11.json',story:'docs/GUYUENA-LIVE-CANON-FAMILY-STORY-PREFERENCE-HOLDOUT-R1-2026-10-11.json',portrait:'docs/GUYUENA-LIVE-CANON-FAMILY-PORTRAIT-BANTER-HOLDOUT-R1-2026-10-11.json',cup:'docs/GUYUENA-LIVE-CANON-FAMILY-NAMING-CLOSENESS-HOLDOUT-R1-2026-10-11.json'};
const evidence=Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,JSON.parse(readFileSync(path,'utf8'))]));
for(const report of Object.values(evidence))if(!report.complete)throw Error('Completed actual dialogue evidence required');
const background={id:'family-background',text:'古月娜是银龙王，伴侣是唐舞麟。他们的孩子是蓝轩宇（又名唐轩宇）。当前明确认领的聊天对象是唐舞麟。',scope:'background',independent:true};
const specs=[
  {id:'gu-implicit-own-settled-habit',key:'place',row:1,expected:'revise',reason:'安静惯了是无来源的既有习惯，而非只说现在喜欢安静。'},
  {id:'gu-implicit-user-old-storytelling',key:'story',row:1,expected:'revise',reason:'当前用户说喜欢细节，不能证明以前也这样，更不能证明过去讲正经事的方式。'},
  {id:'gu-conditional-family-wish',key:'portrait',row:1,expected:'pass',reason:'用户明确说只是想象，完整回复是现在的创作意愿与条件，不断言孩子已经画过。'},
  {id:'gu-present-reciprocal-cup-wish',key:'cup',row:2,expected:'pass',reason:'承接假设中的刻字安排，表达现在的亲近与对等意愿，没有断言已经刻完。'},
];
const cases=specs.map(spec=>{
  const report=evidence[spec.key],row=report.rows[spec.row];
  if(!row?.replies?.length)throw Error('Missing full candidate');
  return {...spec,source:paths[spec.key],input:{candidate:row.replies.join('---'),userMessage:row.input,sources:[background,...report.rows.slice(0,spec.row+1).map((prior,index)=>({id:'user-turn-'+index,text:prior.input,scope:'current',independent:true}))]}};
});
let document=readFileSync(keyFile,'utf8');const lines=document.split(/\r?\n/u);
const start=lines.findIndex(line=>/^\*\*Deepseek:\*\*/iu.test(line.trim()));
const end=lines.findIndex((line,index)=>index>start&&/^\*\*[^*]+\*\*/u.test(line.trim()));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
let apiKey=keys[1];keys.fill('');lines.fill('');document='';
if(!apiKey)throw Error('Authorized second DeepSeek configuration unavailable');
const bridge=await startLiveTestProxy({apiKey,maxCalls:4,maxTokens:500});apiKey=undefined;
const report={model:'deepseek-flash',generation:'direct',scope:'Four bounded diagnostic source reviews of complete actual candidate replies, not new dialogue. Two unsupported implicit histories and two present/conditional wishes. Expected classifications fixed before generation. Prior assistant replies are not independent evidence.',productionReady:false,complete:false,rows:[]};
try{
  for(const item of cases){
    const messages=buildFactAuditMessages(item.input);
    const response=await fetch(bridge.url,{method:'POST',headers:{Authorization:'Bearer '+bridge.token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:'disabled'},temperature:0,max_tokens:500,stream:false}),signal:AbortSignal.timeout(50000)});
    const data=await response.json();if(!response.ok)throw Error('Review transport status '+response.status);
    const raw=data.choices?.[0]?.message?.content??'',audit=parseFactAudit(raw,item.input),finish=data.choices?.[0]?.finish_reason;
    report.rows.push({...item,messages,raw,audit,finish,usage:data.usage,matched:!audit.invalid&&finish==='stop'&&audit.verdict===item.expected});
    writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({id:item.id,expected:item.expected,verdict:audit.verdict,invalid:audit.invalid,finish}));
  }
  report.complete=report.rows.length===4;
}finally{
  report.matches=report.rows.filter(row=>row.matched).length;
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  const observations=bridge.getObservations();
  const totals=observations.reduce((s,row)=>({calls:s.calls+1,input:s.input+(row.usage?.prompt_tokens??0),output:s.output+(row.usage?.completion_tokens??0),total:s.total+(row.usage?.total_tokens??0),missingUsage:s.missingUsage+Number(!row.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});
  writeFileSync(usageOutput,JSON.stringify({totals,observations},null,2)+'\n');
  await bridge.close();console.log(JSON.stringify({complete:report.complete,matches:report.matches,totalCases:4,productionReady:false,totals}));
}
