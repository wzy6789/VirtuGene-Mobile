// Aggregate observed evidence; this is not a test or an automatic acceptance score.
import {readFileSync,writeFileSync,readdirSync,statSync,appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root='release/chat-core-implementation-20261021';
const read=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/u,''));
const latest=(dir,pattern)=>readdirSync(dir).filter(file=>pattern.test(file)).map(file=>join(dir,file)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];
const files={initial:join(root,'live/initial-trial-results-20261022.json'),comparison:join(root,'live/full-comparison/full-comparison-results-20261022.json'),followup:join(root,'live/full-comparison/review-followup-20261022/full-comparison-results-20261022.json')};
const reports=Object.fromEntries(Object.entries(files).map(([name,path])=>[name,read(path)]));
const usage=report=>report.calls.reduce((sum,call)=>{
  if(!call.usage)throw Error('Provider usage is missing');
  const u=call.usage;
  return {requests:sum.requests+1,input:sum.input+u.prompt_tokens,output:sum.output+u.completion_tokens,reasoningWithinOutput:sum.reasoningWithinOutput+(u.completion_tokens_details?.reasoning_tokens??0),total:sum.total+u.total_tokens,cacheHit:sum.cacheHit+(u.prompt_cache_hit_tokens??0),cacheMiss:sum.cacheMiss+(u.prompt_cache_miss_tokens??0)};
},{requests:0,input:0,output:0,reasoningWithinOutput:0,total:0,cacheHit:0,cacheMiss:0});
const usages=Object.fromEntries(Object.entries(reports).map(([key,value])=>[key,usage(value)]));
const total=Object.values(usages).reduce((sum,value)=>Object.fromEntries(Object.keys(value).map(key=>[key,(sum[key]??0)+value[key]])),{});
const initialLedger=read(join(root,'live/initial-trial-budget-20261022.json'));
const fullLedger=read(join(root,'live/full-comparison/full-comparison-budget-20261022.json'));
if(initialLedger.requests.length!==6||fullLedger.requests.length!==72||fullLedger.config.limit!==72||fullLedger.requests.some(row=>row.result?.status!==200))throw Error('Cumulative accounting needs investigation');
const evidence={
  recorded:latest(join(root,'review'),/^current-\d+\.json$/),
  sender:latest(join(root,'delivery'),/^current-\d+\.json$/),
  voice:latest(join(root,'voice'),/^continuity-\d+\.json$/),
  stock:latest(join(root,'performance'),/^stock-\d+\.json$/),
  topics:latest(join(root,'topics'),/^current-\d+\.json$/),
  candidates:latest(join(root,'candidates'),/^current-\d+\.json$/),
  proactive:latest(root,/^proactive-current-\d+\.json$/),
  replies:latest('release/chat-topic-replies-20261019',/^current-\d+\.json$/),
  roundtrip:latest('release/chat-topic-replies-20261019',/^roundtrip-\d+\.json$/),
  backup:latest('release/chat-backup-isolation-20261019',/^checks-\d+\.json$/),
  resume:latest('release/chat-continuity-resume-20261019',/^checks-\d+\.json$/),
  races:latest('release/chat-topic-outcomes-20261018',/^races-\d+\.json$/),
  output:latest(join(root,'output'),/^contract-current-\d+\.json$/),
};
const evidenceSummary=Object.fromEntries(Object.entries(evidence).map(([name,path])=>{
  const report=read(path);
  if(!report.complete)throw Error('Latest evidence is not passing: '+path);
  return [name,{path,checks:report.checks.length,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}];
}));
const findings=[
  {id:'R1',effect:'同名歧义在重读和游标重放后丢失',grade:'Important',status:'fixed-local',evidence:[evidence.recorded,evidence.topics]},
  {id:'R2',effect:'普通扮演漏过把/将身体动作旁白',grade:'Important',status:'fixed-local',evidence:[evidence.recorded,evidence.sender]},
  {id:'R3',effect:'语音已采用的普通assistant历史未重新核验编辑/删除/撤回',grade:'Important',status:'fixed-local',evidence:[evidence.voice]},
  {id:'R4',effect:'真实对话无来源地自述我也有过拿错东西',grade:'Important',status:'fixed-local',evidence:[evidence.recorded,evidence.sender],latestModelAfterFix:files.followup},
  {id:'R5',effect:'将自己的旧措辞归给用户；最终兜底仍保存错误声明',grade:'Important',status:'fixed-local',evidence:[evidence.recorded,evidence.sender],latestModelAfterFix:files.followup},
  {id:'R6',effect:'合法英文复数所有格被当成未闭合引文阻塞',reviewerGrade:'Minor',executorGrade:'Important',regradeReason:'合法普通回复可能被清空/重试，属于功能损失',status:'fixed-local',evidence:[evidence.recorded]},
  {id:'L1',effect:'复采仍新增无来源的具体反复找东西习惯',grade:'Important',status:'fixed-local-after-final-paid-sample',evidence:[evidence.recorded,evidence.sender],paidRetestAfterLatestFix:false},
  {id:'L2',effect:'复采将新想法写成最近已有的心理过程',grade:'Important',status:'fixed-local-after-final-paid-sample',evidence:[evidence.recorded,evidence.sender],paidRetestAfterLatestFix:false},
];
const report={at:new Date().toISOString(),workspace:'F:/VirtuGene-Mobile',previousGoalTurn:'progress: desktop delivery rechecked; implementation not declared complete',codingModel:'未确认',codingReasoning:'未确认',fullObjectiveAchieved:false,files,usages,total,
  modelConfig:{requestModel:'deepseek-flash',thinking:{type:'enabled'},reasoningEffort:'low',maxOutputTokens:900,responseModelForFull72:'deepseek-flash',responseModelForInitial6:'未确认'},
  budgets:{initial:{used:6,limit:6},full:{used:72,limit:72},furtherPaidCallsPlanned:false,bill:'未确认'},
  evidence:evidenceSummary,findings,
  quality:{transportComplete:true,allOutputQualityAccepted:false,originalComparisonHardFailures:['current/emotion/6','current/continuity/9'],followupHardFailures:['emotion/6: dated mental process','recorded-episode/1: invented recurring habit'],softLimits:['倾诉时仍可能追加劝解或过度追问','人物选择有变化，但未证明长期稳定辨识度'],noSplicedTranscripts:true,noBlanketHumanLikenessScore:true},
  limitations:['最终两种新自述修复后没有追加真实模型调用；本地回归不能冒充最新真实表达验收','对照只有十份冻结sender/receipt/history文件不同，其他代码含当前人设共享；不是历史APK整源对照','无Android、耳机、麦克风、真实播放、声学验证，无手机同条件修改前后录像','桌面publication回调不是实际呈现帧；小样本不提供手机P95承诺','完整27条件、60问和五项交叉风险的逐项终审仍需收尾'],
  reviewerRulings:['只接受本地可执行证据，不把审查代替真实模型评分','硬件验证按计划保留未验证，未运行音频以遵守安静限制','历史APK对照和完整旧源码消融没有证据，不作其结论','编码运行模型与推理强度不可确认，保持未确认','单次重要问题修复按失败→修复→回归收束，不再另派复审'],
  fixtureRulings:['原DBCcore异步计数器返回native Promise，引入PrematureCommit；保留Dexie promise链后原24项并发断言通过，没有修改生产事务','原跨会话迁移测试仅因期待44而拒绝当前47；保留所有原始行/索引/失败回滚断言，固定期待47后通过'],
  version:JSON.parse(readFileSync('package.json','utf8')).version,versionChanged:false,apkBuilt:false,published:false,microphoneUsed:false,deviceTested:false};
const reportPath=join(root,'review/stage-evidence-20261022.json');writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const mobile='D:/月起云归/VirtuGene/手机版';
const transcript=[];
const picks=[{scene:'轻聊与人物偏好',report:reports.comparison,caseId:'light',variant:'current'},{scene:'情绪、转题与认真决定',report:reports.followup,caseId:'emotion',variant:'current'},{scene:'改期、暂停与主动续聊',report:reports.comparison,caseId:'continuity',variant:'current'}];
transcript.push('# 古月娜与唐舞麟 · 连续对话\n','场景：当前用户明确认领唐舞麟；以下各组分别为完整十轮原稿，不表示已达标。\n');
for(const pick of picks){const rows=pick.report.rows.filter(row=>row.caseId===pick.caseId&&row.variant===pick.variant);if(rows.length!==10)throw Error('Whole-group selection is incomplete');transcript.push('## '+pick.scene+'\n');for(const row of rows)transcript.push('chatgpt：'+row.input+'\n','古月娜：'+row.replies.join('\n\n')+'\n');}
writeFileSync(join(mobile,'聊天验收/2026-10-22-古月娜-连续十轮对照.md'),transcript.join('\n'),'utf8');
const log=`\n\n### 完整真实对照、独立复核与修复回归（2026-10-22）\n- 工作目录F:/VirtuGene-Mobile；编码模型与推理强度未确认。上一目标轮归类progress；本轮继续完整T0–T6，不将阶段文档或传输完成当成全部达标。\n- 实际付费：初始6次+完整60次+既定剩余12次复采，共78次；初始6/6、完整阶段72/72已用满，未重置和扩额。请求deepseek-flash、thinking enabled、reasoningEffort low、输出上限900；后72次服务端model也返回deepseek-flash，初始6次未保存该返回字段。提供方输入${total.input}、输出${total.output}（含明确返回reasoning ${total.reasoningWithinOutput}）、总${total.total}，缓存命中${total.cacheHit}/未命中${total.cacheMiss}。实际账单未确认，不估算费用；后续不追加付费调用。Key仍在本机DPAPI私有配置，不进项目、日志或浏览器。\n- 60轮输送完成，但原current情绪第6轮编造旧经历、接续第9轮将自己旧措辞归给用户；不能视为全部质量通过。独立复核另发现同名歧义重读丢失、原始身体旁白漏检、语音assistant历史复核不足和英文所有格误阻。已用原生DB/实际sender复现和修复；英文项按合法回复被阻塞的影响从Minor升为Important。\n- 12次复采包括完整情绪10轮及两处明确标识的原稿上下文重放，没拼入旧60轮。错误归属未再出现；仍出现无来源的反复找东西习惯及最近已有想法。两类新自述已本地修复，最新39项记录回归、47项实际sender检查通过；最新修复后没有追加真实模型，不能声称真实人味已达标。\n- 其他本轮回归：表达3854、类型退出0、话题50、候选48、回复101、导入导出41、账号/同名备份隔离33、跨会话39、并发24、原始对白合同142、主动30、语音跨入口22和语音上下文56通过。路径与SHA以${reportPath}为准。并发首次失败来自测试计数器将Dexie Promise换成native Promise；只改测试包装，原成本/撤权断言保留。跨会话首次仅期待旧schema44，原始资料保留已为真；改为当前47并保留索引/回滚断言。所有失败报告保留。\n- 聊天验收选整组：轻聊与接续选原current十轮，情绪选复采十轮，均较同组其余完整稿更合当前目的，但仍保留其错误原话；完整全部版本在live JSON，不按句拼好稿。技术与局限在本日志，聊天文件只放场景与原话。\n- 改动涉及chat-topic-state-repo、chat-topic-outcomes、chat/output-contract、chat-speaker-source-risk、chat-self-report-risk、chat-output-quality、send-service、voice-call/context及对应验证工具。最新实际sender bundle和依赖hash已保存；不是已装机APK。没有同条件手机截图/录屏，本轮没有正式组件新预览。无版本变更、APK、安装、发布、官网更新或真实麦克风/音频。最终全要求审查仍在进行，整体目标未完成。\n`;
const logPath=join(mobile,'开发日志/2026-10-22.md');
if(!readFileSync(logPath,'utf8').includes('### 完整真实对照、独立复核与修复回归（2026-10-22）'))appendFileSync(logPath,log,'utf8');
const index=join(mobile,'00-总览.md'),indexText=readFileSync(index,'utf8'),indexLine='- [[手机版/开发日志/2026-10-22#完整真实对照、独立复核与修复回归（2026-10-22）|2026-10-22 · 完整对照与独立复核]]：实际78次、320197 tokens；重要缺口已本地修复，最新修复后未复采，完整目标未认定达标；无升版打包发布。';
if(!indexText.includes(indexLine))appendFileSync(index,'\n'+indexLine+'\n','utf8');
const progressPath=join(root,'progress-20261022.json'),progress=read(progressPath);
progress.currentCheckpoint={at:report.at,fullObjectiveAchieved:false,actualProviderRequests:total.requests,inputTokens:total.input,outputTokens:total.output,reasoningTokensWithinOutput:total.reasoningWithinOutput,actualBill:'未确认',initialBudgetRemaining:0,fullBudgetRemaining:0,evidence:reportPath,implementation:{T0:'stock source/performance comparison exists; final source audit pending',T1:'native visit30 passed',T2:'sender47/raw142/recorded39 passed; updated served bundle retained',T3:'ambiguity/source/care fixed; topics50/replies101/roundtrip41/backup33/resume39/races24 pass',T4:'voice continuity22/context56 pass; no hardware audio',T5:'candidate48 and prior persona/cache checks; subjective long-term differentiation unproven',T6:'60 comparison+12 follow-up transport complete, quality defects retained; latest2 fixes local-only; final requirement audit incomplete'},codingModel:'未确认',codingReasoning:'未确认',microphoneUsed:false,deviceTested:false,appVersionChanged:false,releasePublished:false};
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
appendFileSync(join(root,'progress.md'),`\n## Full comparison and final-review fix pass checkpoint\nPrevious goal turn: progress. Current: real60+follow-up12 completed within original72 budget, initial6 unchanged. Total78 actual requests/input311871/output8326/reasoning5647/total320197; bill unconfirmed. Actual72 response model deepseek-flash, thinking enabled/low. No further paid calls.\nFinal: Ruling: English plural-possessive finding is Important, not Minor — valid ordinary replies were blocked, a functional failure; fixed with raw contract regression.\nFinal: fixed ambiguity persistence/replay, raw body narration in roleplay, fresh voice assistant history guards, autobiographical existence and speaker attribution — recorded RED→GREEN and native sender/voice regressions. The source-attribution failure also reproduced in exhausted buffered retries; that final save path now omits only unshown false claims and rechecks the independent remainder.\nReal follow-up found2 further source risks (recurring physical routine and retrospective idea). Recorded39 RED→GREEN and sender47 pass; expression3854/types0 restored after preserving the existing independently sourced habitual-action rule. Latest2 fixes have no additional real-model run; do not mark whole quality accepted.\nFinal: Ruling: reviewer declined hardware/real acoustic/Android/P95 judgment — leave unverified under the plan's conditional device gate and keep quiet/microphone restrictions; cost is no device-level guarantee.\nFinal: Ruling: reviewer declined historical-APK/all-source ablation — preserve limited ten-file paired comparison and its actual served snapshots; cost is no historical release causal claim.\nFinal: Ruling: reviewer declined full60 subjective quality and later executor fixes — report observed defects and local proof, no blanket human score; no re-review dispatch.\nFinal: Ruling: runtime coding model/effort cannot be confirmed — keep unknown rather than infer; provider request/response config recorded separately.\nTest ruling: DBCore instrumentation keeps Dexie promises, preserving all24 native concurrency/cost assertions; no production transaction relaxation. Migration harness now expects current47 with identical raw-row/index/rollback checks (39 pass).\nEvidence: ${reportPath}; all raw originals retained. Full objective active/incomplete; final27/Q60/cross-risk audit remains.\n`,'utf8');
console.log(JSON.stringify({reportPath,total,fullObjectiveAchieved:false,providerRequestsRemaining:0,evidence:evidenceSummary},null,2));
