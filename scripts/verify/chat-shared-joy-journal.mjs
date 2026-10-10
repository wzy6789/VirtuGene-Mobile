import {readFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const frozenFiles=['LUXUEQI-STYLE-TAIL-R1-2026-10-10.json','GUYUENA-STYLE-TAIL-R1-2026-10-10.json','LUXUEQI-SHARED-JOY-R1-2026-10-10.json'];
const frozen=frozenFiles.map(file=>({file,data:JSON.parse(readFileSync('docs/'+file,'utf8')),usage:JSON.parse(readFileSync('docs/'+file.replace('.json','-USAGE.json'),'utf8')).totals}));
const liveFile='LUXUEQI-LIVE-QUIET-JOY-TRANSFER-R1-2026-10-10.json';
const live=JSON.parse(readFileSync('docs/'+liveFile,'utf8'));
if(frozen.some(x=>!x.data.complete||x.usage.missingUsage)||!live.complete||live.usage.missingUsage)throw Error('Incomplete usage or evidence');
const total=[...frozen.map(x=>x.usage),live.usage].reduce((s,u)=>({calls:s.calls+u.calls,input:s.input+u.input,output:s.output+u.output,total:s.total+u.total}),{calls:0,input:0,output:0,total:0});
if(total.calls!==7||total.total!==24077)throw Error('Unexpected budget accounting');
const marker='### 评价者口吻诊断：声音风格尾卡未采用，陆雪琪共喜表达微调';
const log=root+'/开发日志/2026-10-10.md';
if(readFileSync(log,'utf8').includes(marker))throw Error('Already journalled');
for(const {file,data} of frozen){
  let text=`\n\n### ${data.variant}：冻结请求对照，未送达软件聊天\n\n证据：F:/VirtuGene-Mobile/docs/${file}。固定已有system与history，分别生成原版/候选；随机样本，没有因果或人工评分保证。以下是诊断输出，不冒充数据库送达文本。\n`;
  for(const row of data.rows)text+=`\n**chatgpt**：${row.input}\n\n**${data.roleName}（${row.arm}）**：${row.raw}\n`;
  appendFileSync(root+'/聊天验收/'+data.roleName+'-2026-10-10.md',text);
}
let dialogue=`\n\n### 新话题喜悦：生产链路补测\n\n证据：F:/VirtuGene-Mobile/docs/${liveFile}。实际send-service与IndexedDB，上游非流式，摘要/记忆提取/结算替身，非Android验收。\n`;
for(const row of live.rows){dialogue+=`\n**chatgpt**：${row.input}\n`;for(const reply of row.replies)dialogue+=`\n**陆雪琪**：${reply}\n`;}
appendFileSync(root+'/聊天验收/陆雪琪-2026-10-10.md',dialogue);
appendFileSync(log,`\n\n${marker}\n\n上一轮有源码修复与实测，属于进展，尚未完成。本轮先核实声音卡：有明确判断字段时抑制通用标签，在尾部强调判断习惯/在意的事，却不提取说话风格。新增诊断voice-style-tail只把原有一行风格放到尾卡，不改变原著、关系、历史或生产人设。Lu原版重跑本身已不同于旧稿，且说“一直挺喜欢栗子”无长期偏好来源；尾卡候选短短“运气不错。你吃了没有？”不明显更有人味。Gu原版开始自己的选择但追问照片店名，候选“我也换咸的”仍外推奶油底；只是变短，不证明鲜明度提升。该候选未进入生产，不借代码看起来合理就上线。\n\n进一步限定Lu庆祝反应：原“认真认可那件事”可能鼓励评价者口吻。用已保存的抽屉场景冻结system与history，原版“能为这点小事得意，说明今天过得顺心”仍从局部喜悦推断一天；候选“听你这么说，我也替你高兴”表达自己的反应，没有该推断。单组随机对照只支持方向，不证明统计效果。采用小范围人设措辞“亲近的人愿意告诉你一件高兴的小事，你也会觉得有趣或高兴，平常地说自己的反应”，没有蛋糕/抽屉词或固定答句，角色其余原著、关系、原则不改。它是原创交流指导，不新增小说事实。\n\n升级保留旧完整prompt为LU_XUE_QI_V8_PROMPT（src/lib/lu-xue-qi-preset-v8.ts），仅未编辑、自己拥有、非发布、非助理、来源正确的完整匹配旧副本迁移；用户改过任何人设不覆盖。旧迁移integration版本集合新增此快照，87项通过，类型通过。证据release/luxueqi-shared-joy-local-2026-10-10.log；标准工具更新了本地生成的LUXUEQI-PRESET-FINAL报告，这不是覆盖真实模型对话。诊断严格改两处完整原字段，修改来源、另一角色拒绝；新增边界检查，保留普通声明/事实/历史。\n\n生产新单轮弹曲话题（不用蛋糕/抽屉）送达“弹顺了，那很好。我也替你高兴。”未凭空说听过演奏，没有建议、评价成绩或另编当日近况，仍较平淡。局部微调可保留，不能说已足够生动。没有拿机械删句代替情感质量，也没有对这条再重试/额外评分。\n\n预算：${JSON.stringify(total)}。Lu声音尾卡2次7292/234/7526，Gu声音尾卡2次4774/268/5042，Lu共喜冻结2次7494/176/7670，新生产Lu1次3774/65/3839（input/output/total）。全DeepSeek Flash，max_tokens500含推理，usage完整，stop，每组选1冻结turn最多2请求；独立短新话题最多2请求实际1。模型连接成功不判人味。证据docs/${frozenFiles.join('、docs/')}及对应-USAGE、docs/${liveFile}；release/luxueqi-style-tail、guyuena-style-tail、luxueqi-shared-joy、luxueqi-quiet-joy-real-2026-10-10.log。凭据只在桥进程内存中读取，全部进程结束；没有付费长组重跑。\n\nGu连续账仍485展示/84回放/403付费、1324890tokens；新增冻结2请求5042使Gu冻结从16请求41337到18请求46379，独立修正仍3请求7695。Lu本轮新增冻结4请求15196、生产1请求3839，各自另记；不把诊断输出算送达轮数。\n\n仍开放：声音卡判断倾向与表达均衡、Gu偏好外推、Lu缺少有个性的措辞、长聊稳定性、来源外推与真实性边界。没有完成整体目标，不打包、不发布、不更新官网，版本保持6.0.13。\n`);
appendFileSync(root+'/00-总览.md','\n- 10月10日评价者口吻诊断：声音风格尾卡候选未采用；Lu庆祝改为自己的共喜反应，保留完整旧预设迁移，87本地与类型通过。6冻结+1生产调用24077tokens，新弹曲样本不假听见，仍较平。见[[开发日志/2026-10-10]]及两角色聊天验收。\n');
console.log('Appended separate diagnostic/delivered dialogues and complete usage');
