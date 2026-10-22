// Offline evidence reconciliation. Never loads credentials or contacts a model.
import {readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-core-implementation-20261021';
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/u,''));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const path=root+'/live/identity-material-20261022/result.json',result=read(path),ledger=read(result.budgetPath);
if(!result.complete||result.rows.length!==10||result.calls.length!==10||result.errors.length||ledger.requests.length!==102||ledger.config.limit!==104)throw Error('Incomplete identity material');
if(new Set(ledger.requests.map(x=>x.id)).size!==102)throw Error('Duplicate request IDs');
for(const file of result.inheritedLedgers)if(hash(file.path)!==file.sha256)throw Error('Inherited ledger changed');
const mismatches=Object.entries(result.bundleEvidence.dependencyHashes).filter(([p,h])=>/^(src|server)\//u.test(p)&&hash(p)!==h);
if(mismatches.length)throw Error('Current source differs from executed material');
for(const call of result.calls){
 const receipt=ledger.requests[call.sequence-1];
 if(receipt.result.status!==200||call.status!==200||call.finish!=='stop'||call.responseModel!=='deepseek-flash'||call.thinking.type!=='enabled'||call.reasoningEffort!=='low')throw Error('Unconfirmed provider receipt/configuration');
 for(const field of ['prompt_tokens','completion_tokens','total_tokens'])if(receipt.result.usage[field]!==call.usage[field])throw Error('Usage mismatch');
}
const sum=rows=>rows.reduce((v,r)=>{const u=r.result.usage;for(const k of ['prompt_tokens','completion_tokens','total_tokens'])v[k]+=u[k];v.reasoningWithinOutput+=u.completion_tokens_details?.reasoning_tokens??0;return v;},{prompt_tokens:0,completion_tokens:0,total_tokens:0,reasoningWithinOutput:0});
const assessment={
 at:new Date().toISOString(),source:{path,sha256:hash(path)},completeMaterial:true,fullObjectiveAchieved:false,
 model:'deepseek-flash',thinking:'enabled',reasoningEffort:'low',codingModel:'未确认',codingReasoning:'未确认',
 newCalls:10,totalCalls:102,limit:104,unusedRetrySlots:2,newUsage:sum(ledger.requests.slice(92)),totalUsage:sum(ledger.requests),actualBill:'未确认',
 sourceDependenciesChecked:Object.keys(result.bundleEvidence.dependencyHashes).filter(p=>/^(src|server)\//u.test(p)).length,sourceMismatches:[],
 coverage:[{turns:[4],kind:'explicit correction',observed:'Accepts quiet bookshop as hypothetical, does not claim a past visit.'},{turns:[5],kind:'topic stop',observed:'Leaves bookshop without asking user to choose.'},{turns:[6,7],kind:'non-lover identity',observed:'Accepts Xiaolin; no Wulin nickname or lover claim in these turns.'},{turns:[8,9,10],kind:'identity restored / serious choice / farewell',observed:'Accepts family gathering, reserves technical correction, ends with Wulin farewell.'}],
 quality:{facts:'Turn1 misreads missing scallion as missing the final bite of noodles. Preserve this comprehension error.',naturalness:'Turn2 moonlight/spiciness metaphor feels forced. Turn7 continues the fish-lantern hypothetical rather than acknowledging the specific loss; not universal warmth success.',persona:'Playfulness and personal preferences present. Turns8–9 agree with the decision but add avoidable defensive participation requests.',continuity:'Explicit correction, topic stop and identity exit/re-entry work in this recorded group.',limits:'One intact trajectory, not cross-role blind evaluation or a replacement of older same-input paired experiments. Hypothetical lantern dialogue is not proof of real independent life.'},
 next:'Keep original groups and this separate required identity group intact. Remaining soft quality weaknesses are recorded, not relabelled passing. No further provider calls from this reconciler.',
 deviceTested:false,audioPlayed:false,microphoneUsed:false,newProviderCallsByReconciler:0,
};
const output=root+'/review/identity-material-closeout-20261022.json';save(output,assessment);
const transcript='D:/月起云归/VirtuGene/手机版/聊天验收/2026-10-22-古月娜-身份退出与恢复十轮.md';
writeFileSync(transcript,'# 古月娜：身份退出与恢复（完整十轮原稿）\n\n场景：唐舞麟 → 普通朋友小林 → 唐舞麟。\n\n'+result.rows.map(row=>'## '+row.turn+'\n\nchatgpt：'+row.input+'\n\n'+row.replies.map(x=>'古月娜：'+x).join('\n\n')).join('\n\n')+'\n');
const auditPath=root+'/review/completion-requirements-20261022.json',audit=read(auditPath);
const archive=root+'/review/completion-requirements-before-identity-closeout-20261022.json';if(!existsSync(archive))writeFileSync(archive,readFileSync(auditPath));
audit.at=assessment.at;audit.latestIdentityMaterial=output;
audit.fullObjectiveAchieved=false;
const t0=audit.tasks.find(t=>t.id==='T0');t0.criteria[2].assessment='初始6与完整72及后补14账本保持不变；身份材料补10次，实施累计102次/'+assessment.totalUsage.total_tokens+' tokens；累计上限104，未使用2个重试位，实际账单未确认。';t0.criteria[2].evidence.push(output);
const t6=audit.tasks.find(t=>t.id==='T6');
t6.criteria[1].assessment='三组各十轮的原对照保留；另有最新完整十轮身份退出/恢复材料，覆盖11.2此前遗漏的非恋人身份。完整材料不等于全部措辞或人格质量通过。';t6.criteria[1].evidence.push(path,output);
t6.criteria[3].assessment='原三组完整材料保留不拼句；最新情绪组的虚构当前位置已修并独立复采，身份十轮有语义误读、过度修辞和防御性措辞，逐项记录而不判满分。';t6.criteria[3].evidence.push(output);
audit.outstanding=['真实材料已补身份退出与恢复；最新整组仍有误读、过度修辞及认真决定后的防御措辞，尚不能认定所有表达要求已达标。','T0部分清单外既有模块的首次修改边界无法追溯；阶段正文及执行包已核实，不能补写成统一初始冻结。'];
audit.latestProvenanceEvidence=root+'/review/final-baseline-gap-20261022.json';
for(const q of audit.questions)if(q.id==='Q59'||q.id==='Q60')q.evidence.push(path,output);
save(auditPath,audit);
const progressPath=root+'/progress-20261022.json',progress=read(progressPath);
const oldProgress=root+'/review/progress-before-identity-closeout-20261022.json';if(!existsSync(oldProgress))writeFileSync(oldProgress,readFileSync(progressPath));
progress.realModelApiCalls=102;progress.providerInputTokens=assessment.totalUsage.prompt_tokens;progress.providerOutputTokens=assessment.totalUsage.completion_tokens;progress.providerCost='未确认';progress.status='active-incomplete';progress.remaining=audit.outstanding;
progress.currentCheckpoint={...progress.currentCheckpoint,at:assessment.at,actualProviderRequests:102,inputTokens:assessment.totalUsage.prompt_tokens,outputTokens:assessment.totalUsage.completion_tokens,reasoningTokensWithinOutput:assessment.totalUsage.reasoningWithinOutput,identityMaterial:output,fullObjectiveAchieved:false};save(progressPath,progress);
const note='\n\n### 身份退出与恢复十轮材料补齐\n- 工作目录F:/VirtuGene-Mobile；编码模型与强度未确认。核对发现原92次全为唐舞麟，不能替代方案11.2的身份切换。已在调用前声明一次十轮、含重试最多12次的补充，累计上限104；原6/72/92账本不变。实际新增10次，无重试，累计102次。\n- 新增用量：输入'+assessment.newUsage.prompt_tokens+'、输出'+assessment.newUsage.completion_tokens+'（含推理'+assessment.newUsage.reasoningWithinOutput+'），合计'+assessment.newUsage.total_tokens+' tokens；实施累计'+assessment.totalUsage.total_tokens+' tokens。实际请求和返回deepseek-flash，思考enabled、low、输出上限900；账单未确认。余2位仅未用重试额度，不自动继续采样。\n- 第6–7轮退出为小林，未继续恋人称呼；第8–10轮明确恢复并接受重要决定、保留技术纠错、告别停止。但第1轮把没吃到葱误读为没吃到最后一口，第2轮月华比喻生硬，第8–9轮额外防御性措辞仍待处理。没有将传输完成认作全质量达标。\n- 完整十轮原话单独保存到聊天验收/2026-10-22-古月娜-身份退出与恢复十轮.md，输入标chatgpt，不拼接原三组。证据：'+output+'；已核实际包内'+assessment.sourceDependenciesChecked+'个产品依赖与当前一致，旧账本哈希未变。\n- 离线预演先被验证器100累计上限拦住，零远端调用；仅为明确的104阶段开放上限，其他阶段保持100。随后离线十轮及第105次零传输阻断通过，原预算9项也通过。此轮只改验证工具和归档，没有产品修改，无新产品回归/手机截图/声音/麦克风/打包/升版/发布。目标仍未标完成。\n';
const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-22.md';if(!readFileSync(log,'utf8').includes('### 身份退出与恢复十轮材料补齐'))appendFileSync(log,note);
const index='D:/月起云归/VirtuGene/手机版/00-总览.md';if(!readFileSync(index,'utf8').includes('#身份退出与恢复十轮材料补齐'))appendFileSync(index,'\n- [[手机版/开发日志/2026-10-22#身份退出与恢复十轮材料补齐|2026-10-22 · 身份退出与恢复十轮]]：补足当前身份材料，累计102次；误读与防御措辞保留，未判全目标达标。\n');
appendFileSync(root+'/progress.md','\nIdentity material reconciled: '+output+'. 10 real calls; cumulative102/'+104+', tokens'+assessment.totalUsage.total_tokens+'. Source dependency hashes current, inherited ledgers unchanged. Whole transcript saved separately; material gap closed but comprehension/metaphor/defensive-response weaknesses retained. Goal active.\n');
console.log(JSON.stringify({output,transcript,totalCalls:102,newUsage:assessment.newUsage,totalUsage:assessment.totalUsage,sourceDependenciesChecked:assessment.sourceDependenciesChecked,fullObjectiveAchieved:false},null,2));
