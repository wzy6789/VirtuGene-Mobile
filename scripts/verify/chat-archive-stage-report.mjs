import {readFileSync,writeFileSync,readdirSync,copyFileSync,existsSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-archive-incremental-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const newest=(prefix,predicate=()=>true)=>{
  const paths=readdirSync(root).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort().reverse();
  for(const name of paths){const path=root+'/'+name,value=read(path);if(predicate(value))return{path,value};}
  throw Error('Missing verified evidence: '+prefix);
};
const summary=newest('summary-',value=>value.complete&&value.checks?.length>=49&&!value.legacyStart);
const wire=newest('summary-wire-green-',value=>value.complete&&value.checks?.length===45&&value.stableSources);
const auxiliary=newest('auxiliary-after-',value=>value.complete&&value.checks?.length>=39);
const beforeAuxiliary=newest('auxiliary-before-');
const beforeSummary={path:root+'/summary-1792374114052.json',value:read(root+'/summary-1792374114052.json')};
const sha=value=>createHash('sha256').update(value).digest('hex');
const logicalRequest=call=>JSON.stringify({history:call.history,previousSummary:call.previousSummary,protectedMemories:call.protectedMemories});
const sizes=[1000,10000,50000];
const comparison=sizes.map(size=>{
  const old=beforeSummary.value.rows.find(row=>row.scenario==='scale-'+size),current=summary.value.rows.find(row=>row.scenario==='scale-'+size);
  const beforeHash=sha(logicalRequest(old.calls[0])),afterHash=sha(logicalRequest(current.calls[0]));
  if(beforeHash!==afterHash)throw Error('Logical summary input changed for pure candidate-query comparison '+size);
  return {size,logicalRequestHashBefore:beforeHash,logicalRequestHashAfter:afterHash,sameLogicalRequest:true,
    before:{messageBodyRows:old.reads['messages.query'].bodyRows,tombstoneBodyRows:old.reads['memorySourceTombstones.query']?.bodyRows??0,elapsedMs:old.elapsedMs},
    after:{messageBodyRows:current.reads['messages.query'].bodyRows,tombstoneBodyRows:Object.entries(current.reads).filter(([key])=>key.startsWith('memorySourceTombstones.')).reduce((sum,[,metric])=>sum+metric.bodyRows,0),elapsedMs:current.elapsedMs}};
});
const auxiliaryComparison=sizes.map(size=>{
  const old=beforeAuxiliary.value.rows.find(row=>row.scenario==='ordinary-stock'&&row.size===size),current=auxiliary.value.rows.find(row=>row.scenario==='ordinary-stock'&&row.size===size);
  return{size,before:{messageBodyRows:old.bodies,elapsedMs:old.elapsedMs},after:{messageBodyRows:current.bodies,elapsedMs:current.elapsedMs},selected:current.selected,
    exactSourceParityAsserted:auxiliary.value.checks.find(check=>check.label==='unchanged exact 48-message model input at '+size)?.pass===true};
});
const production=['src/db/message-repo.ts','src/db/chat-archive-reader.ts','src/db/chat-auxiliary-guard.ts','src/db/chat-summary-archive.ts','src/lib/chat/send-service.ts','src/lib/chat-summary-evidence.ts','src/lib/ai/summary-batches.ts','src/lib/ai/context-summarizer.ts','server/gateway.mjs','server/summary-history-policy.mjs','server/summary-history-policy.d.mts','src/db/index.ts','src/db/session-repo.ts','src/db/session-summary-repo.ts','src/db/memory-repo.ts','src/lib/sync.ts','src/store/group-store.ts'];
const beforeAliases={'src/db/chat-auxiliary-guard.ts':'chat-auxiliary-guard.ts','src/lib/ai/context-summarizer.ts':'context-summarizer.ts','server/gateway.mjs':'gateway.mjs'};
const sources=production.map(path=>{const saved=root+'/before/'+(beforeAliases[path]??path);return {path,sha256:sha(readFileSync(path)),before:existsSync(saved)?{path:saved,sha256:sha(readFileSync(saved))}:null};});
const checkLog=(path,pattern)=>{const contents=readFileSync(path,'utf8');if(!pattern.test(contents))throw Error('Missing pass in '+path);return path;};
const regressions={
 summaryCAS:{checks:26,log:checkLog(root+'/summary-cas-final.log',/"complete":true,"checks":26/)},
 actualSummary:{checks:33,log:checkLog(root+'/summary-live-final.log',/"complete":true,"checks":33/)},
 actualSettlement:{checks:70,log:checkLog(root+'/auxiliary-settlement-regression.log',/"complete":true,"checks":70/)},
 actualChatWindowStream:{checks:265,log:checkLog(root+'/chat-stream.log',/PASS chat-stream: 265 checks/)},
 physicalRecovery:{checks:28,log:checkLog(root+'/request-recovery.log',/"complete":true,"checks":28/)},
 historyPagination:{checks:17,log:checkLog(root+'/history-pagination.log',/"checks":17/)},
 historyProvenance:{checks:7,log:checkLog(root+'/history-provenance.log',/7 boundary checks/)},
 types:{exitCode:0,log:root+'/types-final-all.log'},
};
if(readFileSync(regressions.types.log,'utf8').trim())throw Error('Inspect nonempty final typecheck log');
const streamEvidence=root+'/chat-stream-verification.json';copyFileSync('.tmp-preview/chat-delivery-immediate/verification.json',streamEvidence);
const report={date:'2026-10-19',workspace:process.cwd(),fullPlanComplete:false,stage:'T2 bounded archive candidates and exact summary transport',model:'未确认',reasoning:'未确认',
 completed:[
  'Shared tuple-index forward/backward paging; auxiliary recent48 and summary recent18 boundary use fresh selected-page suppressions in native readonly snapshots.',
  'No-source legacy summaries retain stored text on incomplete rebuild; no timestamp-guessed sources or previous-summary authorization.',
  'Known sourced legacy offsets without the lossless transport marker replay uncertain ranges conservatively; a complete CAS persists normalized offsets and the marker. Sync preserves it; source invalidation clears it.',
  'Summary source segments survive direct and hosted transport exactly, including 1201-unit Unicode boundary extension. Invalid batches reject before transport instead of clipping.',
  'Provider length-truncated summaries remain incomplete on direct and hosted paths, without another generation; partial source-start surrogate pairs replay whole.',
  'Group attribution moved outside original segment budgets to avoid new shared-validator regression; this is not full group continuity validation.',
  'Auxiliary messageCount now records actual bounded model input count; raw source count and user checkpoint remain independently indexed.',
 ],
 evidence:{baseline:root+'/baseline-1792373069389.json',summaryBefore:beforeSummary.path,summaryAfter:summary.path,auxiliaryBefore:beforeAuxiliary.path,auxiliaryAfter:auxiliary.path,wireAfter:wire.path,
  wireBefore:newest('summary-wire-before-wire-').path,surrogateBefore:root+'/summary-1792374760468.json',stream:streamEvidence},
 checks:{summaryArchive:summary.value.checks.length,summaryWire:wire.value.checks.length,auxiliary:auxiliary.value.checks.length},
 summaryComparison:comparison,auxiliaryComparison,regressions,sources,
 measurements:{scope:'Synthetic isolated desktop Chrome native IndexedDB and loopback stub upstream only',repetitions:'One observation per scale/phase; no p50/p95 or universal improvement percentage',logicalInput:'Hash compares actual summarizer parameters with credential omitted, not a real provider full-payload equality claim; corrected wire inputs intentionally differ from old clipped requests.',foreground:'Candidate/background cost only, not Android preparation/first-visible or real model speed'},
 usage:{realModelCalls:0,inputTokens:0,outputTokens:0,upstreamCost:0,codexModelAndCost:'未确认'},
 failedEvidence:[
  'Original summary candidate RED: 27 assertions, 11 failed. Auxiliary RED and full baseline retain original full-read evidence.',
  'Before-wire replay uses archived source only in isolated bundles, never rewrites production; exact applied source hashes are recorded.',
  'First wire harness misdecoded raw UTF-8 chunks and omitted synthetic gateway authorization on manual submissions. Those failures are retained but do not prove product bugs; corrected harness and archived-source replay are authoritative.',
  'Intermediate type check found an unsupported interrupted property on nonstream LLMChatResult; removed, final tsc exited 0.',
 ],
 remaining:[
  'Covered summary prefixes still require forward page scans; all-suppressed archives and insufficient eligible-user fallback can still scan relevant archives. Durable dirty-aware incremental positioning remains T2 work.',
  'Successful summary commit still bulk-loads cumulative source bodies; source metadata and protected-memory candidate costs can grow. No constant-total-cost claim.',
  'Source changes after capture are rejected at commit; the full session-mutation epoch and all background producer before-request gates remain T5 work.',
  'Full T0/T1/T3/T4/T5/T6 requirement and branch matrix, assistant answered evidence, persistent thread integration, T7 whole dialogue comparisons and T8 styled four-width preview/decoded recordings remain incomplete.',
  'No real model/personality scoring, Android, same-condition UI before/after media, paid calls, package/version/install/publication, Library upload or supported Codex project migration verification this stage.',
 ],next:'T2 durable incremental positioning/cumulative-source cost, then T4 answer evidence, scoped corrections, branch audit and T7/T8 complete trajectories/UI evidence'};
const path='docs/CHAT-ARCHIVE-PAGING-AND-SUMMARY-WIRE-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath),t2=progress.tasks.find(task=>task.id==='T2');
t2.evidence=[...new Set([...t2.evidence,path])];t2.remaining='Paged candidates, legacy provenance and summary wire lossless/truncation guards implemented with native/transport evidence; dirty-aware durable scan position, cumulative source commit body cost and long covered-prefix contention remain.';
progress.fullPlanComplete=false;progress.next=report.next;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
if(process.argv.includes('--obsidian')){
  const journal='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',index='D:/月起云归/VirtuGene/手机版/00-总览.md';
  const heading='## 连续性方案 T2：归档分页、摘要原文完整传输与升级兼容';
  if(!readFileSync(journal,'utf8').includes(heading))appendFileSync(journal,`\n\n${heading}\n
- 工作目录 F:/VirtuGene-Mobile；本轮实际编码模型/推理强度均未确认。继续2026-10-18桌面方案，完整T0–T8仍未完成。并行辅助实现/审查完成候选阶段交叉核对后，子任务工具额度受限；主代理接手完成传输、兼容、回归与留证，不把未完成的委派认定已完成。
- messageRepo新增双向tuple排他64分页，共享reader逐页查selected suppressions；aux最近48、summary最近18合格边界与向前12段原文候选在原生只读事务中捕获。保留账号/角色/版本、失败用户事实、composed区分、至少3有效用户门槛、raw来源总数与用户checkpoint；messageCount明确改为实际送模型的bounded条数。无需新schema或索引。
- 删除private legacyCovered按时间戳补造来源：无来源旧摘要不当previous，不标旧原文已覆盖；不完整重建仍保留旧文本，完整CAS才替换。带来源的旧摘要保留其文字，但无lossless标记的原offset最多信任首1000、缺offset从0补读；防止旧网关1000截取而1200记账的漏段沿升级继续。新成功摘要保存规范化来源offset和summaryCoveragePolicy，备份序列化/导入保留，失效同步清除；前台桥接也使用保守覆盖范围。原文不删除。
- 修正direct再次压1200/gateway再次压1000：共用12段/1200（结束代理对可1201）契约，精确发送，非法/过量batch拒绝而非截尾后报成功。长消息旧offset夹在emoji代理对时回退1codeunit重发完整字符。群摘要成员标签移到metadata/说话人标签，不占原文分段预算，避免新validator使原本带群成员前缀的满段失效；没有宣称群聊全链路已验收。
- 新复现并修复模型finish_reason=length仍complete=true：direct和hosted均不推进来源，不额外生成；旧摘要仍保留。共享每页buildSummaryBatch的sourceIds membership Set仅job内构建一次，非跨轮授权缓存。模型路由/主聊天思考/主聊天质检/必要上下文不削减。
- RED证据保留：候选27断言11失败；archived source仅隔离bundle重放，旧wire45断言26失败；旧segmenter重放仅两项surrogate起点失败。初轮wire夹具错误地逐Buffer解码中文且手动网关请求漏合成授权，造成的失败不算产品缺陷；修正夹具后重放旧源码才是可靠RED。中途nonstream result.interrupted类型错误已删除，最终tsc退出0。未还原覆盖生产文件伪造前后。
- GREEN：${report.checks.summaryArchive}摘要候选/兼容、${report.checks.summaryWire}实际direct与gateway到loopback上游、${report.checks.auxiliary}aux；26摘要CAS含可选coverage字段同步/失效、33实际后台、70结算、265真实ChatWindow流式、28physical recovery、17分页升级/同毫秒、7provenance，以及types均通过。纯逻辑/合成transport不是人物自然度评分。
- 千/万/五万同夹具摘要参数hash前后完全相同：候选正文1000/10000/50000→均128，无关失效8105→0；单次47.1/74.4/282.1→5.3/2.4/3.2ms。aux模型输入精确同旧策略，正文→均64、仍选48，5.7/39.2/197.2→1.5/1.3/3.2ms。仅各阶段各规模一次桌面观察；不报告p50/p95/普遍提升百分比/Android首显。修正wire传入正文比旧版完整，不能称所有新旧请求payload都相同；hash一致仅指候选纯查询对照的summarize参数。
- 项目报告 ${path}，原始证据根 ${root}/；内含源码before/after SHA、旧/新/作废证据、命令日志和stream副本，进度fullPlanComplete=false。生产文件与before身份详JSON，不stage并行dirty文件。没有本阶段同条件UI图/录屏，也没有T8右栏四视口已完成证据。
- 当前剩余：覆盖前缀仍需逐页扫描，全部抑制/有效用户不足仍可能遍历相关记录；成功摘要提交仍bulkGet累计来源、置顶记忆候选仍可增长，不能称后台全程常量。需继续dirty-aware持久增量位置/累计来源成本，再T4 answered、范围纠正、分支全集及T7/T8完整轨迹/界面。来源捕获后变化有最终guard，所有producer beforeRequest和完整mutation epoch尚未全部补齐。
- 本阶段真实上游模型0调用/0输入输出token/0费用；本地synthetic响应不等同真实模型，Codex用量/费用未确认。不读私密聊天/密钥、不操作音频/麦克风/设备；无版本/安装包/安装/部署/发布/官网下载变更，无Library保存/项目官方迁移成功证据，不改Codex内部数据库或配置。\n`);
  const entry='- 2026-10-19 连续性T2归档分页与摘要完整性';
  if(!readFileSync(index,'utf8').includes(entry))appendFileSync(index,`\n${entry}：49候选/兼容、45直连网关、39aux及原子/结算/流式/恢复/类型通过；千/万/五万候选正文分别降至128/64，无关失效0，原逻辑参数hash相同。旧无来源不补造，旧wire不确定范围补读，截断摘要不推进。覆盖前缀/累计来源成本、T4及T7/T8仍未完成，无模型/Android/包/发布。见[[开发日志/2026-10-19]]及项目CHAT-ARCHIVE-PAGING-AND-SUMMARY-WIRE-2026-10-19.json。\n`);
}
console.log(JSON.stringify({path,fullPlanComplete:false,checks:report.checks,summaryComparison:comparison,auxiliaryComparison},null,2));
