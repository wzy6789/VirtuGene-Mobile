import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=[1,2].map(revision=>`docs/GUYUENA-LIVE-FAMILIARITY-CHANGE-HOLDOUT-R${revision}-2026-10-10.json`);
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Complete actual transport evidence required');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const payloadChecks=reports.map(r=>{
 const system=r.rows[0].calls[0].messages.find(m=>m.role==='system').content;
 return {revision:r.revision,systemChars:system.length,hasSelectedFood:system.includes('闷罐牛肉'),hasUnrelatedDetailedForging:system.includes('听他说要把休息日')||system.includes('听他说想把休息日')||system.includes('舞麟喜欢锻造。')};
});
if(!payloadChecks[1].hasSelectedFood||payloadChecks[1].hasUnrelatedDetailedForging)throw Error('Actual upstream still has the original routing leak');
const path=root+'/聊天验收/古月娜-2026-10-10.md';
const before=readFileSync(path,'utf8');
const heading='## familiarity-change-holdout / r2（生产对话）';
const selected=reports[1];
const transcript=selected.rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')}`).join('\n\n');
const after=before.includes(heading)?before:before+'\n\n'+heading+'\n\n'+transcript+'\n';
const evidence='release/chat-gu-scoped-voice-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,payloadChecks,guChecks:208,sharedChecks:2589,typeCheck:true,qualityComplete:false,selection:'whole r2 only; r1 complete failed quality raw retained in project',chat:{path,before,after},findings:['Initial real request had unfiltered persona reintroduced by personal-experience reference and combined food/forging paragraph. Prior source-card-only tests did not prove entire production request scope.','Latest send passes same scoped persona to base and voice guidance. Actual upstream contains food facts and no unrelated detailed forging in first turn.','R2 removes fictional dated thought and excessive old-versus-new identity comparison, acknowledges changed taste; second reply still drifts to shared eating convenience, final reply terse.','Own emotional flavor is not guaranteed; all-novel accuracy, long-history sources and entire human-like objective remain open.']},null,2)+'\n');
writeFileSync(path,after);
const log=root+'/开发日志/2026-10-10.md';
const logHeading='## Gu真实熟悉度复验：经历参考绕过筛选';
if(!readFileSync(log,'utf8').includes(logHeading)){
 appendFileSync(log,`\n${logHeading}\n- 上轮有进展：Gu三处原著检索范围收紧、Gu206/shared2589/类型及局部网页复核提供新信息，但未真实验证整条请求。本轮读取当前文件后创建未测三轮小吃街+转述锻造旁支、本人清淡汤/饭量减少、换话题想念，先用当前代码跑R1。\n- R1假编“那天回去我还想”，顺锻造开比喻；本人更新偏好后说“像两个人”，感情轮又长篇解释性格。实际payload检查发现经历核对块重新引用未筛选完整人设前2000字，尾部重带CANON_CONTEXT；原exact求学段也把小吃街和锻造写在一起。不是单纯模型忽视已收紧来源卡，前轮局部测试没覆盖这种整链漏接。\n- send-service在原角色身份判定/声音cache读取后，派生本轮scopedVoiceCharacter，把Gu当前筛选的人设交给buildHumanConversationSections；Lu/其他角色依原guard仍保持输入，不改身份来源、缓存或落库原文。Gu两版exact自有求学综合段在当前prompt省略，食物/锻造事实分别由当前熟悉度与选中来源卡供给；用户改写段仍保留。base正文、声音卡与经历参考使用相同范围，不再把整份原人设通过另一入口带回来。\n- Gu新增2项经历参考和声音卡实际拼装检查，208 ALL PASS（release/guyuena-scoped-voice-local-final-2026-10-10.log），shared2589（release/chat-scoped-voice-local-2026-10-10.log）、类型（release/chat-scoped-voice-types-2026-10-10.log）通过。旧显式回忆测试从要求base重复整段改为验证实际声音卡仍给完整闷罐牛肉资料；旧heard-plan措辞从综合段改为选题喜好段，仍严格检查不是亲眼观看，stored old line保留。初次旧断言失败日志保留，未降低实体事实和来源要求。\n- R2实际第一轮system确认选中食物在、无详细锻造喜好/休息日计划，${JSON.stringify(payloadChecks)}。回应只回那次三人逛小吃街，没再编回去后思想；第二轮接清淡汤和饭量变化，未反驳本人或追加饮食安排，但自己也喜欢/两个人吃省事仍容易趋同及偏向共餐；第三轮随明确暂停转到想念，较短。R2是该完整组目前最佳，不等于熟悉度所有章节准确/情感多样稳定。\n- ${sources.join('、')}包含全部实际请求、输出、落库与调用，${evidence}记录实际payload条件/两版选择/聊天文件前后；R1整组留项目不入精选，Gu仅完整R2保留，未拼两版好句，chatgpt标识。优化方向与技术日志/用量分开，电脑版不改，Lu原精选未变化。\n- deepseek-flash本轮${usage.calls}调用/input${usage.input}/output${usage.output}/total${usage.total}：R1三次10088，R2三次9753。无额外付费审核、提取、摘要，无质检重试；首次session3530已poll terminal exit1、R2首次返回terminal，报告complete/final stop/usage齐；退出1warning未导致重试。改变有明确实际payload根因，复测限定同三轮，不再盲目扩组。\n- 持久身份/原著长背景未核对、无出处历史思想的通用语义、配偶心意变化与长聊漂移等仍未闭环。当前目标未完成，6.0.13不变，无打包、发布或官网下载变更。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 熟悉度整链供给\n- 本轮筛选的人设同时用于正文、声音卡、经历参考，避免旁路重带旧资料。\n- 食物与锻造分开供给；本人更新喜好自然接住，不夸张成另一个人。\n- 亲近减少性格解释与机械同喜好，继续验证真实表达。\n');
 appendFileSync(root+'/00-总览.md',`\n- Gu熟悉度真实复验：Gu208/shared2589/类型通过，${usage.calls}调用/${usage.total}token。经历参考旁路已接筛选人设，实际payload无无关锻造，完整新组R2保存；情绪多样与长期准确仍开放，无发布。\n`);
}
console.log(JSON.stringify({usage,payloadChecks,evidence,qualityComplete:false}));
