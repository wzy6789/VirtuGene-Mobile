import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const [keyFile,revision='R1']=process.argv.slice(2);
if(!/^R[123]$/u.test(revision))throw Error('Only three bounded calibration revisions');
const output=`docs/CHAT-THOUGHT-SOURCE-AUDIT-${revision}-2026-10-10.json`;
if(!keyFile||existsSync(output))throw Error('Credential file required and prior evidence must be preserved');
async function moduleAt(path){const b=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {buildFactAuditMessages,parseFactAudit}=await moduleAt('src/lib/chat-fact-audit.ts');
const {GU_YUE_NA_CANON}=await moduleAt('src/lib/gu-yue-na-canon.ts');
const rows=['R2','R3'].map(revision=>JSON.parse(readFileSync(`docs/GUYUENA-LIVE-MIXED-AFFECTION-TRANSFER-${revision}-2026-10-10.json`,'utf8')).rows[0]);
const sources=[{id:'relationship',text:'当前用户明确认领唐舞麟；古月娜与唐舞麟已婚，蓝轩宇是孩子。',scope:'background',independent:true},...GU_YUE_NA_CANON.map((row,index)=>({id:'canon-'+index,text:row.knowledge,scope:'past',independent:true}))];
const cases=[
 ...rows.map((row,index)=>({id:'actual-unverified-'+(index?'old-event':'recent-life'),kind:'saved full actual candidate',expected:'revise',input:{candidate:row.replies.join('\n---\n'),userMessage:row.input,sources:[...sources,{id:'current-user',text:row.input,scope:'current',independent:true}]}})),
 {id:'present-opinion-and-affection',kind:'authored fixed boundary fixture, not character dialogue',expected:'pass',input:{candidate:'我也想你。\n---\n我更喜欢能各自说真心话的聊天。不一样的想法才有意思，不必每次都选一样的。',userMessage:rows[0].input,sources}},
 {id:'conditional-care-and-known-relationship',kind:'authored fixed boundary fixture, not character dialogue',expected:'pass',input:{candidate:'轩宇是我们的孩子。如果他有自己的选择，我愿意先听听他的理由。',userMessage:'我是舞麟。假如轩宇有自己的选择，你会怎么想？',sources}},
];
let document=readFileSync(keyFile,'utf8');const lines=document.split(/\r?\n/u),start=lines.findIndex(line=>/^\*\*Deepseek:\*\*/iu.test(line.trim())),end=lines.findIndex((line,index)=>index>start&&/^\*\*[^*]+\*\*/u.test(line.trim()));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
let apiKey=keys[1];keys.fill('');lines.fill('');document='';if(!apiKey)throw Error('Authorized configuration missing');
const proxy=await startLiveTestProxy({apiKey,maxCalls:4,maxTokens:500});apiKey=undefined;
const report={model:'deepseek-flash',scope:'Four semantic calibration cases: saved whole failed replies versus explicitly authored opinion/conditional boundaries. No production gate or rewritten character dialogue.',complete:false,productionReady:false,rows:[]};
try{
 for(const fixture of cases){
  const response=await fetch(proxy.url,{method:'POST',headers:{Authorization:'Bearer '+proxy.token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages:buildFactAuditMessages(fixture.input),thinking:{type:'disabled'},temperature:0,max_tokens:500,stream:false}),signal:AbortSignal.timeout(50000)});
  const data=await response.json();if(!response.ok)throw Error('Review transport '+response.status);
  const raw=data.choices?.[0]?.message?.content??'',finish=data.choices?.[0]?.finish_reason,audit=parseFactAudit(raw,fixture.input),correct=finish==='stop'&&!audit.invalid&&audit.verdict===fixture.expected;
  report.rows.push({...fixture,raw,finish,usage:data.usage,audit,correct});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({id:fixture.id,audit,correct}));
 }
 report.complete=true;
}catch(error){report.error=error.message;process.exitCode=1;}finally{
 report.providerCalls=proxy.getObservations();report.usage=report.providerCalls.reduce((sum,call)=>({calls:sum.calls+1,input:sum.input+(call.usage?.prompt_tokens??0),output:sum.output+(call.usage?.completion_tokens??0),total:sum.total+(call.usage?.total_tokens??0),missingUsage:sum.missingUsage+Number(!call.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});report.correct=report.rows.filter(row=>row.correct).length;writeFileSync(output,JSON.stringify(report,null,2));await proxy.close();
}
console.log(JSON.stringify({complete:report.complete,correct:report.correct,usage:report.usage,productionReady:false}));
