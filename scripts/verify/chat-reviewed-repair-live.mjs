import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const [proxy,token,revision,generationMode='thinking',caseList]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy??'')||!token||!/^r\d{1,2}$/u.test(revision??'')||!['thinking','direct'].includes(generationMode))throw Error('Bounded local proxy, distinct revision and diagnostic generation mode required');
const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const output=`docs/CHAT-REVIEWED-REPAIR-${revision.toUpperCase()}-${day}.json`;
if(existsSync(output))throw Error('Do not replace real repair evidence');
const source='docs/CHAT-REVIEW-GROUNDING-R3-2026-10-09.json';
const calibration=JSON.parse(readFileSync(source,'utf8'));
if(!calibration.complete||calibration.generation!=='direct')throw Error('Completed source calibration required');
const compiled=await build({stdin:{contents:"export * from './src/lib/chat-candidate-review';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'});
const box={module:{exports:{}},exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,box);
const {buildCandidateReviewMessages,parseCandidateReview,buildCandidateRepairMessages}=box.module.exports;
const selected=caseList?caseList.split(','):undefined;
if(selected?.some(id=>!calibration.rows.some(row=>row.id===id&&row.review?.verdict==='revise')))throw Error('Unknown or unrevisable case selection');
const report={date:new Date().toISOString(),model:'deepseek-flash',source,revision,generationMode,selectedCases:selected??'all revisable',scope:'Diagnostic repair of selected source-checked saved candidate reviews, then independent new model review. Not production send, not human acceptance; reviewer pass is not proof of truth or personality.',rows:[],complete:false};
async function call(messages,direct){
 const r=await fetch(proxy,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:direct?'disabled':'enabled'},...(direct?{temperature:0}:{reasoning_effort:'low'}),max_tokens:450,stream:false}),signal:AbortSignal.timeout(55000)});
 if(!r.ok)throw Error('Diagnostic transport failed: '+r.status);
 const data=await r.json();return {raw:data.choices?.[0]?.message?.content??'',finish:data.choices?.[0]?.finish_reason,usage:data.usage};
}
try {
 for(const sourceRow of calibration.rows){
  if(selected&&!selected.includes(sourceRow.id))continue;
  const reviewed=parseCandidateReview(sourceRow.raw,sourceRow.input.candidate);
  const messages=buildCandidateRepairMessages(sourceRow.input,reviewed);
  if(!messages)continue;
  const generation=await call(messages,generationMode==='direct');
  const row={id:sourceRow.id,input:sourceRow.input,sourceFindings:reviewed.findings,generation};report.rows.push(row);
  if(generation.finish==='stop'&&generation.raw.trim()){
   const input={...sourceRow.input,candidate:generation.raw};
   row.recheck=await call(buildCandidateReviewMessages(input),true);
   row.recheck.review=parseCandidateReview(row.recheck.raw,generation.raw);
  }
  console.log(JSON.stringify({id:row.id,generated:row.generation.raw,finish:row.generation.finish,recheck:row.recheck?.review}));
 }
 report.complete=true;
}finally{
 const calls=report.rows.flatMap(r=>[r.generation,...(r.recheck?[r.recheck]:[])]);
 report.summary={repaired:report.rows.length,calls:calls.length,tokens:calls.reduce((s,r)=>s+(r.usage?.total_tokens??0),0),
  modelPassed:report.rows.filter(r=>r.recheck?.finish==='stop'&&!r.recheck.review.invalid&&r.recheck.review.verdict==='pass').length,
  generationIncomplete:report.rows.filter(r=>r.generation.finish!=='stop').length,productionReady:false};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
}
