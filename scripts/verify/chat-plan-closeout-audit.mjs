// Requirement/evidence index for the original plan. It never generates replies.
import {readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-plan-closeout-20261019';
const planPath='C:/Users/34568/Desktop/virtugene plan/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18.md';
const read=path=>JSON.parse(readFileSync(path,'utf8')),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const artifact=path=>({path,sha256:hash(path)});
const docs=(...names)=>names.map(name=>'docs/'+name+'.json');
const evidence={
 T0:docs('CHAT-CONTINUITY-COVERAGE-FIX-2026-10-18','CHAT-REQUEST-RECOVERY-2026-10-18','CHAT-DAILY-STYLE-2026-10-19'),
 T1:docs('CHAT-CONTINUITY-COVERAGE-FIX-2026-10-18','CHAT-REQUEST-RECOVERY-2026-10-18','CHAT-GU-RETRY-CONSISTENCY-2026-10-19'),
 T2:docs('CHAT-ARCHIVE-PAGING-AND-SUMMARY-WIRE-2026-10-19','CHAT-SUMMARY-LEDGER-BATCH-2026-10-19','CHAT-SUMMARY-COVERED-PREFIX-2026-10-19','CHAT-SUMMARY-CAS-2026-10-18'),
 T3:docs('CHAT-SCOPED-CORRECTIONS-2026-10-19','CHAT-ENUMERATED-EXAM-CONTINUITY-2026-10-19','CHAT-CONTINUITY-SOURCE-EVIDENCE-2026-10-19'),
 T4:docs('CHAT-TOPIC-REPLY-EVIDENCE-2026-10-19','CHAT-THREAD-IDENTITY-2026-10-19','CHAT-TOPIC-REOPENING-2026-10-19','CHAT-CONTINUITY-RESUME-2026-10-19','CHAT-CONTINUITY-FOCUS-2026-10-19','CHAT-DAILY-STYLE-2026-10-19'),
 T5:docs('CHAT-SUMMARY-CAS-2026-10-18','CHAT-SETTLEMENT-GUARD-2026-10-18','CHAT-MEMORY-WORKER-2026-10-18','CHAT-LIVE-SOURCE-GUARD-2026-10-19','CHAT-CONTINUITY-SOURCE-EVIDENCE-2026-10-19','CHAT-WORLD-SOURCE-GUARD-2026-10-19','CHAT-BACKUP-ISOLATION-2026-10-19'),
 T6:docs('CHAT-REQUEST-RECOVERY-2026-10-18','CHAT-REPLY-COMMIT-2026-10-18','CHAT-CONTINUITY-SOURCE-EVIDENCE-2026-10-19','CHAT-WORLD-SOURCE-GUARD-2026-10-19','CHAT-GU-RETRY-CONSISTENCY-2026-10-19','CHAT-BACKUP-ISOLATION-2026-10-19'),
 T7:docs('CHAT-DAILY-STYLE-2026-10-19'),
 T8:docs('CHAT-DAILY-STYLE-2026-10-19','CHAT-CONTINUITY-MOBILE-PREVIEW-2026-10-19','CHAT-BACKUP-ISOLATION-2026-10-19','CHAT-CONTINUITY-FOCUS-2026-10-19'),
};
const basis={
 T0:'Current native sender24 trajectories/172 turns; every1100 coverage source entry checked against exact DB id/revision/range; final main payload and26 local gateway forwards. This proves literal availability, not model semantic use.',
 T1:'Complete-turn selector and lower transport21 checks, native tied-timestamp pagination/migration17 checks at1k/10k/50k plus interrupted/recovery and partial-batch/idempotence native reports. history-provenance7 is an evaluation helper check, not evidence that a new marker is enabled in production.',
 T2:'Offset-aware64-row candidates, coverage-difference bridge, source-bound summary CAS, complete-only cursor progression, ledger batching, summary-wire and covered-prefix native120/migration66 evidence. O(N) key selection and cumulative fresh-body verification costs remain explicit; original stop rule does not require a new dirty cursor.',
 T3:'Native scoped-correction55, enumerated exams16, exact thread identity17 and source guard360/write65 reports, plus final C03/C07/C10 transport. Finite explicit scope parsing, not universal semantic correction.',
 T4:'Native exact source-backed answer evidence100/edges19/roundtrip41, topic reopening57, selected precise identity17, cross-session resume39, durable focus20 and scoped affect262. User evidence controls completion, assistant evidence controls only actually committed answer slots.',
 T5:'Actual native writer transactions and late-source/owner/version failures in summary33, worker93, private settlement/commit/live/source guards and two-window restore33. No assertion about independent raw-world producers, group or voice entrypoints.',
 T6:'Existing failed resend/delete/content-editor repository only; same-input reuse, partial replacement and fresh revocation24; same-name/shared-preset/owner conflicts and encrypted backup/restore33; separate private/world source guards. No invented successful-regeneration/rollback UI or old-APK downgrade guarantee.',
 T7:'Current Gu/Lu fact/parameter parity24 sends plus uninterrupted Gu five-turn sequence,262 scoped-routing checks and expression3854. All replies are local canned text; ordinary naturalness, distinct character behavior, reduced repetition and absence of fabricated experience are NOT proven by these checks.',
 T8:'Actual native24/172 corpus and source/branch reports; fresh actual Gu ChatWindow30 checks at320/360/390/414 and16/22px plus visually verified decoded42.24/42.52s frames. New-context local-only UI is a desktop mobile viewport, not Android. Actual whole-dialogue model/human scores absent.',
};
const lines=readFileSync(planPath,'utf8').split(/\r?\n/u);let stage;const requirements=[],counts={};
for(let index=0;index<lines.length;index++){
 const heading=/^### (T[0-8])：/u.exec(lines[index]);if(heading)stage=heading[1];
 if(/^## 7\./u.test(lines[index]))stage=undefined;
 const checkbox=/^- \[ \] (.+)$/u.exec(lines[index]);if(!stage||!checkbox)continue;
 const item=counts[stage]=(counts[stage]??0)+1;
 let status='proven-in-listed-local-fixtures';
 if(stage==='T7')status='local-contract-tested-genuine-output-unverified';
 if(stage==='T8'&&item===1)status='local-orchestration-proven-genuine-output-unverified';
 if(stage==='T8'&&item===7)status='optional-android-not-run-no-package-authorized';
 requirements.push({id:stage+'.'+item,stage,sourceLine:index+1,text:checkbox[1],status,basis:basis[stage],evidence:evidence[stage].map(artifact)});
}
if(requirements.length!==47)throw Error('Plan task checkbox count changed; review original scope instead of guessing');
const tracePath='release/chat-continuity-trace-2026-10-19T08-33-59-102Z/baseline.json',trace=read(tracePath);
if(!trace.complete||trace.rows.length!==24)throw Error('Missing final trace');
const coverage=[],checks=[];const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
let turns=0;
for(const trajectory of trace.rows)for(const turn of trajectory.turns){
 turns++;const originals=new Map(turn.databaseSources.map(source=>[source.id,source]));
 check(trajectory.character+'/'+trajectory.id+'/'+turns+' native current input has source id/revision',originals.get(turn.current.messageId)?.content===turn.input&&turn.current.revision===(originals.get(turn.current.messageId)?.revision??1));
 for(const attempt of turn.attempts){
  check(trajectory.character+'/'+trajectory.id+'/'+turns+' actual current input once at final boundary',attempt.messages.at(-1)?.role==='user'&&attempt.messages.at(-1).content===turn.input&&attempt.messages.filter(message=>message.role==='user'&&message.content===turn.input).length===1);
  for(const source of attempt.coverage){const original=originals.get(source.messageId);
   check(source.messageId+' explicit provenance interval bounds',!!original&&(source.provenRanges??[]).every(range=>range.messageId===source.messageId&&range.revision===(original.revision??1)&&range.start>=0&&range.end>range.start&&range.end<=original.content.length));
   check(source.messageId+' every literal gap has a reason',(source.gaps??[]).every(gap=>typeof gap.reason==='string'&&gap.reason.length>0));
   coverage.push({trajectory:trajectory.id,character:trajectory.character,turn:turns,attempt:attempt.attempt,messageId:source.messageId,revision:source.revision,role:source.role,length:source.length,provenRanges:source.provenRanges,gaps:source.gaps});
  }
 }
}
check('exactly172 synthetic native turns',turns===172);check('1100 source coverage entries actually inspected',coverage.length===1100);
writeFileSync(root+'/coverage-ledger.json',JSON.stringify({trace:artifact(tracePath),scope:trace.coverageLimit,coverage},null,2)+'\n');
const log=path=>readFileSync(path,'utf16le').replace(/^\uFEFF/u,'');
const boundaryPath=JSON.parse(log(root+'/boundary.log').trim().split('\n').at(-1)).evidence;
const gatewayPath=JSON.parse(log(root+'/gateway.log').trim().split('\n').at(-1)).evidence;
const boundary=read(boundaryPath),gateway=read(gatewayPath),selector=read(root+'/coverage-checks.json');
check('fresh history selector21 checks',selector.checks===21);
check('fresh native history pagination17 with50000-message fixture',log(root+'/history-pagination.log').includes('"checks":17')&&log(root+'/history-pagination.log').includes('"messages":50000'));
check('fresh evaluation-only provenance helper7',log(root+'/history-provenance.log').includes('PASS history-provenance: 7'));
check('fresh pure boundary has zero missing complete turns/gaps',!boundary.knownFailures.longCorrectionMissing&&!boundary.knownFailures.separateBatchTurnSourcesMissing&&!boundary.remainingBoundaryGaps.length);
check('real isolated gateway26 synthetic forwards and24 final histories unchanged',gateway.complete&&gateway.rows.length===26&&gateway.rows.slice(0,24).every(row=>row.historyUnchanged));
const studyPath='release/chat-continuity-study-20261019/frozen-requests.json',study=read(studyPath);
check('original section10 eight frozen requests, within budget and unexecuted',study.complete&&study.requests.length===8&&study.totalUtf8Bytes<=24000&&study.paidCalls===0&&study.networkCalls===0&&study.modelOutputs.length===0);
const credentialPresence={DEEPSEEK_API_KEY:!!process.env.DEEPSEEK_API_KEY,AI_GATEWAY_TOKEN:!!process.env.AI_GATEWAY_TOKEN,API_KEY:!!process.env.API_KEY,knownServerEnvExists:existsSync('server/.env')};
const sources=['src/lib/chat/send-service.ts','src/lib/chat-history-window.ts','server/chat-history-policy.mjs','server/gateway.mjs','src/db/chat-summary-archive.ts','src/db/memory-ledger-repo.ts','src/db/session-summary-repo.ts','src/lib/chat-scoped-facts.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat-conversation-state.ts','src/db/chat-topic-state-repo.ts','src/lib/continuity-sources.ts','src/db/chat-reply-attempt-repo.ts','src/db/memory-invalidation.ts','src/lib/world/world-source-guard.ts','src/lib/sync.ts','src/lib/sync-ownership.ts','src/lib/chat-expression-guidance.ts','src/lib/gu-yue-na-runtime.ts','src/lib/lu-xue-qi-runtime.ts','src/components/chat/ChatWindow.tsx'].map(artifact);
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',previousGoalTurn:'progress: scoped emotional recovery/courtesy bugs fixed,262 RED→GREEN, native29 sends and final UI30 checks; not complete',
 plan:artifact(planPath),requirements,stageCounts:counts,fullPlanComplete:false,completionProven:false,localAuditChecks:checks,
 freshEvidence:{trace:artifact(tracePath),coverageLedger:artifact(root+'/coverage-ledger.json'),boundary:artifact(boundaryPath),gateway:artifact(gatewayPath),selector:artifact(root+'/coverage-checks.json'),pagination:artifact(root+'/history-pagination.log'),provenanceEvaluationOnly:artifact(root+'/history-provenance.log'),daily:artifact('docs/CHAT-DAILY-STYLE-2026-10-19.json')},currentProductionSnapshot:sources,
 requiredCommands:[{command:'node scripts/verify/history-pagination.mjs',exitCode:0,checks:17},{command:'node scripts/verify/history-provenance.mjs',exitCode:0,checks:7,scope:'evaluation helper, not a newly enabled production marker'},{command:'node scripts/verify/chat-history-coverage.mjs '+root+'/coverage-checks.json',exitCode:0,checks:21},{command:'node scripts/verify/chat-continuity-boundary-trace.mjs --require-complete-turns',exitCode:0},{command:'node scripts/verify/chat-continuity-gateway-trace.mjs '+tracePath,exitCode:0,localUpstreamRequests:26},
  {command:'node scripts/verify/chat-continuity-study-prepare.mjs',exitCode:0,checks:19,paidRequests:0}],
 originalResearch:{prepared:artifact(studyPath),requestCount:8,totalUtf8Bytes:study.totalUtf8Bytes,executionStatus:'not-executed',realResponses:0,criteria:'Four complete six-turn A/B histories using a compact synthetic Gu persona. Same history/question and source-bound manually written B state. No production/persona quality comparison claimed.',credentialPresence,credentialValuesReadOrPrinted:false,noCredentialSearch:true,paidRequests:0,inputTokens:0,outputTokens:0,costUSD:0},
 invariants:{sameOwnerSourceVersionChecksKept:true,noCrossTurnPermissionCacheAdded:true,partialRetriesNotDuplicated:true,rollbackEvidence:'Each original phase has scoped before snapshots/production patches; no revert, staging or commit of the shared dirty worktree.',schema:'Existing native43→44 migration/abort/backup evidence retained; no new schema or app version changes this turn.',ordinaryStock:'Same full synthetic native fixture/model messages and exact body counts were verified in daily-style report.48.5→58.2ms desktop observations are a9.7ms noisy increase, not a speedup or phone guarantee.',summaryCost:'O(N) source keys and cumulative fresh body validation remain limits; not hidden or solved by a new unplanned cursor.'},
 outstanding:[{id:'T7-output',status:'unverified',requirement:'Whole trajectories should be more natural and distinguish Gu/Lu while facts/outcomes remain correct.',needed:'Actual generated outputs from a confirmed configured model and whole-trajectory human scoring. Canned local replies cannot prove this.'},
  {id:'T8-human',status:'unverified',requirement:'Human assessment of full fixed trajectories without selecting/combining best sentences.',needed:'Complete real output trajectories with conditions, actual model, usage, failures and source provenance.'},
  {id:'section10',status:'prepared-not-executed',requirement:'Bounded optional8-call A/B research with raw responses/actual model/usage/cost.',needed:'A confirmed usable model connection and fresh official alias/pricing check before any authorized paid request. No current safe credential entry found; never revive historical pasted keys or scan browser/private storage.'}],
 notAddedAsGates:['Android remains optional.','Independent raw-world producers/group/voice are separate scope.','No new durable dirty-aware cursor or unrelated feature.','No successful-regeneration/rollback UI invented.','No universal emotion/correction semantics claim beyond fixtures.'],
 artifactLimits:['Historical phase reports retain their original failures/limitations; newer evidence supersedes only the matching covered cases, not every semantic claim.','Source/range ledger proves literal availability and identity, not the model reading, obeying, or feeling natural.','Raw synthetic test replies stay in project evidence, not Obsidian聊天验收.','Sidebar project ownership remains officially unconfirmed; no internal Codex storage touched.'],
 result:'Local original-scope implementation/fixtures, transport/gateway/coverage and current preview evidence audited. Full objective is NOT achieved: genuine output and human character/naturalness acceptance remain absent. Do not add more local tests as a substitute.',
 noVersionPackageInstallDeployPublish:true,modelRequestsThisTurn:0,sourceHeadersOrCredentialsStored:false};
const path='docs/CHAT-PLAN-CLOSEOUT-AUDIT-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const task of progress.tasks){task.evidence=[...new Set([...(task.evidence??[]),path])];
 if(['T0','T1','T2','T3','T4','T5','T6'].includes(task.id)){task.status='original-local-fixtures-audited-genuine-dialogue-unverified';task.remaining=task.id==='T2'?'Original offset/bridge/CAS/covered-source and fresh summary/ledger cost audit recorded. O(N) key/final-body costs remain measured limitations; no new cursor gate. Genuine model/human integration not certified.':'Original local/native supported requirements audited; genuine model semantic use and complete human whole-dialogue acceptance remain unverified. Finite fixtures do not prove universal behavior.';}
}
progress.completionAudit={path,sha256:hash(path),requirements:requirements.length,fullPlanComplete:false,remaining:report.outstanding.map(row=>row.id)};
progress.next='Original local implementation audit complete within listed fixtures. Genuine model output/human scoring and the prepared bounded study need a usable confirmed model connection. Do not repeat green local suites or invent new directions to replace the missing evidence.';
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const appendOnce=(target,marker,body)=>{if(!readFileSync(target,'utf8').includes(marker))appendFileSync(target,body);};
appendOnce('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md','### 原方案逐项收尾：47条任务与真实输出缺口',
 '\n### 原方案逐项收尾：47条任务与真实输出缺口\n'+
 '- 工作目录F:/VirtuGene-Mobile；编码模型／推理强度未确认。本轮无生产代码修改；历史覆盖验证脚本仅新增可指定结果路径，避免覆盖原证据，新增原方案A/B输入准备器和收尾审计。逐条引用原方案47条任务、原生报告／SHA和限制，见项目'+path+'。不是把测试计数当全目标达标。\n'+
 '- 重新运行计划明确要求的历史分页17（1千／1万／5万同毫秒资料）、来源标记评估辅助7（不代表生产开启该标记）、完整轮次21、近期桥接／24000字符编译边界。实际网关→本地假上游26次：24组正常请求历史保持一致，另外测系统尾部及超限当前输入。无真实上游调用。\n'+
 '- 逐一核原生24组172轮的1100项DB来源id／revision／区间，范围无越界、当前输入只追加一次、无未解释字面缺口。它证明字面资料可达，不证明模型实际利用或人物表达。原覆盖修复、纠正、回答证据、焦点、CAS、重发和备份报告按对应范围汇总，不复写历史局限。\n'+
 '- 准备第10节明确限定的4组／8请求：古月娜简化合成人设，完整6轮历史，A/B问题与历史完全相同，B仅人工归纳相同用户原文并保留引用。19项准备检查通过，全序列化UTF8共10996字节，低于保守24000字节线。只是未执行策略原型，非完整生产人格／自动抽取器基线；模型原稿／评分为空。未新加执行探测、重试、摘要或评委调用。\n'+
 '- 仅核当前进程DEEPSEEK_API_KEY／AI_GATEWAY_TOKEN／API_KEY是否存在和已知server/.env文件，均无；没有读取或输出值、扫描私人资料／浏览器、复用历史粘贴密钥。真正生成需要可用的已确认模型连接，再核官方别名／价格。真实输出／全轨迹人工自然度和人物差异评分仍是未完成项，不能以新增本地机制代替。\n'+
 '- 现有生产捕获配置deepseek-flash、thinking enabled／low，均只到本地替身；第10节未执行研究另为disabled／.8／非流式／300输出，不能冒称生产基线。本轮0付费／0输入输出token／0费用，编码实际用量未确认。无麦克风／音频、升版、应用构建、APK、安装或发布；无本轮同条件前后截图。原阶段30项组件预览与录屏只按其已有证据保留。\n');
appendOnce('D:/月起云归/VirtuGene/手机版/00-总览.md','原方案47条收尾审计',
 '\n- 2026-10-19 原方案47条收尾审计：原生24组172轮1100来源区间核验、历史17／7／21与本地网关26次通过；第10节8个A/B请求已冻结但未执行。真实模型输出和全轨迹人物自然度人工评分缺失，完整目标未达标。见[[手机版/开发日志/2026-10-19|当日开发日志]]及项目docs/CHAT-PLAN-CLOSEOUT-AUDIT-2026-10-19.json。未升版／打包／发布。\n');
console.log(JSON.stringify({path,requirements:requirements.length,stageCounts:counts,coverageEntries:coverage.length,checks:checks.length,realModelCalls:0,fullPlanComplete:false,remaining:report.outstanding.map(row=>row.id)}));
