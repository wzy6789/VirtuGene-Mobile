import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-postposed-habit-journal-2026-10-10.json';
if(existsSync(evidence))throw Error('Already recorded');
const reports=['GUYUENA-LIVE-SPOILER-CHOICE-TRANSFER-R1-2026-10-10.json','LUXUEQI-LIVE-SPOILER-CHOICE-TRANSFER-R1-2026-10-10.json','LUXUEQI-LIVE-SPOILER-CHOICE-TRANSFER-R2-2026-10-10.json'].map(file=>({file,data:JSON.parse(readFileSync('docs/'+file,'utf8'))}));
if(reports.some(r=>!r.data.complete||r.data.usage.missingUsage))throw Error('Incomplete evidence');
const repaired=reports[2].data;
if(repaired.rows.length!==1||repaired.rows[0].calls.length!==2||!repaired.rows[0].calls[0].replayed||repaired.usage.calls!==1)throw Error('Expected one replay plus existing real retry');
if(!readFileSync('release/expression-postposed-habit-2026-10-10.log','utf16le').includes('PASS chat-expression: 1784 checks'))throw Error('Unverified patch');
const originals=[];
for(const {file,data} of reports.slice(0,2)){
  const path=`${root}/聊天验收/${data.roleName}-2026-10-10.md`;
  const before=readFileSync(path,'utf8');
  const marker='## spoiler-choice-transfer / r1（生产对话）';
  if(before.includes(marker))throw Error('Scene already recorded');
  let block='\n\n'+marker+'\n';
  for(const row of data.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+data.roleName+'**：'+reply+'\n';}
  originals.push({path,before,file,reason:'Only one fresh intact three-turn variant. The isolated saved-draft correction is diagnostic, not a second complete conversation; do not splice it into this scene.'});
  appendFileSync(path,block);
}
const usage=reports.reduce((sum,{data})=>{for(const key of Object.keys(sum))sum[key]+=data.usage[key];return sum;},{calls:0,input:0,output:0,total:0});
writeFileSync(evidence,JSON.stringify({originals,reports:reports.map(r=>r.file),usage,scope:'Fresh dialogue and saved-draft repair kept separate; displaying the only whole scene does not mark it passing'},null,2));
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 新话题与习惯自述\n- 提前知道故事结局的新话题：两人有不同选择，但仍出现批准口吻，陆雪琪编了阅读习惯。\n- 补齐“我看书也有这习惯”这类后置习惯声明检查，三入口共用；真实原稿修正后改说喜好，仍偏解释与比喻。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 新主题迁移与后置习惯声明\n- 新增spoiler-choice-transfer三轮：问提前知道结局的选择、澄清碰巧得知、自然告别。Gu介意、Lu不介意，有不同态度，但两人仍用“不拦你／按心意去看”等批准口吻。Lu“我看书也有这习惯，先知道结局…”没有角色独立来源，原检查仅覆盖频率词前置，漏过。\n- chat-self-report-risk在现有具体动作范围内识别后置的“有这习惯／是这习惯”，不增加角色专属词表。方法详情保留逗号一起核对，知道看书不等于知道阅读顺序；话术样本和第三方不能充当来源。1784项与类型检查通过，新增17项覆盖三入口、仅一般看书的来源不足、样本不算来源、独立对应记录放行，以及喜好/否定/引用/假设/问句放行。证据release/expression-postposed-habit-2026-10-10.log。词表之外、语义改写支持仍不是完整闭环。\n- 六次新生成input18441/output695/total19136：Gu7200/355/7555，Lu11241/340/11581。原失败稿回放含已恢复第一轮（合成时间戳），生产质检准确使用既有一次重试；1次实际调用3840/119/3959。修正消除具体阅读习惯自述，但“我知道，你没那个心思”与山门比喻仍偏解释。回放不是新生成全组或原定时会话，不拼进完整聊天。\n- 本轮7付费调用input${usage.input}/output${usage.output}/total${usage.total}；所有usage完整、stop。deepseek-flash每调用500token上限，无额外评审。实际发送与隔离IndexedDB，上游非流式，摘要/提取/结算替身，非Android；esbuild警告导致PowerShellexit1，完整报告作为结束依据，未盲目重跑。凭据未输出或落盘。证据docs/${reports.map(r=>r.file).join('、docs/')}及release/guyuena-spoiler-choice、luxueqi-spoiler-choice、luxueqi-postposed-habit-replay-2026-10-10.log。\n- 两个新三轮场景只有一版完整新生成，存原样，Lu的原缺陷不掩盖；修正稿仅项目证据，不拼接精选。备份与范围见${evidence}。Gu连续497展示/84回放/415付费，累计input1307236/output49005/total1356241，本日连续149请求397640；冻结20/51217、独立3/7695不变。Lu本轮新生成3调用11581，回放修正1调用3959分别记录，不猜总累计。\n- 人味、批准口吻与长聊漂移未收尾，目标继续。6.0.13不变；未打包、发布或更新官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 新故事结局话题检查与后置习惯声明修复：1784项通过，整组对话、简短优化记录及真实用量分别见手机版三个目录。\n');
console.log(JSON.stringify({usage,fresh:6,replayed:1,paidRepair:1}));
