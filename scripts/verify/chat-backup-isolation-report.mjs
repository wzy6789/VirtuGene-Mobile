import {readFileSync,writeFileSync,appendFileSync,copyFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='release/chat-backup-isolation-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8')),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const latest=(dir,prefix)=>dir+'/'+readdirSync(dir).filter(name=>name.startsWith(prefix)&&/^\d+\.json$/u.test(name.slice(prefix.length))).sort().at(-1);
const appendOnce=(path,marker,text)=>{if(!readFileSync(path,'utf8').includes(marker))appendFileSync(path,text);};
const acceptedPath=root+'/checks-1792396039519.json',beforePath=root+'/before-1792396040939.json';
const accepted=read(acceptedPath),before=read(beforePath);
if(!accepted.complete||accepted.checks.length!==33||accepted.externalWindowImports!==2||before.failures.length!==16||!accepted.stableSources||!before.stableSources)throw Error('Require source-stable33/16 RED→GREEN and two actual writer-page restores');
for(const field of ['fixtureHash','actualModelMessagesHash'])if(accepted[field]!==before[field])throw Error('Before/current mismatch: '+field);
if(accepted.stock.fixtureHash!==before.stock.fixtureHash||accepted.stock.unrelatedBodies!==0)throw Error('Unmatched stock fixture or unrelated body scan');
const production=['src/lib/sync.ts','src/lib/sync-ownership.ts'].map(path=>({path,sha256:hash(path),beforeSnapshot:path.endsWith('/sync.ts')?root+'/before/'+path:null}));
for(const file of production)if(accepted.sourceHashesAfter[file.path]!==file.sha256)throw Error('Current source differs from tested source: '+file.path);
if(read(root+'/checks-1792394914123.json').sourceHashesBefore['src/lib/sync.ts']!==hash(root+'/before/src/lib/sync.ts'))throw Error('Original importer snapshot mismatch');
writeFileSync(root+'/empty-before.txt','');let patch='';
for(const file of production){const diff=spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--ignore-cr-at-eol','--',file.beforeSnapshot??root+'/empty-before.txt',file.path],{encoding:'utf8'});if(diff.status!==1)throw Error(diff.stderr||'Missing scoped change');patch+=diff.stdout+'\n';}
writeFileSync(root+'/production.patch',patch);copyFileSync('src/lib/sync-ownership.ts',root+'/accepted-sync-ownership.ts');
const regressions=[
 ['Gu retry',latest('release/chat-gu-retry-20261019','checks-'),24],
 ['persistent Gu focus',latest('release/chat-continuity-focus-20261019','checks-'),20],
 ['Gu resume and migration',latest('release/chat-continuity-resume-20261019','checks-'),39],
 ['memory worker',latest('release/chat-memory-worker-20261018','worker-'),93],
 ['summary native',latest('release/chat-summary-cas-20261018','live-'),33],
 ['original trace audit',latest('release/chat-continuity-plan-audit-20261019','audit-'),66],
].map(([name,path,checks])=>{const data=read(path);if(!data.complete||data.checks.length!==checks)throw Error('Invalid regression: '+path);return {name,path,checks,sha256:hash(path)};});
const memory=read('release/chat-settlement-guard-20261018/memory-regressions.json');
if(memory.length!==3||memory.some(row=>!row.passed))throw Error('Memory regressions not complete');
const totalBodies=stock=>Object.values(stock.reads).reduce((sum,row)=>sum+row.bodies,0);
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 scope:'Original private-chat T5/T6 supported ownership/backup/restore matrix, using actual built-in Gu Yue Na and production sender',production,
 patch:{path:root+'/production.patch',sha256:hash(root+'/production.patch'),lineEndings:'CR-at-EOL ignored only for readable diff; raw source snapshots/hashes preserved'},
 behavior:['Validate incoming primary-key collisions and private parent/character ownership inside the existing native import writer transaction, before any tombstone or data write. Conflicts cancel the whole import and preserve all native rows.',
 'Batch selected primary keys in256-key chunks; reuse only fresh parent rows within this same transaction. Shared names/presets never authorize sharing private records. Preserve legitimate group-member emotion ownership.',
 'Restore/sync advances conversation.version monotonically, including previously empty legacy sessions. Two actual JavaScript windows prove a pending pre-restore response cannot commit after an identical-text restore. Saved user facts/input remain valid.',
 'No new ownership-transfer, successful-regeneration or timeline-rollback UI. The existing character repository rejects ownership changes; previous native sender guards cover adversarial transfer.'],
 tests:{accepted:{path:acceptedPath,checks:33,sha256:hash(acceptedPath)},frozenBefore:{path:beforePath,checks:33,failures:16,sha256:hash(beforePath),note:'Only the frozen pre-phase sync.ts is substituted; not a historical APK/release comparison. Current helper is unreferenced in that baseline.'},
  initialRed:{path:root+'/checks-1792394914123.json',checks:18,failures:8},restoreRed:{path:root+'/checks-1792395534989.json',checks:29,failures:2},roleStateRed:{path:root+'/checks-1792395706931.json',checks:31,failures:2},regressions,
  memory:memory.map(row=>({suite:row.suite,checks:row.checks,passed:row.passed,path:'release/chat-settlement-guard-20261018/'+row.suite+'.txt'})),
  world:{path:latest('release/chat-world-source-20261019','regressions-'),checks:210,log:root+'/world-regressions.log'},
  trace:{path:'release/chat-continuity-trace-2026-10-19T07-44-09-847Z/baseline.json',trajectories:24,turns:172,transport:'synthetic'},
  types:{path:root+'/accepted-types.log',exitCode:0,observedTerminalSession:92431},diffCheck:{path:root+'/diff-check.log',exitCode:0},
  testCorrections:['Initial assertions used .state instead of the actual readValidatedConversation().conversation API. Correcting them strengthened negative checks and left8 genuine collision failures.',
   'The restore-race test initially used an unsupported structured park-place expectation. It now uses the original documented museum scenario plus an explicit durable-facts precondition. Raw park text remains available; no universal local-place parsing claim. The first diagnostic failure is retained at checks-1792395428219.json.',
   'A runner-only TypeScript cast in.mjs was caught by syntax checking and removed before test execution; no product code or data was affected.']},
 matchedStock:{fixtureHash:accepted.stock.fixtureHash,baseFixtureHash:accepted.fixtureHash,actualModelMessagesHash:accepted.actualModelMessagesHash,distribution:accepted.stock.distribution,incomingNewMessages:600,
  before:{durationMs:before.stock.durationMs,bodies:totalBodies(before.stock),unrelatedBodies:before.stock.unrelatedBodies},current:{durationMs:accepted.stock.durationMs,bodies:totalBodies(accepted.stock),unrelatedBodies:accepted.stock.unrelatedBodies},
  meaning:'Exact native fixtures and profile-turn messages match. Only selected incoming records are read, even with10k unrelated messages/2k memories/8105 withdrawals. One import observation per phase, concurrent desktop tests; timing variation is not a speedup or chat/Android latency claim. No ordinary send-path code changed.'},
 restoreRaces:accepted.rows.filter(row=>row.kind==='pending-generation-restore').map(row=>({hasFacts:row.hasFacts,beforeVersion:row.beforeRestoreVersion,afterVersion:row.afterRestoreVersion,mainRequests:row.mainCalls,completed:row.result.request.completed,storedReplies:row.result.replies.length})),
 observedLocalRequest:accepted.observedLocalRequest,modelTransport:'local substitute; actual upstream model identity and naturalness unverified',
 limits:['Full original plan still needs its final private requirement audit and T7 factual-freeze/style/real-dialogue acceptance; no genuine model/personality score.',
 'The original plan targets private continuity and private-source world derivatives. Redesigning every independent raw-world interpreter/fact producer is separately unverified and is not added as a new completion gate.',
 'T2 has measured O(N) key/fresh-source costs; a newly invented durable cursor is not an original requirement. No cross-round permission cache or source-check removal.',
 'No current-phase same-condition UI screenshots/recording, Android/native-notification validation or old-APK downgrade proof. No new APK, version, installation, deployment or website publication.',
 'No actual private records/credentials were searched. Codex sidebar project assignment remains unconfirmed; no Codex internal storage edits.'],
 actualUsage:{upstreamCalls:0,inputTokens:0,outputTokens:0,upstreamFee:0,codingTokens:'未确认',observedMainLocalStubRequests:3,backgroundLocalStubRequests:'Existing voice-cache task attempts not consolidated; still substituted locally, no upstream calls',audio:false,microphone:false,schemaChanged:false,appVersionChanged:false,appBuild:false},
};
const path='docs/CHAT-BACKUP-ISOLATION-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T5','T6','T8']){const task=progress.tasks.find(task=>task.id===id);task.evidence??=[];if(!task.evidence.includes(path))task.evidence.push(path);}
progress.tasks.find(task=>task.id==='T5').status='implemented-private-native-matrix-pending-final-audit';
progress.tasks.find(task=>task.id==='T5').remaining='Final original private-chat source/CAS/job requirement audit. Actual two-window identical-text restore ABA now verified with preserved user facts. Independent raw-world interpreter/fact producers are outside this private plan, not a new completion gate.';
progress.tasks.find(task=>task.id==='T6').status='implemented-supported-private-operations-pending-final-audit';
progress.tasks.find(task=>task.id==='T6').remaining='Final original supported-operation evidence audit. Gu same-name/shared-preset/account/role collisions, encrypted restore, stale correction/deletion and pending restore verified. No new successful-regeneration/rollback UI or old-APK downgrade guarantee.';
progress.tasks.find(task=>task.id==='T2').remaining='Final original incremental-candidate/coverage audit; retain measured O(N) key and fresh-body costs as limitations. An additional durable dirty-aware cursor was not required by the original stop rule and is not an added completion gate.';
progress.tasks.find(task=>task.id==='T0').remaining='Final private request/source trace audit; non-private entrypoints remain separately scoped.';
progress.next='Finish the original private requirement evidence audit and T7 frozen-fact daily style work with Gu and the second character, then final T8 preview/whole-plan review. Do not add global-world or durable-cursor requirements. No paid model calls/release this phase.';
progress.fullPlanComplete=false;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
appendOnce('.superpowers/sdd/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18/progress.md','OriginalT5/T6 Gu backup33 verified',
 '\n2026-10-19 — OriginalT5/T6 Gu backup33 verified. Frozen identical test33/16 RED→33 GREEN; actual shared-preset Gu copies, same-owner fork, account/role PK collisions, state/emotion parent joins, duplicate ids and late>256-key collision all reject atomically. Two actual JS windows restore identical snapshots while model waits: conversation3→4 and legacy0→1, no old reply, user facts/input survive. Version44 unchanged. Full native fixture and profile main-message hashes match before/current; valid600-message import reads0 unrelated bodies among10k messages/2k memories/8105 withdrawals. Selected bodies18→36; one noisy import timing observation575.7/281.1ms is not chat speed or a speedup claim. Memory77/48/415, world210, worker93/focus20/retry24/resume39/summary33, trace24x172/audit66 and types0. Evidence docs/CHAT-BACKUP-ISOLATION-2026-10-19.json; no paid model/audio/version/build/APK/install/release. Original T7 and final audit remain; no global-world/raw-producer or invented durable-cursor completion gate.\n');
const marker='### 原方案T5／T6：古月娜备份归属与双窗口恢复';
appendOnce('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',marker,'\n'+marker+'\n'+
 '- 工作目录F:/VirtuGene-Mobile；编码模型／推理强度未确认。生产仅修改src/lib/sync.ts并新增src/lib/sync-ownership.ts；原始快照、SHA、差异和完整证据见项目docs/CHAT-BACKUP-ISOLATION-2026-10-19.json。使用实际古月娜预设及正式发送链路，未改人格或其他角色。\n'+
 '- 复现并修复同ID跨账号／跨角色导入覆盖，以及新记录指向其他账号角色、同账号不同角色情绪串会话。写入前在原生导入事务内按主键分256键批量核对归属、原父对象和角色；冲突整包取消、原记录全表hash不变。正常同名副本／共享预设仍各有私有记忆，群聊成员情绪仍归对应角色，不按名称猜归属。没有增加角色转移／成功重生成／时间线回退入口。\n'+
 '- 第二个缺口是恢复ABA：文字／来源版本相同，旧模型请求仍会提交。现恢复推进conversation.version，包括无旧状态的会话；两真实JavaScript页共用IndexedDB，从另一页恢复加密快照：3→4及0→1，旧请求不再完成／落库，已经保存的用户输入和约定仍保留。摘要及后台任务原有版本保护保留。\n'+
 '- 固定时钟／合成UUID，冻结原导入器同33检查有16失败，当前33通过；原始失败全保留。含旧备份不复活删除／纠正、跨批次末尾冲突不留下前600行、普通加密恢复、群聊正例。测试适配器曾误读.state，已按真实API.conversation纠正并加强负例；恢复竞态使用原方案博物馆场景且先断言事实已落库。公园等未支持的结构化地点仍保留原文，不宣称通用语义抽取。\n'+
 '- 存量验证原生完整fixture及主请求messages hash相同：1万无关消息、2000无关记忆、8105无关失效资料；正常新增600条消息导入，无关正文读取0，选定正文18→36。单次桌面导入观测'+before.stock.durationMs.toFixed(1)+'→'+accepted.stock.durationMs.toFixed(1)+'ms受并行与缓存／GC影响，不宣称提速或手机响应改善；普通发送路径未改。无逐候选全扫描或跨轮授权缓存，父对象复用仅限同一原生事务。\n'+
 '- 记忆77／48／415、世界210、worker93、摘要33、古月娜恢复39／焦点20／重发24，以及24组172轮轨迹审计66通过；类型退出0、差异检查退出0。所有模型传输替身，真实自然度及上游model未验收。捕获请求'+JSON.stringify(accepted.observedLocalRequest)+'。\n'+
 '- 原方案目标是私聊连续性及其来源衍生，不扩为独立星域原始解释器／世界事实全系统重构，也不追加原方案停点之外的持久游标任务。接下来只做原T7冻结事实的日常表达及最终逐项审计，完整方案仍未达标。\n'+
 '- 上游0调用／0输入输出token／0费用，编码用量未确认；没有读真实私人资料或搜索凭据，没有麦克风／音频、应用构建、APK、安装或发布，数据库仍44。无本阶段同条件前后截图／Android录屏，旧APK降级未验证。Codex侧栏项目归属未获得官方确认，没有编辑其内部资料。\n');
appendOnce('D:/月起云归/VirtuGene/手机版/00-总览.md','原方案T5/T6古月娜备份33',
 '\n- 2026-10-19 原方案T5/T6古月娜备份33：归属冲突整包回滚，双窗口恢复使旧请求失效且保留用户事实；同名／共享预设和普通加密恢复正例通过。存量600行导入无关正文读取0，模型替身，非真实人味验收。见[[手机版/开发日志/2026-10-19|当日开发日志]]和项目docs/CHAT-BACKUP-ISOLATION-2026-10-19.json。只续原T7及最终审计，未升版／打包／发布。\n');
console.log(JSON.stringify({path,checks:33,beforeFailures:16,stockNativeFixtureIdentical:true,modelMessagesIdentical:true,crossWindowRestores:2,unrelatedBodies:0,fullPlanComplete:false,paidCalls:0}));
