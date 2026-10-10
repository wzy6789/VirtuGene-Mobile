import {readFileSync,appendFileSync} from 'node:fs';

const root='D:/月起云归/VirtuGene/手机版';
const names=['CHAT-LUXUEQI-CLARIFICATION-FRAMING-R1-2026-10-10.json','CHAT-GUYUENA-REACTION-BRIEF-R1-2026-10-10.json'];
const reports=names.map(name=>({name,data:JSON.parse(readFileSync('docs/'+name,'utf8')),usage:JSON.parse(readFileSync('docs/'+name.replace('.json','-USAGE.json'),'utf8'))}));
const marker='## 澄清与普通反应冻结对照：两候选均未采用';
const log=root+'/开发日志/2026-10-10.md';
if(readFileSync(log,'utf8').includes(marker))throw Error('Evidence already journalled');
if(reports.some(({data,usage})=>!data.complete||usage.totals.missingUsage||data.rows.some(row=>row.finish!=='stop')))throw Error('Incomplete comparison');
const totals=reports.reduce((s,{usage})=>({calls:s.calls+usage.totals.calls,input:s.input+usage.totals.input,output:s.output+usage.totals.output,total:s.total+usage.totals.total}),{calls:0,input:0,output:0,total:0});
const entries=reports.map(({name,data:r,usage})=>{
 const path=root+'/聊天验收/'+r.roleName+'-2026-10-10.md';
 const title='## 冻结措辞诊断 / '+name;
 if(readFileSync(path,'utf8').includes(title))throw Error('Dialogue already journalled');
 let entry='\n\n'+title+'\n\n这是保存的真实上下文重新调用提供方的原版/候选对照，不是应用上屏、DB写入或连续新聊天。随机一次不构成因果或统计结论，候选均未采用生产。用量 '+JSON.stringify(usage.totals)+'。证据 F:/VirtuGene-Mobile/docs/'+name+'。\n\n';
 const history=r.rows[0].messages.slice(1,-1);
 if(history.length){entry+='### 两分支共同的实际历史\n\n';for(const row of history)entry+=(row.role==='user'?'chatgpt':r.roleName)+'：'+row.content+'\n\n';}
 for(const row of r.rows)entry+='### '+row.arm+'\n\nchatgpt：'+row.input+'\n\n'+r.roleName+'：'+row.raw+'\n\n';
 entry+='复核：陆雪琪原版反而能表达自己的兴趣，候选只说听着并重问歌名。古月娜原版也有打趣/追问，简短反应候选又编「小时候你听歌不多，光顾着吃了」；原著饭量大不证明幼年少听歌。缩短指导、避免默认自责、允许主动反应都不能仅凭合理措辞就认定效果。没有把未采用候选当作当前生产缺陷已经被新改法修正。\n';
 return [path,entry];
});
const text=`\n\n${marker}\n\n上一轮明确童年自述来源、两角色实际发送检查与真实修正为进展。本轮检查未达标的自然表达，先冻结陆雪琪ordinary-discovery R1第二轮完整上下文，再冻结古月娜同组首轮。每项原版/候选各一次，保留模型与generation参数、历史、事实、人物原文、完整声音卡和共享契约。不新增原著材料，不使用其他人设替代人物。\n\nclarification-framing只将自有隐藏节奏的明确用意更正句改为补充用意不等于你说错，并移除同区重复泛化事实更正句。边界需精确旧句/完整声音卡/正确节奏区，不接受修改来源；实际两角色来源均做零调用边界验证。陆雪琪原版「听你说起这个，我也觉得有点意思」，候选「好，那我听着」「是哪首歌」，没有自然度优势，且重复前文问歌名。没有把本地接线成功或不道歉等同好聊天，未采用生产。\n\nreaction-brief只把明确react动作190字左右的自有指令压短，移除该处重复来源禁令和负面示例，实际共享事实契约完整保留。不是删人物、书后关系或来源要求，也不强行一个气泡/短字数。古月娜原版打趣「你也有走不动路的时候」再问歌，候选反而编出用户幼年听歌不多、光顾吃饭；已有小说饭量与锻造兴趣不支持这条新断言。两边仍以问题收尾，未证明更自然。候选也未采用。发现童年来源保护只覆盖角色第一人称，不等于当前用户或小说舞麟的全部童年自述被保护；语义泛化仍有缺口，不能宣传真实性全面闭环。\n\n原始docs/${names.join('、docs/')}及各-USAGE.json，脚本chat-context-ablation-live/budgeted新增两个诊断分支，chat-context-ablation-checks核对实际两角色来源、事实/人物/声音卡/契约不变，运行通过，均不进入生产。没有重跑不相关全套或宣称新的生产验证。\n\n本轮实际${JSON.stringify(totals)}：4请求12634tokens，陆雪琪冻结7431/152/7583，古月娜冻结4785/266/5051（input/output/total），max_tokens500、两代理各预算2，finish stop、usage完整。没有重试、额外评分或新连续组，诊断直接调用提供方，不经发送后处理/DB/流式。凭据仅内存授权第二DeepSeek配置，finally关代理，无凭据输出，未覆盖旧证据。完整原话与共同历史按chatgpt/角色分别追加Obsidian聊天验收。\n\n古月娜连续累计保持470展示轮、84回放、388付费请求及1286776tokens，本日连续122请求328175tokens。古月娜冻结累计16请求41337tokens，独立修正2请求4988tokens等另计；本轮陆雪琪冻结2请求7583tokens也单列，不加入她的连续对话统计。不隐去候选失败，不称原版随机一次自然回复是已稳定达标。\n\n结论：这两种措辞层调整没有证据支持采用，保持原生产指导。下一步应验证普通分享中事实领域与关系熟悉的使用范围，以及不同话题下自有观点的稳定程度；避免对固定歌名/画画场景叠同义规则。人物关系、现有源支持偏好与用户自定义文字保留。完整目标仍未达到，维持6.0.13，不打包、不发布，不修改官网/电脑版日志。\n`;
for(const [path,entry] of entries)appendFileSync(path,entry);
appendFileSync(log,text);
appendFileSync(root+'/00-总览.md','\n\n- 10月10日自然表达冻结诊断：陆雪琪澄清、古月娜短反应候选均无改善证据，未采用；新增4调用12634tokens，事实领域外推与自然接话仍待改善。见[[开发日志/2026-10-10]]与两角色当天聊天验收。\n');
console.log('Appended rejected-candidate evidence and separate mobile dialogues; production unchanged');
