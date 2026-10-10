import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const paths=[];
for(const role of ['GUYUENA','LUXUEQI'])for(const revision of ['R1','R2'])paths.push(`docs/${role}-LIVE-CASUAL-SIDEWALK-HOLDOUT-${revision}-2026-10-10.json`);
for(const role of ['GUYUENA','LUXUEQI'])paths.push(`docs/${role}-LIVE-TINY-CURIOSITY-HOLDOUT-R2-2026-10-10.json`);
const groups=paths.map(path=>({path,...JSON.parse(readFileSync(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.usage.missingUsage||g.rows.some(row=>row.failed||row.calls.length!==1||row.calls[0].finish!=='stop')))throw Error('Complete actual groups required');
const usage=groups.reduce((sum,g)=>({calls:sum.calls+g.usage.calls,input:sum.input+g.usage.input,output:sum.output+g.usage.output,total:sum.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
if(usage.calls!==8||usage.total!==25310)throw Error('Unexpected actual usage');
const routing=JSON.parse(readFileSync('release/chat-compact-react-routing-2026-10-10.json','utf8'));
if(routing.modelCalls!==0||routing.rows.length!==2||routing.rows.some(row=>!row.pass))throw Error('Current production routing not verified');
if(!readFileSync('release/chat-compact-owned-react-expression-2026-10-10.log','utf16le').includes('PASS chat-expression: 2829 checks')||readFileSync('release/chat-compact-owned-react-types-2026-10-10.log','utf16le').trim())throw Error('Local verification missing');
const evidence='release/chat-compact-react-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({usage,groups:groups.map(g=>({path:g.path,diagnosticCompactOverride:g.compactReact??false,usage:g.usage,rows:g.rows.map(row=>({input:row.input,replies:row.replies}))})),production:{guOrdinary:'existing paragraph',luOrdinary:'short directive',otherActions:'unchanged'},localChecks:2829,routingCalls:0,qualityComplete:false,limits:['One paired topic per actor, not a statistically reliable expression score.','The second Gu topic was temporarily generated with compact production guidance; that Gu activation was removed after review.','Lu compact topic still pulled in the child with an unsupported recurring thought premise.','Gu output still presumed surprise at user noticing ordinary things.','No complete long-dialogue or novel fidelity acceptance.']},null,2)+'\n');
const heading='## 普通分享指导的小量对照：仅保留陆雪琪的精简';
if(!readFileSync(root+'/开发日志/2026-10-10.md','utf8').includes(heading)){
 appendFileSync(root+'/开发日志/2026-10-10.md',`\n${heading}\n- 上轮当前偏好/句中否定与用意更正是已验证进展。本轮针对回复复述指导的问题，先查既有minimal-turn证据：Gu continuous-ten R2及familiar-choice R8（旧生产）全删指导仍有新造日常、虚构次数与追问，不重跑完全删除实验，不将旧配置结果直接当当前结论。\n- 新casual-sidewalk一轮同主题成对生成：店门两块互相矛盾的牌子，人物/当前身份/声音卡/来源块/合同/模型/主动档不变，仅普通react第一行长段缩成“接这件小事，说出你自己此刻的反应”。新diagnostic标记与限定scene拒绝混合其他试验参数，网络前验证恰一处react块，只替换该行，不删事实、假设或其他场景指导。\n- Gu R1带舞麟称呼与共享吐槽较完整；R2简短但末尾追加假设问题，没见稳定优势。Lu R1后半段替店家解释怕占门口，R2一句“是想让人进去，又不许人走神…很会为难人”更像随口接话。每人每条件仅1次，无真实评分统计，不声称已经有因果或稳定人味证明。\n- 先暂时两角色启用短react，并跑独立tiny-curiosity R2两轮（盆栽名字→不同意见）。Gu仍“你还会看这种小事看得出神”预设习惯/姿态，Lu仍“是不是又想起小鼎”强拉孩子及已有心思，说明短指导不自动解决事实或个性。后续两人选择仍不同。家庭物件边界本次没有触发，但不证明所有假设物件都已关。\n- 依据实际收益，最终private send仅luXueQiTurn.context经原owned preset验证后开compactOrdinaryReaction；Gu取消临时激活，继续原段。仅react动作取短指令，求助、情绪、心意、更正、告别、当前来客极冷以及其他人物均沿现有机制。声卡、来源、关系与原一次纠正预算都保留。复用语气参数没有对人设或数据库改写，不生成固定回复。\n- release/chat-compact-react-routing-2026-10-10.json实际私聊发送/隔离IndexedDB复用两捕获原稿，确认最终Gu长段、Lu短段和声卡仍在请求中，两例0 paid。这是当前接线证据，不是新真实模型输出；captured tiny Gu R2属于已撤回的试验配置，不冒称现在的软件行为。\n- 聊天2829/类型过，release/chat-compact-owned-react-expression-2026-10-10.log、release/chat-compact-owned-react-types-2026-10-10.log。新增8项含保留个性、distant先行及非react动作不受影响。\n- 本轮${usage.calls}次DeepSeek Flash/input ${usage.input}/output ${usage.output}/total ${usage.total}，全首稿stop，无empty和实际重试，无付费摘要/提取/结算；4个成对首轮加4个独立两轮样本，${evidence}留所有结果/限制。诊断override false不代表生产Lu没有短指导，实际messages与最终routing为准。PowerShell既有构建警告返回1不当未完成，终态JSON确认后无重启。\n- 路边牌子组整体选Gu R1、Lu R2；Lu R2为真实诊断版本，其单行精简后来接入生产，不拼旧解释或新句。两组独立盆栽R2仍有明显问题，不精选。输入chatgpt，原稿全保留项目，开发/方向/聊天分存手机版。\n- 仍未达标：Gu没有稳定改善，Lu仍母亲话题偏置，长聊和原著符合尚需广范围验收。此变化是局部可评估试验，不外推全局所有场景。6.0.13不变，无打包发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 减少指导复述，有收益才保留\n- 全删指导没有稳定收益，只试普通分享一行。\n- 陆雪琪保留精简，古月娜未见收益则不强行套用。\n- 简洁不等于自然，孩子联想与习惯猜测继续处理。\n- 不用一个笑点证明稳定个性或长聊质量。\n');
 appendFileSync(root+'/00-总览.md',`\n- 普通分享对照：8调用/${usage.total}token。最终仅Lu普通react精简，Gu维持原段；2829/类型及0 paid实际路由检查过。新话题仍有习惯/子女偏置，目标未完成，无发布。\n`);
}
for(const [role,revision] of [['GUYUENA','R1'],['LUXUEQI','R2']]){
 const group=groups.find(g=>g.path.includes(role)&&g.scene==='casual-sidewalk-holdout'&&g.revision.toUpperCase()===revision);
 const file=root+`/聊天验收/${group.roleName}-2026-10-10.md`;
 const title=`## casual-sidewalk-holdout / ${revision.toLowerCase()}（路边的两块店招）`;
 if(!readFileSync(file,'utf8').includes('## casual-sidewalk-holdout /'))appendFileSync(file,'\n'+title+'\n\n'+group.rows.map(row=>`**chatgpt**：${row.input}\n\n`+row.replies.map(reply=>`**${group.roleName}**：${reply}`).join('\n\n')).join('\n\n')+'\n');
}
console.log(JSON.stringify({usage,evidence,productionCompact:'Lu ordinary private only',qualityComplete:false}));
