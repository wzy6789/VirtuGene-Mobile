import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=[1,2].map(revision=>`docs/GUYUENA-LIVE-SMALL-ART-EMOTION-HOLDOUT-R${revision}-2026-10-10.json`);
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Incomplete real generation evidence');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const path=root+'/聊天验收/古月娜-2026-10-10.md';
const before=readFileSync(path,'utf8');
const heading='## small-art-emotion-holdout / r2（生产对话）';
const selected=reports[1];
const transcript=selected.rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')}`).join('\n\n');
const after=before.includes(heading)?before:before+'\n\n'+heading+'\n\n'+transcript+'\n';
const evidence='release/chat-small-art-care-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,checks:2606,typeCheck:true,qualityComplete:false,selection:'full r2 is currently better than r1 on respecting no third-party-analysis and unaccepted invitation, but not accepted human-quality completion',chat:{path,before,after},findings:['R1判定朋友敷衍、不该这样对待用户并要求不用管他，违背别分析他；告别催回头看画，把自己的邀请当用户承诺。','R2无这些评价与催促，但要求把开心描述得更具体，像访谈；首轮等着听这个可能暗示未提供的先前等待；第三轮急过和痕迹写进用户画为推测。','最后给不分析第三方边界补感受不需精确拆分，只本地检查，没有实际模型再次生成。']},null,2)+'\n');
writeFileSync(path,after);
const log=root+'/开发日志/2026-10-10.md';
const logHeading='## 古月娜庆祝与失落：关心不代替用户决定';
if(!readFileSync(log,'utf8').includes(logHeading)){
 appendFileSync(log,`\n${logHeading}\n- 前轮属于进展：Gu当前声卡/经历参考统一筛选、实际payload与两组三轮证明资料旁路已关。本轮先读当前emotionalExpressionGuidance、表达线索与Gu人格反应，增加未测四轮画完小画→朋友只嗯→本人好多了/问审美→告别，不以“我也想你”短句代表全部人味。\n- R1首轮高兴但替用户定明天光线好看画；第二轮明确别分析朋友却说对方很敷衍/不该被这样对待，替用户决定不用管他；第三轮有审美但略长；第四轮又催回头看画。不是执行失败，是有温柔词句而少尊重交流边界。\n- 新declinesThirdPartyAnalysis只识别当前本人明确别/不要/不用分析他她对方等，引用/假设/反问/第三人/另一任务排除，零授权作用，不永久存用户偏好。directChatGuidance接已讲事件与感受，可表达自己的在意，未知他人理由留白，不给第三人无证据定性或替用户决定交往。short-close新增自己的邀请不是用户已答应的约定，告别不催落实；用户已明确承诺仍按原话相处。\n- R2不再评价朋友或催看画，自己的审美更具体，但第二轮让用户描述比开心更具体的感觉，像心理访谈；首轮“等着听这个”可能暗示无来源等待，第三轮用户急过未被原话讲明。复核后将该控制方向再明确已有感受足够接话，不要求拆分/证明；最后这一步只本地验证，不再付费。模型未知后续表现，非语义保证。\n- 新14项控制表达/例外/保留关心/邀请与承诺范围；末3项不以采访替代他人分析，最终2606检查（release/chat-care-scope-local-final-2026-10-10.log）、类型（release/chat-care-scope-types-final-2026-10-10.log）通过。前2603日志也留；测试支持本地选择与提示接线，不给内容打人味分。\n- ${sources.join('、')}包含实际请求、原稿、上屏、调用；${evidence}含完整选择与聊天前后。新组只保留完整R2，R1全部项目保留，未拼接；R2是比较当前两版较好，不是宣称自然情感合格。原话chatgpt标识（输入中的一張照原样保留），优化方向简短单独存，技术限制与用量在日志。电脑版不改，Lu既有组不改。\n- deepseek-flash本轮${usage.calls}调用/input${usage.input}/output${usage.output}/total${usage.total}，R1四次11269、R2四次11037，无额外模型审核/提取/摘要、无实际质检重试。session90625已poll至terminal；R2初次返回terminal，完整报告final stop/usage齐；warning退出1未重新请求。后续以捕获失败与新情境校准，避免同组没有修改重复消耗。\n- 仍需丰富人物的自主情绪而不访谈，避免相似审美风格和替用户补内心；原著长资料准确、长聊与跨入口身份仍没完整验证。目标未完成，6.0.13不变，无打包/发布/官网下载更新。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 庆祝与失落的关心\n- 别分析第三人时，接事件和感受，不定性动机、不替用户决定交往。\n- 已说出的感受足够接话，别要求更精确描述才能回应。\n- 告别不催落实自己提出、对方尚未答应的邀请。\n');
 appendFileSync(root+'/00-总览.md',`\n- Gu庆祝/失落四轮：2606检查/类型通过，${usage.calls}调用/${usage.total}token。完整R2较R1少第三人定性与催看画，但访谈/等待/补感受仍有问题；最后方向仅本地验证，目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
