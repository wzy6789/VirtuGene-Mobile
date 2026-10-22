import {readFileSync,writeFileSync,appendFileSync,readdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='release/chat-gu-retry-20261019',json=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const latest=(dir,prefix)=>dir+'/'+readdirSync(dir).filter(name=>name.startsWith(prefix)&&/^\d+\.json$/u.test(name.slice(prefix.length))).sort().at(-1);
const nativePath=root+'/checks-1792394059880.json',stockPath=root+'/stock-1792394105145.json';
const native=json(nativePath),stock=json(stockPath);
if(!native.complete||native.checks.length!==24||!native.stableSources||!stock.complete||!stock.stableSources)throw Error('Require complete source-stable native and stock evidence');
const files=['src/db/index.ts','src/lib/chat/send-service.ts','src/db/chat-reply-attempt-repo.ts'];
const production=files.map(path=>({path,sha256:hash(path),beforeSnapshot:path.endsWith('chat-reply-attempt-repo.ts')?null:root+'/before/'+path}));
for(const file of production){
 if(native.sourceHashesAfter[file.path]!==file.sha256||stock.sourceHashesAfter[file.path]!==file.sha256)throw Error('Evidence does not match current source: '+file.path);
 if(file.beforeSnapshot&&json(root+'/checks-1792393305416.json').sourceHashesBefore[file.path]!==hash(file.beforeSnapshot))throw Error('Frozen original mismatch');
}
writeFileSync(root+'/empty-before.txt','');
let patch='';
for(const file of production){
 const diff=spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--ignore-cr-at-eol','--',file.beforeSnapshot??root+'/empty-before.txt',file.path],{encoding:'utf8'});
 if(diff.status!==1)throw Error('Expected a concrete scoped diff for '+file.path+': '+diff.stderr);
 patch+=diff.stdout+'\n';
}
writeFileSync(root+'/production.patch',patch);
copyFileSync('src/db/chat-reply-attempt-repo.ts',root+'/accepted-chat-reply-attempt-repo.ts');
const body=native.rows.flatMap(row=>row.calls??[]).find(row=>typeof row.model==='string');
const providerRequest=body?Object.fromEntries(['model','thinking','reasoning_effort','max_tokens','stream'].filter(key=>key in body).map(key=>[key,body[key]])):null;
const countBodies=sample=>Object.entries(sample.reads).reduce((sum,[,read])=>sum+read.bodies,0);
const regressions=[
 ['reply evidence',latest('release/chat-topic-replies-20261019','current-'),101],
 ['reply commit',latest('release/chat-reply-commit-20261018','commit-'),69],
 ['request recovery',latest('release/chat-request-recovery-20261018','recovery-'),28],
 ['focused continuity',latest('release/chat-continuity-focus-20261019','checks-'),20],
 ['source guards',latest('release/chat-continuity-sources-20261019','probe-'),360],
 ['summary native',latest('release/chat-summary-cas-20261018','live-'),33],
 ['memory worker',latest('release/chat-memory-worker-20261018','worker-'),93],
 ['settlement native',latest('release/chat-settlement-guard-20261018','live-'),70],
 ['original trajectory audit',latest('release/chat-continuity-plan-audit-20261019','audit-'),66],
].map(([name,path,checks])=>{const data=json(path);if(!data.complete||data.checks.length!==checks)throw Error('Invalid regression evidence: '+path);return {name,path,checks,sha256:hash(path)};});
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 scope:'Original T6 failed resend, exact-input idempotence, partial replacement and T5 fresh selected-source withdrawal; actual built-in Gu Yue Na preset/runtime',
 production,patch:{path:root+'/production.patch',sha256:hash(root+'/production.patch'),note:'CR-at-EOL ignored in human-readable diff only; original snapshots and source hashes are raw bytes'},
 observedLocalRequest:providerRequest,upstreamModel:'未验证；本地替身未返回真实模型身份',transport:'local substitute only; no genuine personality acceptance',
 semantics:['Identical complete input reuses the entire durable complete batch, with fresh owner/source/withdrawal reads; no second generation or conversation advancement.',
 'Explicit failed resend retires old reply evidence before context compilation. It retains readable partial rows until the new batch is committed; failed replacement keeps those rows.',
 'Replacement deletion and new bubbles commit atomically. Source edits, account/role changes and native withdrawal reject reuse. Legacy unstamped replies are conservatively replaced once only after explicit resend.',
 'Derived summary/memory/ledger and pending jobs retire in batches. The new path uses indexed linked-reply lookup and exact source keys, never a per-bubble full-memory scan.'],
 evidence:{initialRed:{path:root+'/checks-1792393305416.json',checks:6,failures:5},withdrawalRed:{path:root+'/checks-1792393894112.json',checks:22,failures:2},batchReadRed:{path:root+'/checks-1792394024574.json',checks:24,failures:1},accepted:{path:nativePath,checks:24,sha256:hash(nativePath)},regressions,
  memory:{path:root+'/accepted-memory.log',assertions:415,exitCode:0},types:{path:root+'/accepted-types.log',exitCode:0,observedTerminalSession:63849},diffCheck:{path:root+'/diff-check.log',exitCode:0},
  trace:{path:'release/chat-continuity-trace-2026-10-19T07-15-20-955Z/baseline.json',trajectories:24,turns:172,transport:'synthetic'},
  harnessCorrection:'The first legacy reply regression left its queued stub response unused after successful idempotent delivery, shifting later test replies (9 false failures). Cleanup now removes only that unused response object; an additional assertion proves zero generation and identical durable bubble IDs. Raw failed report is retained at release/chat-topic-replies-20261019/current-1792393637397.json.',
  diagnosticNote:'A core.autocrlf=false diff-check against the shared dirty HEAD incorrectly treated CRLF as trailing whitespace. The normal repository diff-check passes; no production line-ending conversion was performed.'},
 performance:{path:stockPath,sha256:hash(stockPath),samples:9,checks:22,fixture:stock.fixture,fullOrdinaryModelMessagesIdentical:true,
  summary:stock.summary,bodyReads:stock.phases.map(phase=>({phase:phase.phase,allBodies:phase.samples.map(countBodies),messageBodies:phase.samples.map(sample=>Object.entries(sample.reads).filter(([name])=>name.startsWith('messages.')).reduce((sum,[,read])=>sum+read.bodies,0))})),
  multipartUnrelatedMemoryBodiesBefore:500,multipartUnrelatedMemoryBodiesAfter:200,
  limits:'Desktop isolated native DB and local transport only. Ordinary median first request28.3→37.2ms, whole39.2→52.9ms in this small concurrent run; this is added safety cost/noise, not a speedup. Body340→343, message215→216. No50k-thread/8105-tombstone body scan. Existing voice-cache stub1 first sample then0 is counted separately and unchanged.'},
 limits:['No genuine model, human scoring, API latency or Android validation. No same-condition before/after screenshots or recording for this phase.',
 'No new successful-regeneration/timeline-rollback UI is invented. Whole transfer/restore/all-producer matrix and genuine full-dialogue/personality gates remain incomplete.',
 'Input digest is idempotence metadata only. It does not certify a fresh answer to an old question; a new message ID is required for a new conversational turn. More than64 linked rows fails closed.',
 'The whole original plan remains incomplete. This phase adds no model call, authorization cache, app/schema release version, package, installation or publication. Existing schema stays44.',
 'Codex sidebar project assignment not officially confirmed in this phase; no internal Codex storage was edited.'],
 actualUsage:{upstreamCalls:0,upstreamInputTokens:0,upstreamOutputTokens:0,upstreamCost:0,codingTokens:'未确认',audioOrMicrophone:false,realPrivateData:false},
};
const path='docs/CHAT-GU-RETRY-CONSISTENCY-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=json(progressPath);
for(const id of ['T5','T6','T8']){const task=progress.tasks.find(task=>task.id===id);task.evidence??=[];if(!task.evidence.includes(path))task.evidence.push(path);}
progress.tasks.find(task=>task.id==='T6').remaining='Actual Gu native exact-input reuse/failed-prefix replacement/edit/withdrawal/backup anti-replay and rollback verified; supported operation inventory and full transfer/role/restore matrix still require final audit. No successful-regeneration/rollback UI invented; no old-APK downgrade claim.';
progress.fullPlanComplete=false;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
appendFileSync('.superpowers/sdd/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18/progress.md','\n2026-10-19 — OriginalT6 Gu retry24 verified. Initial6/5 RED, withdrawal22/2 RED and multipart-read24/1 RED retained. Exact-input complete reuse has zero provider calls/state advance; partial replacement preserves readable prefix on failure and rolls back atomically. Retired evidence rejects old encrypted backup. Selected native tombstones checked even without suppression lists. Batch memory reads500→200 for4 old bubbles/100 unrelated memories; never per-bubble full invalidation. Source360/replies101/commit69/recovery28/focus20/summary33/worker93/settlement70/trace24x172 audit66/types0; character-memory actual415 this phase (do not copy older540 labels). Stock9/22 complete native and ordinary model-message equality, bodies340→343/messages215→216, withdrawals4; local preparation28.3→37.2ms and whole39.2→52.9ms observed, added cost/noise not a speedup/Android claim. Report docs/CHAT-GU-RETRY-CONSISTENCY-2026-10-19.json. No paid call/schema/app-version/build/APK/install/release; whole original plan remains incomplete.\n');
appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md','\n### 原方案T6／T5：古月娜失败重发与旧分支一致性\n- 工作目录F:/VirtuGene-Mobile；编码模型／推理强度未确认。实际内置古月娜与正式发送链路，传输为本地替身。生产改动：src/db/index.ts增加可选replyInputKey、src/lib/chat/send-service.ts及新增src/db/chat-reply-attempt-repo.ts；原始快照、SHA、差异、证据见项目docs/CHAT-GU-RETRY-CONSISTENCY-2026-10-19.json。未修改人格、应用版本或数据库schema（仍44）。\n- 复现并修复：同一输入重复进入发送会多调用模型、多存气泡；失败重发带入旧残句。现在完整批次按输入身份复用且重新核对账号／角色／来源／撤权，不推进第二次对话状态。新问题用新的消息ID，不把历史复用当新答案。老数据无身份戳时，仅在明确重发后保守替换一次。\n- 不完整旧稿先退出有效上下文，原可读前缀保留；替代批次与删除旧气泡一起提交，后续气泡写失败会整体回滚，再次网络失败也保留旧前缀。依赖摘要／自动记忆／账本证据失效、任务取消及墓碑按整批处理。旧加密备份不能复活旧稿权限。普通角色没有新增成功重生成／时间线回退入口。\n- 原6项5失败、无suppression列表的撤权22项2失败、4气泡清理重复扫描24项1失败都留原稿；最终古月娜24通过。相同100条无关记忆，原4气泡清理读取500→批量200正文。既有回应测试曾因复用没有消费替身队列导致后9项错位，现仅清除该次未使用替身，并增加零调用／同气泡ID断言；失败原稿保留，不削弱判定。\n- 来源360／回应101／提交69／恢复28／焦点20／摘要33／worker93／结算70／24组172轮轨迹审计66通过，类型退出0。此轮character-memory实际415项通过，不沿用旧日志540计数。测试读取真实隔离IndexedDB，不是Android或真实人物表现。\n- 存量9样本22检查：513消息、50001事项（5万无关关闭项）、8105失效、40私密合成日记；普通完整fixture及模型messages一致，正文340→343、消息215→216，事项1与失效4正文未增。桌面准备中位数28.3→37.2ms／整轮39.2→52.9ms，明确是新增核验成本及小样本噪声，不宣称提速；接续79／104.6ms为另一功能场景。没有全量事项／失效扫描或跨轮授权缓存。\n- 捕获主请求：'+JSON.stringify(providerRequest)+'；仅本地替身收到，上游模型身份与实际表现未验证。原有声音样本后台替身每阶段首样本1次后0次单列，此功能不新增生成请求。上游0调用／0输入输出token／0费用，Codex用量未确认。\n- 仍未完成原方案完整操作／转移／恢复／生产者审计，以及真实模型长聊、人物辨识度和人工评分。无本阶段同条件前后截图／Android录屏；不把替身“14点”或“嗯”当自然度成果。无真实私人原话、麦克风／音频、构建、APK、安装或发布；Codex侧栏归属未在本阶段获得官方确认。\n');
appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- 2026-10-19 原方案T6古月娜重发24：完整批次复用，旧残句退出上下文，替换失败保留／回滚，旧备份不复活。4气泡清理无关记忆正文500→200；存量普通输入一致，额外核验成本如实记录。见[[手机版/开发日志/2026-10-19|当日开发日志]]及项目docs/CHAT-GU-RETRY-CONSISTENCY-2026-10-19.json。全方案及真实人物验收未完成，未付费调用／升版／打包／发布。\n');
console.log(JSON.stringify({path,checks:native.checks.length,regressions:regressions.map(row=>({name:row.name,checks:row.checks})),observedLocalRequest:providerRequest,fullPlanComplete:false,paidCalls:0}));
