import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const [keyFile,stage='original']=process.argv.slice(2);
if(!['original','followup'].includes(stage))throw Error('Bounded stage required');
const output=stage==='original'?'docs/CHAT-HISTORY-QUARANTINE-AUDIT-R1-2026-10-10.json':'docs/CHAT-HISTORY-QUARANTINE-FOLLOWUP-AUDIT-R1-2026-10-10.json';
if(!keyFile||existsSync(output))throw Error('Preserve evidence and supply authorized file');
async function moduleAt(path){const b=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {buildFactAuditMessages,parseFactAudit}=await moduleAt('src/lib/chat-fact-audit.ts'),{GU_YUE_NA_CANON}=await moduleAt('src/lib/gu-yue-na-canon.ts');
const sourceFile=stage==='original'?'docs/GUYUENA-LIVE-MIXED-AFFECTION-TRANSFER-R6-2026-10-10.json':'docs/GUYUENA-LIVE-IMPLICIT-HISTORY-CARRYOVER-TRANSFER-R3-2026-10-10.json',source=JSON.parse(readFileSync(sourceFile,'utf8')),row=source.rows[0];
if(!source.complete||row.failed||row.calls.length!==1||row.calls[0].finish!=='stop')throw Error('Complete original turn required');
const input={candidate:row.replies.join('\n---\n'),userMessage:row.input,sources:[{id:'relationship',text:'古月娜与唐舞麟已婚，蓝轩宇是孩子；本轮用户直接认领唐舞麟。',scope:'background',independent:true},{id:'user-current',text:row.input,scope:'current',independent:true},...GU_YUE_NA_CANON.map((r,index)=>({id:'canon-'+index,text:r.knowledge,scope:'past',independent:true}))]};
let document=readFileSync(keyFile,'utf8');const lines=document.split(/\r?\n/u),start=lines.findIndex(line=>/^\*\*Deepseek:\*\*/iu.test(line.trim())),end=lines.findIndex((line,index)=>index>start&&/^\*\*[^*]+\*\*/u.test(line.trim())),keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
let apiKey=keys[1];keys.fill('');lines.fill('');document='';if(!apiKey)throw Error('Authorized configuration missing');
const proxy=await startLiveTestProxy({apiKey,maxCalls:1,maxTokens:500});apiKey=undefined;
const report={model:'deepseek-flash',sourceFile,complete:false,productionReady:false,snapshot:{input,persona:source.persona.systemPrompt}};
try{
 const messages=buildFactAuditMessages(input);messages[0].content+='\nreason简短，最多30字；仍逐项核对整句，保留完整引文。用户询问旧回复中的事情，不等于本人确认事情真实发生；问修完还是没动不能证明有实物或没做过。';
 const response=await fetch(proxy.url,{method:'POST',headers:{Authorization:'Bearer '+proxy.token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:'disabled'},temperature:0,max_tokens:500,stream:false}),signal:AbortSignal.timeout(50000)}),data=await response.json();if(!response.ok)throw Error('Audit transport '+response.status);
 report.snapshot.raw=data.choices?.[0]?.message?.content??'';report.finish=data.choices?.[0]?.finish_reason;report.audit=parseFactAudit(report.snapshot.raw,input);report.complete=true;
}catch(error){report.error=error.message;process.exitCode=1;}finally{
 report.providerCalls=proxy.getObservations();report.usage=report.providerCalls.reduce((sum,call)=>({calls:sum.calls+1,input:sum.input+(call.usage?.prompt_tokens??0),output:sum.output+(call.usage?.completion_tokens??0),total:sum.total+(call.usage?.total_tokens??0),missingUsage:sum.missingUsage+Number(!call.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});writeFileSync(output,JSON.stringify(report,null,2));await proxy.close();
}
console.log(JSON.stringify({complete:report.complete,finish:report.finish,audit:report.audit,usage:report.usage,productionReady:false}));
