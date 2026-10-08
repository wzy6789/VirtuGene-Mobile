// Re-evaluate saved model judgments locally. Never regenerate a judgment or
// replace the recorded raw text, and never treat an unknown as a correct pass.
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
const built=await build({stdin:{contents:"export * from './src/lib/chat-candidate-review';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'});
const box={module:{exports:{}},exports:{}};
vm.runInNewContext(built.outputFiles[0].text,box);
const {parseCandidateReview}=box.module.exports;
const files=process.argv.slice(2);
if(!files.length)throw Error('Specify saved candidate-review JSON reports. This script makes zero model calls.');
const rows=[];
for(const file of files){
  const report=JSON.parse(readFileSync(file,'utf8'));
  if(!Array.isArray(report.rows))throw Error(`Missing review rows: ${file}`);
  for(const row of report.rows){
    if(!row.input||typeof row.input.candidate!=='string'||!['pass','revise'].includes(row.expected))throw Error(`Missing candidate or declared expected judgment: ${file}`);
    const parsed=typeof row.raw==='string'?parseCandidateReview(row.raw,row.input.candidate):{verdict:'uncertain',findings:[],invalid:true};
    const unknown=row.finish==='length'||row.status||parsed.invalid||parsed.verdict==='uncertain';
    rows.push({file,id:row.id,expected:row.expected,observed:unknown?'uncertain':parsed.verdict,
      correct:!unknown&&parsed.verdict===row.expected,findings:parsed.findings,
      reason:row.finish==='length'?'truncated':row.status?'transport-failure':parsed.invalid?'invalid-review':undefined,usage:row.usage});
  }
}
const summary={scope:'Saved model-review calibration against developer-declared expectations; not human acceptance or production-chat quality',
  total:rows.length,correct:rows.filter(r=>r.correct).length,unknown:rows.filter(r=>r.observed==='uncertain').length,
  falsePass:rows.filter(r=>r.expected==='revise'&&r.observed==='pass').length,
  falseReject:rows.filter(r=>r.expected==='pass'&&r.observed==='revise').length,
  reportedTokens:rows.reduce((sum,row)=>sum+(row.usage?.total_tokens??0),0),unknownUsage:rows.filter(row=>!row.usage).length,
  productionReady:false};
writeFileSync('docs/CHAT-REVIEW-CALIBRATION-2026-10-08.json',JSON.stringify({date:new Date().toISOString(),summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
