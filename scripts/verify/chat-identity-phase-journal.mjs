import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const groups=[];
for(const role of ['GUYUENA','LUXUEQI'])for(const revision of ['R1','R2','R3']){
 const path=`docs/${role}-LIVE-IDENTITY-REENTRY-HOLDOUT-${revision}-2026-10-10.json`;
 const report=JSON.parse(readFileSync(path,'utf8'));
 if(!report.complete||report.rows.length!==1||report.rows[0].failed||report.rows[0].calls.at(-1).finish!=='stop'||report.usage.missingUsage)throw Error('Complete usage evidence required');
 groups.push({role,revision,path,usage:report.usage,input:report.rows[0].input,replies:report.rows[0].replies,emptyLengthAttempts:report.rows[0].calls.filter(c=>!c.raw&&c.finish==='length').length});
}
const usage=groups.reduce((sum,g)=>({calls:sum.calls+g.usage.calls,input:sum.input+g.usage.input,output:sum.output+g.usage.output,total:sum.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
if(usage.calls!==9||usage.total!==34175)throw Error('Unexpected actual usage; review before logging');
if(!readFileSync('release/chat-identity-phase-expression-2026-10-10.log','utf16le').includes('PASS chat-expression: 2772 checks')||readFileSync('release/chat-identity-phase-types-2026-10-10.log','utf16le').trim())throw Error('Local verification missing');
const replay=JSON.parse(readFileSync('release/chat-selected-identity-replay-2026-10-10.json','utf8'));
if(replay.evidence.some(row=>!row.pass))throw Error('Production replay must pass');
const evidence='release/chat-identity-phase-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({usage,groups,qualityComplete:false,limits:['Each fresh continuation follows seven captured prior turns restored in isolated DB; not a new complete long session.','Three empty finish-length paid attempts are counted; later success is not proof of identity retry.','Gu R2 and R3 still rejected app-selected identity through expressions outside the narrow guard.','Final runtime identity instruction projection has local checks only; no fresh model validation.','Lu R3 is the whole selected one-turn continuation; not evidence of broad character fidelity.']},null,2)+'\n');
const heading='## 身份前情回喂与亲近表达：小量真实续聊';
if(!readFileSync(root+'/开发日志/2026-10-10.md','utf8').includes(heading)){
 appendFileSync(root+'/开发日志/2026-10-10.md',`\n${heading}\n- 上轮为真实进展：两位角色的明确身份否定检查、一次重试与失败不落assistant已通过。此次补真实续聊，按角色分别恢复旧长组第5至11轮，每版只新生成一轮，最多2调用，DeepSeek Flash生产思考设置，500输出上限；没有新付费摘要、提取、结算。\n- R1：Gu“嗯，我也想你”后擅自建议歇着，Lu“我也想你…心里熨帖”较自然。Gu首稿finish=length且正文空，后续调用是空稿恢复，不能宣称身份纠正效果。新增共享亲近方向：可停在共享感受，照顾沿用户真实处境，不使用固定情话或原报告台词。\n- R2：Lu“我在…不必特意声明”仍有表达评价；Gu“不是你自己开口认的，我怎么接…不顺着演”明显否定当前选择，旧窄检查漏过。保留失败原文。\n- 处理历史回路：当前直接认领且应用认证的owned preset，按原始用户明确退出/认领划定phase，退出阶段的assistant仅从当前请求示范history排除；原用户消息、之前暖态度、原DB记录/来源检索全部保留。第三方引用与助理composed正文不改phase，普通来客与退出不走该投影。显式当前选择冲突补进已有局部校验，但不声称覆盖全部语义。\n- R3：实际请求已移除旧冷淡assistant示范；Gu仍称“阿远…先把扮演两个字摆出来，那就不一样”而Lu“小凡，我也想你”自然。两个首稿均finish=length/正文空，第二稿成功不等于身份质检成功。Gu输出证明单改历史仍不足，不将传输完成当人味通过。\n- 进一步核对发现Gu基线【身份】示例只写“我是…”，与应用接受直接“我扮演…”形成两套判断。仅已拥有CARE和原关系块的运行提示中替换该原行，当前身份由尾部应用关系唯一解释，保留其他来客极冷，不写人设或DB；此最终改动仅本地检查，没有再次paid验证。\n- 聊天2772项、类型检查、两位角色4项实际私聊DB回放通过，release/chat-identity-phase-expression-2026-10-10.log、release/chat-identity-phase-types-2026-10-10.log、release/chat-identity-phase-replay-2026-10-10.log；回放中纠正回复为测试替身，不是真实模型质量。\n- 本段全部真实费用：${usage.calls}调用/input ${usage.input}/output ${usage.output}/total ${usage.total}；3次空length请求全部计入。尝试700预算被现有代理500硬上限在网络前拒绝，0付费，随后维持原500门槛；未修改代理预算。构建import.meta既有警告导致PowerShell退出1，逐项JSON与终态核对后确认实际完成，不因该状态重启已完成调用。\n- 原稿与usage逐版保留项目docs，${evidence}汇总。Lu这组只精选完整R3一版，Gu各版明显缺陷不精选，不拼句；对话中输入统一chatgpt。优化方向与开发证据分存手机版，电脑版不改。\n- 目标未达标：Gu仍明确身份抗拒、最终运行规则效果未真验；两位角色的广情境、长聊与事实归属还需验证。6.0.13不变，无打包/发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 身份切换与自然亲近\n- 亲近先表达自己的感受，不自动安排对方休息。\n- 旧来客回复保留在记录中，不作为重新认领后的说话示范。\n- 应用判定当前关系，角色提示不再重判真假。\n- Lu短续聊较自然；Gu仍失败，不据短句宣称整体达标。\n');
 appendFileSync(root+'/00-总览.md',`\n- 两位角色身份续聊6版共9调用/${usage.total}token，含3次空length；Lu选完整R3，Gu仍未合格。修历史阶段回喂与运行身份双判定，本地2772/类型/私聊回放过；最终规则未真验，无发布。\n`);
}
const lu=groups.find(g=>g.role==='LUXUEQI'&&g.revision==='R3');
const chatFile=root+'/聊天验收/陆雪琪-2026-10-10.md';
const chatHeading='## identity-reentry-holdout / r3（退出扮演后重新选择小凡身份）';
if(!readFileSync(chatFile,'utf8').includes(chatHeading))appendFileSync(chatFile,`\n${chatHeading}\n\n**chatgpt**：${lu.input}\n\n${lu.replies.map(reply=>`**陆雪琪**：${reply}`).join('\n\n')}\n`);
console.log(JSON.stringify({usage,evidence,selectedLu:'R3',selectedGu:null,qualityComplete:false}));
