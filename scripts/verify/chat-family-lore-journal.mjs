import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const paths=[
 'docs/LUXUEQI-LIVE-TINY-CURIOSITY-HOLDOUT-R3-2026-10-10.json',
 ...['GUYUENA','LUXUEQI'].flatMap(role=>['R1','R2'].map(rev=>`docs/${role}-LIVE-FAMILY-EVERYDAY-HOLDOUT-${rev}-2026-10-10.json`)),
 'docs/LUXUEQI-LIVE-SIXTH-BOOK-HOLDOUT-R1-2026-10-10.json'
];
const groups=paths.map(path=>({path,...JSON.parse(read(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.usage.missingUsage||g.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop'))))throw Error('Incomplete evidence');
const usage=groups.reduce((sum,g)=>Object.fromEntries(Object.keys(sum).map(key=>[key,sum[key]+g.usage[key]])),{calls:0,input:0,output:0,total:0});
if(usage.calls!==25||usage.total!==87046)throw Error('Unexpected recorded usage');
const routing=JSON.parse(read('release/chat-lu-family-routing-2026-10-10.json','utf8'));
if(routing.modelCalls!==0||routing.rows.length!==5||routing.rows.some(row=>!row.pass))throw Error('Routing evidence missing');
const selected=groups.filter(g=>g.scene==='tiny-curiosity-holdout'||g.scene==='sixth-book-holdout'||g.scene==='family-everyday-holdout'&&((g.roleName==='古月娜'&&g.revision==='r2')||(g.roleName==='陆雪琪'&&g.revision==='r1')));
const evidence='release/chat-family-lore-evaluation-2026-10-10.json';
write(evidence,JSON.stringify({usage,groups:groups.map(g=>({path:g.path,usage:g.usage,rows:g.rows.map(row=>({input:row.input,replies:row.replies}))})),selected:selected.map(g=>g.path),qualityComplete:false,model:'deepseek-flash',limits:['Family examples still contain invented motives or personal possessions.','Only bounded private-send tests; summaries/extraction/settlement mocked.','Novel source verified from indexed excerpt; full page access unavailable.','Neither local checks nor successful transport prove human-level chat.']},null,2)+'\n');
const heading='## 家庭背景压缩、长答意图与第六本天书资料（发布前开发）';
const journal=root+'/开发日志/2026-10-10.md';
if(!read(journal,'utf8').includes(heading))append(journal,`\n${heading}\n- 优化阶段以6.0.13开发，用户随后明确要求发布，当前成果已纳入6.0.14/build56。只读投影压缩陆雪琪重复家庭说明；正文与声音卡共用投影，原数据库人设与用户编辑不改。家庭关系每轮可用，不根据关键词决定她有没有丈夫孩子；保留母亲的教育主张、温柔与具体事件来源边界。相同小葱首轮system由5283字符/25处孩子词降为4902字符/7处，数字仅说明重复减少，不证明人味因果。\n- 家庭“整理屋子”误触长篇输出，改为当前发言者实际任务与长度要求，处理引用、第三方、否定、后续短答改口。旧实现首批72条有31条失败，修后122条完整消息+4条编译提示通过；发布进一步发现“详细写一段说明”流式落库回归，已补8条，最终130+4检查及172流式检查通过。规则仍有界，不声称覆盖任意省略或混合转述。\n- 假设指导鼓励以设想中的例子表达选择，保持已有事实与未建立具体物件范围。本次真实结果仍未完全遵循：Lu家庭R1自述旧衣/剑匣库存，R2新增早年竹叶收藏与师父字；Gu两版首轮误听收纳并追问用户动机，R1连续责备更明显。保留全部原稿，未逐句拼接、删除坏句冒充好版。整组相对精选Gu家庭R2、Lu家庭R1，均不宣称达标。Lu小葱R3比R1/R2少了家庭物件及用户想到孩子的猜测，但关系点评与格言仍偏重。\n- 新增lu-xue-qi-lore.ts：小说第二十三章神剑的无名蓝封面风月图册与小灰交换典故；读者“第六卷天书”昵称不冒充小说正式卷名或《天香录》正式书名；《诛仙2》游戏另有第六本天书剧情。按当前主题/近两条用户原话跟进，换题或明确暂停退出资料；知识不证明角色亲眼见过或持有。红袖发布方索引摘录可查但完整页面未能访问：https://www.hongxiu.com/chapter/22108833000562102/94956723278380969；粉丝昵称仅以视频标题索引为据：https://www.bilibili.com/video/BV1Pr421E7rs/；游戏独立官方资料：https://zhuxian.wanmei.com/news/gamenews/20120502/65182.shtml。不把其他AI百科/同人当原著。\n- 典故真实三轮能说明是读者戏称而非功法，伴侣玩笑能接，退出后不继续亲近；最后“这种称呼”略像规则表演，仍记录限制。没有额外付费评审。\n- Lu123接入检查、聊天表达2829、类型通过；release/chat-lu-family-preset-2026-10-10.log、chat-lu-family-expression-2026-10-10.log、chat-lu-family-types-2026-10-10.log。新增资料话题退出测试初版漏“不过换个话题”，修连接词后通过。5个真实私聊/隔离IndexedDB路由检查用合成替身，0网络模型，验证正文、声音卡、原人设不改与落库，release/chat-lu-family-routing-2026-10-10.json；不能据此判断新模型自然表现。\n- 六组真实模型25调用/input ${usage.input}/output ${usage.output}/total ${usage.total}（含推理），全部首稿stop，无实际重试或empty；每调用500输出上限，家庭场景最多6调用。典故场景实际3次，脚本默认最多12，未假称限额4。摘要、提取、结算替身；私聊生产思考设置、上游非流式，非Android真机。每组实际用量、全原稿与请求保留${paths.join('、')}，汇总${evidence}。不因PowerShell警告exit1重新支付已完成的任务。\n- 仍开放：古月娜动机审视、陆雪琪具体生活经历虚构、声音卡缺普通观点参考、长聊与自由话题个性稳定。陌生人退出冷淡在这两组成立，不能外推所有混合身份语义。全面近真人目标未完成。\n`);
const direction=root+'/优化方向/2026-10-10.md';
const directionHeading='## 家庭日常与观点交流';
if(!read(direction,'utf8').includes(directionHeading))append(direction,`\n${directionHeading}\n- 家庭背景精简重复，亲情与伴侣关系保持稳定。\n- 主见通过具体取舍体现，少盘问动机、少人生格言。\n- 生动用此刻的好恶，不编旧物库存或共同经历。\n- 普通观点交流补适用声音参考，用新话题验证。\n- 典故分清原著、读者昵称与游戏；已发布6.0.14，后续开发不自动发布。\n`);
for(const group of selected){
 const file=root+`/聊天验收/${group.roleName}-2026-10-10.md`;
 const label=group.scene==='tiny-curiosity-holdout'?'盆栽命名与不同看法':group.scene==='sixth-book-holdout'?'第六本天书典故、玩笑与退出身份':'家庭旧物、教育观点、心意与退出身份';
 const title=`## ${group.scene} / ${group.revision}（${label}）`;
 let current=read(file,'utf8');
 const section='\n'+title+'\n\n'+group.rows.map(row=>`**chatgpt**：${row.input}\n\n`+row.replies.map(reply=>`**${group.roleName}**：${reply}`).join('\n\n')).join('\n\n')+'\n';
 const prefix='## '+group.scene+' /';
 const start=current.indexOf(prefix);
 if(start<0)current+=section;
 else{const end=current.indexOf('\n## ',start+prefix.length);current=current.slice(0,start)+section.trimStart()+ (end<0?'':current.slice(end));}
 write(file,current);
 if((current.match(new RegExp('## '+group.scene+' /','gu'))??[]).length!==1)throw Error('Duplicate selected scenario');
 const block=current.slice(current.indexOf(title)).split('\n## ')[0];
 if(block.includes('**用户')||!block.includes('**chatgpt**'))throw Error('Wrong dialogue labels');
}
const index=root+'/00-总览.md',marker='家庭与典故验证（2026-10-10）';
if(!read(index,'utf8').includes(marker))append(index,`\n- ${marker}：25实际调用/${usage.total}token；整组原话与简短方向分存，[[手机版/开发日志/2026-10-10|失败、来源限制与证据]]。已随6.0.14发布，近真人目标尚未完成。\n`);
console.log(JSON.stringify({usage,evidence,selected:selected.map(g=>g.path),qualityComplete:false}));
