import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const output=process.argv[2]??'release/chat-coverage-fix-20261018/coverage-checks.json';
const built=await build({stdin:{contents:"export * from './src/lib/chat-history-window';",loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
let checks=0;const labels=[];
const check=(value,label)=>{if(!value)throw Error(label);checks++;labels.push(label);};
const row=(id,role,content,source,batch)=>({id,role,content,revision:1,replyToUserMessageId:source,replyBatchId:batch,isProactive:false});
try{
 const long='前提：面试原先说的是周五。'+'前情说明。'.repeat(245)+'最后纠正：不是周五，是周四15点。';
 const source=row('long','user',long);
 const selected=api.buildChatHistoryWindow([source],'now');
 check(selected[0].content.startsWith('前提：面试原先说的是周五。')&&selected[0].content.endsWith('最后纠正：不是周五，是周四15点。'),'bounded long history retains both premise and latest correction');
 check(selected[0].content.length<=1200&&source.content===long,'bounded rendering never mutates source or exceeds item budget');
 check(selected[0].sourceCoverage.length===2&&selected[0].sourceCoverage[1].end===long.length,'long history exposes actual prefix and suffix intervals');
 check(api.boundChatHistory(selected)[0].content===selected[0].content,'second transport bound is idempotent');
 const messages=[];
 for(let t=0;t<6;t++){
  messages.push(row('u'+t,'user','问题'+t));
  for(let b=0;b<4;b++)messages.push(row('a'+t+'-'+b,'assistant','回答'+t+'-'+b,'u'+t,'batch'+t+'-'+b));
 }
 const complete=api.selectRecentCompleteTurns(messages,'now');
 check(complete.turns.length===30,'six complete turns retain independently linked reply batches without merging them');
 check(complete.coverage.length===30&&complete.excluded.length===0,'every short source in six turns is accounted for');
 check(api.boundChatHistory(complete.turns).length===30,'lower transport does not silently cut selected complete turns to twelve bubbles');
 check(complete.turns.reduce((n,t)=>n+t.content.length,0)<=14000,'complete-turn policy retains the existing total character ceiling');
 const isolated=api.selectRecentCompleteTurns([...messages,row('now','user','当前输入')],'now');
 check(isolated.turns.every(t=>!t.sourceMessageIds.includes('now')),'current input excluded exactly once before transport append');
 const clipped=api.selectRecentCompleteTurns([source],'now');
 check(clipped.excluded.some(g=>g.messageId==='long'&&g.start>0&&g.end<long.length),'middle interval is honestly excluded rather than claimed complete');
 check(typeof api.buildContinuityBridge==='function','bridge has an explicit original-source coverage interface');
 const bridge=api.buildContinuityBridge([source],'now',clipped.coverage);
 check(bridge.coverage.length===1&&bridge.coverage[0].start===clipped.excluded[0].start&&bridge.coverage[0].end===clipped.excluded[0].end,'bridge fills precisely the missing middle, not a duplicate source prefix');
 const independent=Array.from({length:24},(_,i)=>row('m'+i,i%2?'assistant':'user','独立原文'+i,i%2?'m'+(i-1):undefined,'b'+Math.floor(i/2)));
 const recent=api.selectRecentCompleteTurns(independent,'now');
 const gaps=api.buildContinuityBridge(independent,'now',recent.coverage);
 check([6,7,8,9,10,11].every(i=>gaps.coverage.some(r=>r.messageId==='m'+i)),'bridge closes fixed twelve-group/eighteen-message boundary hole');
 const summaryRow=row('summary','user','旧前文'.repeat(400)+'最新尾部');
 const cursor={sourceMessageIds:['summary'],sourceMessageRevisions:{summary:1},sourceMessageOffsets:{summary:1200}};
 const afterSummary=api.buildContinuityBridge([summaryRow],'now',[],cursor);
 check(afterSummary.coverage[0].start===1200,'valid summary cursor covers only its exact prefix');
 const staleSummary=api.buildContinuityBridge([{...summaryRow,revision:2}],'now',[],cursor);
 check(staleSummary.coverage[0].start===0,'edited source invalidates old summary coverage');
 const missingRevision=api.buildContinuityBridge([summaryRow],'now',[],{sourceMessageIds:['summary']});
 check(missingRevision.coverage[0].start===0,'legacy summary without revision does not fabricate covered source ranges');
 for(const s of ['😀'.repeat(700),'前提'+ '😀'.repeat(700)+'最新纠正']){
  const rendered=api.buildChatHistoryWindow([row('unicode','user',s)],'now')[0].content;
  check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(rendered),'source clipping never splits a supplementary Unicode code point');
 }
 const failed=api.buildContinuityBridge([{...source,failed:true}],'now',[]);
 check(!failed.text&&failed.coverage.length===0,'failed sources cannot enter bridge');
 check(api.buildContinuityBridge([source],'long',[]).coverage.length===0,'bridge never duplicates current user');
 const cap=api.buildContinuityBridge(independent,'now',[],undefined,80);
 check(cap.text.length<=80,'bridge budget includes headings and separators');
 console.log(JSON.stringify({passed:true,checks}));
}finally{writeFileSync(output,JSON.stringify({checks,labels},null,2));}
