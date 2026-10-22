import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-continuity-study-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const runPath=root+'/live-run-1792402412157.json',frozenPath=root+'/frozen-requests.json';
const run=read(runPath),pack=read(frozenPath),checks=[];
const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
check('Exactly8 final responses and8 upstream observations; proxy secret cleared',run.status==='completed'&&run.attempts.length===8&&run.localProxyObservations.length===8&&run.secretPurged);
check('Frozen request pack has not changed',hash(frozenPath)===run.frozenInputsSha256);
for(let index=0;index<8;index++){
 const attempt=run.attempts[index],request=pack.requests[index];
 check('Attempt'+(index+1)+' exact frozen request, no retry',attempt.caseId===request.caseId&&attempt.variant===request.variant&&JSON.stringify(attempt.requestBody)===JSON.stringify(request.body)&&!attempt.retry);
 check('Attempt'+(index+1)+' complete response with actual usage',attempt.status==='accepted'&&attempt.httpStatus===200&&attempt.finishReason==='stop'&&attempt.usageKnown&&attempt.usage.completion_tokens<=300&&attempt.providerModel==='deepseek-flash');
 check('Attempt'+(index+1)+' saved original equals literal response content',JSON.parse(attempt.rawResponse).choices[0].message.content===attempt.reply);
}
check('Cumulative actual usage matches all raw responses within caps',run.attempts.reduce((sum,row)=>sum+row.usage.prompt_tokens,0)===1733&&run.attempts.reduce((sum,row)=>sum+row.usage.completion_tokens,0)===127&&run.accounting.totalTokens===1860&&!run.costUnknown&&run.promptTokens<=24000);
check('No credentials or headers in persisted request/response evidence',!/sk-[a-zA-Z0-9_-]{16,}|Bearer\s+[a-zA-Z0-9]/u.test(readFileSync(runPath,'utf8'))&&!run.headersStored);
const chosen={R1:'B',R2:'A',R3:'B',R4:'B'};
const rows=pack.fixtures.map(fixture=>{
 const attempts=run.attempts.filter(row=>row.caseId===fixture.id),a=attempts.find(row=>row.variant==='A'),b=attempts.find(row=>row.variant==='B');
 return {id:fixture.id,a:a.reply,b:b.reply,selectedWholeVersion:chosen[fixture.id],reviewer:'Codex offline reading of complete frozen contexts and outputs; not a human rating or extra paid model judge',
  observations:fixture.id==='R1'?['Both answer a light preference without returning to the finished exam. B offers music/reading; neither proves a distinctive character.']:
   fixture.id==='R2'?['Both avoid asking about dinner again. Both give broad quiet/light preferences rather than a concrete short-film genre. A is retained as the whole sample; no sentences are combined.']:
   fixture.id==='R3'?['B explicitly retains Saturday14:00, subway, and museum undecided. A gives generic preparation without contradicting those facts. One sample per variant does not prove a causal/global improvement.']:
   ['Both give a recipe without reopening the resolved dispute. B provides clearer cooking order; ordinary oil/salt are kitchen assumptions, not evidence of a recorded pantry. No buying or completed-cooking claim.']};
});
const durations=run.attempts.map(row=>row.durationMs).sort((a,b)=>a-b);
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 scope:'Original section10 bounded four A/B strategy prototypes with a compact synthetic Gu Yue Na persona and Tang Wulin identity. User supplied a credential in this turn; previous connection blocker was resolved for this run.',
 evidence:{rawRun:{path:runPath,sha256:hash(runPath)},frozenInputs:{path:frozenPath,sha256:hash(frozenPath)},officialPreflight:{path:'docs/CHAT-CONTINUITY-MODEL-PREFLIGHT-2026-10-19.json',sha256:hash('docs/CHAT-CONTINUITY-MODEL-PREFLIGHT-2026-10-19.json')}},
 validation:{checks,passed:checks.every(row=>row.ok)},
 actualRequests:8,successfulResponses:8,retries:0,extraProbes:0,extraSummaries:0,paidJudges:0,
 protocol:run.requestedProtocol,actualReturnedModels:[...new Set(run.attempts.map(row=>row.providerModel))],
 modelInterpretation:run.responseModelInterpretation,
 usage:run.accounting,
 elapsed:{individualRequestMs:run.attempts.map(row=>({caseId:row.caseId,variant:row.variant,ms:row.durationMs})),minMs:durations[0],medianMs:(durations[3]+durations[4])/2,maxMs:durations.at(-1),scope:'Local authenticated proxy→official provider complete JSON round-trip. Nonthinking300-output prototype; not first-token, actual UI display, production-thinking response or Android timing.'},
 results:rows,
 conclusions:['All8 responses complete without reopening the resolved/paused topics incorrectly in these four fixtures.','Explicit manual state makes the R3 arrangement more specific. Other pairs do not establish a consistent style benefit.','R2 remains broad; short replies and absence of errors do not prove humanlike expression or Gu-specific warmth.','Keep production persona/voice decisions unchanged on this compact prototype alone. No keyword patch or new product feature follows from this small sample.'],
 limitations:['Only the final reply of each trajectory is actually generated; the previous six turns are explicitly hand-authored synthetic history.','A/B differ in manual state derived from identical history. This does not validate automatic extraction or represent a product pre/post comparison.','One random sample each attemperature.8; no seed guarantee, no statistical or causal claim.','The role is a compact synthetic persona, not the current full built-in Gu prompt/runtime. Lu is not called in this study.','Production thinking remains enabled/low; this plan-specific study explicitly disables thinking. No app setting or version was changed.','Full24-trajectory production-persona naturalness, long-chat drift and human ratings remain unverified. Codex observations are not human scores.','Cost is an official-rate estimate/upper bound from actual usage; account balance/bill not queried. No independent immutable model snapshot confirmation.'],
 credentials:{writtenToFiles:false,headersPersisted:false,proxyClosed:true,secretPurged:true},
 originalEightCallBudgetExhausted:true,noFurtherPaidCallsThisStudy:true,noProductionCodeChanges:true,noVersionPackageInstallDeployPublish:true,
 previousBlocker:{evidence:'docs/CHAT-CONTINUITY-BLOCKED-2026-10-19.json',connectionResolvedForThisRun:true,remaining:'Genuine full production-persona trajectories and human assessment, not absence of section10 responses.'}
};
const reportPath='docs/CHAT-CONTINUITY-LIVE-STUDY-2026-10-19.json';writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const transcriptHeader='# 古月娜｜有界对照原话｜2026-10-19\n\n场景：简化合成人设、唐舞麟身份。每组前6轮是人工编写的固定历史，最后1轮是本次真实DeepSeek API返回；研究采用非思考模式。以下每组只保留一个完整版本，未拼接A/B句子。\n';
let transcript=transcriptHeader;
for(const fixture of pack.fixtures){
 const variant=chosen[fixture.id],reply=run.attempts.find(row=>row.caseId===fixture.id&&row.variant===variant).reply;
 transcript+='\n## '+fixture.id+'｜'+variant+'\n\n';
 for(const [user,assistant]of fixture.pairs)transcript+='chatgpt：'+user+'\n\n古月娜：'+assistant+'\n\n';
 transcript+='chatgpt：'+fixture.message+'\n\n古月娜：'+reply+'\n';
}
writeFileSync(root+'/selected-whole-transcripts.md',transcript);
const mobileRoot='D:/月起云归/VirtuGene/手机版';
mkdirSync(mobileRoot+'/聊天验收',{recursive:true});mkdirSync(mobileRoot+'/优化方向',{recursive:true});
writeFileSync(mobileRoot+'/聊天验收/2026-10-19-古月娜有界对照.md',transcript);
writeFileSync(mobileRoot+'/优化方向/2026-10-19-古月娜有界对照记录.md',
 '# 古月娜有界对照记录｜2026-10-19\n\n'+
 '- 只记录原方案第10节4组8请求，不追加新方向或付费调用。\n'+
 '- 四组未错误拉回已结束话题；R3加人工状态后，周六14点／地铁／馆未定更完整。\n'+
 '- R2两版都只说清静、不吵，类型回答较泛；整体简短，仍不能证明人物辨识度或温柔程度。\n'+
 '- 接受原话按R1 B／R2 A／R3 B／R4 B保留完整版本，没有拼句。这里是Codex原稿观察，不是真人人工评分。\n'+
 '- 简化人设、人工历史、每版单次采样，不改写当前生产角色；不据此宣称自动状态、生产思考模式或完整长聊达标。\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
progress.fullPlanComplete=false;progress.liveStudy={path:reportPath,requests:8,promptTokens:1733,completionTokens:127,actualReturnedModels:report.actualReturnedModels,productionThinkingChanged:false,fullPlanComplete:false};
progress.currentBlocker={previousEvidence:'docs/CHAT-CONTINUITY-BLOCKED-2026-10-19.json',previousConnectionBlockerResolvedForStudy:true,evidence:reportPath,remaining:['T7 full production-persona naturalness','T8 full-trajectory human scoring'],note:'New user credential allowed bounded execution; old connection-blocker audit is historical, not evidence of a current failed connection.'};
progress.next='Original8-call strategy study is complete and budget exhausted; preserve all raw outputs. Full production-persona multi-turn naturalness and human scoring remain unverified. Do not repeat calls, invent local tests or patch the full persona solely from the compact prototype.';
for(const id of ['T7','T8']){const task=progress.tasks.find(row=>row.id===id);task.evidence=[...new Set([...(task.evidence??[]),reportPath])];}
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const appendOnce=(path,marker,text)=>{if(!readFileSync(path,'utf8').includes(marker))appendFileSync(path,text);};
appendOnce(mobileRoot+'/开发日志/2026-10-19.md','### 古月娜第10节真实对照：8次预算用完',
 '\n### 古月娜第10节真实对照：8次预算用完\n'+
 '- 工作目录F:/VirtuGene-Mobile；编码模型／推理强度未确认。用户本轮重新提供凭据，已解决本次有界研究的连接阻塞；不是再利用历史消息中的密钥。通过既有live-test-proxy在内存接入官方api.deepseek.com，密钥／授权头未写代码、日志或原稿，8次后代理关闭并清空秘密。无额外连接探测、失败重试、摘要或LLM评委。\n'+
 '- 4组A/B共8/8返回HTTP200、finish_reason stop；实际返回model均deepseek-flash，只能结合当日官方文档说alias映射1017，不能独立证明不可变快照。每次非思考、temperature.8、stream false、max_tokens300；这是原第10节参数，生产thinking enabled／low没有改。完整原稿、冻结输入hash、每次usage与时间见项目'+reportPath+'及release/chat-continuity-study-20261019/live-run-1792402412157.json。\n'+
 '- 实际输入1733／输出127／合计1860tokens；缓存命中0、未命中1733。按官方峰价估算上界$0.0006723、低谷估算$0.00033615，未查询余额扣费，不冒称实际账单。原方案8次总预算已用完，不再追加。\n'+
 '- 完整JSON往返逐次869／838／595／635／629／682／925／440ms，中位658.5ms。属本地代理到官方服务的非思考短输出，不是首字／上屏／Android或生产思考速度。\n'+
 '- 四组均未把当前问题绕回考试／晚饭／争执；R3 B明确保留周六14点、地铁和馆未定，A是较泛准备。R2两版未给明确短片类型；其余样本不足以证明统一风格收益、人物辨识度或温柔。单次随机A/B不能证明因果。Codex观察不是真人人工评分。\n'+
 '- 每组6轮前文均人工合成，只有最后1轮真实生成；用的是简化古月娜，不是完整内置人格和实际自动提取器。原24条完整生产人物自然度／长聊与人工评分仍未验证，整个目标没有达标。此结果不触发重写生产人设或继续堆关键词。\n'+
 '- 聊天验收只放完整R1 B／R2 A／R3 B／R4 B，用户方标chatgpt；所有A/B原稿留项目，未拼句，分析另放优化方向记录。无生产代码修改、升版、应用构建、APK、安装或发布，无本轮新UI／Android录屏、麦克风或音频。\n');
appendOnce(mobileRoot+'/00-总览.md','古月娜第10节真实8次对照',
 '\n- 2026-10-19 古月娜第10节真实8次对照：8/8成功、输入1733／输出127token，峰价估算上界$0.0006723；原稿与完整选定版本已分别归档，预算用完。简化人设研究有局部状态细节收益，未证明完整生产人物自然度或通过人工评分。见[[手机版/开发日志/2026-10-19|当日开发日志]]和项目docs/CHAT-CONTINUITY-LIVE-STUDY-2026-10-19.json。未改生产／打包／发布。\n');
console.log(JSON.stringify({path:reportPath,validationChecks:checks.length,requests:8,promptTokens:1733,completionTokens:127,officialPeakUpperUSD:run.accounting.officialPeakUpperUSD,credentialPersisted:false,fullPlanComplete:false}));
