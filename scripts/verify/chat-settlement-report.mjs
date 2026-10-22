import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-settlement-guard-20261018/';
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const log=path=>readFileSync(root+path,'utf8').replace(/^\uFEFF/,'');
const accepted=readdirSync(root).filter(path=>/^live-\d+\.json$/.test(path)).sort().reverse().find(path=>{const result=json(root+path);return result.complete&&result.checks.length===70;});
assert.ok(accepted);const live=json(root+accepted),stock=live.rows.find(row=>row.scenario==='stock-guard-only');
assert.equal(stock.reads['messages.getMany'].returned,96);assert.equal(stock.reads['messages.count'].calls,2);
for(const [path,pattern] of [['red.log',/same successful source batch/],['restore-red.log',/derived state on restore/],['analysis-red.log',/analysis-account/],['local-write-red.log',/memory-write-failure/],['duplicate-view-red.log',/duplicate manual click/],['thread-red.log',/manually set aside/],['failed-user-red.log',/provider-failed user utterance/],['new-message-red.log',/derived state on new-message/],['summary-accepted.log',/PASS chat-summary-entry: 73/],['wiring-accepted.log',/"complete":true,"checks":32/],['stream-accepted.log',/PASS chat-stream: 265/]])assert.match(log(path),pattern);
assert.equal(log('types-final3.log').trim(),'');
const memory=json(root+'memory-regressions.json');assert.deepEqual(memory.map(row=>[row.suite,row.passed,row.checks]),[['memory-continuity',true,77],['memory-final',true,48],['character-memory',true,415]]);
const files=['src/db/chat-auxiliary-guard.ts','src/db/index.ts','src/db/continuity-repo.ts','src/store/emotion-store.ts','src/lib/sync.ts','scripts/verify/chat-settlement-live.ts','scripts/verify/chat-settlement-memory-regressions.mjs','scripts/verify/chat-request-recovery.mjs'];
const report={date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',stage:'T5 private settlement/manual analysis sources, atomic derivatives and continuity mutation fence',fullPlanComplete:false,
 files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),beforeSnapshots:root+'before/',
 implementation:[
  'Capture original account, owned private character/session, bounded original source versions, conversation version, auxiliary revision, checkpoint, source count and character continuity revision before generation.',
  'Repeat fresh selected-source/ownership checks before generation and inside the native transaction. Account changes during writes roll back the transaction.',
  'All authoritative local settlement writes, nested ledger/world writes and checkpoint/auxiliary revision share the transaction. Local write failure no longer leaves partial emotion/affinity state.',
  'An already-settled user checkpoint prevents repeated affinity/snapshot work and another generation on the same batch. Independent native commits at one revision have a single winner.',
  'Memory/thread evidence must contain valid direct user message indexes. Assistant-only or missing indexes cannot create a durable user fact; this is provenance, not proof of semantic accuracy.',
  'Failed delivery does not retract a user utterance; failed assistant text and composed dispatch remain excluded.',
  'Manual analysis uses the same fresh source checks; duplicate clicks keep the valid in-flight result and no extra generation. UI publication follows commit and current view/account.',
  'Optional CharacterState.continuityRevision advances in the same transaction as create/complete/drop/reopen/edit/remove/bulk-clear. A late settlement cannot reopen an item manually set aside.',
  'Continuity bookkeeping preserves affinity, mood and life focus, uses one primary-key state row and creates no orphan state for a removed character.',
  'Optional Session.auxiliaryRevision is advanced on existing-session restore/import to invalidate waiting work. No schema, dependency or product version change.'
 ],
 verification:{actualSettlementAndAnalysis:{checks:70,evidence:root+accepted,syntheticOnly:true,includes:['valid outputs/world derivation','duplicate batch','conversation correction','new unprocessed input','source edit/delete/revocation','account/actor/private-session transfer','newer checkpoint','mid-write account rollback','same-record restore','local failure rollback','manual analysis source/account/duplicate UI','native CAS race','manual thread pause while waiting','all continuity mutation counters','same-name role isolation','failed user fact retention','512-message/8105-suppression selected reads']},memoryRegressions:{checks:540,suites:memory,evidence:root+'memory-regressions.json'},summaryEntry:{checks:73,log:root+'summary-accepted.log'},topicWiring:{checks:32,log:root+'wiring-accepted.log'},stream:{checks:265,log:root+'stream-accepted.log'},types:{exitCode:0,log:root+'types-final3.log'}},
 performance:{scope:'Guard-only operations after the candidate snapshot is captured; not foreground/model/UI/Android timing.',fixture:stock.fixture,reads:stock.reads,interpretation:'Two fresh guards read two batches of 48 selected message bodies and perform two indexed message counts. No message-body query, unrelated suppression body or continuity-history read occurs in those guards. Initial candidate capture still loads the session archive and is not represented by these guard-only numbers.'},
 diagnosticCorrection:{evidence:root+'instrumentation-red.log',resolution:'An async wrapper around DBCore changed promise scheduling and manufactured PrematureCommitError. An uninstrumented stock commit passed; the counter now preserves the backend promise with then(). No production keep-alive, delay or retry was added for this instrumentation artifact.'},
 boundaries:{paidModelCalls:0,modelTokens:0,modelFee:0,codexUsageCost:'未确认',runtimeModel:'No upstream model; structured responses substituted locally. Fixture default deepseek-flash does not prove an actual model invocation.',privateUserDataRead:false,microphone:false,android:false,styledRightPanePreview:false,beforeAfterStyledScreenshots:false,versionChanged:false,packaged:false,deployed:false,codexProjectMove:'未验证；未修改内部数据库/配置'},
 remaining:[
  'T2 candidate capture for auxiliary jobs and private summarization still reads the archive; incremental loading and long-summary contention require separate work.',
  'Memory extraction jobs and every other asynchronous producer are not all audited by this private settlement patch.',
  'Post-commit source invalidation, equal-count branch replacement outside selected evidence, deleted-count checkpoint behavior and the complete transfer/rollback matrix remain part of T6.',
  'Thread completion still uses existing title matching; exact target/ambiguity and scoped current outcomes need the remaining T3/T4 work.',
  'Group/voice pipelines are not proven by these private tests; no real-model semantics/personality score.',
  'T7 fixed complete-dialogue scoring and T8 styled actual ChatWindow four-width preview/recordings remain.'
 ]};
writeFileSync('docs/CHAT-SETTLEMENT-GUARD-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=json(progressPath);
const task=progress.tasks.find(task=>task.id==='T5');task.evidence.push('docs/CHAT-SETTLEMENT-GUARD-2026-10-18.json');task.remaining='Memory jobs and other asynchronous producers; private settlement/analysis/continuity mutation fencing now covered, not all producers.';
progress.next='Audit memory-job late commits and remaining source/branch invalidation; then actual streaming partial-batch lifecycle and styled T8 preview.';
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
if(process.argv.includes('--log')){
 appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-18.md',`\n### 连续性T5：私聊结算/手动分析与事项变更保护\n- 工作目录F:/VirtuGene-Mobile；编码模型及推理强度未确认。上一轮摘要修复属实质进展，本阶段继续原完整方案，非全目标完成。实际改动文件/SHA与前快照见docs/CHAT-SETTLEMENT-GUARD-2026-10-18.json。\n- RED复现重复结算、恢复备份后旧结算、手动分析跨账号、本地写失败残留部分数据、重复点击丢失有效分析结果、手动暂放事项被旧结算重建、failed用户话语被错误排除、当前新消息尚未生成状态时旧任务继续写入。各失败原稿保留release/chat-settlement-guard-20261018/。\n- 新job-local来源快照固定原账号/角色/私聊会话、实际输入消息版本、conversation/auxiliary版本、检查点、消息数、continuity版本。请求前及原生事务内重新核验，切账号中途回滚，不加自动生成。情绪/记忆/事项/关系/账本/本次世界派生和检查点同批；本地写失败整批回滚，替代此前分步best-effort部分成功。UI仅提交后发布。\n- 无合法用户编号的记忆和事项不作用户事实，assistant-only依据不入库；编号有效只证明来源存在，不证明模型文本语义全对。failed用户原话仍是用户证据，失败角色输出/代拟转交排除。手动分析同源复核且重复点击不追加调用、不丢原有效结果。\n- CharacterState可选continuityRevision随create/complete/drop/reopen/update/remove/deleteByCharacter/clearForUser同事务推进，不改好感/心情/lifeFocus。旧结算不能重开手动暂放事项，删角色不创建孤儿状态；同名另一角色独立。Session可选auxiliaryRevision与导入恢复联动，均无Dexie schema升级。\n- 实际store+原生DB共70项通过；既有memory-continuity77、memory-final48、character-memory415共540项通过；摘要入口73、发送接续32、流式265、类型检查退出0。模型输出皆替身，真实模型0次/0token/0费用；Codex实际token/费用未确认。\n- 存量核验fixture512消息/8105失效记录：来源快照捕获之后的两次核验只读2批×48正文、做2次索引计数；没有消息正文查询、无关失效正文或事项历史读取，事项版本走单行主键。初始候选捕获仍全读本会话，不能把此guard-only计数写成整轮/手机性能改善。未测Android/首正文/解码首显。\n- 测试计数器曾用async包装DBCore制造PrematureCommitError，未加keepalive到生产掩盖；无计数器48来源提交通过，改为保留原Promise.then后计数通过。失败及修正证据保留，不将其当产品缺陷。\n- 无私人聊天/密钥读取、无麦克风/音频/原生操作、无版本/包/安装/发布；无当前真实样式右栏或同条件前后截图/录屏。Obsidian只追加手机版日志/索引。\n- 剩余：memory jobs等异步生产者；后台候选增量读取；提交后源失效、等计数分支替换及删除计数检查点完整矩阵；事项精确目标/歧义；T7整轨迹人物评分和T8四宽真实组件演示。群聊/语音不外推。更新项目完整进度表，目标保持active。\n`);
 appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- 2026-10-18 连续性T5私聊结算/手动分析70项：来源/账号/CAS、事务回滚、幂等、恢复、手动暂放不复活、同名角色隔离；memory回归540、摘要73/发送32/流式265与类型通过。仅本地替身，无API/Android/发布；memory jobs、分支/增量、T7/T8未完。见当日日志和项目CHAT-SETTLEMENT-GUARD-2026-10-18.json。\n');
}
console.log(JSON.stringify({report:'docs/CHAT-SETTLEMENT-GUARD-2026-10-18.json',fullPlanComplete:false,checks:70,memoryChecks:540}));
