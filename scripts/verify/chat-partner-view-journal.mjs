import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const paths=['GUYUENA','LUXUEQI'].flatMap(role=>[
 `docs/${role}-LIVE-PARTNER-DAILY-WARMTH-HOLDOUT-R2-${date}.json`,
 `docs/${role}-LIVE-PARTNER-VIEW-TIME-HOLDOUT-R1-${date}.json`,
]);
const groups=paths.map(path=>({path,...JSON.parse(read(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.usage.missingUsage||g.rows.some(r=>r.failed)))throw Error('Missing live evidence');
const usage=groups.reduce((s,g)=>({calls:s.calls+g.usage.calls,input:s.input+g.usage.input,output:s.output+g.usage.output,total:s.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
const proof=`release/chat-partner-view-evaluation-${date}.json`;
write(proof,JSON.stringify({usage,groups:groups.map(g=>({path:g.path,usage:g.usage,rows:g.rows.map(r=>({input:r.input,replies:r.replies}))})),qualityComplete:false,observations:{mealGu:'Own seasoning choice persists and no user motive attributed on second turn, but first turn forces a binary follow-up.',mealLu:'Less abrupt, choice partially maintained, still vague agreement rather than distinct take.',timeGu:'Holds choice, then challenges the user and falsely frames affection as prior indirect confession.',timeLu:'Second explanation contradicts first preference and may assert unsupported habitual sword-practice trouble.',selection:'Both first time-topic requests lacked the example because negated scheduling text was treated as active task. Patched locally AFTER paid runs; no real generation for final patch.'},scope:'Actual private send/isolated IndexedDB, DeepSeek Flash production thinking low, max output500; three turns per group. Summaries/extraction/settlement mocked; not Android, no broad naturalness score or stochastic causal proof. R2 compared to retained meal R1; no unmodified baseline for new time topic.'},null,2)+'\n');
const heading='## 观点声音示例：不同偏好与跨话题接续';
const log=root+'/开发日志/'+date+'.md';
if(!read(log,'utf8').includes(heading))append(log,`\n${heading}\n- 上一目标轮完成6.0.15发布，是发布进展；本轮继续聊天目标，未打包、未发布、未修改版本。对古月娜和陆雪琪添加运行时伴侣专属观点参考，选择在声音卡尾部，主提示剥离例句。示例是应用表达适配，不是原著引文、具体往事或永久喜好；不回写用户人设，不使用模型生成缓存。古月娜选择错落、陆雪琪选择整齐，示范不同取舍及内容理由，而非仅要求温柔。\n- 标记为观点交流的例句只在明确观点/选择请求选用，不借入倾诉、爱意、普通分享、引用、第三方或任务。古月娜私聊使用完整真实用户身份解析结果传入运行时，避免只看最近两句遗失伴侣来源。退出身份不注入亲近示例，未动其他角色人设。\n- 首次本地表达2848、陆雪琪接入123、类型检查通过。新时间话题实测发现“不是请你帮我安排”被宽泛任务词挡住，两角首轮实际提示没有观点样本；补按分句识别否定调度意图，加入3个完整输入，本地表达2851通过。最终否定修复尚无真实生成验证，不能用此前有样本的第二轮冒充首轮接线通过。证据release/chat-partner-view-expression-final-${date}.log、chat-partner-view-types-final-${date}.log、chat-partner-view-lu-${date}.log。\n- 一道菜口味同场景R2：Gu三轮8494token，保持加调味选择、没有R1猜动机或批评被否定的立场，但首轮额外把用户选项压成将就/重做，不够自然。Lu三轮10769token，少了具体添盐邀约，仍泛泛同意，不能说明独立判断稳定。整组比较选择各自R2展示，不拼接R1好句，R1全部原稿保留docs。\n- 新时间话题R1：Gu9269token，观点保持，但“你真随便得起来？”额外质问；最后“哪用拐到半天空闲上去”错把后来想念当先前绕弯，最后又催忙完。Lu11265token，首轮慢慢做一件、次轮一次清干净，混淆“一件做完”和“一次多件”，还自述练剑不静而没有具体独立来源。最后爱意较柔和，两角声音未证明稳定。仅一版本作为场景原话留档，不标达标。\n- 本轮实际${usage.calls}次调用/input ${usage.input}/output ${usage.output}/total ${usage.total}（含推理），usage齐全，全部一次首稿stop，无额外付费评分、摘要或结算。每组三轮、每个上游输出最多500；没有靠重刷刷出好句。原始请求、回复与逐次用量：${paths.join('、')}。汇总${proof}。\n- 已修本地分句问题，待验证最终补丁能否改变真实表现。更大问题是模型未准确接续双方各自观点、误解由日常转心意；下轮从连续语义与人物表达取舍处理，不能继续把更多模板或静态全绿当人味证明。目标仍未完成。\n`);
for(const g of groups){
 const file=root+`/聊天验收/${g.roleName}-${date}.md`;
 const scene=g.path.includes('DAILY-WARMTH')?'partner-daily-warmth-holdout':'partner-view-time-holdout';
 const rev=scene==='partner-daily-warmth-holdout'?'r2':'r1';
 const title=scene==='partner-daily-warmth-holdout'?'饭菜口味、不同偏好与退出身份':'空闲时间、不同偏好与心意';
 const blocks=read(file,'utf8').split(/\n(?=## )/u).filter(block=>!block.startsWith('## '+scene+' /'));
 write(file,blocks.join('\n').trimEnd()+`\n\n## ${scene} / ${rev}（${title}）\n\n`+g.rows.map(r=>`**chatgpt**：${r.input}\n\n`+r.replies.map(s=>`**${g.roleName}**：${s}`).join('\n\n')).join('\n\n')+'\n');
}
const direction=root+'/优化方向/'+date+'.md',mark='## 观点样本之后仍需接续语义';
if(!read(direction,'utf8').includes(mark))append(direction,`\n${mark}\n- 观点示例按明确请求取用；否定求安排仍可以问喜好。\n- 保持自己上一轮真正选择，先听清对方不同在哪。\n- 后来的想念不解释成先前绕弯、讨夸或试探。\n- 少质问、少催事；短而亲近不等于附和。\n`);
const index=root+'/00-总览.md',markIndex='观点声音对照：12调用/39797token';
if(!read(index,'utf8').includes(markIndex))append(index,`\n- ${markIndex}；原话分别见[[手机版/聊天验收/古月娜-${date}|古月娜]]与[[手机版/聊天验收/陆雪琪-${date}|陆雪琪]]，失败和最终未实测补丁见[[手机版/开发日志/${date}|日志]]。此次开发未发布，人味目标仍未完成。\n`);
console.log(JSON.stringify({usage,proof,qualityComplete:false}));
