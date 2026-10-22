import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-summary-cas-20261018/';
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const log=path=>readFileSync(root+path,'utf8').replace(/^\uFEFF/,'');
const latest=(prefix,count)=>readdirSync(root).filter(path=>new RegExp('^'+prefix+'-\\d+\\.json$').test(path)).sort().reverse().find(path=>{const row=json(root+path);return row.complete&&row.checks.length===count;});
const cas=latest('cas',24),live=latest('live',33);assert.ok(cas&&live);
for(const [path,pattern] of [['red.log',/same-text summary ABA/],['restore-red.log',/restoring the same summary text/],['private-boundary-red.log',/private summary does not cross/],['recovery-summary-red.log',/physical recovery rejects/],['summary-final2.log',/PASS chat-summary-entry: 73/],['stream-r4.log',/PASS chat-stream: 265/],['recovery-r4.log',/"complete":true,"checks":28/]])assert.match(log(path),pattern);
assert.equal(log('types-final2.log').trim(),'');
const probePath=root+'readprobe-1792328993456.json',probe=json(probePath);assert.equal(probe.complete,true);
const files=['src/db/index.ts','src/db/session-repo.ts','src/db/session-summary-repo.ts','src/db/memory-repo.ts','src/lib/chat/send-service.ts','src/lib/sync.ts','scripts/verify/chat-summary-cas.ts','scripts/verify/chat-summary-cas.mjs','scripts/verify/chat-summary-live.ts','scripts/verify/chat-summary-readprobe.ts','scripts/verify/chat-summary-readprobe.mjs','scripts/verify/chat-request-recovery.mjs'];
const report={date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',stage:'T5 private background summary version/owner/restore guards and selected-source reads',fullPlanComplete:false,
 files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),beforeSnapshots:root+'before/',
 implementation:[
  'Optional Session.summaryRevision uses zero for legacy sessions; successful summary commit and source/memory invalidation advance it. No Dexie schema or product version change.',
  'Private summary captures exact prior text, summary revision, conversation version and original account/character/private-session scope; preparation attempt and final commit use fresh native transaction checks.',
  'Account changes during the write abort the transaction. Stale generations return without retrying or advancing coverage.',
  'Summary memory projection checks the same accepted summary revision and current account, preventing a delayed same-text older projection.',
  'Actual sync serialization/import preserves sources and the optional revision; restoring an existing local session advances its local summary revision so old jobs cannot survive an ABA restore.',
  'Summary commit batch-reads selected sources and protected memories; suppression checks use selected ids, not every scoped suppression record.',
  'Physical request preflight also compares injected summaryRevision so identical text/timestamp cannot hide a changed generation.'
 ],
 verification:{nativeTransactions:{checks:24,evidence:root+cas,includes:['manually released late result','same-text ABA','correction version','owner/character/private-session transfer','account switch and rollback during write','source edit/delete','one competing writer','invalid offsets','8105 unrelated records','actual sync roundtrip','legacy field absence','delayed memory projection','same-record restore invalidation']},actualBackgroundFunction:{checks:33,evidence:root+live,includes:['normal commit and memory projection','incomplete response keeps cursor','provider failure keeps cursor and throttle','actual correction send while old summary waits','source deletion','account/session transfer','private-to-group restoration','account flip during preparation makes no request','same-text summary change blocks physical recovery']},summaryEntry:{checks:73,log:root+'summary-final2.log'},stream:{checks:265,log:root+'stream-r4.log'},recovery:{checks:28,log:root+'recovery-r4.log'},types:{exitCode:0,log:root+'types-final2.log'}},
 performance:{evidence:probePath,...probe,interpretation:'Only the repository background commit is compared. Same synthetic 512-message/12-source/8105-nonmatching-suppression distribution; saved pre-change repository vs current. One sample per phase, cursor-inclusive. Before reads 8105 unrelated suppression bodies plus 12 individual source bodies; after reads 12 selected bodies in one batch and one empty suppression cursor. Approximate 36.2/3.1ms is not foreground, model, UI, Android or statistical latency proof.'},
 boundaries:{paidModelCalls:0,modelTokens:0,modelFee:0,codexUsageCost:'未确认',privateUserDataRead:false,microphone:false,realModelQuality:false,android:false,styledRightPanePreview:false,beforeAfterStyledScreenshots:false,versionChanged:false,packaged:false,deployed:false,codexProjectMove:'未验证；未修改内部配置'},
 remaining:[
  'T2 actual summarizer still loads its archive before forming incremental batches; incremental retrieval/background contention remains.',
  'T5 emotion/relationship settlement and memory-job late results still need the full source/CAS/ownership matrix. This patch does not claim to protect every background producer.',
  'Group summary caller retains its existing guard shape; private summary tests do not prove equivalent group/voice behavior.',
  'T6 successful-stream changes, partial multi-bubble commits, retries/rollback/selected branch and derived-state invalidation remain incomplete.',
  'T3/T4 general semantic corrections and assistant-answered provenance remain incomplete.',
  'T7 real-model naturalness/personality and T8 styled ChatWindow 320/360/390/414 preview/recording deliverables remain.'
 ]};
writeFileSync('docs/CHAT-SUMMARY-CAS-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
const progress={date:'2026-10-18',plan:'C:/Users/34568/Desktop/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18.md',fullPlanComplete:false,
 tasks:[
  {id:'T0',status:'partial',evidence:['docs/CHAT-CONTINUITY-COVERAGE-FIX-2026-10-18.json'],remaining:'Complete final request/source trace matrix audit, including non-private entries separately.'},
  {id:'T1',status:'implemented-with-remaining-audit',evidence:['docs/CHAT-CONTINUITY-COVERAGE-FIX-2026-10-18.json','docs/CHAT-REQUEST-RECOVERY-2026-10-18.json'],remaining:'Final all-source/branch and viewport evidence audit.'},
  {id:'T2',status:'partial',evidence:['docs/CHAT-CONTINUITY-COVERAGE-FIX-2026-10-18.json','docs/CHAT-SUMMARY-CAS-2026-10-18.json'],remaining:'Incremental archive reads and background contention; full offset/legacy audit.'},
  {id:'T3',status:'partial',evidence:['docs/CHAT-TOPIC-WIRING-2026-10-18.json'],remaining:'Scoped preferences, temporal/domain and general semantic correction cases.'},
  {id:'T4',status:'partial',evidence:['docs/CHAT-TOPIC-WIRING-2026-10-18.json'],remaining:'Assistant answer evidence and persistent continuity-thread integration.'},
  {id:'T5',status:'partial',evidence:['docs/CHAT-TOPIC-WIRING-2026-10-18.json','docs/CHAT-SUMMARY-CAS-2026-10-18.json'],remaining:'Settlement/memory jobs and all asynchronous producers.'},
  {id:'T6',status:'partial',evidence:['docs/CHAT-REQUEST-RECOVERY-2026-10-18.json','docs/CHAT-SUMMARY-CAS-2026-10-18.json'],remaining:'Partial-stream commits, selected versions and full backup/transfer/rollback matrix.'},
  {id:'T7',status:'pending-plan-specific-validation',remaining:'Frozen complete dialogue comparisons, all-character voice differences and human scoring; no claimed model results.'},
  {id:'T8',status:'partial-headless-evidence-only',remaining:'Styled actual ChatWindow preview and recordings at four widths, then requirement-by-requirement final audit.'}
 ],next:'Source/version/owner guard for late settlement results; preserve current fact and relationship scope, no new paid model calls.'};
writeFileSync('docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',JSON.stringify(progress,null,2)+'\n');
if(process.argv.includes('--log')){
 appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-18.md',`\n### 连续性T5：后台摘要版本、备份恢复和账号边界\n- 实际目录F:/VirtuGene-Mobile；编码模型/推理强度未确认。上一轮修复有实质进展，本轮继续原T0–T8方案，未收缩目标、未称全部达标。\n- RED实际复现同文字摘要ABA、同记录恢复备份、私聊变群会话、内部恢复忽略摘要新版本四处边界。Session新增可选summaryRevision（旧数据0、不升schema），写入/原话与记忆失效推进；私聊任务绑定原账号/角色/私聊范围/原summary与conversation版本，准备和写回都事务核验。切账号发生在write期间则回滚，过时结果不补生成/不推进游标。\n- 摘要记忆投影校同一已提交revision；同步真实序列化/导入保留可选字段及原消息来源，同本地session恢复时推进本地summaryRevision使恢复前任务失效。发送端物理重试另核summaryRevision，避免文字和时间戳相同却沿用旧代际。\n- 当前原生IndexedDB/CAS24项、实际后台函数+真实更正发送33项通过；含人工释放promise乱序、incomplete/provider error不推进游标且节流、账号/角色/私聊→群边界、源编辑删除、两窗口CAS、mid-write回滚、真实sync导入/旧字段兼容与记忆晚到。原摘要入口73、流式265、恢复28及tsc退出0。所有传输/摘要输出均模拟，不能当真实模型理解或自然度证明。\n- 后台commit同资料对照512消息/12选定来源/8105同账号同角色但零匹配失效记录：修改前读8105无关失效正文+12次逐消息读，修改后1次bulkGet读12来源、1次空失效cursor，未读无关正文。一次桌面样本约36.2→3.1ms，仅后台仓库提交，不是首字/首显/Android，不能推导整体提速比例。完整cursor计数、失败、源hash及证据见docs/CHAT-SUMMARY-CAS-2026-10-18.json与release/chat-summary-cas-20261018/。\n- 本阶段模型0次/0token/0费用，Codex实际token/费用未确认。无私聊/Key读取、麦克风、原生/Android操作、版本/安装包/发布；没有同条件前后截图和真实样式右栏预览。Obsidian仅追加手机版，不改电脑版。\n- 仍待：摘要生成前全历史读取的增量化；旧情绪/关系结算与memory jobs晚到；成功stream中来源变化、分泡提交、全转移/回退；assistant answered来源；T7人物评测和T8四视口真实组件/录屏。群聊/语音没有从本私聊证据外推。新建docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json统一列T0–T8当前不足；全目标active。\n`);
 appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- 2026-10-18 连续性T5后台摘要：24原子/33实际流程检查通过，补同文字ABA、账号/范围、恢复备份与旧摘要记忆投影；后台核验8105无关失效正文→0且批量核12来源。原73摘要/265流式/28恢复和类型通过，无真实模型/Android/发布。T0–T8仍未全完，见当日日志与项目CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json。\n');
}
console.log(JSON.stringify({report:'docs/CHAT-SUMMARY-CAS-2026-10-18.json',fullPlanComplete:false,cas:24,live:33}));
