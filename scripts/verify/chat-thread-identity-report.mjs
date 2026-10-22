import {readFileSync,writeFileSync,appendFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {basename} from 'node:path';

const root='release/chat-thread-identity-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const logText=path=>{const bytes=readFileSync(path);return bytes[0]===255&&bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8');};
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const production=['src/db/continuity-repo.ts','src/db/chat-auxiliary-guard.ts','src/store/emotion-store.ts','src/lib/ai/context-consolidator.ts','src/vite-env.d.ts'];
const stockPath=root+'/'+readdirSync(root).filter(name=>/^stock-\d+\.json$/.test(name)).sort().at(-1);
const evidence={native:root+'/checks-1792388611023.json',initialRed:root+'/checks-1792387659641.json',manualDateRed:root+'/checks-1792388154943.json',ambiguousTargetRed:root+'/checks-1792388246918.json',worldTransactionRed:root+'/worldC-transaction-red.txt',sourceWrite:'release/chat-continuity-sources-20261019/write-current-1792388611773.json',world:'release/chat-world-source-20261019/regressions-1792388618134.json',performance:stockPath};
const native=read(evidence.native),stock=read(stockPath),source=read(evidence.sourceWrite),world=read(evidence.world);
if(!native.complete||native.checks.length!==17||!native.stableSources||!stock.complete||!stock.stableSources||stock.checks.length!==12||!source.complete||source.checks.length!==65||!world.complete)throw Error('Acceptance evidence is missing or failed');
for(const path of production)if(native.sourceHashesAfter[path]!==hash(path)||stock.sourceHashesAfter[path]!==hash(path))throw Error('Production changed after verification: '+path);
const typeLog=root+'/accepted-types.log';
if(logText(typeLog).trim())throw Error('Unexpected typecheck output; inspect before reporting');
const settlementLog=root+'/accepted-settlement.log';
if(!logText(settlementLog).includes('"complete":true,"checks":70'))throw Error('Missing settlement success');
const memoryLog=root+'/final-memory.log';
if(![77,48,415].every(count=>logText(memoryLog).includes('"passed":true,"checks":'+count)))throw Error('Missing memory regression success');
let patch='';
for(const path of production){const diff=spawnSync('git',['diff','--no-index','--',root+'/before/'+basename(path),path],{encoding:'utf8'});if(diff.status>1)throw Error(diff.stderr);patch+=diff.stdout;}
const patchPath=root+'/thread-identity-production.patch';writeFileSync(patchPath,patch);
const reportPath='docs/CHAT-THREAD-IDENTITY-2026-10-19.json';
const report={date:'2026-10-19',workspace:process.cwd(),codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,stage:'Original T4 persistent identity, T5 snapshot/version and T6 compatibility',
 production:production.map(path=>({path,sha256:hash(path),beforeSnapshot:root+'/before/'+basename(path)})),patch:{path:patchPath,sha256:hash(patchPath),scope:'Five frozen pre-phase files; other shared worktree changes are not attributed to this phase.'},
 behavior:[
  'Background settlement observes at most8 source-verified open records, retaining exact IDs/dates and selected source snapshots. Existing single model call carries that bounded inventory; no extra call.',
  'Target ID requires owner/character/kind/open status, exact observed row and fresh selected sources. Unknown or stale IDs never fall back to title matching or create a shadow record.',
  'Automatic deduplication requires same kind, normalized exact title, date, scene/world origin and shared source evidence. Different dates, kinds and independent unknown-date evidence remain separate.',
  'For equal titles, a model-selected ID alone cannot close a record. Cited actual user text must identify exactly one dated occurrence. Proposed replacement dates are excluded from original-date selection.',
  'Unsupported relative/ordinal references and ambiguous statements preserve records; no general semantic/date parser is claimed. Manual content is not overwritten by automatic extraction.',
  'One-time review found same-title manual records wrongly blocking another dated event; dueAt is now part of that guard and the native failure was reproduced before correction.',
  'Final worldC regression exposed nested transaction incompatibility: createMany unnecessarily requested private messages/sessions stores during world creation. Request those stores only for automatic selected-target validation; private selected-source checks remain intact.',
 ],
 evidence:Object.fromEntries(Object.entries(evidence).map(([name,path])=>[name,{path,sha256:hash(path)}])),
 results:{native:{checks:17,failures:0,initialChecks:10,initialFailures:7,manualDateRedFailures:1,ambiguousIdRedFailures:1},sourceWrite:{checks:65,failures:0},settlement:{checks:70,log:settlementLog},world:{checks:world.results.reduce((sum,row)=>sum+row.checks,0),suites:world.results.map(({suite,checks,complete})=>({suite,checks,complete})),retainedRed:evidence.worldTransactionRed},memory:{checks:540,log:memoryLog},types:{exitCode:0,log:typeLog},
 performance:{samples:6,checks:12,fixture:stock.fixture,summary:stock.summary,notes:['50002 continuity rows include50000 unrelated closed threads, plus8105 withdrawal rows; not50000 chat messages. Same full native fixture and original-message hashes across both revisions.','Before/current guard medians are desktop synthetic native DB measurements. Added fresh checks have a measured cost; no speedup, Android or first-visible claim.','Current reads6 thread bodies per sample, not50000. Model inventory intentionally changes the settlement prompt; no claim of identical full model messages.']},
 legacyFixtureChanges:['Source-write merge tests now select a concrete observed ID/snapshot when combining disjoint sources. Manual overwrite fixture uses the same date to test the same occurrence; different-date coexistence has its own native test. No ownership or source guard is relaxed.'],
 review:{agent:'thread_identity_review',oneTimeReadOnly:true,importantFindings:1,scope:'Earlier static revision; subsequent root-owned ambiguity and transaction fixes are backed by native and existing world regressions, not claimed as separately agent-reviewed.'}},
 limits:['General semantic outcomes/reopening and the full backup/transfer/branch matrix remain unfinished in the original plan.','Conservative date disambiguation supports explicit Chinese numeric month/day and full ISO dates. Ambiguous or unsupported references do not mutate records.','No genuine model/personality/full-dialogue scoring or Android validation this phase. Earlier styled preview and recording remain historical UI evidence, not same-condition before/after for this change.'],
 boundaries:{apiCalls:0,inputTokens:0,outputTokens:0,upstreamFee:0,codexUsage:'未确认',privateUserData:false,audio:false,microphone:false,versionChanged:false,schemaChanged:false,appBuild:false,installed:false,published:false,sidebarProjectIdentity:'未确认'}};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T0','T4','T5','T6','T8']){const task=progress.tasks.find(task=>task.id===id);task.evidence=[...new Set([...(task.evidence??[]),reportPath])];}
progress.tasks.find(task=>task.id==='T4').remaining='Exact persistent selected identity/date separation and fresh source/version checks are verified in bounded cases. General semantic outcomes, explicit reopening and original cross-session/branch cases remain.';
progress.fullPlanComplete=false;
progress.next='Finish original remaining requirements only. Do not add new optimization directions or repeat broad review cycles. Real model/personality scoring remains unverified; no paid calls or release in this phase.';
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const marker='2026-10-19 — OriginalT4 persistent identity17';
const ledger='.superpowers/sdd/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18/progress.md';
if(!readFileSync(ledger,'utf8').includes(marker))appendFileSync(ledger,`\n\n${marker}: native17 GREEN, initial10/7 RED, manual different-date1 RED and ambiguous model-selectedID1 RED retained. Current source65/settlement70/world210/memory540 and types0. WorldC1 RED exposed nested messages/sessions table scope; only automatic selected-target updates request those private-source stores, fixing world creation without widening world locks or weakening source checks. Native stock6 samples12 checks:50002threads/8105withdrawals, exact fixture/originals; current6thread bodies, guard medians in ${reportPath}. No speedup/Android/personality claim. Five production hashes, patch, one-time review and limitations recorded. Full original goal remains incomplete; no added directions/model/version/schema/app-build/install/release.\n`);
const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',heading='### 原方案T4：持久事项身份与本轮收尾';
if(!readFileSync(log,'utf8').includes(heading))appendFileSync(log,`\n\n${heading}\n- 工作目录F:/VirtuGene-Mobile；实际编码模型/推理强度未确认。修改continuity-repo.ts、chat-auxiliary-guard.ts、emotion-store.ts、context-consolidator.ts、vite-env.d.ts；阶段前快照、差异和当前SHA见${reportPath}。\n- 相同标题不同日期/种类/独立来源分开保留；后台沿一次调用带最多8条已核实事项的ID和日期。更新/完成核验选中ID、来源与版本，过期/未知ID不回退。模型自选ID不充当用户选中证据；同名多日期且用户没说明时不关闭任何一场。手动内容不被自动覆盖。\n- 原生17通过，初10项7失败；手动同名异日、模糊完成分别复现1失败后修复。来源写入65、结算70、世界210、记忆540、类型通过。最后世界C曾有1失败：嵌套事务无必要请求私人消息/session表，改为仅自动更新选中来源时需要，保留失败证据，世界57项恢复通过。不是靠放松核验解决。\n- 桌面原生同资料6样本/12检查，50002事项（其中50000无关已关项）及8105来源失效记录；当前每样本只读6个事项正文。新增核验的成本和每轮数据见报告，不宣称提速/Android；本阶段无首显实测。完整模型输入因新增事项清单而改变，不写输入完全相同。\n- 支持保守明确日期；相对日/序号等未识别表达保留记录，不猜。通用语义完成、明确重开、完整转移/恢复/分支以及真实模型人物自然度仍未完成；不将局部全绿写成全方案达标。没有本阶段同条件修改前后截图/录屏，旧隔离预览仅历史UI证据。\n- 上游0调用/0token/0费用，Codex用量未确认。无私人原话、音频/麦克风、版本/schema变更、应用构建、APK、安装或发布。用户质疑工期：承认拆分过细、反复扩大检查拖长，只收原清单，不追加方向。\n`);
const index='D:/月起云归/VirtuGene/手机版/00-总览.md',entry='2026-10-19 · T4持久事项身份17';
if(!readFileSync(index,'utf8').includes(entry))appendFileSync(index,`\n- [[手机版/开发日志/2026-10-19|${entry}]]：事项ID/日期/来源及版本校验，17专项、65来源/70结算/210世界/540记忆和类型通过；保留世界事务失败与修复证据。无模型/Android/发布，完整方案仍未完成。\n`);
console.log(JSON.stringify({reportPath,fullPlanComplete:false,nativeChecks:17,worldChecks:report.results.world.checks,performanceSummary:stock.summary,apiCalls:0}));
