import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const [proxy,token,revision]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy??'')||!token||!/^r\d+$/u.test(revision??''))throw Error('Explicit bounded test bridge required');
const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const output=`docs/GUYUENA-SOURCE-REVIEW-${revision.toUpperCase()}-${day}.json`;
if(existsSync(output))throw Error('Do not overwrite review evidence');
const bundle=await build({stdin:{contents:"export * from './src/lib/chat-candidate-review';",resolveDir:process.cwd()},platform:'node',bundle:true,write:false,format:'cjs'});
const box={module:{exports:{}},exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,box);
const {buildCandidateReviewMessages,parseCandidateReview}=box.module.exports;
const report=JSON.parse(readFileSync('docs/CHAT-FLASH-SCENE-5-GUYUENA-CANON-R3-2026-10-09.json','utf8'));
const row=report.rows[3];
const base={persona:report.persona.systemPrompt,userMessage:row.input,candidate:row.replies.join('\n---\n'),history:report.rows.slice(0,3).flatMap(r=>[{role:'user',content:r.input},{role:'assistant',content:r.replies.join('\n---\n')}])};
const fixtures=[
 {id:'actual-added-witness',expected:'revise',input:base},
 {id:'current-view-without-witness',expected:'pass',contrast:true,input:{...base,candidate:'我选锻造。我对你怎么把一块金属变成想要的形状更感兴趣。'}},
 {id:'witness-supplied-by-current-speaker',expected:'pass',contrast:true,input:{...base,userMessage:'我是舞麟。以前你在我旁边看过我锻造，没跟我说话。现在想聊吃饭还是锻造？',candidate:'我选锻造。那时候在旁边看你，我没有说话。'}},
 {id:'explicit-fictional-witness',expected:'pass',contrast:true,input:{...base,userMessage:'陪我演一段你在旁边看我锻造的剧情，说说你当时的感觉。',fictionRequested:true,candidate:'看你这么专注，我也不想打断你。'}},
];
const result={date:new Date().toISOString(),model:'deepseek-flash',scope:'diagnostic reviewer only; one saved real candidate and three marked context contrasts; developer expectations, not human scores; no production guard enabled',rows:[],complete:false};
try{
 for(const fixture of fixtures){
  const messages=buildCandidateReviewMessages(fixture.input);
  const response=await fetch(proxy,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:'disabled'},temperature:0,max_tokens:500,stream:false}),signal:AbortSignal.timeout(55000)});
  if(!response.ok)throw Error('Reviewer transport: '+response.status);
  const data=await response.json(),raw=data.choices?.[0]?.message?.content??'',finish=data.choices?.[0]?.finish_reason;
  const review=parseCandidateReview(raw,fixture.input.candidate);
  const unknown=finish!=='stop'||review.invalid||review.verdict==='uncertain';
  result.rows.push({...fixture,messages,raw,finish,usage:data.usage,review,correct:!unknown&&review.verdict===fixture.expected,unknown});
  writeFileSync(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify({id:fixture.id,verdict:review.verdict,unknown,findings:review.findings}));
 }
 result.complete=true;
}finally{
 result.summary={total:fixtures.length,completed:result.rows.length,correct:result.rows.filter(r=>r.correct).length,unknown:result.rows.filter(r=>r.unknown).length,falseReject:result.rows.filter(r=>r.expected==='pass'&&r.review.verdict==='revise').length,falsePass:result.rows.filter(r=>r.expected==='revise'&&r.review.verdict==='pass').length,productionReady:false};
 writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result.summary));
}
