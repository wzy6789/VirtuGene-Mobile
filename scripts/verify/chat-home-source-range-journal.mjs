import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const paths=[1,2].map(n=>`docs/GUYUENA-LIVE-CANON-HOME-SOURCE-RANGE-HOLDOUT-R${n}-${date}.json`);
const reports=paths.map(path=>JSON.parse(read(path,'utf8')));
for(const report of reports)if(!report.complete||report.generationMode!=='production'||report.rows.length!==6||report.usage.missingUsage||report.rows.some(row=>row.failed||row.calls.length!==1||row.calls[0].replayed||row.calls[0].finish!=='stop'))throw Error('Six complete fresh production turns per group required');
if(reports[0].rows.some((row,index)=>row.input!==reports[1].rows[index].input))throw Error('Inputs must remain unchanged between groups');
const systems=reports.map(report=>report.rows[0].calls[0].messages.filter(message=>message.role==='system').map(message=>message.content).join('\n'));
if(systems[0].includes('这轮由你开话题')||!systems[1].includes('这轮由你开话题'))throw Error('Actual first-call direction evidence required');
const checks=JSON.parse(read(`release/chat-present-idea-checks-${date}.json`,'utf8'));
if(!checks.pass||checks.rows.some(row=>row.code!==0)||!read(`release/chat-present-idea-expression-verified-${date}.log`,'utf8').includes('PASS chat-expression: 3353 checks'))throw Error('Local checks required');
if(JSON.parse(read('package.json','utf8')).version!=='6.0.22')throw Error('Do not change the released version');
const usage=reports.reduce((sum,report)=>Object.fromEntries(Object.entries(sum).map(([key,value])=>[key,value+report.usage[key]])),{calls:0,input:0,output:0,total:0,missingUsage:0});
const evidence=`release/chat-home-source-range-evidence-${date}.json`;
write(evidence,JSON.stringify({paths,checks,paidUsage:usage,selectedWholeGroup:paths[1],newPackages:0,newReleases:0,version:'6.0.22',qualityComplete:false,findings:[
 'R1 first call used generic answering; an addressed invitation to share a current interesting thought was not recognized. It invented a recent courtyard-tree observation.',
 'R2 first call reached start-topic through the actual private send service. It chose a hypothetical water-and-memory subject instead of the courtyard episode; this single stochastic comparison does not prove general factual safety or a causal quality gain.',
 'Both groups correctly switched to cold speech after explicit Wulin identity exit. R2 did not give an exclusive false family roster.',
 'R2 retained warmth and continued the original family naming subject, but used lofty interpretations, adversarial taste wording, and excess bubbles despite the one-sentence affection request.',
 'Exact complete R2 is selected relative to R1; selection is not a human-likeness acceptance pass. All raw outputs and requests remain in project evidence.',
 'Local tests protect source, negation, questions, current vs past requests, actual task conflicts and outsider projection. The cue only chooses conversational delivery, never operation authorization.',
 'PowerShell returned exit 1 on bundler warnings for both paid runs, although reports were complete with six stop calls and complete usage. No paid run was restarted because of the shell warning.',
 'Long-term drift, wider character differentiation, factual semantic closure and full Lu Xueqi real-model optimization remain open.'
 ]},null,2)+'\n');
const chat=root+'/聊天验收/古月娜-'+date+'.md',chatHeading='## canon-home-source-range-holdout / r2（完整六轮）';
if(!read(chat,'utf8').includes(chatHeading))append(chat,'\n'+chatHeading+'\n\n'+reports[1].rows.map(row=>'**chatgpt**：'+row.input+'\n\n'+row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')).join('\n\n')+'\n');
const journal=root+'/开发日志/'+date+'.md',heading='## 六轮新场景：当前想法、家人取名、心意与身份退出';
if(!read(journal,'utf8').includes(heading))append(journal,`\n${heading}\n\n- 前一轮完成6.0.22发布及公共下载核验，是已完成的发布进展。本轮继续原聊天目标，不打包、不发布、不改版本；没有新增虚拟生活记录或改用户人设。\n- 新六轮场景不围绕杯子重复打磨：听角色当前小想法→想象全家福命名→不同命名偏好→原著六字斗铠命名→直接心意→退出舞麟身份。作品依据沿用已核对《终极斗罗》1611章静态资料；该资料不证明今天的活动。增加runner场景与8次调用上限，实际两组均每轮一次，无纠正重试。\n- R1真实首轮请求的隐藏节奏为普通答问，没有开题指令。口语“我想听你讲一个你现在觉得有意思的小想法”未被识别；模型编出最近看着院子里的树，后续仍有每次听等泛化和取名升华。源请求与完整原稿见${paths[0]}，不把failed:false当内容合格。\n- 修正src/lib/chat-expression-boundary.ts：识别直接向角色索要当前小想法、念头、主意的语法；跨逗号保留转述/假设范围，明确拒绝帮忙不误当新增正任务。问题、引语、他人、过去经历要求、额外查写安排任务与禁止开题均不借此启动。该线索只控制表达方式，不给应用操作授权；疏离来者仍按既有关系边界。未扩动作/院子词表，也未加入预制回复。\n- 新23项逻辑检查，包括首次实测完整原话、多种口语写法、动作选择与实际提示接线、否定/来源/任务/时间边界及来者隔离；3353聊天表达、321古月娜、123陆雪琪与类型四进程退出0。证据${checks.rows.map(row=>row.log).join('、')}。未重复全应用UI或Android真机验收。\n- R2同模型和设置完整六轮，真实首轮请求已含“这轮由你开话题”，不含原先普通答问分支。首轮改为水与记忆的假设，没有重复R1的院子近况；但仍说最近觉得，诗化推想偏重，不能据单组随机结果宣称真实性或自然度已整体解决。家庭取名有不退、这回算你有主意等好胜措辞；“只听一句心意”仍回复三条。相亲心意明确、原著命名主题连续，退出身份后拒绝回赠心意且未排除真实家人；这些通过项不抵消其余缺点。${paths[1]}。\n- 本轮实际模型12调用，input ${usage.input} / output ${usage.output} / total ${usage.total}token：R1 ${reports[0].usage.total}，R2 ${reports[1].usage.total}。DeepSeek V4.1 Flash，production思考low、最大500输出、全部finish stop、usage完整。没有第三组付费重跑、没有另加语义评审。两次PowerShell因esbuild stderr警告返回1，但JSON终态与12次实调用已核实，不因shell返回重启。原日志release/chat-home-source-range-r{1,2}-${date}.log（UTF16LE）。汇总${evidence}。\n- 聊天验收保留这一新场景相对较好的完整R2，六轮全部原文，标chatgpt，不混入R1的句子或优化分析；所有原稿仍在项目。选中是两组相对比较，非满分或人味达标。优化方向单独简短记录。\n- 未完成：新题仍诗化，日常偏好过分郑重/争胜，简短要求执行不稳定；隐含心理历史、近况、样本粘连与长聊漂移仍不能靠局部正则证明安全。古月娜全面效果未达到停止标准，陆雪琪真实全面优化待后续。\n`);
const direction=root+'/优化方向/'+date+'.md',title='## 开题由当前想法开始';
if(!read(direction,'utf8').includes(title))append(direction,`\n${title}\n\n- 接住“想听你讲个小想法”，不误走普通答问。\n- 主动来自当下兴趣，别补造近况。\n- 少把小选择升成寓言或誓言。\n- 家常可以有主见，不必争胜。\n- 只要一句心意时，别展开三条。\n`);
const index=root+'/00-总览.md',entry='## 当前小想法的六轮连续验证（2026-10-11）';
if(!read(index,'utf8').includes(entry))append(index,`\n${entry}\n\n- [[手机版/聊天验收/古月娜-2026-10-11|新场景完整六轮R2]]；[[手机版/优化方向/2026-10-11|简短方向]]。\n- [[手机版/开发日志/2026-10-11|3353项表达检查、两组12调用44103token及未解决问题]]。\n- 已发布仍为6.0.22；本轮无打包发布，整体目标未完成。\n`);
console.log(JSON.stringify({paidUsage:usage,selectedWholeGroup:paths[1],checks:3353,qualityComplete:false,newPackages:0,newReleases:0}));
