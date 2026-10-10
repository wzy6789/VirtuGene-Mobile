import {readFileSync,appendFileSync} from 'node:fs';

// Append this bounded evidence batch once; never rebuild earlier journals.
const root='D:/月起云归/VirtuGene/手机版';
const names=['LUXUEQI-LIVE-SMALL-SUCCESS-TRANSFER-R1-2026-10-10.json','LUXUEQI-LIVE-SMALL-SUCCESS-TRANSFER-R2-2026-10-10.json','GUYUENA-LIVE-SMALL-SUCCESS-TRANSFER-R3-2026-10-10.json'];
const reports=names.map(name=>({name,data:JSON.parse(readFileSync('docs/'+name,'utf8'))}));
const diagnosticName='CHAT-GUYUENA-AGENCY-FRAMING-R1-2026-10-10.json';
const diagnostic=JSON.parse(readFileSync('docs/'+diagnosticName,'utf8'));
const diagnosticUsage=JSON.parse(readFileSync('docs/'+diagnosticName.replace('.json','-USAGE.json'),'utf8'));
const marker='## 用意澄清接续：两角色实际对话';
const log=root+'/开发日志/2026-10-10.md';
if(readFileSync(log,'utf8').includes(marker))throw Error('Evidence batch already journalled');
if(!diagnostic.complete||diagnosticUsage.totals.missingUsage||reports.some(r=>!r.data.complete||r.data.usage.missingUsage))throw Error('Incomplete evidence');
const totals=reports.reduce((sum,{data})=>({calls:sum.calls+data.usage.calls,input:sum.input+data.usage.input,output:sum.output+data.usage.output,total:sum.total+data.usage.total}),{...diagnosticUsage.totals});
const entries=[];
for(const {name,data:r} of reports){
 const path=root+'/聊天验收/'+r.roleName+'-2026-10-10.md';
 const title='## 用意澄清接续 / '+name;
 if(readFileSync(path,'utf8').includes(title))throw Error('Dialogue already journalled');
 let entry='\n\n'+title+'\n\n实际生产私聊发送与IndexedDB；提供方非流式，摘要/提取/结算替身。完整传输不等于人味达标。用量 '+JSON.stringify(r.usage)+'。证据 F:/VirtuGene-Mobile/docs/'+name+'。\n\n';
 for(const row of r.rows){entry+='chatgpt：'+row.input+'\n\n';for(const reply of row.replies)entry+=r.roleName+'：'+reply+'\n\n';}
 entry+='复核：首轮仍按得意判断水平或猜分享想展示。陆雪琪修前重复确认，修后表达自己的高兴；古月娜修后不再评水平，但「这我收下了」仍偏表演。重复场景、随机采样与不同历史不能证明因果或泛化。\n';
 entries.push([path,entry]);
}
let frozen='\n\n## 骄傲措辞冻结诊断 / agency-framing R1\n\n固定R80首轮完整上下文，原版与候选两请求4949tokens。只改应用自有正文/声音卡两句，原著关系、对外银龙王骄傲、历史与契约不变。非生产上屏，不是连续对话。候选没有质量优势，未采用。证据 F:/VirtuGene-Mobile/docs/'+diagnosticName+'。\n\n';
for(const row of diagnostic.rows)frozen+='对照分支：'+row.arm+'\n\nchatgpt：'+row.input+'\n\n古月娜：'+row.raw+'\n\n';
entries.push([root+'/聊天验收/古月娜-2026-10-10.md',frozen]);
const description=`\n\n${marker}\n\n上一轮仅确认陆雪琪范围，不算聊天质量改善。本轮agency-framing冻结诊断严格限定古月娜自有关心正文和完整声音卡两句；事实、关系、对外银龙王骄傲和契约保留。修改来源、缺字段及陆雪琪无对应作者字段均拒绝，边界检查通过。两请求仍猜用户想展示画，没有可靠优势，未改生产角色文本。\n\n陆雪琪R1三轮发现更正用意被共用隐藏节奏判成换话题，产生两条重复确认。修复chat-turn-cues：有限明确「不是想/要/让你做某事，只是/而是……」对照需否定与替代用意同时存在；报告、引用、假设、问题、解释用途不触发。接入isTopicClarification及respond-clarification动作，保留当前事项并沿明确补充用意回应，不解释心理。人物心意映射同步，倾听偏好不叠冲突指导。自己的观点、新任务、明确换题、剧情保留各自路线；不授权操作，不推断隐含情绪，不改原著事实、人设或关系。\n\n初次套件失败于「不是想让你」句式，补正后1646通过；新增任务/剧情/换题/倾听边界后1650通过，最终类型检查通过。新增20项覆盖语法正反例与两角色指导入口，不固化画画标准答案。证据release/expression-intent-correction-2026-10-10.log（失败）、expression-intent-correction-final-2026-10-10.log及expression-intent-correction-boundaries-2026-10-10.log（1650）。\n\n修后陆雪琪R2和古月娜R3第二轮实际system均有用意澄清指导，停止评水平、自然收尾；陆雪琪表达自己的高兴，古月娜「这我收下了」仍表演化。首轮仍以得意猜想展示或评价水平；同场景复用、随机采样与不同历史不能证明因果改善或泛化。仅保留确切接续修复，不再给画画例题增加专属答案，下一步检查其他分享和用意更正场景。两角色目标仍未完成。\n\n本轮用量（含冻结、修前与修后）：${JSON.stringify(totals)}，共11请求35599tokens；max_tokens500，全部finish stop、usage完整，无额外评分、质检重试或第三次生成。三个连续组预算各4实际各3；凭据仅内存授权第二DeepSeek配置，已终止并finally关代理。连续组PowerShell退出码1来自已有esbuild警告，报告完整与用量分别核对，日志不删。原始docs/${names.join('、docs/')}及docs/${diagnosticName}和对应-USAGE.json；release/luxueqi-small-success-real-2026-10-10.log、luxueqi-intent-correction-real-2026-10-10.log、guyuena-intent-correction-real-2026-10-10.log均保留。\n\n古月娜连续累计467展示轮、84回放、385付费请求，input1234232/output44488/total1278720；本日连续119请求320119tokens。冻结累计14请求36286tokens、独立修正1请求2373tokens及其他独立验收另计。陆雪琪本轮增加6请求22998tokens，不混入古月娜累计。完整chatgpt/角色原话分别追加手机版聊天验收。首次日志追加尝试因PowerShell管道中文编码失败，未写入；改用UTF8文件脚本。保持6.0.13，不打包、不发布，不改官网或电脑版日志。\n`;
for(const [path,entry] of entries)appendFileSync(path,entry);
appendFileSync(log,description);
appendFileSync(root+'/00-总览.md','\n\n- 10月10日用意澄清接续：古月娜、陆雪琪实际三轮对照；1650本地表达检查及类型通过。骄傲措辞候选未采用，分享动机猜测与表演化表达仍待改善。见[[开发日志/2026-10-10]]及两角色当天聊天验收。\n');
console.log('Appended separate mobile dialogues, evidence and index; no desktop journals changed');
