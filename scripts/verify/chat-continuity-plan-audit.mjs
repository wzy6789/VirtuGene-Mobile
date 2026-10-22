import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const input=process.argv[2];if(!input)throw Error('Pass a captured24-trajectory baseline.json');
const trace=JSON.parse(readFileSync(input,'utf8'));if(!trace.complete||trace.rows.length!==24)throw Error('A complete captured trace is required');
const checks=[],check=(name,ok,detail)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const topics=row=>row.turns.at(-1).conversation?.topics??[];
const wire=turn=>turn.attempts.at(-1).messages.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
for(const row of trace.rows){
 const name=row.character+' '+row.id,last=row.turns.at(-1),all=wire(last),state=topics(row);
 check(name+' every turn has actual transport and saved reply',row.turns.every(turn=>turn.attempts.length&&turn.savedReplies.length&&turn.databaseSources.some(source=>source.role==='user'&&source.id===turn.current.messageId)));
 if(row.id==='C01')check(name+' user-confirmed exam closure persists',state.some(topic=>topic.kind==='exam'&&topic.outcome==='resolved'));
 if(row.id==='C02')check(name+' meal answer and specific dish persist',state.some(topic=>topic.kind==='meal'&&topic.outcome==='answered'&&topic.slots.dish?.value==='番茄鸡蛋面'));
 if(row.id==='C03')check(name+' current correction and historical date stay distinct',state.some(topic=>topic.kind==='plan'&&topic.slots.date?.value==='周四'&&topic.slots.time?.value==='15点'&&topic.slotHistory.some(slot=>slot.field==='date'&&slot.value==='周五')));
 if(row.id==='C04')check(name+' resolved disagreement is not reopened by cooking',state.some(topic=>topic.kind==='conflict'&&topic.outcome==='resolved'));
 if(row.id==='C05')check(name+' reopened plan retains corrected known slots',state.some(topic=>topic.kind==='plan'&&topic.outcome==='pending'&&topic.slots.date?.value==='周六'&&topic.slots.time?.value==='14点'&&topic.slots.transport?.value==='地铁'));
 if(row.id==='C06')check(name+' listening request reaches actual final request',wire(row.turns[1]).includes('先别分析，让我说完'));
 if(row.id==='C07'){
  check(name+' raw scoped/temporal originals preserved',all.includes('晚上我不喝咖啡')&&all.includes('白天还是会喝')&&all.includes('我以前住北京，现在住上海'));
  const fact=(kind,period)=>state.find(topic=>topic.kind===kind&&topic.slots.period?.value===period);
  check(name+' day and evening are distinct sourced current constraints',fact('preference','晚上')?.slots.object?.value==='咖啡'&&fact('preference','晚上')?.slots.stance?.value==='不喝'&&fact('preference','白天')?.slots.stance?.value==='喝');
  check(name+' current residence and past residence stay distinct',fact('residence','以前')?.slots.place?.value==='北京'&&fact('residence','现在')?.slots.place?.value==='上海');
  const system=String(last.attempts.at(-1).messages[0].content);
  check(name+' real final prompt projects all four scoped claims',system.includes('咖啡·晚上')&&system.includes('咖啡·白天')&&system.includes('居住地·以前·北京')&&system.includes('居住地·当前'));
 }
 if(row.id==='C08'){
  check(name+' cancellation and user reopening originals preserved',all.includes('后来取消了，因为双方都没时间')&&all.includes('重新商量那个邀约'));
  const initial=row.turns[0].conversation?.topics?.find(topic=>topic.kind==='plan');
  check(name+' invitation is a sourced current topic with original weekend',initial?.label==='朋友邀约'&&initial.slots.date?.value==='周末');
  check(name+' cancellation survives music and historical inquiry',row.turns.slice(1,5).every(turn=>turn.conversation?.topics?.some(topic=>topic.id===initial?.id&&topic.outcome==='cancelled')));
  check(name+' explicit reopening preserves the same invitation and known date',state.some(topic=>topic.id===initial?.id&&topic.outcome==='pending'&&topic.slots.date?.value==='周末'));
  check(name+' final actual prompt projects reopened invitation',String(last.attempts.at(-1).messages[0].content).includes('"事项":"朋友邀约","状态":"pending"'));
 }
 if(row.id==='C09')check(name+' reality/story and exit originals preserved',all.includes('现实中我叫阿远')&&all.includes('剧情里小林住在海边')&&all.includes('退出扮演，我还是阿远'));
 if(row.id==='C10')check(name+' long-message tail correction reaches final request',all.includes('最后纠正：不是周五，是周四15点'));
 if(row.id==='C11'){
  const math=state.find(topic=>topic.label==='数学考试'),english=state.find(topic=>topic.label==='英语考试');
  check(name+' two exams retain independent current statuses',math?.outcome==='resolved'&&english?.outcome==='pending'&&state.length===2,state.map(topic=>({label:topic.label,outcome:topic.outcome})));
  check(name+' separate dates are source-backed',math?.slots.date?.value==='周一'&&english?.slots.date?.value==='周三');
  const system=String(last.attempts.at(-1).messages[0].content);
  check(name+' comparison prompt contains both current statuses',system.includes('"事项":"数学考试","状态":"resolved"')&&system.includes('"事项":"英语考试","状态":"pending"'));
 }
 if(row.id==='C12')check(name+' length preference survives six-turn window',all.includes('我喜欢简短回复'));
}
const root='release/chat-continuity-plan-audit-20261019';mkdirSync(root,{recursive:true});
const result={complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),input,inputSha256:createHash('sha256').update(readFileSync(input)).digest('hex'),scope:'Captured actual send-service24 fixed trajectories,172 synthetic turns. Typed-state requirements checked where implemented; other factual cases check original availability only, NOT model semantic utilization or character naturalness.',apiCalls:0,fullPlanComplete:false};
const path=root+'/audit-'+Date.now()+'.json';writeFileSync(path,JSON.stringify(result,null,2));console.log(JSON.stringify({path,complete:result.complete,checks:checks.length,failures:result.failures.map(row=>row.name),apiCalls:0},null,2));if(!result.complete)process.exitCode=1;
