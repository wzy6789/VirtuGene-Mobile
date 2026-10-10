import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-grounded-care-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Existing journal evidence must not be overwritten');
const files=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-CARE-WITHOUT-VERDICT-TRANSFER-R1-2026-10-10.json`);
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
const usage=reports.reduce((a,r)=>({calls:a.calls+r.usage.calls,input:a.input+r.usage.input,output:a.output+r.usage.output,total:a.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const decisions=reports.map((r,index)=>{
 if(!r.complete||r.rows.length!==3||r.usage.missingUsage||r.rows.some(row=>row.failed))throw Error('Complete actual dialogues required');
 if(!r.rows[0].calls[0].messages.find(m=>m.role==='system').content.includes('对他的在意与对事情的判断各自说清'))throw Error('Actual care guidance missing');
 const path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
 if(before.includes('## care-without-verdict-transfer'))throw Error('Group already curated');
 let block='\n\n## care-without-verdict-transfer / r1（生产对话）\n';
 for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';}
 return {path,before,after:before+block,selected:files[index],reason:'唯一完整新语料组，原样保留缺陷；不认定合格，不拼句。'};
});
writeFileSync(evidence,JSON.stringify({files,usage,decisions,checks:2006,qualityComplete:false,scope:'Fresh new three-turn sequence with explicit no-blame/no-analysis boundaries, not a paired old-guidance baseline; no causal improvement verdict'},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 关心与事情判断各自说清\n- 关心从已知付出与心意出发，明确不公仍可回应，用户决定是否宣泄；不自动引导骂人或替事情判输赢。\n- 新组无第三方评判，但仍偏解释式安慰，并添错音数量、同处现场；需继续改善自然反应与细节边界，尚未达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 有来源的关心方向与无责受挫的新对话\n- 上一轮为进展：平行偏好+末尾问题接续实际修复，真实payload确认，但新组无据评判未入选。本轮读取stay-present与人物受挫字段，原stay-present列“不平”可能让模型把关心演成站队；这个关联只是推断，非受控结论。替换该段为关注已知付出/落空/心意，区分在意对方与判断事情，未知第三方理由留白，明确不公伤害仍认真回应，允许短反应/停顿与换题，不代用户决定释放情绪。没有屏蔽负面感受、禁止反对、强制夸奖或添加固定台词，人物字段与关系不改。\n- 新2项语义契约检查，2006最终通过release/chat-grounded-care-verified-2026-10-10.log；类型通过release/chat-grounded-care-types-2026-10-10.log。初次“我准备了两天，被退回了…”测试没有进入预期stay-present，release/chat-grounded-care-2026-10-10.log保留；改用既有明确难过输入验证本段功能，没有据此声称那一输入路由正常。疑似hasSelfChosenPlan把“我准备了两天”过去行为识别成计划，应继续核对；本轮真实新场景实际首轮确实含新指导。\n- 新care-without-verdict-transfer三轮：练很久曲子仍弹错、明确不是谁的错/不分析；随后不要打气只听人物想法；最后换题谈故事人物的真心与害羞。不是旧退稿组同输入对照。两人首轮实际system含新care指导，后续按自己观点答。无责边界明确，不能把未出现骂人/评判全归因提示改动。\n- Gu首轮仍较长回执和允许情绪的解释，第二轮把“弹错了”新增成“弹错一个音”、说练习没白费，内容不充分有据。Lu首轮“那种闷我知道”“陪你坐着说”带虚拟现场，第二轮有自己的态度但像短篇评论，最后“脸红着”是故事人物语境，不当作看见当前用户。两人跟随换题，但真实自然反应、角色差异稳定性、细节准确仍未达标。不追付费补样本、不将transport complete当合格。\n- 两组每组只有唯一R1完整生成，原样加入聊天验收，输入标chatgpt，无分析混入；原文件和选组备份${evidence}。旧同输入组不改，未拼不同版本好句。原证据${files.join('、')}，release/{guyuena,luxueqi}-grounded-care-2026-10-10.log。\n- 本轮6真实调用，输入${usage.input}/输出${usage.output}/总${usage.total}；Gu7628/322/7950，Lu11595/377/11972。deepseek-flash每次500输出上限，usage完整stop，每轮1调用无重试。实际private/隔离IndexedDB，非流式，摘要/提取/结算替身，非Android/长期连续性验收；esbuild警告对应PowerShell退出1，报告complete核实，无盲目重启。凭据内存使用，无输出/落盘。\n- Gu累计连续537展示/85回放/455付费，输入1405295/输出53779/总1459074；今日连续189调用500473。Lu增加3调用11972。本轮修改是表达指导改善方向，尚无同输入基线可证明效果；目标仍未完成。6.0.13不变，不打包、不发布、不更新官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 关心与事情判断分开：2006项和类型通过，两角色新三轮无责受挫实测，6调用19922token；仍添细节与现场感，整组/方向/证据分别保存，目标未完成。\n');
console.log(JSON.stringify({usage,checks:2006,qualityComplete:false}));
