import {readFileSync,writeFileSync,readdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root='release/chat-topic-wiring-20261018/';
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const log=path=>readFileSync(root+path,'utf8').replace(/^\uFEFF/,'');
const wiringPath=readdirSync(root).filter(path=>/^wiring-\d+\.json$/.test(path)).sort().at(-1);
const wiring=json(root+wiringPath);
const races=json('release/chat-topic-outcomes-20261018/races.json');
const outcomes=json('release/chat-topic-outcomes-20261018/checks.json');
assert.equal(wiring.complete,true);assert.equal(wiring.checks.length,32);
assert.equal(races.complete,true);assert.equal(races.checks.length,24);
assert.equal(outcomes.checks,45);
assert.match(log('expression-accepted.log'),/PASS chat-expression: 3854 checks/);
assert.match(log('stream-accepted.log'),/PASS chat-stream: 265 checks/);
assert.match(log('summary-accepted.log'),/PASS chat-summary-entry: 73 checks/);
const perfPath=root+'performance-1792326583501.json';
const perf=json(perfPath);
const files=['src/lib/chat/send-service.ts','src/lib/chat-conversation-state.ts','src/lib/chat-topic-outcomes.ts','src/db/chat-topic-state-repo.ts','scripts/verify/chat-human-live.ts','scripts/verify/chat-topic-wiring.ts','scripts/verify/chat-topic-wiring.mjs','scripts/verify/chat-topic-outcomes.mjs','scripts/verify/chat-topic-state-races.ts','scripts/verify/chat-coverage-performance.ts','scripts/verify/chat-coverage-performance.mjs'];
const report={date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',stage:'T3/T4 source-backed topics wired into private sender; T5 selected-source/CAS checks',fullPlanComplete:false,
 files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),
 implementation:[
  'Direct user conclusions and supported slots persist before generation; a provider failure does not retract a user fact. Rhythm counters remain post-success.',
  'Fresh read checks account, character, private session, source revision/range and scoped suppression; invalid topics are removed without inferring an old value back from history.',
  'Native CAS rejects a conflicting conversation version; reply commit also checks current message and selected topic evidence.',
  'Failure marking checks unchanged message revision/content/role/body origin and current account, so a late failure cannot mark an edited replacement as failed.',
  'Current-query projection supplies relevant named topics or current focus, not every unrelated historical topic; whole records and wrapper respect exact budget.',
  'Conservative explicit grammar distinguishes negative event existence, historical episodes, vocabulary and preferences from a new pending event; conflicting event denial becomes unresolved.',
  'Invalid/nonrepresentable observation clocks and out-of-range timezone offsets are rejected before projection.'
 ],
 verification:{outcomes:{checks:45,evidence:'release/chat-topic-outcomes-20261018/checks.json'},nativeRaces:{checks:24,evidence:'release/chat-topic-outcomes-20261018/races.json',log:root+'races-accepted.log'},actualSender:{checks:32,primaryRows:10,evidence:root+wiringPath,freshJavaScriptRuntimeReload:true,androidReload:false},expression:{checks:3854,log:root+'expression-accepted.log'},stream:{checks:265,log:root+'stream-accepted.log'},summaryEntry:{checks:73,log:root+'summary-accepted.log'},types:{log:root+'types-accepted.log',exitCode:0},redEvidence:['clock-red.log','date-red.log','budget-red.log','stale-evidence-red.log'].map(path=>root+path)},
 performance:{evidence:perfPath,fixture:perf.phases[0].fixture,phases:perf.phases.map(phase=>({phase:phase.phase,samples:phase.samples.map(s=>({iteration:s.iteration,prepareMs:s.prepareMs,reads:s.reads}))})),interpretation:'Four sequential desktop Chrome samples per phase, mocked transport. Payload intentionally adds verified topic projection; not an unchanged-payload speed comparison. Cursor operations are included. Added selected-source reads exist; this is not proof of zero performance cost or Android latency.'},
 boundaries:{paidModelCalls:0,modelTokens:0,microphoneCalls:0,privateUserDataRead:false,versionChanged:false,packaged:false,deployed:false,codexTokenCost:'未确认',beforeAfterStyledScreenshots:false,rightPaneStyledPreview:false,codexProjectMove:'未验证；未修改内部配置'},
 remaining:[
  'T2 summary incremental/background contention and stale asynchronous-result audit remains incomplete.',
  'T3 explicit grammar is not a universal semantic parser; full date/domain/contradiction coverage remains.',
  'T4 assistant answer evidence and general answered slots are not fully implemented; legacy preferences lack complete source provenance.',
  'T5/T6 physical model recovery preflight, streaming partial-batch lifecycle, all edit/delete/rollback/branch races and graceful concurrency UX still need verification.',
  'T7 no real-model personality/naturalness score; synthetic transport cannot prove human-like output.',
  'T8 actual styled ChatWindow isolated preview at 320/360/390/414 and long-content/keyboard coverage remains; no Android or decoded visible timing proof.'
 ]};
writeFileSync('docs/CHAT-TOPIC-WIRING-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--log')){
 appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-18.md',`\n### 全角色连续性：来源事项接入真实发送与局部竞态闭环\n- 实际工作目录F:/VirtuGene-Mobile；编码模型与推理强度未确认。接续上一阶段“尚未接线”的基础，本阶段已接入send-service；不是全方案完成。实际改动及SHA256见docs/CHAT-TOPIC-WIRING-2026-10-18.json。\n- 用户直接事实在模型请求前CAS落库；发送失败不撤回用户结论。暂放/恢复保留已知槽位、取消回忆不恢复行动。删源先按选定消息批量核验并移除受影响事项，不从旧原文自动恢复旧日期。\n- 回复提交前校验当前来源和事项来源；另一窗口版本更新、当前源改写或旧槽位源改写时拒绝过时回复。失败标记只作用于未被改写的原消息。单独保存的后续节奏更新也用CAS。一般词语/否定/历史事件不新造pending；事件否定待核；异常时钟和时区拒收，投影含包装严格限长。\n- 当前纯逻辑45、原生IndexedDB/CAS24、实际sender32（10主轨迹行+故障/竞争探针）通过；新JS页面从同隔离数据库恢复已知日期时间交通。表达3854、流式265、真实发送摘要73通过；tsc退出0。模型传输全部模拟，真实模型0次/0 token/0费用；Codex实际token/费用未确认，不把测试回复当人味达标。\n- 存量性能用512消息、8105失效记录、40私密日记、7事项；含cursor计数的最终对照performance-1792326583501.json：准备before36/23/18/15ms，after32/13/13/13ms。仅4顺序桌面样本，payload新增真实事项投影，不能算同输入提速或Android保证。新增选定来源bulkGet及每轮5次空匹配失效cursor真实记录，不宣称零开销或查询数不变。\n- 证据目录release/chat-topic-wiring-20261018/；保留clock/date/budget/stale-evidence等失败原稿。无私人聊天读取、无麦克风/原生调用、无升版本/安装包/发布。没有同条件前后截图、没有当前真实样式右栏预览/手机首显证明。\n- 待完成：摘要后台增量/晚到、一般语义与assistant答复来源、物理恢复重试前复核、流式部分落库/完整分支竞态、T7真实表达与T8实际ChatWindow窄屏验收。当前源失效会安全中断，自动本地重组与用户提示尚需优化。\n`);
 appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- 2026-10-18 连续性来源事项已接真实sender：45核心/24原子DB/32发送接续及刷新探针通过，表达3854/流式265/摘要73及类型通过；有存量资料读取证据，无付费调用。全计划、完整竞态/重试与真实样式预览未完。见 [[开发日志/2026-10-18]] 与项目docs/CHAT-TOPIC-WIRING-2026-10-18.json。\n');
}
console.log(JSON.stringify({report:'docs/CHAT-TOPIC-WIRING-2026-10-18.json',fullPlanComplete:false}));
