import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-peer-choice-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Already recorded');
const decisions=[];
let usage={calls:0,input:0,output:0,total:0};
for(const [role,prefix] of [['古月娜','GUYUENA'],['陆雪琪','LUXUEQI']]){
  const files=[1,3].map(rev=>`docs/${prefix}-LIVE-SPOILER-CHOICE-TRANSFER-R${rev}-2026-10-10.json`);
  const variants=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
  if(variants.some(r=>!r.complete||r.rows.length!==3||r.usage.missingUsage)||variants[1].usage.calls!==3)throw Error('Incomplete evidence');
  if(variants[0].rows.some((row,i)=>row.input!==variants[1].rows[i].input))throw Error('Different conversation group');
  for(const key of Object.keys(usage))usage[key]+=variants[1].usage[key];
  const path=`${root}/聊天验收/${role}-2026-10-10.md`;
  const before=readFileSync(path,'utf8');
  const marker='## spoiler-choice-transfer / r1（生产对话）';
  const start=before.indexOf(marker);
  if(start<0)throw Error('Original displayed group missing');
  const next=before.indexOf('\n## ',start+marker.length),end=next<0?before.length:next;
  const selected=role==='古月娜'?0:1;
  let block=selected===0?before.slice(start,end):'## spoiler-choice-transfer / r3（候选契约完整对话，契约未采用）\n';
  if(selected===1)for(const row of variants[1].rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+role+'**：'+reply+'\n';}
  const after=before.slice(0,start)+block+before.slice(end);
  decisions.push({role,path,before,after,candidates:files,selected:files[selected],reason:role==='古月娜'?'R1接续清楚；R3第二轮把读者碰巧知道结局误接成故事人物自己是否想知道。不采用R3整组。':'R3没有R1的具体无来源阅读习惯，三轮完整连贯，整体相对更稳；仍有劝告和修辞，不判定自然或性格达标。修正回放R2非完整组，不拼入。'});
}
writeFileSync(evidence,JSON.stringify({usage,decisions,productionDecision:'Revert the added peer-choice contract clause: observed samples do not support an improvement. One sample per condition is not causal evidence.'},null,2));
for(const item of decisions)writeFileSync(item.path,item.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 批准口吻对照\n- 新增“选择不需批准”提示后，两人仍追加劝告，Gu还丢了语义对象；没有可靠收益，已撤回。\n- 保留整组证据，Gu留R1、Lu选较安全的R3并注明候选契约未采用。接下来重视语义接续，少堆禁令。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 批准口吻：未采用的契约试验\n- 共享普通分享条目试加平等表达与无需批准的提示，不改人物身份/关系/人设，不禁止明确求助。候选版1784表达检查通过，证据release/expression-peer-choice-2026-10-10.log；这只是协议和本地功能检查，不是人味得分。\n- Gu/Lu同一三轮故事结局场景各一版：Gu仍说想看就去看，第二轮把读者碰巧知道结局误接成故事人物自己是否想知道；Lu仍说从头看、先别让人再讲。没有显示稳定收益，撤回新增契约句，回到已验原版。保留此前后置习惯检查；不以新增约束数量衡量效果。单样本对照不能归因。\n- 六次真实新生成，input${usage.input}/output${usage.output}/total${usage.total}；Gu7230/322/7552，Lu11261/346/11607。deepseek-flash，每调用500token上限，usage完整、stop、无重试、无额外评审。隔离实际发送与IndexedDB，上游非流式，摘要/提取/结算替身，非Android。esbuild警告导致PowerShellexit1，完整报告为终止证据，未重复调用。证据docs/{GUYUENA,LUXUEQI}-LIVE-SPOILER-CHOICE-TRANSFER-R3-2026-10-10.json及release/{guyuena,luxueqi}-peer-choice-2026-10-10.log。\n- 整组比较：Gu继续展示R1；Lu选择无具体阅读习惯虚构的R3，注明候选契约未采用，仍有劝告与修辞。R2仅修正回放，不作为完整候选，更不拼入。旧展示备份、完整候选与选择理由保存${evidence}。\n- Gu连续500展示/84回放/418付费，累计input1314466/output49327/total1363793；本日连续152请求405192。冻结20/51217、独立3/7695不变。Lu本轮连续新增3调用11607，不猜全局累计。目标未达成：批准/评价口吻、语义对象接续、事实外推和长期辨识度仍开放。6.0.13不变；未打包/发布/改官网。\n`);
console.log(JSON.stringify({usage,reverted:true,selected:decisions.map(d=>({role:d.role,file:d.selected}))}));
