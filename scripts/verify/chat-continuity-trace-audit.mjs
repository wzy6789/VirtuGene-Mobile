import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const path=process.argv[2];
if(!path)throw Error('Pass a unique baseline.json path');
const data=JSON.parse(readFileSync(path,'utf8'));
if(!data.complete||data.rows.length!==24)throw Error('Incomplete trace run');
const text=m=>typeof m.content==='string'?m.content:JSON.stringify(m.content);
const longCorrections=[];
for(const row of data.rows.filter(r=>r.id==='C10')){
 const turn=row.turns.at(-1),wire=turn.attempts.at(-1);
 const source=turn.databaseSources.find(m=>m.role==='user'&&m.content.includes('最后纠正：'));
 if(!source)throw Error('Missing synthetic source');
 const selected=turn.historyStages.filter(s=>s.stage==='selected-history').at(-1);
 const selectedContent=selected?.result.filter(g=>g.sourceMessageIds.includes(source.id)).map(g=>g.content).join('\n')??'';
 const correction='最后纠正：不是周五，是周四15点。';
 const inPayload=wire.messages.some(m=>text(m).includes(correction));
 longCorrections.push({character:row.character,sourceId:source.id,revision:source.revision,sourceLength:source.content.length,correctionRange:{start:source.content.indexOf(correction),end:source.content.length},candidateHasCorrection:selected?.candidates.some(c=>c.id===source.id&&c.content.includes(correction))??false,selectedHistoryHasCorrection:selectedContent.includes(correction),selectedContentLength:selectedContent.length,finalPayloadHasCorrection:inPayload,sourceCoverage:wire.coverage.find(c=>c.messageId===source.id),cause:!selectedContent.includes(correction)?'Correction present in selected candidates but removed by per-group prefix clipping; inspect history selection before changing model guidance.':'Inspect later stages.'});
}
const result={source:path,trajectories:data.rows.length,turns:data.rows.reduce((sum,r)=>sum+r.turns.length,0),paidCalls:0,longCorrections,
 completeT0:false,
 unverified:['Gateway payload has not been executed; BYOK-compatible synthetic fetch only.','Operational C11 deletion and C12 account switching/retry/interrupt await separate tests.','Literal match coverage cannot establish summary semantics or provenance of identical text.','firstVisible is not measured from decoded component frames.','History bridge summaries, 200-message range and same-millisecond multiparts still need separate stress cases.'],
 interpretation:'Trace harness ran 24 scripts; complete run does not mean product behavior or full T0 acceptance is proven.'};
writeFileSync(join(dirname(path),'audit.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({trajectories:result.trajectories,turns:result.turns,longCorrections:longCorrections.map(c=>({character:c.character,candidate:c.candidateHasCorrection,selected:c.selectedHistoryHasCorrection,wire:c.finalPayloadHasCorrection,range:c.correctionRange})),completeT0:false}));
if(process.argv.includes('--require-correction')&&longCorrections.some(c=>!c.finalPayloadHasCorrection))process.exitCode=1;
