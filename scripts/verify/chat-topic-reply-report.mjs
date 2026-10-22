import {readFileSync,writeFileSync,readdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root='release/chat-topic-replies-20261019';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const production=['src/lib/chat-topic-replies.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat-conversation-state.ts','src/db/chat-topic-state-repo.ts','src/db/index.ts','src/lib/chat/send-service.ts'];
const testFiles=['scripts/verify/chat-topic-replies.ts','scripts/verify/chat-topic-replies.mjs','scripts/verify/chat-topic-reply-edges.mjs','scripts/verify/chat-topic-reply-roundtrip.ts','scripts/verify/chat-topic-reply-roundtrip.mjs','scripts/verify/chat-topic-reply-performance.ts','scripts/verify/chat-topic-reply-performance.mjs','scripts/verify/chat-reply-commit.ts','scripts/verify/chat-request-recovery.mjs','scripts/verify/chat-topic-wiring.ts'];
const latest=(prefix,accept)=>{
 for(const name of readdirSync(root).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort().reverse()){
  const path=root+'/'+name,value=read(path);if(accept(value))return {path,value};
 }throw Error('Missing verified evidence: '+prefix);
};
const sourceCurrent=value=>Object.entries(value.sourceHashesAfter??{}).every(([path,sha])=>hash(path)===sha);
const current=latest('current-',value=>value.complete&&value.checks.length===100&&value.stableSources&&value.stableEffectiveSources&&sourceCurrent(value));
const baseline=latest('red-',value=>value.beforeMode&&value.stableEffectiveSources&&sourceCurrent(value)
 &&['scripts/verify/chat-topic-replies.ts','scripts/verify/chat-topic-replies.mjs'].every(path=>value.sourceHashesAfter[path]===current.value.sourceHashesAfter[path]));
const retryRed=latest('legacy-retry-',value=>value.legacyRetrySource&&value.checks.length===100&&value.failures.length===1
 &&value.failures[0].name==='failed-source-successful-retry-records-answer-evidence'&&sourceCurrent(value));
const edges=latest('edges-',value=>value.complete&&value.checks.length===19&&value.stableSources&&sourceCurrent(value));
const roundtrip=latest('roundtrip-',value=>value.complete&&value.checks.length===41&&value.stableSources&&sourceCurrent(value));
const performance=latest('performance-',value=>value.complete&&value.changedDuringRun.length===0
 &&Object.entries(value.sourceHashes).every(([path,sha])=>hash(path)===sha));
for(const record of [current,baseline,retryRed,edges,roundtrip,performance])if(record.value.blockedRequests||record.value.apiCalls||record.value.paidCalls)throw Error('Unexpected network/paid call: '+record.path);
const median=values=>{const sorted=values.toSorted((a,b)=>a-b);return (sorted[(sorted.length-1)>>1]+sorted[sorted.length>>1])/2;};
const returned=(sample,stage,table)=>Object.entries(sample.reads).filter(([key])=>key.startsWith(stage+':')&&(!table||key.startsWith(stage+':'+table+'.'))).reduce((sum,[,value])=>sum+value.returnedBodies,0);
const perfSamples=performance.value.phases.flatMap(phase=>phase.samples);
for(const field of ['fixtureSha256','historySha256','currentUserSha256','userFactsBeforeSha256','userFactsAfterSha256'])if(new Set(perfSamples.map(sample=>sample[field])).size!==1)throw Error('Changed stock/input/user facts: '+field);
const perf=performance.value.phases.map(phase=>({phase:phase.phase,checks:phase.checks.length,transports:[...new Set(phase.samples.map(sample=>sample.transport))].map(transport=>{
 const samples=phase.samples.filter(sample=>sample.transport===transport);
 if(samples.length!==4)throw Error('Expected four samples per transport');
 return {transport,samples:4,medianMs:Object.fromEntries(['requestMs','firstTransportBodyMs','firstStreamSnapshotMs','fullSendMs'].map(key=>[key,median(samples.map(sample=>sample[key]))])),
  returnedBodies:{preRequestTotal:[...new Set(samples.map(sample=>returned(sample,'pre-request')))],preRequestMessages:[...new Set(samples.map(sample=>returned(sample,'pre-request','messages')))],postResponseTotal:[...new Set(samples.map(sample=>returned(sample,'post-response')))],postResponseMessages:[...new Set(samples.map(sample=>returned(sample,'post-response','messages')))],tombstones:[...new Set(samples.map(sample=>returned(sample,'pre-request','memorySourceTombstones')+returned(sample,'post-response','memorySourceTombstones')))],diaries:[...new Set(samples.map(sample=>returned(sample,'pre-request','diaries')+returned(sample,'post-response','diaries')))]}};
})}));
const requireLog=(name,pattern)=>{const path=root+'/'+name+'.log';if(!pattern.test(readFileSync(path,'utf8')))throw Error('Inspect regression: '+path);return {path,sha256:hash(path),exitCode:0};};
const regressions={
 topics:{checks:45,...requireLog('topics-final',/"passed":true,"checks":45/)},
 races:{checks:24,...requireLog('races-final',/"complete":true,"checks":24/)},
 wiring:{checks:32,...requireLog('wiring-final',/"complete":true,"checks":32/)},
 replyCommit:{checks:69,...requireLog('reply-commit-final',/"complete":true,"checks":69/)},
 liveSources:{checks:63,...requireLog('live-sources-final',/"complete":true,"checks":63/)},
 recovery:{checks:28,...requireLog('recovery-final',/"complete":true,"checks":28/)},
 stream:{checks:265,...requireLog('stream-final',/PASS chat-stream: 265 checks/)},
 types:{...requireLog('types-final',/^\s*$/)},
};
let patch='';
for(const path of [...production.filter(path=>path!=='src/lib/chat-topic-replies.ts'),'scripts/verify/chat-topic-wiring.ts','scripts/verify/chat-reply-commit.ts','scripts/verify/chat-request-recovery.mjs']){
 const before=root+'/before/'+path,result=spawnSync('git',['diff','--no-index','--',before,path],{encoding:'utf8'});
 if(result.status>1)throw Error(result.stderr);patch+=result.stdout+'\n';
}
const added=spawnSync('git',['diff','--no-index','--','NUL','src/lib/chat-topic-replies.ts'],{encoding:'utf8'});
if(added.status>1)throw Error(added.stderr);patch+=added.stdout;
writeFileSync(root+'/production-and-regression.patch',patch);
const report={date:'2026-10-19',workspace:process.cwd(),plan:'C:/Users/34568/Desktop/virtugene plan/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18.md',
 stage:'T4 bounded, source-backed role response evidence; T5 atomic new-response commit; T6 response invalidation',fullPlanComplete:false,actualModel:'未确认',actualReasoningEffort:'未确认',
 production:production.map(path=>({path,sha256:hash(path),...(path==='src/lib/chat-topic-replies.ts'?{added:true}:{before:{path:root+'/before/'+path,sha256:hash(root+'/before/'+path)}})})),
 verificationSources:testFiles.map(path=>({path,sha256:hash(path)})),patch:root+'/production-and-regression.patch',
 implemented:[
  'Keep user facts, current slots and completion/cancellation user-sourced. Role speech is a separate bounded record, never an event completion or user confirmation.',
  'At most two response batches per topic and four per session, actual saved spans plus initiating user revision. responded/asked are distinct; answered-slot only matches narrow whole affirmative sentences against existing user-sourced slots.',
  'Persist completion metadata on normal and catch-partial paths; undefined legacy metadata is not retrospectively interpreted as a complete answer.',
  'Construct evidence from freshly stored user and assistant rows inside reply transaction; new role evidence CAS fails atomically with the message batch. Ordinary auxiliary rhythm without a new role record remains post-commit best effort.',
  'Revalidate selected IDs, roles, same session, source versions/ranges, complete batch metadata and scoped suppressions in one bounded batch. Stale role sources remove role evidence independently of valid user facts.',
  'Prompt rendering gives user facts priority over role diagnostics and excerpts. New user questions and corrections remain authoritative; no hard ban on asking an old question again.',
 ],
 evidence:{current:{path:current.path,checks:100},frozenBefore:{path:baseline.path,checks:baseline.value.checks.length,expectedFailures:baseline.value.failures.length},
  retryCausalRed:{path:retryRed.path,checks:100,expectedFailures:1},edges:{path:edges.path,checks:19},roundtrip:{path:roundtrip.path,checks:41},performance:{path:performance.path,checks:performance.value.checks.length+performance.value.phases.reduce((n,phase)=>n+phase.checks.length,0)},
  partialCausalRed:root+'/partial-causal-final.log',substringAndBudgetRed:root+'/edges-1792379431829.json',nextPersistentSourceRed:{path:'release/chat-continuity-sources-20261019/probe-1792380141730.json',checks:19,safetyFailures:4,fixed:false},historicalFixtureCorrections:[root+'/current-1792378880973.json',root+'/wiring-diagnostic.log',root+'/reply-commit.log',root+'/reply-partial-diagnostic.log']},
 regressions,
 observedBeforeAfter:[
  'Frozen pre-feature sender does not persist response evidence; current actual sender retains it beyond twelve filler turns, outside recent history/raw bridge, and a fresh same-origin page uses it in the next actual provider payload.',
  'Failure retry clears failed in DB before generation; using the stale failed:true argument omitted evidence. Current transaction uses its fresh stored user row; isolated old-argument overlay reproduces only that failure.',
  '14点半/114点/14点前 were false answered=14点 via substring. Exact whole-sentence matching now leaves them responded; 14点/是14点/时间定在14点 remain answered.',
  'New diagnostics once displaced fitting user facts at350 characters; current rendering retains the user-confirmed date/time/transport within the same budget.',
  'A catch-partial can contain only the first visible bubble even if the provider had queued more; persist exactly the visible prefix, mark all retained rows interrupted and mirror the actual stored rows in UI.',
  'Real collectSyncData→JSON→delete isolated database→importSyncData retains fields. Source edits/deletes and old package reimport never restore valid response evidence. Stale raw conversation may remain stored; read validation filters it.',
 ],
 performance:{fixture:perfSamples[0].fixture,fixtureSha256:perfSamples[0].fixtureSha256,historySha256:perfSamples[0].historySha256,currentUserSha256:perfSamples[0].currentUserSha256,
  samples:16,results:perf,completePayloadUnchanged:false,reason:'After system intentionally includes role response annotation. History/current user/existing user facts/source evidence are unchanged; this is not a pure query optimization.',
  limits:'Desktop native isolated IndexedDB and local simulated transport; four samples per phase/transport, no speedup claim. First JS stream callback is not decoded visual first display. Returned rows include repeated reads. Existing private synthetic diary reads80 remain; unrelated8105 tombstones are not scanned by selected verification.'},
 correctionsAndRulings:[
  'The initial global atomic-conversation change broke existing post-commit-state-error behavior; only new role evidence is now atomic. A failed auxiliary rhythm write cannot undo an ordinary delivered reply.',
  'One fixture had unplanned voice-sample background requests and provider recovery retries; all were loopback blocked/stubbed, no paid calls. Fixture-only persona samples and explicit failure budget corrected those tests; original failures retained.',
  'The source can be rejected by the history guard before the topic guard. Wiring test now accepts those two exact errors with zero persisted replies, never a generic success/error exemption.',
  'An initial interruption assertion assumed two bubbles, while only one had been displayed. Corrected to match the actual visible prefix; the separate final causal overlay removing just completion metadata remains RED.',
 ],
 remaining:[
  'Persistent ContinuityThread exact identity/source-revision linkage and post-edit/delete revalidation are not implemented in this stage. Cross-session reuse is not established by same-session page reload.',
  'General semantic answer detection, all named topic focus forms, scoped preferences/time/domain correction and all asynchronous producers/branches remain incomplete.',
  'Old messages without completion metadata are preserved but not backfilled as answered. Malformed role-record shape can drop all role evidence for that validation read; user facts still independently survive.',
  'Local sync functions tested; backup archive format, real network sync, real models, human voice scoring and Android not verified.',
  'No same-condition product screenshots/recordings or new right-panel preview in this backend stage. T8 four styled actual-component viewports/decoded recording remain.',
  'T2 durable dirty-aware positioning and cumulative final source-body cost remain; overall T0–T8 completion has not been claimed.',
 ],
 usage:{upstreamModelCalls:0,inputTokens:0,outputTokens:0,modelFees:0,codexModelAndCost:'未确认',syntheticOnly:true},
 boundaries:{privateDataRead:false,microphone:false,audio:false,device:false,appVersionChanged:false,databaseSchemaChangedThisStage:false,build:false,apk:false,install:false,deploy:false,publish:false,officialWebsiteChanged:false,librarySaved:false,sidebarProjectVerified:false},
};
for(const key of ['current','frozenBefore','retryCausalRed','edges','roundtrip','performance'])report.evidence[key].sha256=hash(report.evidence[key].path);
const reportPath='docs/CHAT-TOPIC-REPLY-EVIDENCE-2026-10-19.json';writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T4','T5','T6']){const task=progress.tasks.find(task=>task.id===id);task.evidence??=[];if(!task.evidence.includes(reportPath))task.evidence.push(reportPath);}
progress.tasks.find(task=>task.id==='T4').remaining='Bounded actual response evidence implemented. Persistent exact thread identity/source linkage, general semantic answers, all topic focus forms and scope/domain correction remain.';
progress.next='Continue T4/T6 persistent-thread source revision and exact identity validation; T2 durable positioning/cumulative source cost, T3 corrections and T5/T7/T8 audit remain.';
progress.fullPlanComplete=false;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const note=`\n\n## 连续性方案 T4：角色实际回应证据、原子提交与失效\n\n- 工作目录F:/VirtuGene-Mobile；实际编码模型/推理强度均未确认。仅推进既有方案，源快照与独立隔离回归，不自动提交或覆盖共享dirty代码。全T0–T8仍未完成。\n- 用户事实与角色说过的话分开：每题最多2批/会话最多4批，记录实际已保存批次、问句来源、revision和字符范围。answered只接受已知用户槽位的狭义整句肯定回答，不由角色关闭事件；复杂表达只记responded。原文编辑/删除/抑制后角色证据单独失效，仍有效的用户安排保留。\n- 新增replyCompletion可选元数据，旧记录不猜回填。完整新response与消息同事务CAS；无新response的节奏辅助写仍提交后尽力，已纠正中途绑定过紧导致的post-commit-state-error回归。失败重发使用事务内fresh用户行，不用旧failed:true输入。catch中断只保存已显示前缀并标记interrupted。\n- 当前100项实际发送/重开页/多批次/来源与事务检查，19边界，41真实本地sync往返，189存量性能断言通过；既有topics45、races24、wiring32、replyCommit69、liveSources63、recovery28、实际ChatWindow stream265、tsc退出0。模型全为合成transport，无真实人味评分。\n- RED与过程问题保留：14点半误答14点、350预算诊断挤掉用户事实、旧failed:true重发漏回复证据已逐项修；最终旧重发参数overlay100项仅1失败。旧baseline${baseline.value.checks.length}项/${baseline.value.failures.length}预期失败。fixture背景声音请求/恢复次数、先触发history guard、只显示1泡却预期2泡均有明确夹具修正，不当作额外产品缺陷。\n- 性能同512存量消息+当前1、8105跨角色失效、40私密合成日记、7话题、200加载消息；16样本。buffered准备25.10→24.10ms/首JS60.20→58.50/整轮69.90→69.50；SSE准备21.30→21.95/首JS52.45→53.00/整轮130.40→129.75。不是提速结论或Android，首JS不是解码画面。请求前返回行157→163（消息49→55），回复后228→239（消息209→220），墓碑4→4/日记80→80；重复读取计入。已有私密日记候选查询仍在，未进payload。\n- 完整fixturehash ${perfSamples[0].fixtureSha256}；history/currentuser/userfacts/source前后相同，但after system新增角色记录，完整payload有意不同，不冒称纯查询同payload提速。同步导入可能保存原始旧response，实际读取边界过滤；未测备份归档文件/真实同步网络。\n- 生产改动与before/after SHA、patch、全部原始失败/成功见${reportPath}及release/chat-topic-replies-20261019/。本阶段没有同条件软件UI图/视频或新右栏预览。persistent thread仍缺来源revision/精确对象联动，不把页面重开说成跨session完成；T7人物/T8四视口及整体轨迹仍待验。\n- 上游0调用/0输入输出tokens/0费用；Codex用量费用未确认。无私人聊天/密钥扫描、音频/麦克风/设备、版本/schema/APK/安装/部署/发布/官网变更；无Library成功保存/官方侧栏归属验证。\n`;
if(process.argv.includes('--obsidian')){
 const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',index='D:/月起云归/VirtuGene/手机版/00-总览.md';
 if(!readFileSync(log,'utf8').includes('## 连续性方案 T4：角色实际回应证据、原子提交与失效'))appendFileSync(log,note);
 if(!readFileSync(log,'utf8').includes('后续persistent来源实际RED已确认'))appendFileSync(log,'\n- 后续persistent来源实际RED已确认：release/chat-continuity-sources-20261019/probe-1792380141730.json，19项中4项安全期望失败；真实messageRepo编辑revision1→2或删除原文后，已选重核验与fresh召回仍接受旧thread。selected阶段只bulkGet(thread.id)，没读取sourceMessageId；账号/status对照正常拒绝。派生continuity worldEvent和catalog也待同源闸门审计，未伪称本阶段已修。下一步补分来源revision/session/range证据，legacy不猜回填，保留原记录。\n');
 const line='\n- [[手机版/开发日志/2026-10-19|2026-10-19 · T4角色实际回应证据]]：100发送/19边界/41同步/189性能及相关回归通过，用户事实与角色话语分层；跨session线程来源、人物与四视口未完成，零API/版本/打包发布。\n';
 if(!readFileSync(index,'utf8').includes('T4角色实际回应证据'))appendFileSync(index,line);
}
console.log(JSON.stringify({report:reportPath,production:production.length,checks:{sender:100,edges:19,sync:41,performance:report.evidence.performance.checks},regressions:Object.fromEntries(Object.entries(regressions).map(([name,value])=>[name,value.checks??value.exitCode])),fullPlanComplete:false,apiCalls:0},null,2));
