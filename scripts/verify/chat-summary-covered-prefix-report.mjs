import {readFileSync,writeFileSync,readdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root='release/chat-summary-covered-prefix-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const tests=['scripts/verify/chat-summary-covered-prefix.ts','scripts/verify/chat-summary-covered-prefix.mjs'];
const production=['src/db/chat-summary-archive.ts','src/db/index.ts'];
const latest=(prefix,accept)=>{
  for(const name of readdirSync(root).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort().reverse()){
    const path=root+'/'+name,value=read(path);if(accept(value))return{path,value};
  }throw Error('Missing matching evidence: '+prefix);
};
const currentTests=value=>tests.every(path=>value.sourceHashesAfter?.[path]===hash(path));
const currentProduction=value=>production.every(path=>value.sourceHashesAfter?.[path]===hash(path));
const independent=latest('current-',value=>value.complete&&value.stableSources&&value.stableEffectiveSources&&currentTests(value)&&currentProduction(value));
const matched=read(root+'/final-matched-comparison.json');
const after={path:matched.currentPath,value:read(matched.currentPath)},before={path:matched.baselinePath,value:read(matched.baselinePath)};
if(!after.value.complete||!after.value.stableSources||!currentTests(after.value)||!currentProduction(after.value)
  ||!before.value.beforeMode||!before.value.stableEffectiveSources||!currentTests(before.value)
  ||before.value.failures?.length!==3||!before.value.failures.every(label=>/^scale-\d+ covered-prefix capture reads/.test(label)))throw Error('Matched evidence is not current');
const migration=latest('migration-',value=>value.complete&&value.stableSources&&value.stableEffectiveSources&&currentTests(value)&&currentProduction(value));
if(migration.value.totalMessagesBefore!==50003||migration.value.originalRowsHash!==migration.value.migratedRowsHash)throw Error('Migration must preserve all 50003 original rows');
const pairs=before.value.rows.map(old=>{
  const current=after.value.rows.find(row=>row.scenario===old.scenario);
  for(const key of ['inputHash','modelInputHash','segmentsHash','cursorHash','previousSummaryHash'])
    if(!current||old[key]!==current[key])throw Error('Changed candidate evidence: '+old.scenario+' '+key);
  return{scenario:old.scenario,inputHash:current.inputHash,modelInputHash:current.modelInputHash,segmentsHash:current.segmentsHash,cursorHash:current.cursorHash,
    beforeMs:old.elapsedMs,afterMs:current.elapsedMs,beforeBodyRows:old.messageBodyRows,afterBodyRows:current.messageBodyRows,
    beforeKeyRows:old.messageKeyRows,afterKeyRows:current.messageKeyRows,beforeHeap:old.heapBefore,beforeHeapAfter:old.heapAfter,afterHeap:current.heapBefore,afterHeapAfter:current.heapAfter};
});
if(pairs.length!==after.value.rows.length)throw Error('Comparison scenarios differ');
const requireLog=(name,pattern)=>{const path=root+'/'+name;if(!pattern.test(readFileSync(path,'utf8')))throw Error('Verification missing: '+path);return path;};
const regressions={
  archive:{checks:49,log:requireLog('archive-final.log',/"checks":\s*49/)},
  actualSummary:{checks:33,log:requireLog('summary-live-final.log',/"complete":true,"checks":33/)},
  summaryCAS:{checks:28,log:requireLog('summaryCAS.log',/"complete":true,"checks":28/)},
  pagination:{checks:17,log:requireLog('pagination.log',/PASS history-pagination: .*"checks":17,.*"upgradeTo":43/)},
  provenance:{checks:7,log:requireLog('provenance.log',/PASS history-provenance: 7 boundary checks/)},
  draftStorage:{checks:33,log:requireLog('draft-storage.log',/"count":33/)},
  replyCommit:{checks:66,log:requireLog('reply-commit.log',/"complete":true,"checks":66/)},
  chatStream:{checks:265,log:requireLog('chat-stream.log',/PASS chat-stream: 265 checks/)},
  types:{exitCode:0,log:root+'/types-final.log'},
};
if(readFileSync(regressions.types.log,'utf8').trim())throw Error('Inspect typecheck output');
let patch='';
for(const path of [...production,'scripts/verify/character-draft-storage.ts']){
  const frozen=root+'/before/'+path,result=spawnSync('git',['diff','--no-index','--',frozen,path],{encoding:'utf8'});
  if(result.status>1)throw Error(result.stderr);patch+=result.stdout+'\n';
}
writeFileSync(root+'/production-and-compatibility.patch',patch);
const report={date:'2026-10-19',workspace:process.cwd(),plan:'C:/Users/34568/Desktop/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18.md',
  stage:'T2 covered-prefix candidate positioning',fullPlanComplete:false,model:'未确认',reasoning:'未确认',
  production:production.map(path=>({path,sha256:hash(path),before:{path:root+'/before/'+path,sha256:hash(root+'/before/'+path)}})),
  verificationSources:[...tests,'scripts/verify/chat-summary-metadata-native.mjs','scripts/verify/character-draft-storage.ts'].map(path=>({path,sha256:hash(path)})),
  patch:root+'/production-and-compatibility.patch',
  implemented:[
    'Preserve the original first 64-body archive page; an already complete early batch/long tail never pays for new archive-wide keys.',
    'For sufficiently dense sourced coverage, a native [sessionId+revision+content.length] index proves unchanged revision and length. At most 32 exact buckets with at least 64 sources each; missing native revision, partial offsets or mismatches fall back to original bodies.',
    'Fresh chronological primary IDs discover older insertions; seek each next uncovered span with one original get plus a native page of at most 63 following originals, preserving ordering and body batching.',
    'Do not cache authorization or remove any final source body checks; candidate keys never establish nonfailed state or replace source revocation/version guards.',
    'Additive schema42 to43 creates the native index without rewriting originals; every previous table/index is retained. Related draft compatibility assertion now permits newer additive schemas.',
  ],
  evidence:{before:before.path,after:after.path,migration:migration.path,independentValidation:independent.path,
    initialPerformanceRed:root+'/red-1792377156792.json',earlyRegressionRed:root+'/current-1792377471623.json',nearPrefixRegressionRed:root+'/current-1792377788197.json',
    firstIntermediate:root+'/intermediate-before-lazy/chat-summary-archive.ts',secondIntermediate:root+'/intermediate-before-probe64/chat-summary-archive.ts',
    draftCompatibilityRed:root+'/draft-storage-red.log',nativeAlternatives:root+'/native-perf-1792377171629.json'},
  correctness:{checks:after.value.checks.length,scenarios:pairs.length,allComparedInputAndCandidateHashesEqual:true,
    scope:'Actual readonly captureChatSummaryArchive in fresh isolated native Chromium DB. Candidate-history hash is not a complete production-provider payload hash or real-model quality measurement.'},
  scale:pairs.filter(row=>row.scenario.startsWith('scale-')),allScenarioComparisons:pairs,
  independentRepeat:independent.value.rows.filter(row=>row.scenario.startsWith('scale-')).map(row=>({scenario:row.scenario,elapsedMs:row.elapsedMs,bodyRows:row.messageBodyRows,keyRows:row.messageKeyRows})),
  migration:{checks:migration.value.checks.length,from:42,to:43,rows:50003,upgradeMs:migration.value.upgradeElapsedMs,
    originalRowsHash:migration.value.originalRowsHash,migratedRowsHash:migration.value.migratedRowsHash,
    heapBefore:migration.value.heapBefore,heapAfter:migration.value.heapAfter},regressions,
  rulings:[
    'Rejected getAllRecords as key-only access: native results include values. Cursor alternatives were measured, but only grouped native getAllKeys is used in production.',
    'Length alone was insufficient for native writes keeping stale source projections; the native revision is included and missing revisions conservatively fall back.',
    'Review found eager index work regressed early batches. A 12-row probe still regressed nearby insertions fitting the original 64-row page. Both REDs and intermediate sources are retained; final code keeps the original first page.',
    'Dense scale budget changed from provisional128 to140 = recent64 + original probe64 + actual new12. Other tested spans use explicit192/256 budgets; every native body page remains at most64. No segment, permission or source-validation threshold was weakened.',
    'Early fixture growth-tail expectation accidentally crossed the recent18 boundary; corrected test and all raw failures retained. New-path correctness fixtures use200+ covered sources and targets beyond the first64, with actual index-use checks.',
    'Use the authorized shared workdir and scoped before snapshots, no unrelated reset/staging/commit, model/config changes or extra product scope.',
  ],
  limits:[
    'Still O(N) source/length/chronological keys for dense coverage, not a durable dirty-aware bookmark. Sparse or highly diverse offsets may retain original body scans. Fully cumulative final commit still reads source bodies.',
    'Capture-only timing excludes fixture setup, hashing, opening/upgrade and final commit/ledger/model/first-visible work; it is not a user reply latency or Android benchmark. All before/after observations retained; small cases can still fluctuate or be slower.',
    'First native index creation was measured once on desktop with50003 short synthetic rows; this is not an Android startup or production write-overhead guarantee.',
    'Native failed changes retaining stale derived keys remain an existing source-index boundary; candidate length keys do not prove nonfailed status. Final full-body guards continue to reject invalid commits.',
    'Heap snapshots are before/after only, not peak memory; synthetic native setup bypasses production history-search tokenization and is excluded from capture timing.',
    'Input hashes cover supplied session/original-message fixture values, not a byte-for-byte whole-database hash. Deterministic suppression/foreign-row setups are recorded by the fixture source.',
    'No new styled component preview, same-condition UI screenshots/recording, Android test or real-model human/personality scoring in this backend step. Full T0–T8 requirements remain incomplete.',
  ],
  usage:{realModelCalls:0,inputTokens:0,outputTokens:0,realProviderCost:0,codexUsageAndCost:'未确认'},
  noVersionPackageInstallDeployPublish:true,
  reproduce:[{command:'node scripts/verify/chat-summary-covered-prefix.mjs --red',expectedExitCode:1,reason:'Saved-before control intentionally fails exactly three scale body budgets'},
    {command:'node scripts/verify/chat-summary-covered-prefix.mjs',expectedExitCode:0},{command:'node scripts/verify/chat-summary-covered-prefix.mjs --migration',expectedExitCode:0}],
  next:'T2 durable dirty-aware positioning/cumulative final-source cost remains; continue T4 assistant-answer evidence and remaining T3/T5/T6/T7/T8 requirement audit.'};
const path='docs/CHAT-SUMMARY-COVERED-PREFIX-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath),t2=progress.tasks.find(task=>task.id==='T2');
t2.evidence=[...new Set([...t2.evidence,path])];t2.remaining='Dense covered prefixes use fresh native revision/length key positioning with unchanged final source checks. O(N) key scans, sparse/diverse body fallback, durable dirty-aware positioning and cumulative final source-body cost remain.';
progress.fullPlanComplete=false;progress.next=report.next;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
if(process.argv.includes('--obsidian')){
  const journal='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',index='D:/月起云归/VirtuGene/手机版/00-总览.md';
  const heading='## 连续性方案 T2：已覆盖摘要前缀的正文跳读';
  const scale=report.scale.map(row=>`${row.scenario.replace('scale-','')}条：正文${row.beforeBodyRows}→${row.afterBodyRows}，本次${row.beforeMs.toFixed(1)}→${row.afterMs.toFixed(1)}ms`).join('；');
  if(!readFileSync(journal,'utf8').includes(heading))appendFileSync(journal,`\n\n${heading}\n\n- 工作目录F:/VirtuGene-Mobile；实际编码模型及推理强度均未确认。按桌面既有方案继续T2，使用executing-plans及调试/验证技能；保留共享工作区，root改生产，子代理做隔离夹具、原生备选实验和只读审阅。未自动提交、移动任务或改Codex内部状态。\n- 实际改动：chat-summary-archive.ts按当前版本和正文长度批量定位已覆盖原文，原64条首页能凑足本批就直接返回；不够才按原生索引键跳过匹配覆盖、读取下一段原文。index.ts增加schema43原生[sessionId+revision+content.length]索引，保留旧索引，不重写原记录；character-draft-storage.ts修正旧42硬断言，草稿语义/隔离/回滚33项仍验证。完整差异见项目${root}/production-and-compatibility.patch。\n- 原先每次从头读已总结正文：${scale}。同${pairs.length}组夹具的input、原文segments、旧摘要和cursor hash全部一致；这是候选捕获计时，不是完整provider payload hash、首显、模型速度或Android。读键仍O(N)，保留各小case变慢与全部原始样本，不挑最快。\n- 过程中的失败如实保留：初版即使首批补插已够也先查全历史键；12行懒探仍漏了前12已覆盖、后12新插入的邻近场景。两次实际RED后最终恢复原64原稿首块和其offset检查，密集样本正文140=64近期+64首探+12新原稿。自拟128门槛按该构成改140，其他段192/256，单页64不变，没有缩减输入或弱化权限；首轮growth夹具预期越过最近18条边界亦已纠正，旧失败均留存。\n- 正确性${report.correctness.checks}项通过，关键回插/同毫秒/增长缩短/新revision保留旧derived key/缺revision/长消息部分offset/整页失败撤回空白均实际走新索引路径；全覆盖不生成、不改session，少量探测后剩余均覆盖也不重复。正式缺revision记录不匹配新索引，回正文，不猜补版本；来源、抑制和最终fresh正文核验完整保留。\n- 真实v42→43原生升级${report.migration.checks}项通过，50003条消息原字段hash一致，旧store/index全部保留，native编辑/转移/删除/事务回滚均核对；单次桌面开库建索引${report.migration.upgradeMs.toFixed(1)}ms，heap仅前后非峰值，不作手机启动或写入开销保证。\n- 相关回归：archive49、实际summary33、CAS28含原生旧投影反例、分页17、来源7、草稿33、reply commit66、实际ChatWindow stream265、tsc退出0。无统一全项目test入口，不宣称全部软件或真实模型达标。证据和源hash见项目${path}、${root}/；README式复现命令在report。\n- 限制与下一步：密集候选仍约多份O(N)键；离散offset/未覆盖很多会回旧正文页。最终累计来源正文验证仍在，完整dirty-aware游标、T4角色answered证据、其余范围/分支与T7/T8四视口及完整对话验收仍未完成。没有本阶段同条件软件UI图/视频或活跃右栏预览，原生基准图不是产品UI。\n- 本阶段真实上游0调用/0输入输出tokens/0费用，Codex用量费用未确认；未读私密聊天/密钥，未操作麦克风、声音、设备；未修改应用版本、打包、安装、部署、发布或官网。整体目标仍active，阶段进步不等于全方案完成。\n`);
  const label='- 2026-10-19 连续性T2已覆盖摘要前缀跳读';
  if(!readFileSync(index,'utf8').includes(label))appendFileSync(index,`\n${label}：${report.correctness.checks}专项、${report.migration.checks}升级及相关回归通过；5万条密集覆盖正文${report.scale.at(-1).beforeBodyRows}→${report.scale.at(-1).afterBodyRows}，候选内容hash一致；保留fresh正文核验，读键/累计成本与全方案仍未完成。无模型/Android/发布。见[[开发日志/2026-10-19]]与项目CHAT-SUMMARY-COVERED-PREFIX-2026-10-19.json。\n`);
}
console.log(JSON.stringify({path,fullPlanComplete:false,checks:report.correctness.checks,scenarios:pairs.length,migration:report.migration,scale:report.scale.map(row=>({scenario:row.scenario,beforeMs:row.beforeMs,afterMs:row.afterMs,beforeBodies:row.beforeBodyRows,afterBodies:row.afterBodyRows})),regressions},null,2));
