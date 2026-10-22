import {readFileSync,writeFileSync,readdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-summary-ledger-batch-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const source='src/db/memory-ledger-repo.ts',sourceSha256=hash(source);
const latest=(prefix,accept)=>{
  for(const name of readdirSync(root).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort().reverse()){
    const path=root+'/'+name,value=read(path);if(accept(value))return{path,value};
  }throw Error('Missing current evidence '+prefix);
};
const validation=latest('after-',value=>value.complete&&value.correctness?.complete&&value.correctness.checks.length===90&&value.sourcesStable&&value.sourceSha256===sourceSha256);
const newBefore={path:root+'/red-1792376260212.json',value:read(root+'/red-1792376260212.json')};
const newAfter={path:root+'/after-1792376311754.json',value:read(root+'/after-1792376311754.json')};
const existingBefore={path:root+'/existing-red-1792376316688.json',value:read(root+'/existing-red-1792376316688.json')};
const existingAfter={path:root+'/existing-after-1792376319057.json',value:read(root+'/existing-after-1792376319057.json')};
const scale={path:root+'/existing-scale-after-1792376326856.json',value:read(root+'/existing-scale-after-1792376326856.json')};
for(const result of [newAfter,existingAfter,scale])if(!result.value.complete||!result.value.sourcesStable||result.value.sourceSha256!==sourceSha256)throw Error('Evidence is not current: '+result.path);
const compare=(before,after)=>before.value.performance.map(old=>{
  const current=after.value.performance.find(row=>row.count===old.count);
  if(old.inputSha256!==current.inputSha256||!current.correct||!current.withinBudget)throw Error('Comparison must preserve input and correctness');
  return{count:old.count,inputSha256:current.inputSha256,beforeMs:old.elapsedMs,afterMs:current.elapsedMs,beforeMetrics:old.metrics,afterMetrics:current.metrics,concurrentSessionRead:current.competingSessionRead};
});
const requireLog=(name,expression)=>{const path=root+'/'+name;if(!expression.test(readFileSync(path,'utf8')))throw Error('Missing verification in '+path);return path;};
const regressions={
 memory:{checks:540,log:requireLog('memory-final-code.log',/"suite":"character-memory","passed":true,"checks":415/)},
 summary:{checks:33,log:requireLog('summary-final-code.log',/"complete":true,"checks":33/)},
 worker:{checks:93,log:requireLog('worker-final-code.log',/"complete":true,"checks":93/)},
 settlement:{checks:70,log:requireLog('settlement-final-code.log',/"complete":true,"checks":70/)},
 summaryCAS:{checks:28,log:requireLog('summary-cas.log',/"complete":true,"checks":28/)},
 types:{exitCode:0,log:root+'/types-final-code.log'},
};
if(readFileSync(regressions.types.log,'utf8').trim())throw Error('Inspect final typecheck output');
for(const [suite,count] of [['memory-continuity',77],['memory-final',48],['character-memory',415]]){
 if(!readFileSync(regressions.memory.log,'utf8').includes(JSON.stringify({suite,passed:true,checks:count})))throw Error('Missing memory suite '+suite);
}
const report={date:'2026-10-19',workspace:process.cwd(),fullPlanComplete:false,stage:'T2 aggregate-summary ledger batching',model:'未确认',reasoning:'未确认',
 production:{path:source,sha256:sourceSha256,before:{path:root+'/before/memory-ledger-repo.ts',sha256:hash(root+'/before/memory-ledger-repo.ts')}},
 tests:['scripts/verify/chat-summary-ledger-batch.ts','scripts/verify/chat-summary-ledger-batch.mjs','scripts/verify/chat-summary-source-index-native.mjs','scripts/verify/chat-summary-cas.ts'].map(path=>({path,sha256:hash(path)})),
 implemented:[
  'Aggregate summary only: first source reuses public record creation/conflict behavior, remaining evidence folds in original order within one native transaction; ordinary/imported/no-session bridges retain original paths.',
  'Canonical claim lookup once, claim and knowledge writes at most twice, per-source evidence preserved with chunks no larger than 256; cross-chunk duplicates read this same transaction previous writes.',
  'Late writes fail atomically: no partial claim, knowledge or earlier-source evidence is committed.',
  'Standalone bridge reads session type before its ledger write transaction, matching old timing and avoiding new session write-lock contention. Existing caller parent transactions keep their original locks and atomicity.',
  'Fresh summary commit body validation remains unchanged; actual CAS tests reject raw native failed/shortened sources with intentionally stale derived indexes.',
 ],
 evidence:{validation:validation.path,newBefore:newBefore.path,newAfter:newAfter.path,existingBefore:existingBefore.path,existingAfter:existingAfter.path,existingScale:scale.path,
  initialRed:root+'/red-1792375719582.json',boundedBatchRed:root+'/after-1792375909569.json',sessionLockRed:root+'/after-1792376255477.json',
  rejectedKeyOnly:'release/chat-summary-source-index-20261019/native-characterization-1792375499955.json'},
 correctness:{checks:90,scope:'Actual syncMemoryItem state vs sequential public record under fixed time; explicit permission/provenance assertions, cross-account/character, groups/imports, three cross-chunk duplicate/withdrawal cases and third-batch rollback'},
 newEvidenceComparison:compare(newBefore,newAfter),existingEvidenceComparison:compare(existingBefore,existingAfter),afterOnlyScale:scale.value.performance,
 repeatObservations:validation.value.performance.map(row=>({count:row.count,elapsedMs:row.elapsedMs,concurrentSessionRead:row.competingSessionRead})),regressions,
 rulings:[
  'Rejected pure metadata/key-only final source checks: native writes can retain stale derived evidence keys, and boolean failed is not natively indexable. Fresh body checks retain safety; no production schema/index migration was introduced.',
  'Reuse first record rather than duplicate its creation/conflict implementation: bound is two claim/knowledge writes, not one. An initial one-write test budget was corrected and its results retained.',
  'Chunk evidence at 256 instead of cloning all N evidence rows into new maps. This bounds additional batch objects, not total input, graph size, heap or total time.',
  'Initial helper unnecessarily held a session write lock; independent native second-connection evidence demonstrated the regression before removal. Final ledger transaction touches only its three tables when standalone.',
  'Keep the user designated shared workdir and dirty checkout; scoped before snapshots and isolated DB fixtures, no unrelated staging/reset or fabricated commits.',
 ],
 limits:[
  'Single desktop observations, no controlled Android or p50/p95. Extra independent root run overlapped other regressions; all observations are retained, not just the fastest sample.',
  '512/1000 sources have matched before/after input hashes; 50000 existing sources were measured after only, not a same-size improvement comparison.',
  'Input hashes cover the supplied memory and declared fixture/seed inputs. Runtime timestamps and generated claim identities are not a full database byte-for-byte equality claim.',
  'Standalone native transaction counts are not the number of transactions in an enclosing upsertSessionSummary call, which already used one parent transaction before.',
  'Evidence remains O(N); final 50000 existing sources read and write all 50000 rows. Ledger/parent write locks can still delay callers using those tables; only the unnecessary standalone session lock was eliminated.',
  'Full cumulative source body validation and covered-prefix archive scanning remain; dirty-aware durable candidate cursor and all T0–T8 final audit/UI/personality gates are not complete.',
  'No same-condition UI screenshots/recording, right-pane preview or Android this backend step. No real model output or human/personality quality assertion.',
 ],usage:{realModelCalls:0,inputTokens:0,outputTokens:0,realProviderCost:0,codexUsageAndCost:'未确认'},
 noVersionPackageInstallDeployPublish:true,next:'Continue T2 durable candidate/cumulative cost work, then complete T4 answer evidence and the T3/T5/T6/T7/T8 requirement matrix'};
const path='docs/CHAT-SUMMARY-LEDGER-BATCH-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath),t2=progress.tasks.find(task=>task.id==='T2');
t2.evidence=[...new Set([...t2.evidence,path])];t2.remaining='Candidate paging and aggregate ledger batching implemented with preserved source/withdrawal guards. Covered-prefix scans, dirty-aware durable positioning and fresh cumulative source body cost remain; key-only replacement was disproved by native-write evidence.';
progress.fullPlanComplete=false;progress.next=report.next;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
if(process.argv.includes('--obsidian')){
 const journal='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',index='D:/月起云归/VirtuGene/手机版/00-总览.md';
 const heading='## 连续性方案 T2：摘要来源账本批处理与锁范围回归';
 if(!readFileSync(journal,'utf8').includes(heading))appendFileSync(journal,`\n\n${heading}\n
- F:/VirtuGene-Mobile；实际编码模型/推理强度均未确认。按既有桌面方案使用superpowers:executing-plans、systematic-debugging、test-driven-development和verification-before-completion，保留当前共享dirty工作区，独立子代理只做原生特性探针/回归与审查；源快照而非覆盖并行代码，未自动提交或移工作目录。完整目标仍active，T2与全T0–T8未完成。
- 先否定不安全的提速方案：原生content.length索引可自动更新长度，但布尔failed不可原生索引。直接原生put保留旧派生key时，key-only会漏失效。保留updateSummary fresh正文检查，没有新增生产schema/index；新增2项实际CAS反例验证失败标记/正文缩短仍拒绝。原生characterization是临时隔离数据库，不是正式schema升级验收。
- 实际定位syncMemoryItem对每条累计来源重查canonical claim、重写claim/knowledge且逐条桥接。仅aggregate summary批处理：首源复用record的创建/冲突逻辑，余源按原顺序fold同源新revision/撤回/异源重新授权，256条一批读写证据，claim/knowledge多源最多各2写，单源仍1；普通auto、imported及无session入口保留。一个原生ledger事务内全部证据、claim、edge要么成功要么回滚，不跨轮缓存授权。
- 必要回归：初版把sessions加入整个ledger写事务，实际第二native connection读取session等待到job结束（24.3/44.3ms），这是新引入锁风险，已修。session类型读取按旧方式置于ledger rw前，独立事务仅3账本表；最终并发session读约0.2–0.4ms且先完成。父级upsert原有sessions/messages等事务锁仍保留，不声称所有后台写均无前台争用。
- RED全保留：原512/1000来源各512/1000次canonical/claim/edge操作；首轮预算单写改为首record+最终写最多2，测试门槛变更有记录。整批N证据读写后又补每批256的RED；锁scope亦先实测RED再改。最终90/90语义（顺序public record对照与明确权限断言、跨账号/角色、group/import、跨批重复/新rev/withdrawn、第三批失败全回滚）通过，root独立复跑通过且source/test hash稳定。
- 存量ledger同输入hash：512 612.1→33.1ms，1000 1712.7→58.0ms，确实读取已有证据N行，含撤回/较高旧版本；canonical1、claim/edge各2写，单批<=256。新证据同条件512/1000 26.3/50.4ms，root与其他回归并行的独立重复为44.3/78.1ms，保留全部，不挑最快当普遍指标。50k存量仅after 3180.2ms，读写都50000行，单批256，不宣称同规模改善、Android或模型/首显速度。
- 最终相关回归：memory540（77/48/415）、actual summary33、worker93、settlement70、CAS28含2个native绕过特性反例，tsc退出0。没有统一npm test入口，执行方案相关的项目真实验证脚本，未称全软件所有测试完成。生产本阶段只改memory-ledger-repo.ts，SHA ${sourceSha256}；实际差异、全部脚本/日志/原始数据见项目${path}和${root}/。
- 限制：累计source fresh正文读取仍在；覆盖前缀仍需分页扫描；证据本身仍O(N)，50k仍约3秒账本作业且父级事务仍会持锁。后续继续T2增量定位/累计成本，再T4 answered、范围纠正、各生产者/分支与T7/T8完整轨迹和四视口预览。没有本阶段同条件UI图/视频、真实模型评分、Android/右栏新预览。
- 本阶段真实上游0调用/0输入输出tokens/0费用；fixture不是实际模型，Codex用量费用未确认。无私密聊天/密钥扫描、音频/麦克风/设备、版本/APK/安装/发布/官网改动。无Library成功上传或官方侧栏归属验证，不改Codex内部数据库/配置。\n`);
 const label='- 2026-10-19 连续性T2摘要账本批处理';
 if(!readFileSync(index,'utf8').includes(label))appendFileSync(index,`\n${label}：90语义+540记忆/33摘要/93worker/70结算/28CAS及类型通过；存量512/1000同输入612.1→33.1ms、1712.7→58.0ms，每批256且不额外锁session。保留fresh正文核验；50k仍O(N)，T2及全方案未完成，无模型/Android/包/发布。见[[开发日志/2026-10-19]]及项目CHAT-SUMMARY-LEDGER-BATCH-2026-10-19.json。\n`);
}
console.log(JSON.stringify({path,fullPlanComplete:false,sourceSha256,correctnessChecks:90,newEvidenceComparison:report.newEvidenceComparison.map(row=>({count:row.count,beforeMs:row.beforeMs,afterMs:row.afterMs})),existingEvidenceComparison:report.existingEvidenceComparison.map(row=>({count:row.count,beforeMs:row.beforeMs,afterMs:row.afterMs})),regressions},null,2));
