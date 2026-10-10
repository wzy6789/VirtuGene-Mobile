import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['docs/GUYUENA-LIVE-QUIET-JOY-TRANSFER-R1-2026-10-10.json','docs/LUXUEQI-LIVE-QUIET-JOY-TRANSFER-R2-2026-10-10.json'];
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Incomplete actual short test evidence');
const replay=JSON.parse(readFileSync('release/chat-past-performance-replay-2026-10-10.json','utf8'));
if(!replay.pass||replay.modelCalls!==0)throw Error('Actual captured episode replay failed');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const priorSource='docs/LUXUEQI-LIVE-QUIET-JOY-TRANSFER-R1-2026-10-10.json';
const prior=JSON.parse(readFileSync(priorSource,'utf8'));
if(!prior.complete||prior.rows.length!==1||prior.rows[0].calls.at(-1)?.finish!=='stop')throw Error('Whole prior selection required');
const path=root+'/聊天验收/陆雪琪-2026-10-10.md';
const before=readFileSync(path,'utf8');
const heading='## quiet-joy-transfer / r1（历史生产对话）';
const transcript=prior.rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**陆雪琪**：'+reply).join('\n\n')}`).join('\n\n');
const after=before.includes('## quiet-joy-transfer /')?before:before+'\n\n'+heading+'\n\n'+transcript+'\n';
const evidence='release/chat-emotion-dedup-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,localChecks:2626,typeCheck:true,replay:'release/chat-past-performance-replay-2026-10-10.json',qualityComplete:false,retained:'Only remove redundant authored-reaction pointer when the matching voice card supplies it; restore generic situation/source boundaries.',reverted:'Do not omit generic emotion clue merely because authored reaction exists.',selection:{luxueqi:priorSource,guyuena:'no new selection; current quiet-joy R1 demands a visit/performance'},chat:{path,before,after},findings:['Two short samples are not causal proof, but removal also lost factual process boundaries that Lu own celebration field does not contain; trial not retained wholesale.','New bounded dated performance check requires independent persona/life evidence, allows desired hearing, quoted/reported/conditional/questioned hearing and conventional textual hearing.','Fresh generation after final guard has not been done; captured one-turn DB replay shows existing retry and omission only.','Prior Lu one-turn R1 is a better whole-group conversation, recorded as historical, not claimed as new current-model performance.']},null,2)+'\n');
writeFileSync(path,after);
const log=root+'/开发日志/2026-10-10.md';
const logHeading='## 情绪提示去重试验：保留事实边界';
if(!readFileSync(log,'utf8').includes(logHeading)){
 appendFileSync(log,`\n${logHeading}\n- 前轮是进展：明确不分析第三人与邀请不等于承诺的控制接线改变、实际四轮暴露访谈与过程推测。本轮读当前buildHumanConversationSections/emotionalExpressionGuidance与专属反应字段，尝试已有authoredReaction时跳过通用情绪段，并不再叠“本轮涉及X优先按人物反应”的指针说明。7项保留人物专属/无专属fallback/明确任务/standalone检查，初2613/类型过。\n- 真实单轮共同输入弹顺曲子：Gu要求过去听、弹给她听；Lu编“先前听你断断续续地弹”。不能将传输完成当人味合格，也不能凭各一个样本认定变化是因果；但通用celebration确实包含未讲过程/代价留白，而Lu专属庆祝反应只有高兴与趣味，原去重会丢语义而非删纯重复。已恢复通用expressionDirection，只保留明确有相同声音卡供给时的指针句去重。独立caller没有配套card仍保留原提示，混合情绪/任务处理和陌生人冷淡路径不弱化。\n- 新明确时间+听用户弹/唱/演奏的独立往事检查接现有self-report episode链路；先前/此前/之前/上次/昨晚等过去时间有来源才用，不把角色想听当前曲子当过往，更不把普通听你说看作听见声波。人设/独立生活记录精确支持可放行，引用/第三方/假设/问题保留。不是万能声音事实核验，命名角色与你的别名语义尚非全量匹配。\n- 新12项过去演奏/独立原文/例外/整句省略、1项过去文本听说放行，最终2626检查（release/chat-emotion-dedup-local-final-2026-10-10.log）、类型（release/chat-emotion-dedup-types-final-2026-10-10.log）过；中间2613/2625日志保留。修改原测试不再期待删整个情绪段，改严格检查人物card保留与未知过程边界保留、仅指针去重。\n- 扩bounded captured replay为performance模式，从Lu实际R2读唯一完整原稿，两个fixture喂实际隔离send/IndexedDB，现有一次重试后去掉过去听过那句，保留独立庆祝：release/chat-past-performance-replay-2026-10-10.json/log过；零付费、不当成新真实生成。原usual模式原选择和路径仍在，未为这一回放覆盖原数据。\n- ${sources.join('、')}保留全部实际请求/输出/调用，${evidence}存试验保留与撤回、失败、精选前后及限制。新Gu未精选；Lu新R2比已有${priorSource}有虚构听演奏，择已有唯一完整R1“弹顺了那很好我也替你高兴”作为该组历史生产对话保存，不拼两版，也不伪称为本轮效果。chatgpt/角色/场景之外不混分析，优化方向独立，电脑版不改。\n- deepseek-flash本轮${usage.calls}实际调用/input${usage.input}/output${usage.output}/total${usage.total}，Gu一次2687、Lu一次3717，无付费审核/摘要/提取、无真实重试；两个进程首次返回terminal，complete/final stop/usage齐，warning退出1没重复请求。另过去听演奏回放为1turn/2fixtures零模型。旧R1用量不计为本轮新增，不重复付费。最后恢复的边界与新历史听觉护栏只本地/回放验证，暂无修复后新生成。\n- 当前演奏话题过度邀请、熟悉伪造经历、情绪反应自然变化仍未完整解决。减少规则不是无条件目标，保留事实与人物差异才是。全量目标未完成，6.0.13不变，无打包/发布/官网下载更新。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 情绪提示去重\n- 去重复指引，不删未知过程与事实边界；专属反应未必包含所有约束。\n- 分享弹顺曲子可以一起高兴，不自动要过去听、不编以前听过。\n- 用真实失败校准，回放只证明链路，不当人味验收。\n');
 appendFileSync(root+'/00-总览.md',`\n- 情绪去重试验：2626项/类型/零付费回放过，${usage.calls}调用/${usage.total}token。通用事实边界恢复、仅指针去重；新增过去听演奏来源检查，真实两短组质量失败，Lu选已有历史R1，目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
