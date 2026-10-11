import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const paths=['GUYUENA','LUXUEQI'].flatMap(role=>[
 `docs/${role}-LIVE-PARTNER-VIEW-TIME-HOLDOUT-R2-${date}.json`,
 `docs/${role}-LIVE-PARTNER-VIEW-PATH-HOLDOUT-R1-${date}.json`,
]);
const groups=paths.map(path=>({path,...JSON.parse(read(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.usage.missingUsage||g.rows.some(r=>r.failed)))throw Error('Incomplete evidence');
const usage=groups.reduce((s,g)=>({calls:s.calls+g.usage.calls,input:s.input+g.usage.input,output:s.output+g.usage.output,total:s.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
const routing=groups.map(g=>({path:g.path,rows:g.rows.map(r=>{
 const prompt=r.calls[0].messages.find(m=>m.role==='system').content;
 return {input:r.input,viewAnchor:prompt.includes('[相邻观点原话]'),hypothesis:prompt.includes('[正在讨论的假设]'),oldTopic:prompt.includes('当前话题只作为背景参考')};
})}));
if(routing.some(g=>!g.rows[1].viewAnchor||g.rows[2].viewAnchor||g.rows[2].hypothesis||g.rows[2].oldTopic))throw Error('Actual requests contradict routing');
const evidence=`release/chat-view-continuity-evaluation-${date}.json`;
write(evidence,JSON.stringify({usage,routing,groups:groups.map(g=>({path:g.path,usage:g.usage,rows:g.rows.map(r=>({input:r.input,replies:r.replies}))})),qualityComplete:false,assessment:{time:'Both retain one-slow-task preference on follow-up. Gu no longer labels prior talk an indirect confession, but has an unsupported vague past claim and a strained time metaphor. Lu present affection is clear.',path:'Both retain river-path preference and handle later affection with old premise absent. Gu still speculates about user motive, generalizes dragon-water affinity, and introduces an unrequested future walk; Lu first turn gives unnecessary joint-walk options.',causality:'Time R2 changes both earlier negated-request selection and current continuity, not an isolated causal proof. Path is a fresh topic with no unmodified baseline. All first drafts passed local quality, which did not detect these semantic defects.'},scope:'Production private send and isolated IndexedDB. DeepSeek Flash thinking low; output cap500, each scene max6 calls. Summaries/extraction/settlement mocked; no Android or broad human-likeness score.'},null,2)+'\n');
const log=root+'/开发日志/'+date+'.md',heading='## 连续接话：当前心意退出旧假设、观点归属原话';
if(!read(log,'utf8').includes(heading))append(log,`\n${heading}\n- 前一轮已改权威代码并取得12次真实生成，因此是进展；本轮复查真实请求发现，用户后来直接说想念时，隐藏提示仍追加“本轮仍在这个假设里交换想法”，泛词“安排”让旧条件继续激活。不是模型单方面不遵守，也不是缺一条温柔禁令。\n- conversationalHypothesis遇到当前非问句直接心意时清除旧假设；当前另有明确假设问句仍保留新条件。连续注意力仅渲染当轮时省去旧话题/搁置列表，原会话状态与历史不删除，真正续谈时仍可读取，回复长度和不连问等真实偏好保留。\n- 提取统一的requestsCharacterChoice：直接两选问句含假设仍可交流观点，否定求安排不等同实际任务；不对应用操作授权。声音例句选择复用，不另存习惯。新chat-view-continuity从相邻用户问句和人物连续气泡读取原话，只用于真正追问自己的理由，最多260字问题/320字答复，超限省略不截断；归属明确且不是事实记忆，不为换话题、新选择、普通心意或无答复发明立场。额外加新具体题目相关性条件，避免把旧选择套到另一兴趣上。\n- 初次本地验证失败于新增测试变量attention/timeQuestion与旧套件同名，不是通过；已保留release/chat-view-continuity-expression-initial-failure-${date}.log，局部作用域修正后2867通过，新增不相关观点检查后最终2868通过，最终类型检查通过。证据release/chat-view-continuity-expression-final-${date}.log、chat-view-continuity-types-final-${date}.log。\n- 原时间场景R2：Gu9016、Lu11497token，均保持一件慢做的选择，Gu没有R1的质问和把心意说成绕弯，Lu最后直接说我也想你/听你说出来高兴。Gu首轮“以前总是赶”缺独立具体依据，最后时辰用完的比喻仍有修辞感，不标人味达标。R2包含上一轮否定调度修复和本轮焦点修复，不是单变量对照；不相关新话题过滤在R2之后加入，该输入仍走同一原话分支。\n- 新沿河散步R1：Gu9130、Lu11343token。两角第二轮维持沿河选择，四组三轮实际请求中第二轮都有相邻观点原话，第三轮都没有旧假设/话题/观点锚。Gu依旧猜“想陪我还是嫌磨蹭”，把龙族亲水泛化成依据（未在已提供来源证实具体亲水喜好），结尾又约下次走路；Lu首轮也给陪走或等她的额外选项。亲近有进步，仍未证明不盘问、不臆断、自由话题鲜明而稳定。\n- 本轮实际${usage.calls}调用/input ${usage.input}/output ${usage.output}/total ${usage.total}（含推理），逐次usage齐全，均一次首稿stop；每次输出最多500，每组最多6调用，未靠反复刷稿或付费评审挑句。真实私聊send-service与IndexedDB，上游非流式，摘要/提取/结算替身；不能证明Android等待体验。原稿${paths.join('、')}，汇总${evidence}，日志release/chat-view-continuity-{gu,lu}-live-${date}.log及chat-view-path-{gu,lu}-live-${date}.log。\n- 手机版聊天验收的时间组整组选择R2替换R1，沿河只有R1整组留档；不拼接不同版本，全部项目原稿保留。优化方向单独简记。此次不打包、不发布，版本6.0.15保持；下一步仍需减少Gu猜动机、臆定喜好与未来安排，不能以局部观点保持或静态质检通过宣布完成。\n`);
for(const g of groups){
 const file=root+`/聊天验收/${g.roleName}-${date}.md`;
 const time=g.path.includes('VIEW-TIME');
 const scene=time?'partner-view-time-holdout':'partner-view-path-holdout';
 const rev=time?'r2':'r1',title=time?'空闲时间、不同偏好与心意':'散步路线、不同偏好与心意';
 const blocks=read(file,'utf8').split(/\n(?=## )/u).filter(block=>!block.startsWith('## '+scene+' /'));
 write(file,blocks.join('\n').trimEnd()+`\n\n## ${scene} / ${rev}（${title}）\n\n`+g.rows.map(r=>`**chatgpt**：${r.input}\n\n`+r.replies.map(s=>`**${g.roleName}**：${s}`).join('\n\n')).join('\n\n')+'\n');
}
const direction=root+'/优化方向/'+date+'.md',mark='## 连续接话的焦点分开';
if(!read(direction,'utf8').includes(mark))append(direction,`\n${mark}\n- 后来的心意退出旧假设，不倒推聊天动机。\n- 解释自己的选择时核对上一轮原话，不随对方换答案。\n- Gu仍多猜动机、泛化设定与约未来；Lu少追加陪走选项。\n- 局部连续性改善，真实自然度仍未达标。\n`);
const index=root+'/00-总览.md',markIndex='连续接话对照：12调用/40986token';
if(!read(index,'utf8').includes(markIndex))append(index,`\n- ${markIndex}；两角三轮请求确认心意已退出旧假设，观点保持改善，仍有动机猜测与额外安排。原话见[[手机版/聊天验收/古月娜-${date}|古月娜]]、[[手机版/聊天验收/陆雪琪-${date}|陆雪琪]]；证据与未解决问题见[[手机版/开发日志/${date}|日志]]。未发布。\n`);
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
