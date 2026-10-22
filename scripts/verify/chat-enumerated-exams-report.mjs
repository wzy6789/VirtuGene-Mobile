import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const root='release/chat-enumerated-exams-20261019';
const paths={red:root+'/checks-1792385111528.json',green:root+'/checks-1792385170924.json',beforeAudit:'release/chat-continuity-plan-audit-20261019/audit-1792385239515.json',afterAudit:'release/chat-continuity-plan-audit-20261019/audit-1792385260390.json',gateway:'release/chat-continuity-gateway-2026-10-19T04-49-50-821Z/gateway.json',replies:'release/chat-topic-replies-20261019/current-1792385266515.json'};
const red=read(paths.red),green=read(paths.green),before=read(paths.beforeAudit),after=read(paths.afterAudit),gateway=read(paths.gateway);
if(red.checks.length!==16||red.failures.length!==12||!green.complete||!green.stableSources||green.checks.length!==16||before.failures.length!==6||!after.complete||after.checks.length!==52||!gateway.complete||gateway.rows.length!==26)throw Error('Required actual phase evidence does not match');
const production='src/lib/chat-topic-outcomes.ts';
if(green.sourceHashesAfter[production]!==hash(production))throw Error('Production changed after phase checks');
const reportPath='docs/CHAT-ENUMERATED-EXAM-CONTINUITY-2026-10-19.json';
const report={date:'2026-10-19',workspace:process.cwd(),codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 problem:'Explicitly listed mathematics and English exams collapsed into one event; completing mathematics incorrectly resolved the aggregate.',
 change:'Conservatively split two to four explicitly named exams, attach short subject/date/time references only to existing same-domain records, retain independent outcomes, and project both states for comparison. Generic completion with several exams remains ambiguous. No generated entities, new DB reads or per-turn model calls.',
 production:{path:production,sha256:hash(production),beforeSnapshot:root+'/before/chat-topic-outcomes.ts',beforeSha256:hash(root+'/before/chat-topic-outcomes.ts')},
 evidence:Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,{path,sha256:hash(path)}])),
 results:{pure:{before:{checks:16,failures:12},after:{checks:16,failures:0}},actualSendService:{trajectories:24,syntheticTurns:172,modelReply:'嗯。',beforeAudit:{checks:52,failures:6},afterAudit:{checks:52,failures:0}},gateway:{requests:26,ordinaryHistoryUnchanged:true,withinBudgetTailPreserved:gateway.rows.find(row=>row.id==='budget-tail-within-24000')?.systemPrefixKept,overLimitClippingObserved:true},regression:{topicOutcomes:45,topicReplies:100,types:{exitCode:0,log:root+'/types.log'}}},
 limits:['24 trajectories use the real sender and native isolated DB but a stub model, not semantic or character-quality acceptance.','Some trajectory assertions prove raw source availability only, including scoped preferences, identity/domain originals and long-input corrections; they do not prove complete typed extraction or actual model use.','Enumeration covers explicit two-to-four named exams, not unrestricted Chinese task understanding.','The before trajectory was recorded before expanding its source-hash graph. Its captured native states are actual, but no fully matched historical graph is fabricated.','No Android, same-condition UI baseline, paid model or voice validation.'],
 boundaries:{apiCalls:0,inputTokens:0,outputTokens:0,upstreamFee:0,codexUsage:'未确认',versionChanged:false,apk:false,published:false,privateData:false,audio:false,microphone:false}};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T0','T3','T4','T8']){const task=progress.tasks.find(task=>task.id===id);task.evidence=[...new Set([...(task.evidence??[]),reportPath])];}
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const ledger='.superpowers/sdd/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18/progress.md';
const marker='2026-10-19 — Original C11 enumerated-exam range defect';
if(!readFileSync(ledger,'utf8').includes(marker))appendFileSync(ledger,`\n\n${marker}: fixed with16/12 RED→16 GREEN. Actual24 trajectories/172 synthetic turns audit52/6 RED→52 GREEN; gateway26 local requests, replies100/topic45/types0. Evidence ${reportPath}. Independent dates/outcomes retained; generic completion remains ambiguous. Original source availability in other scenarios is not semantic/personality acceptance. Whole plan incomplete. No new direction/model/version/build/release.\n`);
if(process.argv.includes('--obsidian')){
 const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md',heading='### 原方案C11：多场考试独立状态收尾';
 if(!readFileSync(log,'utf8').includes(heading))appendFileSync(log,`\n\n${heading}\n- 工作目录F:/VirtuGene-Mobile；编码模型/推理强度未确认。改动src/lib/chat-topic-outcomes.ts：显式列出的2—4场考试分别保存日期与结果，泛指完成时不猜对象。修改前快照及当前SHA见${reportPath}。\n- 纯逻辑16项原12失败后全部通过；真实发送链24组/172轮模拟回复，52项原6失败后全部通过。旧topic45、reply100和类型检查通过。实际网关26次本地上游请求通过，普通历史不变，超限截断如实记录。\n- 其他语料部分仅证明原话进入请求，不证明结构化状态全覆盖或模型正确使用。无同条件前后截图/录屏、无Android与真实模型人味结论。\n- 上游0调用/0token/0费用；Codex用量未确认。无私人数据、声音/麦克风、版本修改、打包或发布。完整方案仍未完成，继续原清单收尾。\n`);
 const index='D:/月起云归/VirtuGene/手机版/00-总览.md';if(!readFileSync(index,'utf8').includes('C11多场考试'))appendFileSync(index,'\n- [[手机版/开发日志/2026-10-19|2026-10-19 · C11多场考试]]：独立日期/状态修复，原24组轨迹52项和网关26次本地验证；真实模型未验证，完整方案未完成。\n');
}
console.log(JSON.stringify({report:reportPath,pure:16,audit:52,gateway:26,fullPlanComplete:false,paidCalls:0}));
