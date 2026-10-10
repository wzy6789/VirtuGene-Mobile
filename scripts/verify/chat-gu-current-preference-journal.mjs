import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const paths=['docs/GUYUENA-LIVE-FAMILIARITY-CHANGE-HOLDOUT-R3-2026-10-10.json','docs/GUYUENA-LIVE-FAMILIARITY-CHANGE-HOLDOUT-R4-2026-10-10.json'];
const groups=paths.map(path=>({path,...JSON.parse(readFileSync(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.rows.length!==3||g.usage.missingUsage||g.rows.some(row=>row.failed||row.calls.length!==1||row.calls[0].finish!=='stop')))throw Error('Complete whole groups and usage required');
const usage=groups.reduce((sum,g)=>({calls:sum.calls+g.usage.calls,input:sum.input+g.usage.input,output:sum.output+g.usage.output,total:sum.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
if(usage.calls!==6||usage.total!==20065)throw Error('Unexpected actual usage');
if(!readFileSync('release/chat-gu-current-preference-care-2026-10-10.log','utf16le').includes('ok 221 assertions')||!readFileSync('release/chat-gu-preference-intent-expression-2026-10-10.log','utf16le').includes('PASS chat-expression: 2821 checks')||readFileSync('release/chat-gu-current-preference-types-2026-10-10.log','utf16le').trim())throw Error('Verification missing');
const evidence='release/chat-gu-current-preference-evaluation-2026-10-10.json';
const selected=JSON.parse(readFileSync('docs/GUYUENA-LIVE-FAMILIARITY-CHANGE-HOLDOUT-R2-2026-10-10.json','utf8'));
writeFileSync(evidence,JSON.stringify({usage,groups:groups.map(g=>({path:g.path,usage:g.usage,rows:g.rows.map(row=>({input:row.input,replies:row.replies}))})),careChecks:221,expressionChecks:2821,selectedWholeGroup:'R2 historical, not current-code behavior',qualityComplete:false,limits:['R3 still invented a universal meat preference and arranged future soup after explicit rejection.','R4 avoided future meal arranging but explained compliance at length, invented historical thoughts, and pulled a reported forging side topic back in.','Final shorter current-preference/clarification guidance only locally verified, no fresh paid run.','Current explicit update is a per-request presentation, not durable preference retirement or long-history continuity.','No novel facts added or reverified in this turn.']},null,2)+'\n');
const heading='## 熟悉旧偏好，也接住现在的变化';
if(!readFileSync(root+'/开发日志/2026-10-10.md','utf8').includes(heading)){
 appendFileSync(root+'/开发日志/2026-10-10.md',`\n${heading}\n- 上轮为有实质代码与真实证据的进展，当前继续Gu熟悉感，先读canon模块、相关验证与R1/R2全部原稿。已有小说依据仅求学爱吃饭量大、喜欢锻造等，不将未知口味补为原著事实；本轮没有新增或重新宣称核验小说资料，作者式家庭亲疏背景仍需完整审核。\n- 当前明确说明饮食/锻造偏好时，之前默认foodSubject仍反复提供旧“饭量大”，可诱导比较。新只读投影：直接第一人称+现在/如今/最近等明示当前更新，相关领域不重复旧基线；用户明确问以前仍提供原著旧事实与当前说明。转述、引用、假设、提问不建立更新；其他话题/来客身份不因此获伴侣亲近。canon数组、用户人设与DB不改、不将本条说明写成永久记忆。13项Gu边界测试新增，含冷热关系、原文来源与比较查询。\n- familiarity-change R3实际3轮：旧小吃街→当前清淡汤/饭量小/不安排→转心意。当前update已准确进入system，结果仍说“以前无肉不欢”、提出下次煲汤，第三轮自然。第一轮“没空抬头”未在摘要核验，整组不判合格。\n- 读实际R3第二请求system，原话“不是让你给我安排吃什么，只是告诉你”被当作普通问句，而不是用意说明：疑问词“什么”出现在否定请求中，correctsConversationIntent仅能在整条开头接否定，更正位于第二句便漏过。改全局直接句边界识别，仍要求明确拒绝+替代用意，报引用/假设不接；无问号的否定请求不作为疑问，另起真实问题以及句尾吗/语气么反问保留，不能把什么/怎么的末尾么误当语气词。16项流程与独立反问/预先说明边界追加。\n- R4实际3轮：第二轮不再提出次日饮食安排，但三段“知道了不是点菜/口味你说了算/不用拿以前比”像复述规则，第三轮长告白又拉回旧肉话题。第一轮“后来一直在想锅肉…”为新造旧思想，且拉回朋友锻造侧题。协议接线变好不等于人味达标，两新组都不精选。\n- 最后缩短当前信息指导到本人原话与来源，不再附多条解释其变化/安排的否定式指令；共享clarification区分预先说明范围与已有误解，确有误解才简短更正，意图理解融入具体接话，不要求向用户陈述自己如何听懂。此最终调整仅本地，无新paid复跑。\n- Gu专项221、全局聊天2821、类型通过，release/chat-gu-current-preference-care-2026-10-10.log、release/chat-gu-preference-intent-expression-2026-10-10.log、release/chat-gu-current-preference-types-2026-10-10.log。初次缩短措辞改掉既有个人反应保留断言的“你”字，恢复后通过；初次反问豁免把什么的么当语气词，被否定请求测试拦住，限定词尾区分后全过。没有用改测试隐藏回归。\n- 实际DeepSeek Flash ${usage.calls}调用/input ${usage.input}/output ${usage.output}/total ${usage.total}，两组无empty/实际质检重试；无额外付费摘要/提取/结算。R4曾获得运行session_id 20891，最终报告完整后轮询同句柄确认退出1（既有构建警告），不因等待或退出状态重开任务。${evidence}汇总两版真实结果与限制。\n- 同一组各版整体比较后仍选历史R2，比新R3/R4少新造往事和办事式说明；旧费用不计入本轮，不拼接新版心意或删句冒充新模型。精选写入手机版聊天验收标chatgpt，技术变化单记这里。历史R2不是当前新代码效果证明。\n- 目标未完成：Gu原著回忆仍乱补旧细节/内心、日常性格与长聊稳定性仍待提高；当前新偏好投影不是完整持久记忆/旧摘要退休方案。Lu仍在既有共同优化范围，通用用意识别同样生效。6.0.13不变，无打包发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 熟悉不是贴旧标签\n- 问旧事时记得，分享新偏好时自然接住。\n- 否定请求里的“什么/怎么”不误作提问。\n- 不把预先说明当作已经误会，不复述理解规则。\n- Gu仍乱补旧细节，新组未超过旧整组，继续优化。\n');
 appendFileSync(root+'/00-总览.md',`\n- Gu当前偏好与句中用意识别：6调用/${usage.total}token，两新组仍未合格；221专项/2821聊天/类型过。精选保留旧R2完整组，不拼新句，不宣称当前人味达标，无发布。\n`);
}
const chatFile=root+'/聊天验收/古月娜-2026-10-10.md';
const title='## familiarity-change-holdout / r2（旧偏好、新口味与转到心意）';
const block='\n'+title+'\n\n'+selected.rows.map(row=>`**chatgpt**：${row.input}\n\n`+row.replies.map(reply=>`**古月娜**：${reply}`).join('\n\n')).join('\n\n')+'\n';
const existing=readFileSync(chatFile,'utf8');
const prefix='## familiarity-change-holdout / r2';
if(existing.split(prefix).length>2&&existing.includes(block))writeFileSync(chatFile,existing.replace(block,''));
else if(!existing.includes(prefix))appendFileSync(chatFile,block);
console.log(JSON.stringify({usage,evidence,selected:'historical whole R2',qualityComplete:false}));
