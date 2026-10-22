import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-request-recovery-20261018/';
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const text=path=>readFileSync(root+path,'utf8').replace(/^\uFEFF/,'');
const candidates=readdirSync(root).filter(path=>/^recovery-\d+\.json$/.test(path)).sort().reverse();
const accepted=candidates.find(path=>{const row=json(root+path);return row.complete&&row.checks.length===28&&row.faultInjection==='none';});
assert.ok(accepted,'Current 28-case pass required');
const recovery=json(root+accepted);
assert.match(text('red.log'),/edit-current never retransmits/);
assert.match(text('best-draft-fault-red.log'),/cannot resurrect a previous best draft/);
assert.match(text('expression-accepted.log'),/PASS chat-expression: 3854/);
assert.match(text('stream-accepted.log'),/PASS chat-stream: 265/);
assert.match(text('summary-accepted.log'),/PASS chat-summary-entry: 73/);
assert.match(text('wiring-r2.log'),/"complete":true,"checks":32/);
assert.equal(text('types-r2.log').trim(),'');
const perfPath=root+'performance-1792328146121.json',perf=json(perfPath);
assert.equal(perf.complete,true);
assert.equal(perf.phases.length,2);
assert.ok(perf.phases[0].samples.every((sample,i)=>sample.inputSha256===perf.phases[1].samples[i].inputSha256));
const files=['src/lib/ai/deepseek.ts','src/lib/web-api.ts','src/vite-env.d.ts','src/lib/chat/send-service.ts','src/db/chat-history-snapshot.ts','scripts/verify/chat-request-recovery.ts','scripts/verify/chat-request-recovery.mjs','scripts/verify/chat-coverage-performance.ts','scripts/verify/chat-coverage-performance.mjs'];
const report={date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',stage:'T5/T6 physical-request evidence guard and loaded history synchronization',fullPlanComplete:false,
 files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),beforeSnapshots:root+'before/',
 findings:[
  'The client performed one internal provider-error recovery without returning to the sender source guard; an edited current message could therefore be retransmitted.',
  'Classifying evidence invalidation as server:error allowed an earlier bestDraft to be restored after a quality retry. A controlled legacy-classification fault reproduces this independently.',
  'The UI store can contain a deleted or edited message after a repository mutation. Rejecting this snapshot without local synchronization causes an avoidable failed send.'
 ],
 changes:[
  'A local beforeRequest callback runs after key acquisition, before each physical BYOK/gateway request, including recovery. It is never serialized or persisted.',
  'Preflight checks current account/private session, unchanged current source, bounded selected history/bridge identities and revisions, suppression, topic CAS/evidence and any injected summary sources.',
  'Internal recovery also revalidates selected recall references and fails closed on revocation. Initial/quality attempts retain existing local recompile behavior.',
  'Guard TypeError is not a network-recovery condition; cancellation sends nothing. Evidence-invalidated errors cannot trigger previous-draft fallback.',
  'Loaded history candidates synchronize through exact sourceEvidenceKey primary keys; only changed ids hydrate bodies. No all-account tombstone or archive body scan added.'
 ],
 verification:{requestRecovery:{checks:28,evidence:root+accepted,syntheticOnly:true,includes:['ordinary recovery','current edit/delete','session transfer','account change','topic evidence edit','history edit','quality retry then revocation','stale UI revision refresh','BYOK/gateway guard TypeError','BYOK/gateway actual two-attempt callback order','payload callback exclusion','abort before request']},existingTopicWiring:{checks:32,log:root+'wiring-r2.log'},expression:{checks:3854,log:root+'expression-accepted.log'},stream:{checks:265,log:root+'stream-accepted.log'},summaryEntry:{checks:73,log:root+'summary-accepted.log'},types:{exitCode:0,log:root+'types-r2.log'},originalFailure:root+'red.log',controlledFault:root+'best-draft-fault-red.log',supersededDiagnostics:'The earlier generic-customer-service draft did not reach the intended quality retry. Its diagnostic failures are retained but do not prove a production defect; the final three-question draft reaches that path.'},
 performance:{evidence:perfPath,fixture:perf.phases[0].fixture,identicalOutgoingMessages:true,phases:perf.phases.map(phase=>({phase:phase.phase,samples:phase.samples.map(sample=>({prepareMs:sample.prepareMs,inputSha256:sample.inputSha256,reads:sample.reads}))})),interpretation:'Four sequential desktop Chrome samples per phase; mocked nonstream transport. Before 42/24/25/27ms, after 43/22/23/22ms. No Android, decoded UI, real-model latency or statistically meaningful speed claim. New index-key synchronization and selected-source reads have real cost and are listed in cursor-inclusive counters.'},
 boundaries:{paidModelCalls:0,modelTokens:0,modelFee:0,codexUsageCost:'未确认',privateChatRead:false,microphone:false,realGatewayUpstream:false,android:false,styledRightPanePreview:false,beforeAfterStyledScreenshots:false,versionChanged:false,packaged:false,deployed:false,codexProjectMove:'未验证；未修改内部数据库或配置'},
 remaining:[
  'Background summary incremental reads, late jobs and summary/state versions need the full T2/T5 fault matrix.',
  'Preflight rejects revoked inputs before retry; it cannot recall data already transmitted. Changes during a successful stream and every partial-batch commit remain a separate T6 audit.',
  'General assistant-answered source records, scoped time/domain corrections, all backup/transfer/rollback cases remain incomplete.',
  'No real-model personality or naturalness conclusions. T7 and styled actual ChatWindow T8 viewport/recording deliverables remain.'
 ]};
writeFileSync('docs/CHAT-REQUEST-RECOVERY-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--log')){
 appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-18.md',`\n### 连续性T5/T6：物理请求恢复重试前复核与加载快照同步\n- 工作目录F:/VirtuGene-Mobile；实际编码模型/推理强度未确认。按原连续性方案继续实施，上一阶段有实质源码/验证进展；本阶段非全方案完成。\n- 证实客户端内部server-error恢复原先绕过sender核验，当前源改写后还会重传旧上下文（red.log）。新增本地beforeRequest，每次直连/网关物理请求前复核当前账号/会话/当前消息/历史及补文选定来源/topic CAS/注入摘要；内部恢复另核已选召回。只读按主键/索引批量核验，不改路由/思考设置/质检，不加生成。\n- 来源失效独立于普通网络错误：webApi保留chat错误，sender不恢复bestDraft。用仅移除错误分类的隔离fault注入，复现旧草稿复活失败；完整源码不回退覆盖。最初客服腔样本未真正进入quality retry，诊断失败保留但不当产品缺陷证据，最终三连实质问句正确进入该路径。\n- 删除/编辑后的UI内存原稿曾阻断正常发送；新增chat-history-snapshot按精确sourceEvidenceKey取key，仅变动id补读正文，发送使用新版本/去掉已删项。仍重新核授权与失效，不缓存授权。\n- 28恢复/失效检查通过，覆盖直连和网关客户端模拟、普通恢复、当前编辑/删除、账号/会话转移、旧槽位与历史编辑、quality重试后失效、旧加载版本刷新、guard TypeError不重试、callback不入payload、取消不请求。原sender32、表达3854、流式265、摘要入口73及tsc退出0。\n- 性能：同512消息/8105失效/40私密日记/7事项，完整messages四对哈希一致；准备before42/24/25/27ms，after43/22/23/22ms。仅桌面顺序4样本/模拟传输，新增index key/cursor和选定正文读取成本完整记录，不推断Android/首显或统计提速。证据release/chat-request-recovery-20261018/performance-1792328146121.json。\n- 本阶段变动文件及SHA/前快照、失败/通过原稿见docs/CHAT-REQUEST-RECOVERY-2026-10-18.json。实际模型0次/0token/0费用；Codex费用/token未确认。不读私聊/Key、不用麦克风、无版本/包/安装/发布，无当前真实样式右栏/前后截图。\n- 待完成：摘要后台增量与迟到全矩阵、成功stream期间变化和分泡提交、assistant answered来源、转移/备份/回退全集，以及T7/T8人物表现与真实ChatWindow预览。已经发出的请求无法撤回，不能将请求前复核说成全链路撤权已闭环。\n`);
 appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- 2026-10-18 连续性T5/T6补物理恢复前来源核验、失效不回退旧草稿、加载旧版本本地刷新；28恢复检查与32发送/3854表达/265流式/73摘要及类型通过，同payload存量性能留证。全计划与成功流式期间/后台任务、T7/T8未完。见 [[开发日志/2026-10-18]] 及项目docs/CHAT-REQUEST-RECOVERY-2026-10-18.json。\n');
}
console.log(JSON.stringify({report:'docs/CHAT-REQUEST-RECOVERY-2026-10-18.json',fullPlanComplete:false,checks:recovery.checks.length}));
