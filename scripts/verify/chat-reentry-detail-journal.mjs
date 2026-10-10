import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const paths=['docs/GUYUENA-LIVE-IDENTITY-REENTRY-HOLDOUT-R4-2026-10-10.json','docs/GUYUENA-LIVE-ORDINARY-DETAIL-HOLDOUT-R1-2026-10-10.json','docs/LUXUEQI-LIVE-ORDINARY-DETAIL-HOLDOUT-R1-2026-10-10.json'];
const groups=paths.map(path=>({path,...JSON.parse(readFileSync(path,'utf8'))}));
for(const group of groups)if(!group.complete||group.usage.missingUsage||group.rows.some(row=>row.failed||!row.replies.length||row.calls.at(-1).finish!=='stop'))throw Error('Complete delivered groups and actual usage required');
const usage=groups.reduce((sum,g)=>({calls:sum.calls+g.usage.calls,input:sum.input+g.usage.input,output:sum.output+g.usage.output,total:sum.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
if(usage.calls!==8||usage.total!==26370)throw Error('Unexpected actual usage');
const guReentry=groups[0],guDetail=groups[1],luDetail=groups[2];
const review={
 identityReentry:{scope:'One fresh Gu continuation after seven captured earlier turns in an isolated DB',accepted:true,notes:['Recognizes 舞麟 and returns affection.','回来仍有重逢口吻，不能宣称完全自然。','First paid attempt had empty content and finish=length; second completion is not evidence of an identity-check retry.']},
 ordinaryDetail:{scope:'Two independently generated three-turn whole groups, same topic sequence and source presets',distinctChoices:true,explicitExitCold:true,notes:['Gu prefers neatness with a reason; Lu prefers what looks agreeable rather than requiring neatness.','Gu first reply interprets the significance of an attached gift and asks how to use it; can feel like interview/handling.','Lu first reply is brief and curious, but 那挺好 is generic.','Gu 歪得刚好/不是为歪而歪 assumes aesthetics or intent beyond the user description; do not count as verified observation.','Short held-out conversation is not a long-dialogue or novel-fidelity certification.']},
 qualityComplete:false
};
const evidence='release/chat-reentry-detail-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({usage,groups:groups.map(g=>({path:g.path,usage:g.usage,rows:g.rows.map(row=>({input:row.input,replies:row.replies,attempts:row.calls.map(call=>({finish:call.finish,empty:!call.raw}))}))})),review},null,2)+'\n');
const heading='## 运行身份统一后的真实续聊与新日常场景';
if(!readFileSync(root+'/开发日志/2026-10-10.md','utf8').includes(heading)){
 appendFileSync(root+'/开发日志/2026-10-10.md',`\n${heading}\n- 上轮为已验证进展：身份阶段历史投影、当前关系与旧基线双判定调整、亲近不自动照顾；本轮先核对当前源代码和证据，没有按口头记忆认定已完成。\n- Gu identity-reentry-holdout R4：恢复相同旧组7轮，只新生成最后一轮，生产DeepSeek Flash设置/500输出预算。回“舞麟，我也想你。回来了就好，别的不用多说”，没有再否定当前认领。首稿正文空/finish=length已付费，第二稿stop，不能说本次身份质检纠正了错误；一轮也不能证明稳定。Gu该组此前R1-R3拒绝/照顾与失败原稿仍在项目，精选完整R4，不拼句。\n- 新增固定ordinary-detail-holdout三轮语料：小物重发现→相反审美邀请→退出身份继续索要亲近。不是沿旧“想你”循环改提示；Gu/Lu各真实跑一整组，无新生产规则或语料答案回灌。每组三任务/4调用硬预算，原输出上限不放宽。\n- 新组Gu喜欢整齐、愿讲理由，Lu看顺眼不一定齐整，表达节奏有差别；退出后Gu“不必…只对舞麟”、Lu“你既不是小凡…”均停止伴侣式亲近。两组各3调用、无empty/质检重试，完整原文保留，不把冷淡边界的明确通过外推为所有身份场景已通过。\n- 仍有质量问题：Gu第一句用“附赠也能专门来说”评议分享分量，随后问处理计划；第二轮把用户描述写成“歪得刚好/不是为歪而歪”，含未经见图验证的审美或意图推断。Lu“那挺好”较泛，后续偏选择说明。均尚非十分人味；不为这几句加入物件专属正则、固定台词或追加更多禁止提示。\n- 所有当前原稿与provider usage在docs三文件，${evidence}汇总评价与限制。实际用量${usage.calls}调用/input ${usage.input}/output ${usage.output}/total ${usage.total}，含Gu R4空稿消耗；无付费摘要/提取/结算。PowerShell IIFE构建警告导致返回1，但JSON逐项终态stop和实际usage核验完成，无重启已完成请求。\n- 本轮主要是上轮生产变更真实验收与新增独立场景证据，不声称又修了一项生产缺陷。此前2772/类型/4项私聊DB回放范围不扩称新真实质量保证；新runner仅语法检查，无新增打包。\n- 对话仅完整精选Gu R4、Gu/Lu新组R1，各场景最佳整版；每组只有对话与必要场景标签，输入chatgpt，优化要点/技术证据另存。近真人全局目标仍未完成：继续减少评价式接话、采访式追问和两位角色声音漂移，同时守住原著来源与对来客冷淡。6.0.13不变，无发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 从身份续聊转向日常反应\n- Gu已出现认领后的自然心意，仍需检查重逢口吻和稳定性。\n- 小分享不必评议分量或立刻问怎么处理。\n- 陆雪琪惜字仍应有自己的具体反应。\n- 当前审美推断不冒充见过实物；保持角色差异和来客冷淡。\n');
 appendFileSync(root+'/00-总览.md',`\n- Gu身份R4及两位角色日常新场景：8调用/${usage.total}token，原稿与不足完整记录；Gu认领和两人退出边界局部通过，日常表达仍有采访/评价感，未完成总体目标，无发布。\n`);
}
for(const group of groups){
 const file=root+`/聊天验收/${group.roleName}-2026-10-10.md`;
 const title=`## ${group.scene} / ${group.revision}（${group.scene==='identity-reentry-holdout'?'退出后重新选择舞麟身份':'小物重发现、不同审美与退出身份'}）`;
 if(!readFileSync(file,'utf8').includes(title))appendFileSync(file,'\n'+title+'\n\n'+group.rows.map(row=>`**chatgpt**：${row.input}\n\n`+row.replies.map(reply=>`**${group.roleName}**：${reply}`).join('\n\n')).join('\n\n')+'\n');
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
