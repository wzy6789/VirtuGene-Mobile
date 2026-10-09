// Re-evaluate saved model judgments locally. Never regenerate a judgment or
// replace the recorded raw text, and never treat an unknown as a correct pass.
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const built=await build({stdin:{contents:"export * from './src/lib/chat-candidate-review';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'});
const box={module:{exports:{}},exports:{}};
vm.runInNewContext(built.outputFiles[0].text,box);
const {parseCandidateReview}=box.module.exports;
const args=process.argv.slice(2);
const outputIndex=args.indexOf('--output');
const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const output=outputIndex>=0?args[outputIndex+1]:`docs/CHAT-REVIEW-CALIBRATION-${day}.json`;
if(outputIndex>=0)args.splice(outputIndex,2);
if(!/^docs\/[A-Z0-9-]+\.json$/u.test(output??'')||existsSync(output))throw Error('Specify a new docs report path; saved evidence must not be overwritten');
const files=args;
if(!files.length)throw Error('Specify saved candidate-review JSON reports. This script makes zero model calls.');
const rows=[];
for(const file of files){
  const report=JSON.parse(readFileSync(file,'utf8'));
  if(!Array.isArray(report.rows))throw Error(`Missing review rows: ${file}`);
  for(const row of report.rows){
    if(!row.input||typeof row.input.candidate!=='string'||!['pass','revise'].includes(row.expected))throw Error(`Missing candidate or declared expected judgment: ${file}`);
    const parsed=typeof row.raw==='string'?parseCandidateReview(row.raw,row.input.candidate):{verdict:'uncertain',findings:[],invalid:true};
    const transportFailure=row.status!==undefined&&row.status!==200;
    const unknown=row.finish!=='stop'||transportFailure||parsed.invalid||parsed.verdict==='uncertain';
    const kindCorrect=!row.kind||parsed.findings.some(finding=>finding.kind===row.kind);
    rows.push({file,id:row.id,expected:row.expected,observed:unknown?'uncertain':parsed.verdict,
      correct:!unknown&&parsed.verdict===row.expected&&kindCorrect,kindCorrect,findings:parsed.findings,
      reason:row.finish==='length'?'truncated':transportFailure?'transport-failure':parsed.invalid?'invalid-review':row.finish!=='stop'?'incomplete-finish':undefined,usage:row.usage});
  }
}
const summary={scope:'Saved model-review calibration against developer-declared expectations; not human acceptance or production-chat quality',
  total:rows.length,correct:rows.filter(r=>r.correct).length,unknown:rows.filter(r=>r.observed==='uncertain').length,
  falsePass:rows.filter(r=>r.expected==='revise'&&r.observed==='pass').length,
  falseReject:rows.filter(r=>r.expected==='pass'&&r.observed==='revise').length,
  wrongKind:rows.filter(r=>r.expected==='revise'&&r.observed==='revise'&&!r.kindCorrect).length,
  reportedTokens:rows.reduce((sum,row)=>sum+(row.usage?.total_tokens??0),0),unknownUsage:rows.filter(row=>!row.usage).length,
  productionReady:false};
writeFileSync(output,JSON.stringify({date:new Date().toISOString(),summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
