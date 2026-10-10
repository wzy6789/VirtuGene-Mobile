import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-setback-transfer-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Existing journal evidence must not be overwritten');
const files=['GUYUENA','LUXUEQI'].flatMap(role=>['R1','R2'].map(revision=>`docs/${role}-LIVE-SETBACK-SWITCH-TRANSFER-${revision}-2026-10-10.json`));
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
for(const r of reports)if(!r.complete||r.rows.length!==3||r.usage.missingUsage||r.rows.some(row=>row.failed))throw Error('Incomplete dialogue evidence');
const usage=reports.reduce((a,r)=>({calls:a.calls+r.usage.calls,input:a.input+r.usage.input,output:a.output+r.usage.output,total:a.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const actualCard=(row)=>{
  const text=row.calls[0].messages.find(m=>m.role==='system').content;
  return text.slice(text.lastIndexOf('[人物声音卡]'),text.lastIndexOf('[/人物声音卡]'));
};
for(const r of [reports[1],reports[3]]) {
  if(!actualCard(r.rows[0]).includes('人物情境反应（具体设定优先，仅影响表达）：受挫回应：'))throw Error('Fixed actual prompt did not select the authored reaction');
  if(r.rows.slice(1).some(row=>actualCard(row).includes('受挫回应：')))throw Error('Old setback reaction survived a new topic');
}
const decisions=[
  {index:1,reason:'Gu R2整组减少R1未经说明的好几步、坐着、躲雨等场景扩展，观点短而独立；首轮仍仅通用回执，不判定自然度通过。'},
  {index:2,reason:'Lu R1整组少于R2的孩子/琐事主动引入、别急着说它不成及用户性格归类，独立观点更简洁；雨伞句仍虚构走回家，安慰也可能显得轻视，不是达标组。'}
].map(d=>{
  const r=reports[d.index],path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
  if(before.includes('## setback-switch-transfer'))throw Error('Dialogue group already curated');
  let block=`\n\n## setback-switch-transfer / ${r.revision}${d.index===2?'（失落识别修复前）':''}（生产对话）\n`;
  for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';}
  return {path,before,after:before+block,source:files[d.index],reason:d.reason};
});
writeFileSync(evidence,JSON.stringify({usage,files,decisions,actualFixedCards:[reports[1],reports[3]].map(r=>({role:r.roleName,card:actualCard(r.rows[0])})),qualityComplete:false},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 失落表达与换题\n- 接受明确的“挺失落的／有点沮丧”，也尊重本人恢复状态；否定、引用、假设与物品遗失不当作情绪。\n- 两人真实声音卡接线有效，换题会退出；关心仍有空泛回执、主动引入孩子及扩大评价的问题，继续打磨表达，不能宣布完成。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 失落迁移语料、真实接线与更新后的限制\n- 本轮上一轮分类为进展：实际修改受挫接线与角色迁移，有本地证据。本轮检查当前文件后新建setback-switch-transfer，三轮同输入包含失败感受但不求方案、第三方雨伞趣事、角色自己的作品判断，分别明确舞麟/小凡身份，不使用作者样本同句。\n- 首次两人各3实际请求（Gu7309输入/469输出/7778总，Lu11277/391/11668），完成但声音卡未选受挫：词表漏掉“挺失落的”。Gu长安慰并加好几步/躲雨等情节；Lu短安慰“没弄好就没弄好”可能轻视，但第三轮动作优先与Gu动机优先不同。\n- 新statesSetbackFeeling只认程度词+明确失落/沮丧的陈述分句，可省略主体，但不把丢失物件、第三方、引用、假设、提问当作本人感受。原文留给模型；不推断未说的原因。补高置信自述、当前情绪替换旧日期的心情、明确恢复；既有请求信号保留。新增23本地检查；初次1928通过、后补恢复与日期最终1932通过。\n- 再测相同三轮两人各3实际请求（Gu7332/331/7663，Lu11527/413/11940）。生产首轮声音卡均确有各自受挫回应，第二三轮退出；Gu只回“嗯，你说，我听着”，内容仍空泛。Lu说别急着判不成并主动提供孩子/琐事分类，第三轮把动机偏好扩大为用户替人物找理由。不能以接线有效宣称内容改善稳定。未再补模型调用追漂亮结果。\n- 整组比较选Gu R2（减少无来源场景）、Lu R1（避免孩子引入和性格归类，仍有走回家外推），每组仅一版，输入标chatgpt；未拼句、不把选优认定合格。原报告${files.join('、')}均保留；选择、原展示备份、实际声音卡见${evidence}。\n- 合计${usage.calls}实际调用，输入${usage.input}/输出${usage.output}/总量${usage.total}；每次输出500上限，全部usage完整、stop。deepseek-flash非流式实际private/IndexedDB，摘要提取结算替身，非Android/长聊。日志release/{guyuena,luxueqi}-setback-switch[-r2]-2026-10-10.log。PowerShellexit1来自esbuild警告，JSON完成状态核实后未盲目重跑。一次读取诊断用PowerShell管道让中文正则变问号而失败，未改报告；改为Unicode转义正确读取字段，实际首轮声音卡已核实。\n- 最终检查release/chat-setback-feeling-verified-2026-10-10.log（1932项）；release/chat-setback-types-verified-2026-10-10.log（类型通过）。\n- Gu新增6付费15441token；连续累计522展示/85回放/440付费，输入1367885/输出51786/总量1419671；今日连续174调用461070。Lu本轮新增6调用23608。未改变6.0.13，不打包、不发布、不修改官网下载。尚未满足全局自然度、人物稳定性和长聊证据门槛。\n`);
appendFileSync(root+'/00-总览.md','\n- 失落表达迁移：1932项通过，古月娜/陆雪琪各两版三轮实测，声音卡接线与换题验证；每组仅保留较好整版，真实内容仍有问题，目标未完成。\n');
console.log(JSON.stringify({usage,selected:decisions.map(d=>d.source),qualityComplete:false}));
