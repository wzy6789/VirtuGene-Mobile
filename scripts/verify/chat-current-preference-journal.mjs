import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-current-preference-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Preserve existing selection');
const file='docs/GUYUENA-LIVE-FAMILIARITY-CORRECTION-TRANSFER-R1-2026-10-10.json',r=JSON.parse(readFileSync(file,'utf8'));
if(!r.complete||r.rows.length!==4||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Completed source required');
const path=root+'/聊天验收/古月娜-2026-10-10.md',before=readFileSync(path,'utf8');
if(before.includes('## familiarity-correction-transfer'))throw Error('Existing whole group needs comparison');
let block='\n\n## familiarity-correction-transfer / r1（生产对话）\n';
for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**古月娜**：'+reply+'\n';}
const decision={selected:file,path,before,after:before+block,reason:'新四轮全输入只生成一组，完整保存，不拼版本；并非质量合格或多版择优证明。',limitations:'最认真、以前手更配锤等未支持细节，正常/不丢人评价和旁边看画、没抬头等现场仍存在。'};
writeFileSync(evidence,JSON.stringify({usage:r.usage,decision,retainedChange:'Literal current preference update keeps temporal scope; cannot authorize unqualified persistent or universal history. Existing forging fact set now includes previously verified growth goals.',qualityComplete:false},null,2));
writeFileSync(path,decision.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 原著喜好与当前变化\n- “我现在不喜欢”不再失去现在限定，不能变成一直不喜欢；明确长期原话和当前普通喜好仍可用。\n- 补齐既有锻造兴趣及成长目标，避免用一个爱好抹掉其他追求。\n- 四轮能接喜好变化、换题和告别，但仍添吃得最认真、共同现场与评价感受；尚未达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n## 当前偏好时间范围与古月娜原著熟悉（中断后归档）\n- 上轮实际已修改并完成进程，本轮中断后读取report.complete及结束日志核实，不重新调用。chat-user-habit-risk原来归一化“我现在/如今喜欢”时丢弃时间限定，导致“我一直喜欢锻造→我现在不喜欢锻造”竟支持“你一直不喜欢锻造”。先加25项本地正负用例，baseline红，保留currentOnly元数据后2148项通过；明确当前选择不能授权一直/一向/向来/总是/每次的断言，普通当前喜好和明确独立长期原话仍保留。是有限字面来源保护，不等于完整语义时间理解。\n- gu-yue-na-canon锻造daily资料补入已有知识条目中的强大魂师、斗铠师目标，不能将喜欢锻造解释为不在意成果或别的事。没有新增未经核对的小说事实、不作新引文。Gu检查ALL PASS、类型通过，release/chat-current-preference-{verified,gu-care,types}-2026-10-10.log；baseline失败release/chat-current-preference-baseline-2026-10-10.log保留。Lu共用来源检查；本轮真实对话只跑Gu，没有把Gu证据冒称Lu实测。\n- Gu familiarity-correction四轮新输入：问旧喜好→现在不喜欢锻造而喜欢画画→猫形云换题→告别。实际已接变化并跟随新话题，却新增闷罐牛肉吃得最认真、之前总觉得手配锤等无来源细节，且评价正常/不丢人、旁边看画、没抬头看天；明显不满足完成标准。新组只有本次，整组保存作唯一展示，不拼句，不把完成传输当自然/真实通过。\n- ${file}；release/guyuena-current-preference-live-2026-10-10.log；选择及展示前备份${evidence}。输入chatgpt、原话与简短方向/技术记录分别存。\n- 实际4次deepseek-flash付费input${r.usage.input}/output${r.usage.output}/total${r.usage.total}；500输出上限，每轮1次无重试、finish stop及usage完整。session67411已实际poll确认终止，当前无该活跃进程，不因中断重启。隔离IndexedDB actual private，非流式上游，摘要/提取/结算替身，未验证Android或长聊。凭据不输出。\n- 6.0.13不变，无打包/发布/官网下载更新。完整目标继续，下一步从当前payload结构和来源边界复核，避免继续针对每个失败名词加规则。\n`);
appendFileSync(root+'/00-总览.md',`\n- 当前偏好范围：2148项、Gu与类型通过，Gu四轮4调用${r.usage.total}token，接受变化但仍添未核对细节；中断后核实终止归档，目标继续。\n`);
console.log(JSON.stringify({usage:r.usage,selected:file,qualityComplete:false}));
