import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,appendFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

if(process.argv.includes('--help')){
 console.log('Generate the current persistent continuity-source evidence report; --obsidian appends the mobile development log. No tests or model calls are made.');
 process.exit(0);
}
const root='release/chat-continuity-sources-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const production=['src/db/continuity-repo.ts','src/db/index.ts','src/lib/continuity-sources.ts','src/lib/character-memory.ts','src/lib/memory-source-snapshot.ts','src/lib/world/world-recall.ts','src/store/emotion-store.ts'];
const current=value=>Object.entries(value.sourceHashesAfter??value.sourceHashes??{}).every(([path,sha])=>hash(path)===sha);
const latest=(prefix,accept)=>{
 for(const name of readdirSync(root).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort().reverse()){
  const path=root+'/'+name,value=read(path);if(accept(value))return{path,value};
 }throw Error('No current evidence for '+prefix);
};
const probe=latest('probe-',v=>v.complete&&v.checks.length===360&&v.stableSources&&current(v));
const write=latest('write-current-',v=>v.complete&&v.checks.length===65&&v.stableSources&&current(v));
const performance=latest('performance-',v=>v.complete&&!v.buildOnly&&!v.changedDuringRun.length&&current(v));
for(const entry of [probe,write,performance]){
 assert.equal(entry.value.apiCalls??entry.value.paidCalls,0);
 assert.equal(entry.value.blockedRequests,0);
}
const redPath=root+'/write-current-1792383042519.json',red=read(redPath);
assert.equal(red.checks.length,65);assert.equal(red.failures.length,10);
const before=performance.value.phases.find(p=>p.phase==='before'),after=performance.value.phases.find(p=>p.phase==='after');
assert.equal(performance.value.healthyBaselineComparison,false);
assert.equal(before.samples[0].diagnosticCause.name,'PrematureCommitError');
assert.equal(before.atomicRollback.rows.length,1);
assert.equal(after.complete,true);assert.equal(after.checks.length,96);assert.equal(after.samples.length,8);
assert.equal(after.atomicRollback.rows.length,0);assert.equal(after.atomicRollback.complete,true);
const median=values=>{const x=values.toSorted((a,b)=>a-b);return(x[(x.length-1)>>1]+x[x.length>>1])/2;};
const timings=[...new Set(after.samples.map(s=>s.transport))].map(transport=>{
 const samples=after.samples.filter(s=>s.transport===transport);
 return {transport,samples:samples.length,medianMs:Object.fromEntries(['requestMs','firstTransportBodyMs','firstStreamSnapshotMs','fullSendMs'].map(key=>[key,median(samples.map(s=>s[key]))]))};
});
const readTotals=Object.entries(after.samples[0].reads).reduce((totals,[name,row])=>{
 const [stage,table]=name.split(':');const sum=totals[stage]??={calls:0,bodies:0,returnedKeys:0,requestedKeys:0,cursorVisits:0,indexedCountSum:0,messageBodies:0,threadBodies:0,tombstoneBodies:0,diaryBodies:0};
 sum.calls+=row.calls;sum.bodies+=row.returnedBodies;sum.returnedKeys+=row.returnedKeys;sum.requestedKeys+=row.requestedKeys;sum.cursorVisits+=row.cursorVisits;sum.indexedCountSum+=row.indexedCountSum;
 for(const [prefix,key] of [['messages.','messageBodies'],['continuityThreads.','threadBodies'],['memorySourceTombstones.','tombstoneBodies'],['diaries.','diaryBodies']])if(table.startsWith(prefix))sum[key]+=row.returnedBodies;
 return totals;
},{});
const log=(name,pattern)=>{const path=root+'/'+name;assert.match(readFileSync(path,'utf8'),pattern);return{path,sha256:hash(path)};};
const regressions={
 memory:{checks:540,...log('memory-final.log',/"suite":"character-memory","passed":true,"checks":415/)},
 settlement:{checks:70,...log('settlement-final-native.log',/"complete":true,"checks":70/)},
 summary:{checks:33,...log('summary-final.log',/"complete":true,"checks":33/)},
 liveSources:{checks:63,...log('live-sources-final.log',/"complete":true,"checks":63/)},
 topicReplies:{checks:100,...log('topic-replies-final.log',/"complete": true,[\s\S]*"checks": 100/)},
 types:{exitCode:0,path:root+'/types-final.log'},
};
assert.equal(readFileSync(regressions.types.path,'utf8').trim(),'');
const patchPath=root+'/production-source-changes.patch';let patch='';
for(const file of production){
 const saved=root+'/before/'+file;
 if(!existsSync(saved)||file==='src/lib/world/world-recall.ts')continue;
 const diff=spawnSync('git',['diff','--no-index','--',saved,file],{encoding:'utf8'});
 if(![0,1].includes(diff.status))throw Error(diff.stderr);
 patch+=diff.stdout;
}
writeFileSync(patchPath,patch);
const reportPath='docs/CHAT-CONTINUITY-SOURCE-EVIDENCE-2026-10-19.json';
const report={date:'2026-10-19',workspace:process.cwd(),plan:'C:/Users/34568/Desktop/virtugene plan/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18.md',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,stage:'T4/T6 persistent source provenance with T5 selected-source atomic guards; scoped manual completion',
 production:production.map(path=>({path,sha256:hash(path)})),patch:{path:patchPath,sha256:hash(patchPath),scope:'Per-file snapshots, not one historical revision. New continuity-sources.ts is included as a hashed full source; world-recall snapshot was captured after its guard, so omitted from before/after patch rather than pretending it is a pre-fix file.'},
 implemented:[
  'Optional bounded private-chat evidence records original session/message/revision/prefix span, captured from actual settlement input rather than model-supplied versions. No schema or app-version bump in this phase.',
  'Creation and merge preserve all required premises; overflow, conflicting revisions or absent old proof do not silently certify a truncated list. Legacy AI rows remain stored but cannot be confirmed recall without historic proof.',
  'Candidate/catalog/final private recall and derived world-history references validate actual selected sources, suppressions, ownership and event ACL. Foreign candidate access is rejected before following private source chains.',
  'Final selected source proofs, suppression authorization and whole-row snapshots are rechecked in one native readonly transaction after earlier awaits; no early boolean reuse or cross-round authorization cache.',
  'Private-chat attribution stays unclassified; manual and world records are identified separately. World-history completed references expose their real status instead of masquerading as open arrangements.',
  'AI duplicate extraction cannot overwrite manual content. Automatic manual completion requires a narrow, explicit source-backed record-control command; quoted/hypothetical/negated/unrelated/question text, stale revisions and ambiguous multiple targets are rejected. The direct UI completion remains available.',
  'Automatic completion checks actual incoming selected originals in the native write transaction and compares the selected thread again before changing it. Original and new private AI completion references are merged without fabricating proof.',
 ],
 evidence:{probe:{path:probe.path,sha256:hash(probe.path),checks:360},write:{path:write.path,sha256:hash(write.path),checks:65,localSettlementStubs:write.value.modelStubCalls},
  manualRed:{path:redPath,sha256:hash(redPath),checks:65,failures:10},
  originalRed:root+'/probe-1792380141730.json',expandedRed:root+'/probe-1792380640887.json',
  raceReds:[root+'/probe-1792381271106.json',root+'/probe-1792381534748.json',root+'/probe-1792381836585.json'],
  performance:{path:performance.path,sha256:hash(performance.path),driverChecks:performance.value.checks.length,currentSampleChecks:96,fixtureSha256:performance.value.fixtureSha256,fixturePath:performance.value.fixturePath,fixtureFileSha256:performance.value.fixtureFileSha256,fixture:performance.value.fixture,healthyBaselineComparison:false,timings,readTotals,
   baseline:'Frozen five-file overlay fails with PrematureCommitError after durable writes, even without read probes. It is not a healthy latency baseline and no speedup is calculated. Other sources remain current, including world-recall; this is not a release comparison.',
   rollback:'Actual second-bubble write failure leaves one old-baseline row; current path leaves zero, with no production sender keep-alive/timeout hack.',
   simulatedCalls:11,actualPaidCalls:0,limits:'Desktop isolated native Chromium IndexedDB with simulated buffered/SSE waits; first JS snapshot is not decoded visible UI. No Android or real-model guarantee. Whole sending reads include repeated fresh checks and existing candidate/diary costs; the 16-message-body selected8-thread probe is not a whole-send count. History/current user/existing user-fact hashes match; system attribution intentionally changes, so complete payload hashes need not match.'},
 },regressions,
 rulings:[
  'Source provenance proves live user words, not arbitrary semantic extraction or automatic completion truth. Explicit manual control stays conservative, and direct UI controls remain intentional actions.',
  'Manual/scene/world/private origins are not merged by similar title alone; ambiguous automatic completion is refused rather than choosing a first match. Exact identities and dates still need broader T4 work.',
  'Source deletion does not erase user-visible originals of old derived rows; final recall rejects unproven records. Existing legacy data is not silently re-certified.',
 ],
 limitations:[
  'No general semantic completion proof for AI-origin threads; a live source index alone is not proof that model-selected completion text is correct.',
  'Manual control currently accepts a deliberately narrow command grammar. Unsupported natural paraphrases do not auto-close records; no claim of general Chinese NLU.',
  'External scene/world sources lack persisted historical revision provenance. Their fresh ACL checks do not prove all legacy semantics.',
  'World-turn can turn selected history into plaintext before later Director/Actor waits; those producer-specific late-source guards remain.',
  'T2 durable dirty-aware positioning and cumulative source-body costs; T3 scoped temporal/domain corrections; full T4 identity/reopen matrix; T5 other producers; T6 full restore/branch matrix; T7 real character naturalness; T8 styled four-width component previews and recordings remain.',
  'No same-condition UI screenshots/recordings, new right-pane preview, physical Android tests or real-model evaluations this phase.',
 ],
 boundaries:{upstreamModelCalls:0,inputTokens:0,outputTokens:0,upstreamFee:0,codexTokensAndCost:'未确认',privateUserDataRead:false,audio:false,microphone:false,versionChanged:false,apkBuilt:false,installed:false,published:false,sidebarProjectVerified:false},
};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
// An accidental --help call to an older generator rewrote its historical hash
// observations. Preserve the original raw evidence, and explicitly remove any
// suggestion those current hashes were captured by the old run.
const historicalPath='docs/CHAT-SETTLEMENT-GUARD-2026-10-18.json';
const historical=read(historicalPath);
if(!historical.reportRegenerationDisclosure){
 historical.filesObservedAt20261019ReportRegeneration=historical.files;delete historical.files;
 historical.reportRegenerationDisclosure='2026-10-19: an accidental --help invocation of its legacy generator regenerated this report without running tests. Historical source hashes are not recoverable from that invocation; the listed hashes are current observations, not historical bindings. Original raw test evidence remains; fresh current 70-check settlement evidence is separately linked in CHAT-CONTINUITY-SOURCE-EVIDENCE-2026-10-19.json. Do not count report generation as a test.';
 writeFileSync(historicalPath,JSON.stringify(historical,null,2)+'\n');
}
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T4','T5','T6']){const task=progress.tasks.find(t=>t.id===id);task.evidence=[...new Set([...(task.evidence??[]),reportPath])];}
progress.tasks.find(t=>t.id==='T4').remaining='Private source provenance and scoped manual control implemented. General semantic outcomes, exact identities/dates, complete reopening and domain/temporal correction remain.';
progress.tasks.find(t=>t.id==='T5').remaining='Private settlement/analysis, memory worker and selected continuity final guards covered in tested cases. Other producers including late world-turn Director/Actor source changes remain.';
progress.tasks.find(t=>t.id==='T6').remaining='Source edit/delete/suppression and actual sync roundtrip covered for new private threads; external historical versions, complete backup/transfer/branch matrix and late plaintext producers remain.';
progress.next='Continue exact persistent identity/outcome and world producer late-source checks; retain T2/T3/T7/T8 remaining acceptance matrix.';
progress.fullPlanComplete=false;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const ledger='.superpowers/sdd/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18/progress.md';
const marker='2026-10-19 — Persistent source phase final evidence recorded';
const note=`\n\n${marker}: ${reportPath}. Current probe360, write65 (manual-control expanded RED10→GREEN0), memory540, settlement70, summary33, liveSources63, topicReplies100 and tsc0. Current performance8 samples/96 sample checks, fixture ${performance.value.fixtureSha256}, native forced second-bubble rollback leaves0 rows vs frozen unhealthy baseline1. Baseline PrematureCommitError means no healthy latency speedup comparison; desktop/simulated only. Session55479 had already completed0; final refreshed performance is ${performance.path}. Whole-read counts remain in report, not reduced to selected-only bounds.\n\nRuling: preserve legitimate manual completion via explicit source-backed record-control commands and direct UI completion; reject unrelated/quoted/hypothetical/negated/question sources and stale revisions, and do not guess among distinct matching records. General AI semantic completion is still not proven. One-time independent review findings addressed with actual native RED→GREEN; no review redispatch loop.\n\nEvidence handling correction: accidental --help on legacy chat-settlement-report.mjs regenerated its historical report, not tests. Marked current hash observations as regeneration-time only, retained raw evidence, reran actual settlement70 separately, repaired aggregate progress and deduplicated evidence. No historical source binding is fabricated. No API/model/audio/device/version/package/release work. Actual coding model/reasoning unknown. Full goal remains active and incomplete.\n`;
if(!readFileSync(ledger,'utf8').includes(marker))appendFileSync(ledger,note);
if(process.argv.includes('--obsidian')){
 const logPath='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',indexPath='D:/月起云归/VirtuGene/手机版/00-总览.md';
 const heading='## 连续性 T4/T6：持久事项来源、原子复核与手动完成边界';
 if(!readFileSync(logPath,'utf8').includes(heading))appendFileSync(logPath,`\n\n${heading}\n\n- 工作目录F:/VirtuGene-Mobile；实际编码模型/推理强度未确认。改动文件、逐文件SHA/差异和原始证据见${reportPath}。本阶段全方案未完成。\n- 新事项保存实际结算输入中的用户来源、会话、revision和字符范围。旧AI记录保留但不猜历史证明；私聊线索标注未分类，手动和世界来源分别归属。编辑/删除/抑制原文后，候选、目录、选中复核和世界派生读取拒绝失效线索；来源、权限及快照最后在一个原生事务中核验。外账号候选先拒绝再跟随来源。\n- 模型不能用谢谢/转述/假设/否定/问句关闭手动事项；明确记录控制命令和界面完成仍有效。自动写入再次核验选中对象和来源版本，多对象不猜。人工记录内容不受重复提取覆盖。AI事项通用语义完成、精确日期身份、外部历史版本仍未全面完成。\n- 原生来源360项、实际结算/同步65项、memory540、结算70、摘要33、liveSources63、回复100及类型检查通过。手动控制65项先10失败后全通过；其余竞态RED和修正均保留。全部是合成资料+本地替身，不是真实模型人味达标。\n- 存量512消息/8105失效/40合成日记/8事项：当前8样本96项通过，${timings.map(x=>x.transport+'准备中位'+x.medianMs.requestMs.toFixed(2)+'ms/首JS'+x.medianMs.firstStreamSnapshotMs.toFixed(2)+'ms').join('；')}。只读桌面隔离模拟传输，首JS不是解码首显，不是Android保证。旧五文件baseline有PrematureCommitError，不能算健康提速对照；强制第二泡失败旧残1行、当前0行。完整fixture ${performance.value.fixtureSha256}；全轮读取次数/正文/键/游标见报告，不拿单独8事项核验16正文代替整轮。\n- 文档处理纠正：旧report脚本无help保护，误调用后重生成历史报告；已标注其hash为本轮观察而非历史绑定，原始证据保留；另实跑结算70，未把生成报告算成测试。\n- 上游模型0调用/0token/0费用，Codex实际用量费用未确认。无私人资料、密钥、音频、设备、版本、APK、安装、部署或发布。无同条件UI前后截图/录屏或本阶段新右侧预览，侧栏官方归属未验证。\n- 剩余：T2持久定位和累计读取、T3时态范围、T4通用语义/身份、world-turn后续await来源保护、完整分支/备份矩阵、T7人物人工评分、T8四宽真实组件演示。\n`);
 if(!readFileSync(indexPath,'utf8').includes('持久事项来源与手动完成边界'))appendFileSync(indexPath,'\n- [[手机版/开发日志/2026-10-19|2026-10-19 · 持久事项来源与手动完成边界]]：360来源/65写入同步与相关回归通过；存量模拟性能8样本，旧baseline失败不算提速。全方案、真实模型和四宽演示未完成；无版本/发布。\n');
}
console.log(JSON.stringify({report:reportPath,probe:360,write:65,performanceSamples:8,fullPlanComplete:false,paidCalls:0},null,2));
