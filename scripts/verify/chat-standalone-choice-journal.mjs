import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['docs/GUYUENA-LIVE-STANDALONE-CHOICE-HOLDOUT-R1-2026-10-10.json','docs/LUXUEQI-LIVE-STANDALONE-CHOICE-HOLDOUT-R1-2026-10-10.json'];
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.rows.length!==2||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Complete paired preference reports required');
if(!readFileSync('release/chat-standalone-choice-2026-10-10.log','utf16le').includes('PASS chat-expression: 2683'))throw Error('Local checks missing');
if(readFileSync('release/chat-standalone-choice-types-2026-10-10.log','utf16le').replace(/^\uFEFF/,'').trim())throw Error('Typecheck not clean');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const r=reports[1],path=root+'/聊天验收/陆雪琪-2026-10-10.md';
const before=readFileSync(path,'utf8'),heading='## standalone-choice-holdout / r1（生产对话）';
const transcript=r.rows.map(row=>'**chatgpt**：'+row.input+'\n\n'+row.replies.map(reply=>'**陆雪琪**：'+reply).join('\n\n')).join('\n\n');
const after=before.includes(heading)?before:before+'\n\n'+heading+'\n\n'+transcript+'\n';
const evidence='release/chat-standalone-choice-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,checks:2683,typeCheck:true,qualityComplete:false,selection:{luxueqi:sources[1],guyuena:'not selected: reader-type generalization and unsupported patience-trait framing'},chat:{path,before,after},findings:['Standalone 你喜欢A还是B and 你喜欢哪种 now route to a personal viewpoint rather than only a generic question.','Reports and hypothetical contexts retain sentence scope across comma; a separate later direct question can still be recognized. Quoted option names remain options.','27 added checks: six positive forms each with shared-intent and two actual role tails, plus nine negative scope controls.','Gu chooses long stories and Lu short stories, but one sample per role cannot prove stable character distinction. Present choices are not verified novel facts.','Lu retains a complete two-turn conversation; Gu full raw is retained but not curated. No sentence splicing.','This change is a prompt-intent recognition change, not a new enforcement layer or source authorization. Unknown formats still depend on the original model understanding.','No paid retry, assessment, extraction or summary calls; no package, publication or version change.']},null,2)+'\n');
writeFileSync(path,after);
const log=root+'/开发日志/2026-10-10.md',logHeading='## 独立偏好问句：让人物说自己的选择';
if(!readFileSync(log,'utf8').includes(logHeading)){
 appendFileSync(log,`\n${logHeading}\n- 上轮为进展：倾诉→后来求助→告别接续真实过，但仍有倾听宣言。本轮补前次明确遗留的裸偏好问句缺口，读isChoiceInvitation/isViewExchange/detectHumanTurn/ownPerspective；原二选形式要求更喜欢，普通你喜欢A还是B只当普通问句，缺观点与理由指引。\n- 扩已有选择结构的可选更，支持直接哪种/哪个/哪一个偏好；不是补某个角色固定答案，不规定长篇短篇偏好。报告/条件按完整句保持逗号范围，之后独立直接问题仍可问。翻译/改写/写作请求、整句引用和都行许可仍不进入观点分支；有引号的选项名称可用。只是表达线索，不增加操作授权、身份认领或写偏好记忆。\n- 27项新增：6类正例各共享意图和两人物实际tail接线、9类反例；最终2683项通过，类型通过，release/chat-standalone-choice-2026-10-10.log、release/chat-standalone-choice-types-2026-10-10.log。已有倾诉接续、直接心意、外来者冷淡及角色隔离检查同时通过。\n- 新standalone-choice-holdout真实两轮：直接问长篇还是短篇，再表达自己喜欢短篇并说明理由。Gu选长篇且保留，Lu选短篇并补短也要立得住，两人有当前不同判断，但一个样本不能证明稳定辨识度，现时选择也不是原著事实。Gu第二轮我是没那个耐心与偏爱短篇的人往往更挑，仍把理由扩成耐性和读者类型评价，不纳新精选；全部原稿留${sources[0]}。Lu完整唯一两轮作为当前该组记录保存，不和Gu或其他版本拼句，原稿${sources[1]}，${evidence}保存精选前后及失败限制。聊天仅chatgpt与角色原话，优化另放，电脑版不改。\n- deepseek-flash ${usage.calls}真实调用/input ${usage.input}/output ${usage.output}/total ${usage.total}（Gu5275，Lu7399），complete/final stop/usage齐，无付费重试、隐藏审核/摘要/提取。其余本地零模型。\n- 长聊里的个人偏好漂移、以评价用户代替自己的反应、原著广泛熟悉程度仍未完整达标。此次机制可达性与真实两轮是进展，不能宣称近真人目标完成。6.0.13不变，无打包发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 独立偏好问句\n- 你喜欢A还是B直接问人物选择，不必先说我的偏好。\n- 理由讲作品与自己的选择，不顺手评价某类读者。\n- 两人物有不同答案；短测不证明长期声音稳定。\n');
 appendFileSync(root+'/00-总览.md',`\n- 独立偏好问句：2683项/类型过，两人物各2轮，${usage.calls}调用/${usage.total}token。Lu整组保留，Gu仍有类型评价不精选；目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
