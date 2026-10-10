import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['docs/LUXUEQI-LIVE-IDENTITY-PHASE-TRANSFER-R4-2026-10-10.json','docs/LUXUEQI-LIVE-ORDINARY-TASTE-HOLDOUT-R1-2026-10-10.json','docs/LUXUEQI-LIVE-ORDINARY-TASTE-HOLDOUT-R2-2026-10-10.json'];
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Complete final transport and usage required');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const evidence='release/chat-lu-relation-focus-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,checks:2573,luChecks:97,typeCheck:true,qualityComplete:false,selection:'ordinary-taste-holdout full r2 only; retain prior identity-phase r1',findings:['关系提示精简保留身份与事实边界，未改人物原文、示例或版本。','phase r4没有编孩子，改编了天气与夜间安静，未精选。','杯子R1自己选择素净，但第二轮虚构孩子作品与用户每样都夸的习惯；R2没有该具体往事，仍有防御式开头、格言与不必要育儿假设。','R2是该新组目前较好的完整版本，不是人味达标，最终同源偏好澄清接线仅本地检查。']},null,2)+'\n');
const selected=reports[2];
const heading='## ordinary-taste-holdout / r2（生产对话）';
const transcript=selected.rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**陆雪琪**：'+reply).join('\n\n')}`).join('\n\n');
const chat=root+'/聊天验收/陆雪琪-2026-10-10.md';
if(!readFileSync(chat,'utf8').includes(heading))appendFileSync(chat,'\n\n'+heading+'\n\n'+transcript+'\n');
const log=root+'/开发日志/2026-10-10.md';
const logHeading='## 陆雪琪关系提示减重与不同选择接续';
if(!readFileSync(log,'utf8').includes(logHeading)){
 appendFileSync(log,`\n${logHeading}\n- 上轮为实质进展：自由邀请与近期家庭护栏已修改、四组真实证据及2556检查得到新信息。本轮读当前人设/声音卡/关系context，发现运行时反复强调丈夫、孩子、父亲和儿童未知状态；尾部关系上下文挤入多个家庭焦点，不能只继续堆禁令。\n- GENTLE_CONTEXT精简重复家庭说明；身份、婚姻时间、父亲归属、自己的主见、温柔、原话与独立事实来源、明示时间线覆盖仍保留。家庭只是背景，当前题目决定内容。不删除此前失败的三条亲密样本，不改用户人设或迁移版本，无额外模型调用层。\n- 三轮phase R4认领接续正常，未编孩子但又说“这两天风凉了些夜里清静”，依然无来源，未替换之前完整R1。新的杯子/奇怪物件两轮holdout R1有独立偏好，但编小鼎常做歪东西与用户每样说好。发现“你不必跟我选一样的”不在isOpinionInvitation里，故走react而非明确自己观点；新增共用语法界限判断欢迎不同选择，引用/第三方/假设/必须相同不处理。\n- 杯子R2不再编上述共同习惯，但“我也没打算同你选一样”仍防御、“清水出芙蓉”格言与孩子假设偏多。继续检查发现independentPreference缺“我其实更喜欢”和同样的选择许可，引入同一个DIFFERENCE_PERMISSION正则接两处，激活已有不必证明/不评定用户喜好/就对象继续聊方向。最后这一步只有本地验证，没有再付费，不把R2称最终变更后表现。\n- 97项Lu关系/迁移检查（release/luxueqi-relationship-compact-local-2026-10-10.log）通过；shared新增2项精简后事实/主见、10项许可与作用方向、5项本人偏好澄清，最终2573通过（release/chat-difference-permission-expression-final-2026-10-10.log），类型通过（release/chat-difference-permission-types-final-2026-10-10.log）。中间日志也保留，测试不证明内容质量。\n- ${sources.join('、')}全部请求和输出保留，${evidence}记录取舍；新杯子整组仅R2展示，R1项目保留；phase旧R1继续作为当前最佳，R4不上架、不截取好句。输入标chatgpt，原话、优化方向、技术日志分开，电脑版不改。\n- deepseek-flash本轮${usage.calls}调用，input${usage.input}/output${usage.output}/total${usage.total}，没有额外摘要/提取/结算、没有质检重试。进程均已终止，报告complete/final stop/usage齐，warning退出1未因此重跑。后两轮对照是具体识别方向改变，不盲目重复；后续优先现有失败与本地改进，节省模型量。\n- 仍未解决：无内容邀请时编天气、普通谈物件仍牵孩子、稳固而非防御的个人观点、格言化、长期身份来源与长聊漂移。最终目标仍未完成；6.0.13不变、没有打包或发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 陆雪琪关系提示减重\n- 家庭关系只定身份，不抢当前话题；近况缺来源就不补。\n- 欢迎不同选择时继续谈对象，不反复证明自己没迎合。\n- 保留独立好恶，减少格言与每轮绕回孩子。\n');
 appendFileSync(root+'/00-总览.md',`\n- Lu关系提示减重/不同选择接续：2573项、Lu97、类型通过，${usage.calls}调用/${usage.total}token。杯子完整R2为当前较好版，仍有防御与家庭假设；phase天气虚构不精选。目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
