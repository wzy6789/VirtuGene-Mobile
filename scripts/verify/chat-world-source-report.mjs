import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
if(process.argv.includes('--help')){console.log('Current world-source phase evidence; --obsidian appends mobile logs. Does not execute tests or models.');process.exit(0);}
const root='release/chat-world-source-20261019',hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const read=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const latest=(prefix,accept)=>{for(const name of readdirSync(root).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort().reverse()){const path=root+'/'+name,value=read(path);if(accept(value))return{path,value};}throw Error('Missing evidence '+prefix);};
const sourceCurrent=value=>Object.entries(value.sourceHashesAfter??{}).every(([path,sha])=>hash(path)===sha);
const races=latest('races-',v=>v.complete&&v.checks.length===143&&v.stableSources&&sourceCurrent(v));
const stock=latest('stock-performance-',v=>v.complete&&v.changedDuringRun.length===0&&sourceCurrent(v));
assert.equal(races.value.blockedRequests,0);assert.equal(stock.value.blockedRequests,0);
assert.equal(stock.value.checks.length,13);assert.equal(stock.value.phases.length,2);
for(const phase of stock.value.phases){assert.equal(phase.samples.length,3);assert.equal(phase.complete,true);}
for(let i=0;i<3;i++)assert.equal(stock.value.phases[0].samples[i].payloadSha256,stock.value.phases[1].samples[i].payloadSha256);
const worldSuites=['worldB','worldC','worldE','worldF','world-stream'].map(suite=>{
 const path=root+'/regression-'+suite+'.txt',body=readFileSync(path,'utf8');assert.ok(body.includes('ALL PASS'));assert.ok(!/^FAIL/m.test(body));
 return{suite,path,sha256:hash(path),checks:(body.match(/^ok\s/gm)||[]).length||Number(body.match(/^PASS (\d+) /m)?.[1]??0)};
});
const memoryLog=root+'/memory-final.log',memory=readFileSync(memoryLog,'utf8');
for(const [suite,count] of [['memory-continuity',77],['memory-final',48],['character-memory',415]])assert.ok(memory.includes(JSON.stringify({suite,passed:true,checks:count})));
const types=root+'/types-final-source.log';assert.equal(readFileSync(types,'utf8').trim(),'');
const frozen=['src/lib/world/world-turn.ts','src/lib/world/world-context.ts','src/lib/world/world-ai-client.ts','src/lib/world/world-recall.ts','src/lib/character-history-recall.ts','src/lib/world/world-director.ts','src/lib/world/world-actor.ts','src/lib/world/world-narrator.ts','src/lib/world/world-consistency.ts','src/lib/world/world-settlement.ts'];
const production=[...frozen,'src/lib/world/world-source-guard.ts','src/lib/memory-source-snapshot.ts'];
let patch='';for(const path of frozen){const result=spawnSync('git',['diff','--no-index','--',root+'/before/'+path,path],{encoding:'utf8'});assert.ok([0,1].includes(result.status));patch+=result.stdout;}
const patchPath=root+'/world-source-production.patch';writeFileSync(patchPath,patch);
const reportPath='docs/CHAT-WORLD-SOURCE-GUARD-2026-10-19.json';
const report={date:'2026-10-19',workspace:process.cwd(),codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,stage:'T5/T6 retrieved world-context sources across director/actor/guard/settlement awaits and publication',
 production:production.map(path=>({path,sha256:hash(path)})),tests:['scripts/verify/chat-world-source-races.ts','scripts/verify/chat-world-source-races.mjs','scripts/verify/chat-world-source-performance.mjs','scripts/verify/chat-world-source-regressions.mjs','scripts/verify/worldE.ts'].map(path=>({path,sha256:hash(path)})),
 patch:{path:patchPath,sha256:hash(patchPath),scope:'Ten frozen pre-phase files, not a historical release reconstruction. New world-source-guard.ts and added memory-source-snapshot helper are recorded as current full files; no invented pre-phase snapshot for those.'},
 implemented:[
  'Retain retrieved reference originals and permissions in transient WeakMap guards, not serialized prompt data, cached authorization or persistent facts. Preserve guards across world-context clones and settlement context refresh.',
  'Before and after world model work, revalidate exact selected originals and audience knowledge, message/session ownership, suppression and source snapshots. Selected-history verification never rebuilds candidate searches.',
  'Keep private material actor-scoped; public director context still receives only shared history. An authorized supporting link per audience is sufficient for shared memory; private unrelated alternative links cannot invalidate an otherwise valid recall.',
  'With retrieved evidence, hold visible SSE partials until post-generation source verification and preserve the complete accumulated/delta contract. Source-free streaming stays unchanged. Invalid sources do not trigger another actual model fallback.',
  'Local publication and settlement validate sources inside the native write transaction; entry/derived writes cannot run in the gap after an earlier authorization read. The callback performs no network work.',
  'Current-scene routing has a separate owner/member/state comparison that excludes only updatedAt and locally changing conversation/visual state. Original entry/message bodies retain full snapshots, avoiding false withdrawal after this turn appends a normal reply.',
  'First send, ordinary subject, explicit recall and actual failed-turn retry reject source edit/delete/suppression during director or actor generation. User input is preserved.',
  'Settlement trace is committed with the source-authorized derived data and turn identity, then emitted after commit. Source-invalid settlement cannot publish the old director trace; legitimate successful settlement changes remain allowed.',
 ],
 evidence:{races:{path:races.path,sha256:hash(races.path),checks:143,localStructuredStubs:races.value.localModelStubs,localSseRequests:races.value.simulatedHttpCalls},
  originalRed:root+'/races-1792383526397.json',originalRedChecks:37,originalRedFailures:15,
  frozen119Red:root+'/red-1792384079553.json',frozen119Failures:50,
  routeFalseInvalidation:root+'/races-1792383711886.json',
  sseDeltaRed:root+'/races-1792384009686.json',
  reviewRed:{path:root+'/races-1792384366900.json',checks:143,failures:7},
  independentReview:{agent:'world_source_review',scope:'One read-only review of this phase against supplied snapshots',importantFindings:2,resolution:'Both reproduced in native143/7 RED then143 GREEN; no re-review loop.'},
  performance:{path:stock.path,sha256:hash(stock.path),fixturePath:stock.value.fixturePath,fixtureSha256:stock.value.fixtureSha256,fixtureFileSha256:stock.value.fixtureFileSha256,driverChecks:13,samples:6,phases:stock.value.phases.map(phase=>({phase:phase.phase,summary:phase.summary})),modelMessagesIdentical:true,
   fixture:{messages:513,unrelatedAndScopedSuppressionRows:8105,privateSyntheticDiaries:40},
   interpretation:'Three desktop observations per phase with local30ms transport. Same full native imported fixture and complete model-message hashes. These guards cost additional bounded reads and time, not a speedup. No Android/decoded-display guarantee. The ordinary private-chat sending path is not changed by the world client guard.',
   scope:'Ten frozen pre-phase production files vs current, all other modules current; not an app release comparison. First fixture imports failed BulkError. Native bulkPut import was then accepted only after exact full-table fixture hashes matched; discarded failures remain raw evidence.'},
 },regressions:{world:worldSuites,memory:{path:memoryLog,checks:540,sha256:hash(memoryLog)},types:{path:types,exitCode:0}},
 rulings:[
  'No authorization result survives the current generation/write boundary. Fresh reads and native locks are retained; redundant root rechecks were replaced by propagation of the already-failed substep, never by skipping the next request or publication guard.',
  'Source-dependent world partials are deliberately held until verification; ordinary source-free world streaming and private chat keep their existing behavior. This cost is explicit, not sold as free acceleration.',
  'Guard transactions currently include all local tables because selected reference types and nested existing writes span tables. Only exact selected rows are read; broader lock contention remains a measured-scope limit.',
  'worldE migration assertion41 was stale after the earlier verified schema43 change; only the expected current schema assertion was updated. No schema or app-version change in this phase.',
 ],
 remaining:[
  'This is retrieved-source lifecycle coverage, not a complete audit of every raw world-fact/recent-entry/interpreter input, every other producer, account epoch or unnotified native mutation.',
  'Broad native transaction lock contention across independent modules and larger world scenes still needs the original plan performance audit; no Android claim.',
  'Full T2/T3/T4/T6 requirement matrix, T7 complete dialogue/character scoring and T8 styled four-width preview/recordings remain. No new optimization directions are authorized by this report.',
 ],
 boundaries:{upstreamCalls:0,inputTokens:0,outputTokens:0,upstreamFee:0,codexUsageAndCost:'未确认',privateUserDataRead:false,audio:false,microphone:false,versionChanged:false,schemaChanged:false,apkBuilt:false,installed:false,deployed:false,styledPreview:false,sameConditionScreenshots:false,sidebarProjectVerified:false},
};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T5','T6']){const task=progress.tasks.find(task=>task.id===id);task.evidence=[...new Set([...(task.evidence??[]),reportPath])];}
progress.tasks.find(task=>task.id==='T5').remaining='Retrieved world sources now guarded across director/actor/guard/settlement and native publication in tested cases. Raw world-fact/recent-entry/interpreter dependencies, complete account epoch and other producers still need the original audit.';
progress.tasks.find(task=>task.id==='T6').remaining='New private threads and retrieved world sources reject edit/delete/suppression through tested first/plain/retry/SSE/settlement paths. Exact persistent identity, full backup/transfer/branch matrix and unnotified native mutation coverage remain.';
progress.next='Close original requirement matrix: T3 scoped corrections, T4 exact persistent identity/outcomes, T2 positioning/cumulative costs, then T7/T8 complete dialogue and styled previews. Do not add directions or repeat already-passing suites without new changes.';
progress.fullPlanComplete=false;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const ledger='.superpowers/sdd/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18/progress.md',marker='2026-10-19 — World retrieved-source phase verified';
if(!readFileSync(ledger,'utf8').includes(marker))appendFileSync(ledger,`\n\n${marker}: ${reportPath}; fresh143, worldB44/C57/E62/F28/stream19, memory540, project types0. Independent2 Important native143/7 RED→GREEN fixed. Final6 stock samples13 driver checks preserve complete native fixture ${stock.value.fixtureSha256} and all model messages. Added sources guard cost observed explicitly; first JS144→192.6ms, whole149.5→196.9ms in this desktop local30ms sample, not Android or speedup. Message bodies64→174, suppression bodies8→18, diaries80→80; no8105-record body scan. Exact final values/each sample in report. Final typecheck after root cleanup and source-stable performance0. Version41 assertion in worldE was an earlier schema43 stale test, corrected without schema change. No paid calls or release. Full goal active; follow original remaining requirements only.\n`);
if(process.argv.includes('--obsidian')){
 const path='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',heading='### 世界异步来源保护：本阶段验证完成，完整方案未完成';
 if(!readFileSync(path,'utf8').includes(heading))appendFileSync(path,`\n\n${heading}\n- 工作目录F:/VirtuGene-Mobile；实际编码模型/推理强度未确认。文件及SHA/差异、失败/成功证据见${reportPath}。\n- 首次发送/普通话题/失败重试/模拟SSE/结算143项，世界B44/C57/E62/F28/stream19、memory540、类型检查通过。原37项15失败；独立审查2项问题143项7失败后修复。源修改、删除、撤回后不再把旧材料带入后续调用或新正文/痕迹。有效授权替代链接不误伤；本轮正常追加不使原条目失效。\n- 引用资料的世界流式需等源复核再发布；无资料的世界流式及私聊不改。来源/权限无跨轮缓存，选定主键/索引核验并在本地写事务中复核，不重跑候选扫描。事务当前锁全部本地表；跨模块争用仍是原计划待核项。\n- 513消息/8105失效/40私密合成日记，同一个完整原生fixture和完整模型messages一致；桌面模拟6样本。首JS中位144→192.6ms、整轮149.5→196.9ms；消息正文64→174、失效正文8→18、日记80→80。新增核验有约47ms成本，不是提速或Android承诺；首JS不是解码显示。原始逐轮数据和fixturehash见报告。原生导入BulkError失败保留，bulkPut后以全表hash确认输入相同。\n- worldE唯一失败是旧版本断言41与既有schema43不符，修正测试并单独复跑通过；本阶段不升schema/版本。记录过的编译before新测试API缺导出属于夹具绑定问题，使用显式可选namespace访问，无伪造旧函数。\n- 上游0调用/0token/0费用；Codex用量费用未确认。无私人资料/密钥扫描、音频、设备、APK、安装、发布、官网变更；无本阶段右栏/同条件截图录屏。完整T2/T3/T4/T5/T6/T7/T8仍需原清单收口，不新增方向。\n`);
 const index='D:/月起云归/VirtuGene/手机版/00-总览.md';if(!readFileSync(index,'utf8').includes('世界异步来源保护143'))appendFileSync(index,'\n- [[手机版/开发日志/2026-10-19|2026-10-19 · 世界异步来源保护143]]：世界/记忆相关回归和类型通过；存量相同payload新增约47ms核验成本，非Android/提速。完整连续性方案未完成；无版本和发布。\n');
}
console.log(JSON.stringify({report:reportPath,races:143,worldChecks:worldSuites.reduce((n,s)=>n+s.checks,0),stockSamples:6,fullPlanComplete:false,apiCalls:0},null,2));
