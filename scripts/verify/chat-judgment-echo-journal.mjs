import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-judgment-echo-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Existing evidence must remain');
const usage={calls:0,input:0,output:0,total:0};
const decisions=['GUYUENA','LUXUEQI'].map((role,index)=>{
 const files=[1,2,3].map(n=>`docs/${role}-LIVE-STORY-VIEW-ECHO-TRANSFER-R${n}-2026-10-10.json`);
 const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
 for(const report of reports){
  if(!report.complete||report.rows.length!==2||report.usage.missingUsage||report.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Complete bounded real evidence required');
  for(const key of Object.keys(usage))usage[key]+=report.usage[key];
  if(report.rows.some((row,i)=>row.input!==reports[0].rows[i].input))throw Error('Same inputs required');
 }
 if(reports[0].judgmentEchoCompaction||!reports[1].judgmentEchoCompaction||reports[2].judgmentEchoCompaction)throw Error('Baseline, diagnostic, production switches must be distinct');
 const baselineSystem=reports[0].rows[0].calls[0].messages.find(m=>m.role==='system').content;
 const fields=baselineSystem.split('\n').filter(line=>/^(?:判断习惯|在意的事)：/u.test(line));
 if(fields.length!==2)throw Error('Expected two full source fields');
 for(const report of reports.slice(1))for(const row of report.rows)for(const call of row.calls){
  const system=call.messages.find(m=>m.role==='system').content;
  if(system.split('\n').some(line=>/^(?:判断习惯|在意的事)：/u.test(line)))throw Error('Duplicate source head remains');
  const card=system.match(/\[人物声音卡\][\s\S]*?\[\/人物声音卡\]/u)?.[0];
  if(!fields.every(line=>card?.includes(line)))throw Error('Complete source fields missing from final card');
 }
 const selected=reports[1],path=`${root}/聊天验收/${selected.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
 if(before.includes('## story-view-echo-transfer'))throw Error('Group already displayed');
 let block='\n\n## story-view-echo-transfer / r2（去重试验对话）\n';
 for(const row of selected.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+selected.roleName+'**：'+reply+'\n';}
 return {files,selected:files[1],path,before,after:before+block,removedHeadCharacters:fields.reduce((n,line)=>n+line.length+1,0),firstCallInputTokens:reports.map(r=>r.rows[0].calls[0].usage.prompt_tokens),reason:index===0?'R2有自己的不同好恶与轻微打趣，R1偏论述，R3替用户许可留白并添共同看稿关系，整组保留R2。':'R2较短且未补旧事，R1末轮套是非，R3补“你从前话说一半”的未核对经历；整组保留R2。',limitations:index===0?'R2仍有闹你及要求讲理由的强势措辞，不能证明其他场景长期更好。':'R2堵门比喻仍生硬；R3未核对共同历史说明去重不能保证事实准确。'};
});
writeFileSync(evidence,JSON.stringify({usage,decisions,productionEnabled:true,scope:'Exact complete app-owned judgment fields removed only from head after compilation; final card keeps all text. Private send only, no authored persona mutation. Baseline/diagnostic/production fresh two-turn reports, histories differ; not proof of causal style improvement, speed, Android or long-chat success.',qualityComplete:false},null,2));
for(const decision of decisions)writeFileSync(decision.path,decision.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 保留人物底色，去掉判断重复\n- 人设头部与末尾声音卡的完整自有判断只留一份；用户编辑、截短卡片、多张卡片都不处理。\n- 两人实际私聊已接去重；小组试验更简短，但正式复测仍有生硬比喻、许可语气和未核对旧事，整体未达标。\n- 继续区分熟悉带来的自然关心与为亲近而补写共同历史。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n## 自有判断副本去重：正式私聊接线\n- 上轮评价问句识别2092通过，新增表达指导因R3长论述撤回。本轮读取actual system，确认两位判断习惯、在意的事完整文本同时在头部与末尾卡出现。没有再堆限制语句，新增chat-owned-judgment-compaction纯函数，只移除精确自有头部行：Gu要求现有CARE全文存在，Lu要求当前人设全文与自有预设一致；末尾唯一声音卡的判断栏目必须包含完整原行且头部仅有一份。声音样本不能代替判断，截短或多卡不动。原人设、身份、事实、关系、情境反应、末尾协议保留，不改库，不改用户原文。\n- 本地19项相关边界新增，chat-expression最终2111项通过（release/chat-judgment-echo-production-verified-2026-10-10.log），类型通过（release/chat-judgment-echo-production-types-2026-10-10.log）。编辑Lu测试包含确实重复原字段的完整卡，避免用本来就不会去重的无卡输入伪证明编辑保护。\n- 新story-view-echo-transfer每组两输入（故事留白、结尾偏好分歧），Gu/Lu各baseline R1两轮、诊断R2两轮、正式接线后关闭诊断R3两轮。R2较短，Gu有不同好恶和轻微打趣、Lu没有绕入是非；采用精确冗余消除接入send-service编译后。R3实际每次请求无头部重复且末尾卡完整，证明正式链路生效，非仅工具。部分上下文日期/模型随机及第二轮前文不同，不把所有输出差异当去重因果。每角色移除头部字符${decisions.map(d=>d.removedHeadCharacters).join('/')}，输入首轮token数据在证据；总体输入变化还受输出历史影响，不声称固定百分比或加速。\n- 尚存：Gu R3替用户许可留白、要求讲结局；Lu R3“就像你从前那样，话说一半”没有当前所供资料支持，不能用夫妻身份自证此旧事。去重不能保证真实性或人物辨识度。整体R2各入选，R1/R3完整原稿保留，不拼句；展示标明去重试验，不冒称当前生产新稿。\n- ${decisions.flatMap(d=>d.files).join('、')}；选择与展示前备份${evidence}；release/{guyuena,luxueqi}-judgment-echo-{baseline,candidate,production}-2026-10-10.log。聊天原话输入chatgpt，优化简短与技术证据分开。\n- 本轮12次deepseek-flash付费input${usage.input}/output${usage.output}/total${usage.total}。各两轮每轮一次无重试，500输出上限、usage完整、finish stop。非流式actual private/隔离IndexedDB，摘要/提取/结算替身，非Android与长聊。真实运行终端已终止且report.complete，不因esbuild警告exit1再跑；凭据不输出。\n- 正式仅私聊启用，不宣称主动/群聊已去重。诊断开关保留，不默认开启；函数幂等不会重复删除。目标未完成。6.0.13不变，不打包、不发布、不更新官网下载。\n`);
appendFileSync(root+'/00-总览.md',`\n- 判断全文去重接入正式私聊：2111项与类型通过，双角色baseline/试验/正式共12调用${usage.total}token。只留较好R2整组，正式仍见未核对旧事与生硬措辞，整体目标继续。\n`);
console.log(JSON.stringify({usage,decisions:decisions.map(({selected,removedHeadCharacters,firstCallInputTokens})=>({selected,removedHeadCharacters,firstCallInputTokens})),qualityComplete:false}));
