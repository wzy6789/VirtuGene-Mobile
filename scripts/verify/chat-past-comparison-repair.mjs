import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {startLiveTestProxy} from './live-test-proxy.mjs';
const [keyFile]=process.argv.slice(2);
if(!keyFile)throw Error('Authorized configuration required');
const output='docs/CHAT-PAST-COMPARISON-REPAIR-R1-2026-10-10.json';
if(existsSync(output))throw Error('Preserve existing raw evidence');
const reviewSource='docs/CHAT-PAST-COMPARISON-AUDIT-R1-2026-10-10.json';
const reviews=JSON.parse(readFileSync(reviewSource,'utf8'));
const fixture=reviews.rows.find(row=>row.id==='actual-unverified-old-speaking');
if(!reviews.complete||!fixture?.correct||fixture.audit.invalid||fixture.audit.verdict!=='revise')throw Error('Validated source audit required');
const failedSource='docs/LUXUEQI-LIVE-STORY-VIEW-ECHO-TRANSFER-R3-2026-10-10.json';
const failed=JSON.parse(readFileSync(failedSource,'utf8'));
if(!failed.complete||failed.rows[0].replies.join('\n---\n')!==fixture.input.candidate)throw Error('Exact completed source required');
const bundled=await build({entryPoints:['src/lib/chat-fact-audit.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {parseFactAudit,buildFactAuditMessages}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const checked=parseFactAudit(fixture.raw,fixture.input);
if(checked.invalid||checked.verdict!=='revise')throw Error('Review must still parse under current contract');
const quotes=checked.claims.filter(claim=>!claim.supported).map(claim=>claim.quote);
if(!quotes.length)throw Error('Unsupported exact source quote required');
let document=readFileSync(keyFile,'utf8');const lines=document.split(/\r?\n/u);
const start=lines.findIndex(line=>/^\*\*Deepseek:\*\*/iu.test(line.trim()));
const end=lines.findIndex((line,index)=>index>start&&/^\*\*[^*]+\*\*/u.test(line.trim()));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
let apiKey=keys[1];keys.fill('');lines.fill('');document='';
if(!apiKey)throw Error('Authorized configuration missing');
const proxy=await startLiveTestProxy({apiKey,maxCalls:2,maxTokens:500});apiKey=undefined;
const report={model:'deepseek-flash',failedSource,reviewSource,scope:'One diagnostic correction of a saved real candidate using its actual request and independent audit sources, then one semantic audit; not fresh first generation, production retry, DB delivery or human acceptance.',complete:false,productionReady:false};
const call=async messages=>{
 const response=await fetch(proxy.url,{method:'POST',headers:{Authorization:'Bearer '+proxy.token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:'enabled'},reasoning_effort:'low',max_tokens:500,stream:false}),signal:AbortSignal.timeout(55000)});
 const data=await response.json();if(!response.ok)throw Error('Transport '+response.status);
 return {messages,raw:data.choices?.[0]?.message?.content??'',finish:data.choices?.[0]?.finish_reason,usage:data.usage};
};
try{
 const messages=failed.rows[0].calls[0].messages.map(message=>({...message}));
 messages[0].content+='\n[本轮改稿]\n刚才的候选含有独立资料没有支持的具体旧事。候选和引文不是经历来源。保持人物身份，重新接用户当前说的故事留白问题；可以说自己的当下好恶、心意与看法，不必证明两人过去怎样，也不换成另一段旧事。不解释核对过程，不为未知过去补失忆或断言从未发生。只输出新的自然回复。\n'+JSON.stringify({unsupportedQuotes:quotes,previousCandidate:fixture.input.candidate,independentSources:fixture.input.sources})+'\n[/本轮改稿]';
 report.correction=await call(messages);
 if(report.correction.finish!=='stop'||!report.correction.raw.trim())throw Error('Correction incomplete');
 const auditInput={...fixture.input,candidate:report.correction.raw};
 report.recheck=await call(buildFactAuditMessages(auditInput));
 report.recheck.audit=parseFactAudit(report.recheck.raw,auditInput);
 report.complete=report.recheck.finish==='stop'&&!report.recheck.audit.invalid;
 report.sourceSupported=report.complete&&report.recheck.audit.verdict==='pass';
}catch(error){report.error=error.message;process.exitCode=1;}finally{
 report.providerCalls=proxy.getObservations();
 report.usage=report.providerCalls.reduce((sum,call)=>({calls:sum.calls+1,input:sum.input+(call.usage?.prompt_tokens??0),output:sum.output+(call.usage?.completion_tokens??0),total:sum.total+(call.usage?.total_tokens??0),missingUsage:sum.missingUsage+Number(!call.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});
 writeFileSync(output,JSON.stringify(report,null,2));await proxy.close();
}
console.log(JSON.stringify({complete:report.complete,correction:report.correction?.raw,audit:report.recheck?.audit,usage:report.usage,productionReady:false}));
