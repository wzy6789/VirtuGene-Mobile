import {readFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const names=['GUYUENA-FOCUSED-REACTIONS-R1-2026-10-10.json','LUXUEQI-FOCUSED-REACTIONS-R1-2026-10-10.json'];
const reports=names.map(name=>({name,data:JSON.parse(readFileSync('docs/'+name,'utf8')),usage:JSON.parse(readFileSync('docs/'+name.replace('.json','-USAGE.json'),'utf8')).totals}));
if(reports.some(r=>!r.data.complete||r.usage.calls!==2||r.usage.missingUsage))throw Error('Incomplete paired evidence');
const marker='### 无关情绪字段精简对照：减少 tokens 未改善自然反应，未采用';
const path=root+'/开发日志/2026-10-10.md';
if(readFileSync(path,'utf8').includes(marker))throw Error('Already journalled');
for(const {name,data} of reports){
  let text=`\n\n### focused-reactions：未采用的冻结对照\n\nF:/VirtuGene-Mobile/docs/${name}；不经过落库、不冒充软件送达。只有原请求system中的未被尾卡选中的6类反应字段删掉，历史、事实、当前声音卡与原模型参数保留。两稿各一次，随机对照不能证明因果。\n`;
  for(const row of data.rows)text+=`\n**chatgpt**：${row.input}\n\n**${data.roleName}（${row.arm}）**：${row.raw}\n`;
  appendFileSync(root+'/聊天验收/'+data.roleName+'-2026-10-10.md',text);
}
appendFileSync(path,`\n\n${marker}\n\n前一轮是实际源码/迁移/验证进展。本轮重新读生产：Gu每轮已按话题路由原著资料，Lu关系背景按明确原话认领；两人物声音卡保留当轮反应但base仍有其他反应。没有把缺少“说话风格”当已证明原因，上轮尾卡候选已否定。\n\n本轮测试focused-reactions候选：冻结Gu实际第二轮食物选择、Lu当前production的弹曲小喜悦；只删除原正文中明确命名且尾卡未选中的被夸/分歧/道歉/亲密/疲惫/庆祝字段，不改当前尾卡、原著、关系、时间、用户输入和history，不移除来源真实性契约。现有诊断工具新增有界变体与字段/尾部保留静态检查，不新增生产规则。\n\nGu原稿能给咸味选择但写“甜的东西我尝两口就够”与整块会腻，仍可能把当前喜好写成习惯；候选更长，开头“下次别买它”接管决定，后面自己的选择较具体但又设试吃要求。Lu原稿替他高兴，愿意哪天听；候选短，却凭空写“我记得你练它练了好些日子”。没有用户练习时长或独立记录支持，不能把“弹顺了”当许多天练习的证据，也不能把陪伴感建立在假记忆上。候选不进入生产。本地inspect的完整语义记忆检查仍不封闭，未为这个句子再追加某一动作的正则来冒充解决所有情况。\n\nGu提供方输入2360→2177，Lu3774→3583，减少183/191tokens；字符减少不能证明内容好，模型输出长短与虚构波动仍在。两个单样本随机对照不足以说明删字段一定导致问题，但足以说明本轮没有采用依据。生产人格与提示词保留上一轮状态。\n\n4次DeepSeek Flash付费：Guinput4537/output301/total4838；Lu7357/94/7451；合计input11894/output395/total12289，usage完整、stop。预算每组2请求实际2，max_tokens500含推理，非流式提供方冻结直调，无真实软件送达，无额外评分/第三次重试。原始docs/${names.join('、docs/')}及各-USAGE；release/guyuena-focused-reactions、luxueqi-focused-reactions-2026-10-10.log。静态变体检查通过，原始候选失败完整保留到两角色聊天验收，以chatgpt为输入方。凭据只在授权桥进程内存，不写报告；所有请求与进程已结束。\n\nGu连续仍485展示/84回放/403付费、1324890tokens；Gu冻结新增2请求4838，从18/46379到20请求51217，独立修正仍3/7695。Lu冻结本轮+2请求7451，不增生产送达计数。\n\n下一步应以实际有来源的人物知识/用户事实边界和交流来回检验为主，不能继续把越来越短的回复当自然化成果。人物特色、事实外推、日常松弛与长聊稳定仍未整体达标，目标保持进行中。未打包、未发布、未更新官网，6.0.13保持，电脑版日志不动。\n`);
appendFileSync(root+'/00-总览.md','\n- 10月10日无关情绪字段精简诊断：Gu/Lu各一组冻结，4调用12289tokens；候选仍接管决定/编用户练习往事，未采用。节省约180—190输入tokens不等于人味变好。见[[开发日志/2026-10-10]]及两角色聊天验收。\n');
console.log('Preserved both failed candidate comparisons and measured usage');
