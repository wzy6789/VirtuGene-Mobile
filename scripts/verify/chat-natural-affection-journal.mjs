import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-natural-affection-journal-2026-10-10.json';
if(existsSync(evidence))throw Error('Already recorded');
if(!readFileSync('release/expression-natural-affection-2026-10-10.log','utf16le').includes('PASS chat-expression: 1829 checks'))throw Error('Incomplete local verification');
const files=['GUYUENA-LIVE-NATURAL-MISSING-TRANSFER-R1-2026-10-10.json','LUXUEQI-LIVE-NATURAL-MISSING-TRANSFER-R1-2026-10-10.json'];
const originals=[];
const usage={calls:0,input:0,output:0,total:0};
for(const file of files){
  const data=JSON.parse(readFileSync('docs/'+file,'utf8'));
  if(!data.complete||data.rows.length!==2||data.usage.calls!==2||data.usage.missingUsage)throw Error('Unexpected actual dialogue');
  const prompt=data.rows[0].calls[0].messages.find(m=>m.role==='system')?.content??'';
  if(!prompt.includes('用户直接表达了喜欢')||!prompt.includes('亲密反应：'))throw Error('Actual request missed the authored affectionate routing');
  for(const key of Object.keys(usage))usage[key]+=data.usage[key];
  const path=`${root}/聊天验收/${data.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
  const marker='## natural-missing-transfer / r1（生产对话）';
  if(before.includes(marker))throw Error('Duplicate group');
  originals.push({path,before,file,actualAffectionRouting:true});
  let block='\n\n'+marker+'\n';
  for(const row of data.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+data.roleName+'**：'+reply+'\n';}
  appendFileSync(path,block);
}
writeFileSync(evidence,JSON.stringify({usage,originals,scope:'One complete two-turn variant per role; no stitching. First Gu input has an authored near-exact voice sample, so this verifies production routing and a follow-up, not independent broad style generalization.'},null,2));
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 日常想念表达\n- 时间、主语与程度词换顺序仍能接住想念，保持否定、引用、任务和对象边界；自然进入人物亲密回应。\n- 新两轮Gu直接且较活泼，Lu简短含蓄；Gu仍泛说藏话累，Lu仍偏回执。首轮近似已有样本，不能算广泛自然度达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 日常想念的语序识别\n- chat-expression-boundary将直接心意按可选主语/时间/程度词与严格对象边界识别，覆盖“今天就是想你了／我今天就是想你了／今天我挺想你的／我刚才忽然有点想你／现在惦记着你”等。不新增关系，不让明确任务让位；分句保留问号，避免“想你了？”被当声明。否定、另一对象、引用、第三方、假设、任务和未来表述仍排除。\n- 1829项表达与类型通过，新增35项检查实际action、authoredReaction情境及边界：release/expression-natural-affection-2026-10-10.log。旧长亲密例句现在识别为affection，不再以ordinary场景进入普通话题；此前收紧弱相关匹配仍保留。并未宣称任意自然语言都可由正则识别。\n- natural-missing-transfer每角色两轮真实发送，实际首轮prompt含直接心意指导与角色亲密反应。Gu“我也想你／你这么说我很开心”后接自己的喜好；Lu“我也想你，小凡”后简短开心。Gu“这有什么不好意思／藏着才累”仍容易压过对方的害羞，Lu“我听见了”仍偏回执；未评为整体人味达标。首轮Gu输入近似作者已有声音样本，不能作为独立广泛迁移或因果收益证据。\n- 4付费调用input${usage.input}/output${usage.output}/total${usage.total}：Gu4711/176/4887，Lu7357/135/7492。deepseek-flash，每调用500token上限，usage完整、stop，无重试或额外评审。隔离实际发送与IndexedDB，上游非流式，摘要/提取/结算替身，非Android。凭据未输出或落盘；esbuild警告导致PowerShellexit1，完整报告为结束证据，不重复调用。证据docs/${files.join('、docs/')}及release/guyuena-natural-missing、luxueqi-natural-missing-2026-10-10.log。\n- 新组各仅一版完整对话，在Obsidian分别展示；原文件与接线核对存${evidence}。旧组不增添变体、不混接好句。Gu连续505展示/84回放/423付费，input1326301/output49880/total1376181；本日连续157请求417580，冻结20/51217、独立3/7695不变。Lu本轮新增2调用7492，不猜累计。\n- 事实外推、评价/批准口吻、人物辨识度和长聊自然接续仍开放。6.0.13不变；未打包、发布、改官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 日常想念语序接线：1829项通过，Gu/Lu各两轮实际请求验证；对话、优化方向与技术用量分别记录。\n');
console.log(JSON.stringify({usage,roles:2,wholeGroups:2,qualityComplete:false}));
