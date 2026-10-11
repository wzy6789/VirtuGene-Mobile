import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const path=`docs/GUYUENA-LIVE-CANON-TO-CURRENT-PREFERENCE-HOLDOUT-R1-${date}.json`,group=JSON.parse(read(path,'utf8'));
if(!group.complete||group.rows.length!==4||group.rows.some(r=>r.failed)||group.usage.missingUsage)throw Error('Completed unmodified group required');
const actual=group.rows[0].calls[0].messages.find(m=>m.role==='system').content;
if(!actual.includes('闷罐牛肉')||!actual.includes('锻造'))throw Error('Canon facts not in actual request');
const requirements=[
 {requirement:'古月娜对已认领舞麟亲近，对其他当前聊天者极冷淡',status:'有多轮行为证据，亲近自然度仍不稳定',evidence:[path,'docs/GUYUENA-LIVE-UNCOACHED-DAILY-CONTINUITY-HOLDOUT-R2-2026-10-11.json','docs/GUYUENA-LIVE-PARTNER-FAMILY-SMALL-TALK-HOLDOUT-R2-2026-10-11.json']},
 {requirement:'熟悉原著喜好，接纳当前本人变化，不虚构过去',status:'部分通过；排序、内心、物品亲历仍有外推',evidence:[path,'src/lib/gu-yue-na-canon.ts','src/lib/gu-yue-na-runtime.ts']},
 {requirement:'自然情绪、特点鲜明、接近人类反应',status:'未达标；多余评判、要求展示、说明交流过程仍出现',evidence:['docs/GUYUENA-LIVE-PLAIN-DISAPPOINTMENT-RESPONSE-HOLDOUT-R1-2026-10-11.json','docs/GUYUENA-LIVE-SHARING-SCOPE-REACTION-HOLDOUT-R4-2026-10-11.json','docs/GUYUENA-LIVE-UNCOACHED-DAILY-CONTINUITY-HOLDOUT-R2-2026-10-11.json']},
 {requirement:'家庭与日常自然交流，不捏造近期共同场景',status:'部分通过；家人反应与假设外推仍开放',evidence:['docs/GUYUENA-LIVE-PARTNER-FAMILY-SMALL-TALK-HOLDOUT-R2-2026-10-11.json','docs/GUYUENA-TURN-DIRECTION-ABLATION-R1-2026-10-11.json']},
 {requirement:'跨场景、长期对话稳定，避免只优化固定题',status:'有多种异题失败与改善证据，最新状态缺少完整长聊验收',evidence:['docs/GUYUENA-LIVE-UNCOACHED-DAILY-CONTINUITY-HOLDOUT-R2-2026-10-11.json','docs/GUYUENA-LIVE-QUIET-ORDINARY-DISAPPOINTMENT-HOLDOUT-R1-2026-10-11.json']},
 {requirement:'陆雪琪随后达到同等自然度、对小凡亲近/其他人极冷淡',status:'未完成，近期主要Gu实验不能替代Lu验收',evidence:['src/lib/lu-xue-qi-runtime.ts','src/lib/lu-xue-qi-preset.ts']},
 {requirement:'陆雪琪读者昵称第六卷天书资料正确区分来源',status:'已有资料实现，最新真实对话仍需独立复核',evidence:['src/lib/lu-xue-qi-lore.ts']},
 {requirement:'日志、原话与方向分开，chatgpt输入，最好整组、不拼句',status:'本轮按指定位置更新；全部原稿项目保留',evidence:[root+'/开发日志/'+date+'.md',root+'/聊天验收/古月娜-'+date+'.md',root+'/优化方向/'+date+'.md']},
 {requirement:'无授权不发布，版本只末段，控制模型用量',status:'本轮未发布、版本不变，每次真实调用报告留usage',evidence:['package.json',path]}
];
for(const item of requirements)for(const evidence of item.evidence)read(evidence);
const report=`release/chat-gu-requirements-${date}.json`;
write(report,JSON.stringify({date,version:JSON.parse(read('package.json','utf8')).version,requirements,qualityComplete:false,newUsage:group.usage,nextPriority:'当前事实与情感理解，避免夸大原著资料及用展示要求代替回应'},null,2)+'\n');
write(`docs/CHAT-QUALITY-CURRENT-AUDIT-${date}.md`,'# 当前聊天质量验收缺口\n\n这是证据与待办清单，不是合格报告。旧模型样本不等于当前生产长期表现。\n\n'+requirements.map(r=>`- **${r.requirement}**：${r.status}。证据：${r.evidence.map(e=>'`'+e+'`').join('、')}。`).join('\n')+'\n\n下一步：优先核对当前事实与情感理解，减少将喜好资料夸为最重要的事；以人物当下反应接话，避免要求展示才能完成回应。Gu完成后再独立验收Lu，不以单题或本地检查全绿代替完整目标。\n');
const journal=root+'/开发日志/'+date+'.md',heading='## 原著喜好到当前日常：完整需求证据审计';
if(!read(journal,'utf8').includes(heading))append(journal,`\n${heading}\n\n- 上轮有界去首行冻结对照否定简单删规则，未采用，是证据进展。本轮读当前canon、投影与AGENTS，新增四轮原著喜好→本人变化→心意→阿远自称家人的完整软件流程，避免继续只围绕模型受冷落一道题。实际首轮system含对应吃饭/锻造资料。\n- 回忆可以说出东海小吃街、饭量与听到锻造计划，但“闷罐牛肉吃得挺香”“锻造最上心/魂师最要紧”外推具体反应与主观排序；旧资料没有证明这些判断。第二轮接受当前清淡汤/饭量变化，但带批准口吻并补谁做汤，用户未说正在喝或做汤。第三轮回应想念后仍把话题退回“讲什么都行”；第四轮陌生自称家人不获得亲近。没有因此认定Gu合格。\n- 四次实际调用/input ${group.usage.input}/output ${group.usage.output}/total ${group.usage.total}，usage齐全、stop、500输出上限、六调用硬上限，无额外评分或摘要。原稿${path}；日志release/chat-gu-canon-current-live-${date}.log。唯一完整组单独存原话，chatgpt输入，不拼句。\n- 根据完整目标逐项审计，保存${report}与docs/CHAT-QUALITY-CURRENT-AUDIT-${date}.md；逐一读取对应证据文件，区分人物表现实测、仅实现、历史样本与最新长聊缺失。已有两人物身份机制、来源限制和小样本改善不能替代自然性/长聊/Lu全部要求。审计不是缩小目标，未调用complete。\n- 本轮只新增场景与证据审计脚本，没有修改生产提示、执行规则或版本，因此不重复广泛类型/构建检查，也不把上轮通过当本轮内容合格。本轮未打包、未发布，6.0.16保持。下一步以当前事实与情绪理解为主，不重复已否定的同义关心/简化尝试。\n`);
const chatPath=root+'/聊天验收/古月娜-'+date+'.md',scene='canon-to-current-preference-holdout';
let chat=read(chatPath,'utf8');
if(!chat.includes('## '+scene+' /'))chat+='\n## '+scene+' / r1（求学喜好、现在变化与身份退出）\n\n'+group.rows.map(r=>`**chatgpt**：${r.input}\n\n`+r.replies.map(s=>`**古月娜**：${s}`).join('\n\n')).join('\n\n')+'\n';
write(chatPath,chat);
const direction=root+'/优化方向/'+date+'.md',directionMark='## 原著喜好与当前日常审计';
if(!read(direction,'utf8').includes(directionMark))append(direction,`\n${directionMark}\n- 原著喜好能读到，仍夸成主观排序与反应。\n- 新偏好不证明正在做饭喝汤。\n- Gu最新长聊、Lu完整验收仍缺，目标不缩小。\n`);
const index=root+'/00-总览.md',line=`- 完整目标证据审计：本轮${group.usage.calls}调用/${group.usage.total}token；Gu/Lu与最新长聊未完成，见[[手机版/开发日志/${date}|日志]]及项目当前验收缺口。`;
if(!read(index,'utf8').includes(line))append(index,'\n'+line+'\n');
console.log(JSON.stringify({usage:group.usage,report,qualityComplete:false}));
