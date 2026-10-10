import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const [keyFile]=process.argv.slice(2);
if(!keyFile)throw Error('Authorized credential file required');
const output='docs/CHAT-PAST-COMPARISON-AUDIT-R1-2026-10-10.json';
if(existsSync(output))throw Error('Do not overwrite evidence');
const moduleAt=async path=>{const bundled=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));};
const {buildFactAuditMessages,parseFactAudit}=await moduleAt('src/lib/chat-fact-audit.ts');
const {GU_YUE_NA_CANON}=await moduleAt('src/lib/gu-yue-na-canon.ts');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const failed=read('docs/LUXUEQI-LIVE-STORY-VIEW-ECHO-TRANSFER-R3-2026-10-10.json');
const good=read('docs/LUXUEQI-LIVE-STORY-VIEW-ECHO-TRANSFER-R2-2026-10-10.json');
if(!failed.complete||!good.complete)throw Error('Actual completed source required');
const relationship={id:'relationship',text:'本轮用户明确认领张小凡，与陆雪琪已有婚姻关系。',scope:'background',independent:true};
const current={id:'current-user',text:failed.rows[0].input,scope:'current',independent:true};
const candidate=failed.rows[0].replies.join('\n---\n');
const meal=GU_YUE_NA_CANON.find(row=>/小吃|饮食|吃/u.test(row.knowledge));
if(!meal)throw Error('Existing canonical meal source missing');
const cases=[
 {id:'actual-unverified-old-speaking',kind:'saved actual dialogue',expected:'revise',input:{candidate,userMessage:failed.rows[0].input,sources:[relationship,current]}},
 {id:'same-text-supported-by-user',kind:'marked source contrast, not new dialogue',expected:'pass',input:{candidate,userMessage:failed.rows[0].input,sources:[relationship,current,{id:'user-past',text:'我从前对你说话总说到一半，没有全说明白。',scope:'past',independent:true}]}},
 {id:'actual-current-preference-and-conditional',kind:'saved actual dialogue',expected:'pass',input:{candidate:good.rows[0].replies.join('\n---\n'),userMessage:good.rows[0].input,sources:[relationship,current]}},
 {id:'known-canon-meal',kind:'authored fixed source check, not new dialogue',expected:'pass',input:{candidate:'我记得求学时和你、谢邂一起逛过东海小吃街。',userMessage:'我是舞麟。你还记得我们求学时去过东海小吃街吗？',sources:[{id:'identity',text:'本轮用户明确认领唐舞麟。',scope:'background',independent:true},{id:'canon-meal',text:meal.knowledge,scope:'past',independent:true}]}},
];
let document=readFileSync(keyFile,'utf8');const lines=document.split(/\r?\n/u);
const start=lines.findIndex(line=>/^\*\*Deepseek:\*\*/iu.test(line.trim()));
const end=lines.findIndex((line,index)=>index>start&&/^\*\*[^*]+\*\*/u.test(line.trim()));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
let apiKey=keys[1];keys.fill('');lines.fill('');document='';
if(!apiKey)throw Error('Authorized configuration missing');
const proxy=await startLiveTestProxy({apiKey,maxCalls:4,maxTokens:500});apiKey=undefined;
const report={model:'deepseek-flash',scope:'Four source-specific semantic calibration cases, saved complete candidate plus explicitly marked contrasts; not new character dialogue, no production gate, no human rating.',productionReady:false,complete:false,rows:[]};
try{
 for(const fixture of cases){
  const response=await fetch(proxy.url,{method:'POST',headers:{Authorization:'Bearer '+proxy.token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages:buildFactAuditMessages(fixture.input),thinking:{type:'disabled'},temperature:0,max_tokens:500,stream:false}),signal:AbortSignal.timeout(50000)});
  const data=await response.json();if(!response.ok)throw Error('Review transport '+response.status);
  const raw=data.choices?.[0]?.message?.content??'',finish=data.choices?.[0]?.finish_reason;
  const audit=parseFactAudit(raw,fixture.input);
  const correct=finish==='stop'&&!audit.invalid&&audit.verdict===fixture.expected;
  report.rows.push({...fixture,raw,finish,usage:data.usage,audit,correct});
  writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({id:fixture.id,expected:fixture.expected,audit,correct}));
 }
 report.complete=true;
}catch(error){report.error=error.message;process.exitCode=1;}finally{
 report.providerCalls=proxy.getObservations();
 report.usage=report.providerCalls.reduce((sum,call)=>({calls:sum.calls+1,input:sum.input+(call.usage?.prompt_tokens??0),output:sum.output+(call.usage?.completion_tokens??0),total:sum.total+(call.usage?.total_tokens??0),missingUsage:sum.missingUsage+Number(!call.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});
 report.correct=report.rows.filter(row=>row.correct).length;
 writeFileSync(output,JSON.stringify(report,null,2));await proxy.close();
}
console.log(JSON.stringify({complete:report.complete,correct:report.correct,usage:report.usage,productionReady:false}));
