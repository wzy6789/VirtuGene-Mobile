// Pure production selector/compiler stress. Not a DB, UI or model test.
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const artifact=await build({stdin:{contents:"export * from './src/lib/chat-history-window'; export {compileChatContext} from './src/lib/chat-context-compiler';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {buildChatHistoryWindow,boundChatHistory,selectRecentCompleteTurns,buildContinuityBridge,compileChatContext}=await import('data:text/javascript;base64,'+Buffer.from(artifact.outputFiles[0].text).toString('base64'));
const root='release/chat-continuity-boundary-'+new Date().toISOString().replace(/[:.]/gu,'-');mkdirSync(root,{recursive:true});
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const row=(id,role,content,source,batch)=>({id,role,content,replyToUserMessageId:source,replyBatchId:batch,createdAt:1000,revision:1});
const cases=[];
const examine=(id,messages,requiredIds)=>{
 const legacySelected=buildChatHistoryWindow(messages,'current');
 const selection=selectRecentCompleteTurns(messages,'current');
 const selected=selection.turns;
 const bounded=boundChatHistory(selected);
 const ids=new Set(selected.flatMap(turn=>turn.sourceMessageIds));
 const missing=requiredIds.filter(id=>!ids.has(id));
 const bridge=buildContinuityBridge(messages,'current',selection.coverage);
 cases.push({id,inputSha256:sha(messages),input:messages,legacySelected,selected,bounded,bridge,requiredIds,missingSourceIds:missing,orderNote:'Actual private selector tested; legacy group-count wrapper retained separately. Input order held fixed; same-timestamp DB cursor order is separately tested by history-pagination.'});
};
const independent=Array.from({length:24},(_,i)=>row('m'+i,i%2?'assistant':'user','独立原文编号'+i,i%2?'m'+(i-1):undefined,'b'+Math.floor(i/2)));
examine('12-group-vs-18-message-boundary',independent,independent.slice(-12).map(m=>m.id));
const selected24=new Set(cases.at(-1).selected.flatMap(t=>t.sourceMessageIds));
const summaryCandidateIds=new Set(independent.slice(0,-18).map(m=>m.id));
const betweenBoundaries=independent.filter(m=>!selected24.has(m.id)&&!summaryCandidateIds.has(m.id)).map(m=>({id:m.id,revision:m.revision,start:0,end:m.content.length,reason:'outside selected 12 groups but inside fixed 18-message summary exclusion'}));
const remainingBoundaryGaps=betweenBoundaries.filter(gap=>!cases[0].bridge.coverage.some(range=>range.messageId===gap.id&&range.start===gap.start&&range.end===gap.end));
const many=Array.from({length:200},(_,i)=>row('long-'+i,i%2?'assistant':'user','长历史原文'+i,i%2?'long-'+(i-1):undefined,'long-b'+Math.floor(i/2)));
examine('200-message-tail',many,many.slice(-12).map(m=>m.id));
for(const separateBatches of [false,true]){
 const messages=[];
 for(let turn=0;turn<6;turn++){
  const user='multi-u'+turn;messages.push(row(user,'user','这一轮的用户问题'+turn));
  for(let bubble=0;bubble<4;bubble++)messages.push(row('multi-a'+turn+'-'+bubble,'assistant','对应回答'+turn+'-'+bubble,user,'batch'+turn+(separateBatches?'-'+bubble:'')));
 }
 examine(separateBatches?'separate-batches-six-complete-turns':'same-batch-six-complete-turns',messages,messages.map(m=>m.id));
}
const long=row('tail-correction','user','前情说明。'.repeat(245)+'最后纠正：不是周五，是周四15点。');
examine('long-message-tail-correction',[long,row('tail-answer','assistant','嗯。',long.id,'tail-batch')],[long.id,'tail-answer']);
const longCase=cases.at(-1);longCase.correctionKept=longCase.bounded.some(t=>t.content.includes('最后纠正：不是周五，是周四15点。'));
const compiled=compileChatContext('角色身份'.repeat(2800),[
 {key:'optional-life',text:'无关生活背景'.repeat(3000),priority:40},
 {key:'latest-correction',text:'[本轮纠正]约在周四15点，不是周五。[/本轮纠正]',priority:100,placement:'tail',requireComplete:true},
 {key:'voice',text:'[人物声音卡]保持原有人物语气[/人物声音卡]',priority:100,placement:'tail',requireComplete:true},
]);
if(!compiled.included.includes('latest-correction')||compiled.partial.includes('latest-correction')||!compiled.prompt.endsWith('[/人物声音卡]'))throw Error('Complete reserved tail lost in bounded compiler stress');
const report={date:new Date().toISOString(),scope:'Pure real history selector/compiler, fixed input order and same timestamps; no DB pagination/model/UI inference',paidCalls:0,cases,betweenBoundaries,remainingBoundaryGaps,systemBudget:{chars:compiled.prompt.length,included:compiled.included,partial:compiled.partial,omitted:compiled.omitted},sourceHashes:['src/lib/chat-history-window.ts','src/lib/chat-context-compiler.ts'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),knownFailures:{longCorrectionMissing:!longCase.correctionKept,separateBatchTurnSourcesMissing:cases.find(c=>c.id.startsWith('separate')).missingSourceIds.length,unbridgedBoundary:remainingBoundaryGaps},allProductRequirementsProven:false};
writeFileSync(root+'/boundary.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({evidence:root+'/boundary.json',remainingBoundaryHole:remainingBoundaryGaps.map(m=>m.id),longCorrectionKept:longCase.correctionKept,separateBatchMissing:report.knownFailures.separateBatchTurnSourcesMissing,systemChars:compiled.prompt.length,paidCalls:0}));
if(process.argv.includes('--require-complete-turns')&&(report.knownFailures.longCorrectionMissing||report.knownFailures.separateBatchTurnSourcesMissing||remainingBoundaryGaps.length))process.exitCode=1;
