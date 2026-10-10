import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';

const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-distress-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Journal evidence already exists; do not duplicate entries');
const files=['docs/GUYUENA-LIVE-DAILY-DIALOGUE-TRANSFER-R1-2026-10-10.json','docs/LUXUEQI-LIVE-DAILY-DIALOGUE-TRANSFER-R1-2026-10-10.json'];
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
const decisions=reports.map((r,index)=>{
  if(!r.complete||r.rows.length!==6||r.usage.missingUsage)throw Error('Incomplete evidence');
  const path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`;
  const before=readFileSync(path,'utf8');
  const heading='## daily-dialogue-transfer / r1（受挫回应接线前，生产对话）';
  if(before.includes('## daily-dialogue-transfer'))throw Error('Scene already curated');
  let block=`\n\n${heading}\n`;
  for(const row of r.rows){
    block+='\n**chatgpt**：'+row.input+'\n';
    for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';
  }
  return {path,before,after:before+block,source:files[index],reason:'唯一完整新生成组，整组保存接线前结果；不拼句、不当作修改后验收。'};
});
const usage=reports.reduce((a,r)=>({calls:a.calls+r.usage.calls,input:a.input+r.usage.input,output:a.output+r.usage.output,total:a.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
writeFileSync(evidence,JSON.stringify({usage,decisions,scope:'Six-turn fresh dialogues before distress wiring; local routing/migration after fix, no fresh post-fix generation',qualityComplete:false},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 古月娜与陆雪琪：受挫时的自己的反应\n- 两人共同纳入持续优化，受挫与疲惫分开，优先使用各自写明的关心方式。\n- 接线前六轮实测能换题和结束，但仍有泛化点评、重复问缘由；本轮只验证机制修复，未再付费生成，不能宣称人味达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 古月娜、陆雪琪连续日常实测与受挫回应接线\n- 两人使用相同六轮新语料，首轮明确舞麟/小凡身份，包含饮料错名、受挫但不求办法、换题、独立观点及结束。deepseek-flash真实私聊发送与隔离IndexedDB；摘要/提取/结算替身，非Android。两组完成均无缺失usage，各6调用，未重试；不将传输成功认定内容合格。\n- Gu14600输入/608输出/15208总量；Lu22748/628/23376；合计12调用输入${usage.input}/输出${usage.output}/总量${usage.total}。500输出上限，序列最多8调用；修复后本轮追加模型0，凭据未输出或落盘。原报告${files.join('、')}；release/{guyuena,luxueqi}-daily-dialogue-2026-10-10.log。\n- Gu受挫时仍“我听着”，Lu用户已经说明事情没做成后仍问烦恼是不是这件事；Lu还把不改饮料名扩大为“不在乎这些”，结束出现无来源的路上嘱咐。两人故事观点不同、能够跟随换题，但不能据此判整体自然。完整R1各作为唯一新组保留，标注接线前，不拼后续修正句。原文件备份与整组选择见${evidence}。\n- 确认interactionMoment漏接高置信distress，只有tired/celebration；新增distress与受挫回应作者字段，六种通用风格补对应指导。Gu/Lu各独立作者段，不写固定答案，不改变身份或事实许可，未知经历仍留白；否定/引用/假设/换题不继承。修改接入现有声音卡与情绪指导，不新增模型请求。此缺口是可证接线问题，不能断言它是所有坏回复的唯一原因。\n- Lu修改前完整提示词冻结v9，knownPrompts只迁移精确匹配的自有旧文；编辑/发布版本保留，voice哈希自然失效。Gu沿用自有标记块更新。\n- 表达1909项通过：release/chat-distress-expression-2026-10-10.log；Lu93项数据库迁移/声音卡集成通过：release/luxueqi-distress-preset-verified-2026-10-10.log；Gu185项通过：release/guyuena-distress-care-2026-10-10.log；类型无错误：release/chat-distress-types-2026-10-10.log。初次Lu集成对Gu直接用未初始化种子文本失败，失败日志release/luxueqi-distress-preset-2026-10-10.log保留；改为读取initSeedCharacters后的真实数据库角色再验证，生产接线未用假字段补测试。\n- Gu累计连续516展示/85回放/434付费，输入1353244/输出50986/总量1404230；今日连续168调用445629。Lu本轮增加6调用23376。测试无付费。\n- 尚未验证修改后的真实生成、长聊稳定性及广泛自然度；仍有通用点评、出处外推与语义级事实边界。6.0.13未改，不打包、不发布、不更新官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 古月娜与陆雪琪共同优化：新增受挫回应接线，1909表达/93陆雪琪集成/185古月娜检查通过；两组真实六轮对话与实际用量已分开记录，修改后真实生成尚未验证。\n');
console.log(JSON.stringify({usage,roles:reports.map(r=>r.roleName),qualityComplete:false}));
