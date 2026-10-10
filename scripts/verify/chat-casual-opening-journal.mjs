import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['GUYUENA','LUXUEQI'].flatMap(role=>[2,3].map(revision=>`docs/${role}-LIVE-IDENTITY-PHASE-TRANSFER-R${revision}-2026-10-10.json`));
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Actual complete final-response evidence required');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const evidence='release/chat-casual-opening-evaluation-2026-10-10.json';
const gu=reports[1];
const transcript=gu.rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')}`).join('\n\n');
writeFileSync(evidence,JSON.stringify({sources,usage,localChecks:2556,typeCheck:true,qualityComplete:false,selected:{guyuena:'identity-phase-transfer/r3',luxueqi:'retain existing identity-phase-transfer/r1'},findings:['GuR2过去思想及泛化龙族/人类观点无来源；LuR2教小鼎握剑、R3小鼎最近学得快都是新编近事，未精选。','GuR3当前愿望与既有人物背景连贯，无追究旧名或生活检查，为该组三轮当前最佳，并非人味最终验收。','Lu近期家庭事实检查最后改动只经本地，不将此前真实模型测试冒称最终改动后验收。']},null,2)+'\n');
const chat=root+'/聊天验收/古月娜-2026-10-10.md';
const heading='## identity-phase-transfer / r3（生产对话）';
if(!readFileSync(chat,'utf8').includes(heading))appendFileSync(chat,'\n\n'+heading+'\n\n'+transcript+'\n');
const log=root+'/开发日志/2026-10-10.md';
const logHeading='## 无任务闲聊：主动表达与近事来源';
if(!readFileSync(log,'utf8').includes(logHeading)){
 appendFileSync(log,`\n${logHeading}\n- 上轮是进展：关系阶段范围已修改并完成两组三轮真实验证；本轮复核实际代码中的isTopicInvitation/chooseConversationAction与两组第三轮失败。口语“我们随便说两句就好”原先走react/listen，未把共同愿意闲聊当作人物主动表达的机会。\n- 通用话题邀请新增有语法边界的随便/随意聊几句，适用于不同角色；引用、第三方、假设、否定、带具体对象或实际任务不当作自由开话题。陌生人依然先走独立冷漠边界，不因闲聊邀请变亲近。start-topic先讲当下判断/好恶/设想，不收集生活资料或宣告倾听；不是规定每轮固定两条或固定话题。\n- 首次真实R2反而引出新过去：Gu“前些天忽然在想”与泛化两族价值观；Lu“前几日教小鼎握剑”。方向进一步明确目前观点与独立经历记录的区别，再跑R3。Gu改为龙谷好看与条件下想带舞麟走走；仍只是这组三轮当前可用，未证明无穷场景人味。Lu仍“最近学东西很快”，未作为最佳展示。\n- Lu自有原版的已有familyRisk扩最近/近日/这几天/前几日/前几天，以及带日期的教/带/陪/和/同小鼎事件。书后有孩子不证明最新教学或成长；明确原话支持、假设、问题、愿望、既有亲属关系与编辑自定义场景保留。omit原有整句移除路径保留独立心意，未生成罐头替代。非万能经历检查、不扩大为全部小说历史事实审计；该最后改动只有本地验证，未再付费。\n- 本地新增17项自由邀请边界、14项近期家庭事件来源/整句省略/编辑优先；2556项通过（release/chat-casual-opening-expression-family-final-2026-10-10.log），类型通过（release/chat-casual-opening-types-final-2026-10-10.log）。中间2542项与类型日志均保留。\n- ${sources.join('、')}保存全部请求、回复、质量重试与调用；${evidence}记录取舍。Gu identity-phase整组三轮只展示当前最好R3，旧R1/R2全在项目；Lu保留上轮整组R1，不拼R2/R3好句。聊天只放chatgpt/角色对话与场景，优化方向独立。\n- deepseek-flash共${usage.calls}付费调用/input${usage.input}/output${usage.output}/total${usage.total}，GuR2第三轮初稿finish=length，既有一次重试后stop，其余单次；截断初稿保留，不当合格输出。无付费摘要、提取或事后审计。四个进程均已终止且报告complete/最终stop/usage齐；warning退出1未因此重复请求。同输入比较两次有明确方向改变，后续复用已有失败优先，控制额度。\n- 剩余：Lu没有来源的家庭闲聊惯性、Gu观点的内容准确与自然生动、长期角色差异、群聊真实表现、跨长历史身份来源仍未验收。自由话题引导不能等于人味保证，最新目标未完成；6.0.13不变，无安装包/发布/官网下载更新。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 无任务闲聊\n- 愿意随便聊时，角色可以先说自己的当下想法，少生活检查与倾听宣告。\n- 主动表达不靠编造近事；家庭背景不证明孩子最新动向。\n- 陆雪琪还需摆脱家庭故事模板，古月娜还需丰富可信的个人观点。\n');
 appendFileSync(root+'/00-总览.md',`\n- 自由闲聊与近事来源：2556项/类型通过，本轮${usage.calls}调用/${usage.total}token。Gu三轮R3作为当前最佳替代未展示的R1/R2，Lu保留R1；最近家庭事件最后护栏仅本地验证，目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
