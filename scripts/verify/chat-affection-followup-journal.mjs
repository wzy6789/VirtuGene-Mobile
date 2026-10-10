import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-affection-followup-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Already recorded');
if(!readFileSync('release/expression-affection-source-fallback-2026-10-10.log','utf16le').includes('PASS chat-expression: 1898 checks'))throw Error('Checks incomplete');
const files=['GUYUENA-LIVE-NATURAL-MISSING-TRANSFER-R2-2026-10-10.json','LUXUEQI-LIVE-NATURAL-MISSING-TRANSFER-R2-2026-10-10.json','GUYUENA-LIVE-SHY-AFFECTION-TRANSFER-R1-2026-10-10.json','GUYUENA-LIVE-SHY-AFFECTION-TRANSFER-R2-2026-10-10.json'];
const data=files.map(file=>JSON.parse(readFileSync('docs/'+file,'utf8')));
if(data.some(r=>!r.complete||r.usage.missingUsage))throw Error('Incomplete real evidence');
const replay=JSON.parse(readFileSync('docs/CHAT-AFFECTION-SAVED-DRAFT-REPLAY-R2-2026-10-10.json','utf8'));
if(!replay.complete||replay.modelCalls!==0||replay.row.calls.length!==2||replay.row.calls.some(c=>!c.replayed))throw Error('Invalid local replay');
const usage=data.reduce((sum,r)=>{for(const key of Object.keys(sum))sum[key]+=r.usage[key];return sum;},{calls:0,input:0,output:0,total:0});
const decisions=[];
for(const r of data.slice(0,2)){
  const path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
  const old='## natural-missing-transfer / r1（生产对话）',start=before.indexOf(old);
  if(start<0)throw Error('Displayed source group missing');
  const next=before.indexOf('\n## ',start+old.length),end=next<0?before.length:next;
  const prompt=r.rows[1].calls[0].messages.find(m=>m.role==='system').content;
  const card=prompt.slice(prompt.lastIndexOf('[人物声音卡]'),prompt.lastIndexOf('[/人物声音卡]'));
  if(!card.includes('亲密反应：'))throw Error('Actual follow-up voice reaction missing');
  let block='## natural-missing-transfer / r2（生产对话）\n';
  for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';}
  const after=before.slice(0,start)+block+before.slice(end);
  decisions.push({path,before,after,selected:files[data.indexOf(r)],reason:r.roleName==='古月娜'?'R2整组少了R1的这有什么不好意思/藏着才累的解释，更多表达自己喜欢听。仍有不用藏的劝告，不判定广泛自然度达标。':'R2整组表达自己也有一点害羞与愿意直说，不再只是我听见了的回执。只有一组新样本，不能证明稳定。',actualFollowupCard:card});
}
// The transfer has only one complete fresh version. Its real repair and the
// zero-cost fallback replay remain diagnostic evidence, never spliced in.
const transfer=data[2],path=`${root}/聊天验收/古月娜-2026-10-10.md`;
let block='\n\n## shy-affection-transfer / r1（生产原稿，兜底修复前）\n';
for(const row of transfer.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**古月娜**：'+reply+'\n';}
writeFileSync(evidence,JSON.stringify({usage,decisions,transfer:files[2],realRepair:files[3],localReplay:'docs/CHAT-AFFECTION-SAVED-DRAFT-REPLAY-R2-2026-10-10.json',scope:'Best intact original scene variant per role; new transfer retains failure, repair/fallback not spliced; source safety verified by local actual send pipeline, not fresh corrected generation'},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(path,block);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 心意之后的接续\n- 只在相邻心意已得到回应时，把害羞和愿意表达接回人物自己的亲密反应；转题、求助、道歉和拒绝不沿用。\n- 原两轮两人更能说自己的感受；换语序仍编“难得主动”，修正又编窗边状态。补检查与零付费发布兜底验证，仍未整体达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 亲密接续、语序迁移与重试后的事实兜底\n- 原affectionReaction只识别短害羞整句，用户补一句愿意表达便失去作者亲密反应。抽为isAffectionReaction，支持自己的害羞、刚才表达的引入及不愿藏话/收回的组合；需要紧邻自己的心意已被assistant实际回应。interactionMomentForTurn统一用于情绪指导、作者反应选择和保留在尾部的声音卡。历史原文只解析，不修改；没有改变关系、亲密许可或人物原文。混入任务、问题、换话题、道歉、拒绝或第三方不继承。\n- Gu/Lu各两轮natural-missing R2，真实第二轮卡均含各自亲密反应。Gu少解释、说喜欢听；Lu说自己也有一点害羞并愿意说。这组R2各整体替换R1，保留原文件与理由，不拼句。首轮近似已有声音样本，不能证明广泛泛化。\n- Gu不同语序shy-affection两轮（无相同作者例句）首轮仍编“难得你主动说这种话”。补现有频率判断的前置语法，否定/疑问/假设/引用和实际来源放行。真实原稿回放用原一次重试，消除难得却改编“刚才正坐在窗边发呆”，该修正失败证据保留，不能称成功。\n- 补明确进行体的实际姿势场景（含省略主语）检查，保留想做、假设、比喻、指令、明确其他主语和用户指定演员状态。新增omitUnsupportedAffectionHistory整句兜底，接入private的候选可用性、发布前处理与质量指标；已有活动整句兜底覆盖姿势，不多调用、不补罐头。依赖同句整句删除，独立真心保留；source支持频率不删除。\n- 最终1898项表达与类型通过：release/expression-affection-source-fallback-2026-10-10.log。新增亲密接续29项、频率语法27项、姿势/整句兜底13项。零付费将两条真实原稿（初稿+失败修正）按原顺序回放通过当前实际发送/IndexedDB，恰好两次replayed，最终仅落库“嗯，我也想你。”：docs/CHAT-AFFECTION-SAVED-DRAFT-REPLAY-R2-2026-10-10.json。第一次本地回放找不到Playwright自带浏览器，保留失败报告；改用项目既有Chrome后通过，未新增模型调用。原报告/日志不覆盖。\n- 本轮7实际调用input${usage.input}/output${usage.output}/total${usage.total}；原场景Gu4945/184/5129，Lu7570/138/7708；Gu迁移4953/219/5172；Gu原稿真实修正2445/95/2540。deepseek-flash、每次500token上限，usage完整、stop。真实修正不是第三次生成；最终兜底验证为两个旧稿本地回放，模型0。非流式隔离实际发送与IndexedDB，摘要/提取/结算替身，非Android；凭据不输出/落盘。esbuild警告导致PowerShellexit1，以报告结束状态为准。证据docs/${files.join('、docs/')}及release/{guyuena,luxueqi}-affection-followup、guyuena-shy-affection-transfer、guyuena-inverted-rarity-repair、chat-affection-saved-replay-r2-2026-10-10.log。\n- 迁移组仅一版完整新生成，原样注明兜底修复前；真实修正与零付费兜底只作项目诊断证据，不拼入完整组。原展示/整组选择与真实尾卡见${evidence}。Gu连续510展示/85回放/428付费，input1338644/output50378/total1389022；本日连续162请求430421。零付费两稿重放独立于连续模型用量；冻结20/51217、独立3/7695不变。Lu本轮连续新增2调用7708。\n- 不宣称表达普遍达标：人物点评腔、语义指代、词表外事实、长聊漂移仍开放，安全省句不等于内容人味。6.0.13不变，未打包/发布/改官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 亲密接续与重试事实兜底：1898项通过，两个真实失败稿零付费回放只保存独立心意。整组对话、简短方向和实际用量分开记录。\n');
console.log(JSON.stringify({usage,localReplay:replay.complete,qualityComplete:false}));
