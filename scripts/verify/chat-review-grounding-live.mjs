import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const [proxy,token,revision,generation='thinking']=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy??'')||!token||!/^r\d{1,2}$/u.test(revision??'')||!['thinking','direct'].includes(generation))throw Error('Bounded local proxy, distinct revision and reviewer mode required');
const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const output=`docs/CHAT-REVIEW-GROUNDING-${revision.toUpperCase()}-${day}.json`;
if(existsSync(output))throw Error('Do not overwrite saved judgments');
const compiled=await build({stdin:{contents:"export * from './src/lib/chat-candidate-review';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'});
const box={module:{exports:{}},exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,box);
const {buildCandidateReviewMessages,parseCandidateReview}=box.module.exports;
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const gentle=read('docs/CHAT-FLASH-SCENE-3-JOY-R12-2026-10-09.json');
const direct=read('docs/CHAT-FLASH-SCENE-2-JOY-R1-2026-10-09.json');
const earlier=read('docs/CHAT-FLASH-SCENE-3-JOY-R8-2026-10-08.json');
const short=read('docs/CHAT-FLASH-SCENE-3-JOY-R10-2026-10-09.json');
const inputAt=(report,index)=>({persona:report.persona.systemPrompt,userMessage:report.rows[index].input,
 candidate:report.rows[index].replies.join('\n---\n'),history:report.rows.slice(0,index).flatMap(row=>[{role:'user',content:row.input},{role:'assistant',content:row.replies.join('\n---\n')}])});
const cases=[
 {id:'actual-user-cause',expected:'revise',kind:'unsupported-user-assumption',source:'gentle R12 turn 3',input:inputAt(gentle,2)},
 {id:'actual-user-habit',expected:'revise',kind:'unsupported-user-assumption',source:'direct R1 turn 6',input:inputAt(direct,5)},
 {id:'actual-own-habit',expected:'revise',kind:'unsupported-experience',source:'gentle R8 turn 6',input:inputAt(earlier,5)},
 {id:'explicit-no-advice',expected:'revise',kind:'forced-response',source:'contrast: R12 candidate, explicit current request changed',input:{...inputAt(gentle,2),userMessage:'不用分析也不要给建议，只是想说我有点空。'}},
 {id:'supported-user-cause',expected:'pass',source:'contrast: R12 first sentence, independent user cause supplied',input:{...inputAt(gentle,2),candidate:gentle.rows[2].replies[0],history:[{role:'user',content:'备考时我一直绷得很紧，考完觉得那根弦一下松了。'}]}},
 {id:'current-preference',expected:'pass',source:'direct R1 turn 5 first sentence',input:{...inputAt(direct,4),candidate:direct.rows[4].replies[0]}},
 {id:'playful-current-reaction',expected:'pass',source:'gentle R10 turn 2',input:inputAt(short,1)},
 {id:'explicit-fiction',expected:'pass',source:'contrast: R8 candidate, explicit fictional invitation',input:{...inputAt(earlier,5),userMessage:'陪我演一段一起在家看电影的剧情，你说说自己的零食习惯。',fictionRequested:true}},
];
const report={date:new Date().toISOString(),model:'deepseek-flash',revision,generation,scope:'8 fixed reviewer calibration cases; expectations declared by developer, not human acceptance; saved real candidates plus marked context contrasts; no production deployment or change to character generation mode',rows:[],complete:false};
try {
 for(const fixture of cases){
  const messages=buildCandidateReviewMessages(fixture.input);
  const response=await fetch(proxy,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:generation==='direct'?'disabled':'enabled'},...(generation==='thinking'?{reasoning_effort:'low'}:{temperature:0}),max_tokens:450,stream:false}),signal:AbortSignal.timeout(55000)});
  if(!response.ok){report.rows.push({...fixture,status:response.status});throw Error('Review transport failed: '+response.status);}
  const data=await response.json(),raw=data.choices?.[0]?.message?.content??'',finish=data.choices?.[0]?.finish_reason;
  const review=parseCandidateReview(raw,fixture.input.candidate);
  const unknown=finish!=='stop'||review.invalid||review.verdict==='uncertain';
  const correct=!unknown&&review.verdict===fixture.expected&&(!fixture.kind||review.findings.some(f=>f.kind===fixture.kind));
  report.rows.push({...fixture,raw,finish,usage:data.usage,review,correct,unknown});
  console.log(JSON.stringify({id:fixture.id,expected:fixture.expected,observed:unknown?'uncertain':review.verdict,correct,findings:review.findings}));
 }
 report.complete=true;
} finally {
 report.summary={total:cases.length,completed:report.rows.length,correct:report.rows.filter(r=>r.correct).length,
  unknown:report.rows.filter(r=>r.unknown||r.status).length,falsePass:report.rows.filter(r=>r.expected==='revise'&&r.review?.verdict==='pass').length,
  falseReject:report.rows.filter(r=>r.expected==='pass'&&r.review?.verdict==='revise').length,
  tokens:report.rows.reduce((s,r)=>s+(r.usage?.total_tokens??0),0),productionReady:false};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.summary));
}
