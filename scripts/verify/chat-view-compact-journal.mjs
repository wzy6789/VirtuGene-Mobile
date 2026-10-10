import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-view-compact-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Already recorded');
const roles=[['古月娜','GUYUENA'],['陆雪琪','LUXUEQI']];
const selections=[];
let usage={calls:0,input:0,output:0,total:0};
for(const [role,prefix] of roles){
  const variants=[1,2,3].map(n=>{
    const file=`docs/${prefix}-LIVE-PERSONAL-VIEW-TRANSFER-R${n}-2026-10-10.json`;
    const data=JSON.parse(readFileSync(file,'utf8'));
    if(!data.complete||data.usage.calls!==2||data.usage.missingUsage||data.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Incomplete evidence');
    if(n>1)for(const key of Object.keys(usage))usage[key]+=data.usage[key];
    return {file,data};
  });
  const selected=role==='古月娜'?1:3;
  const path=`${root}/聊天验收/${role}-2026-10-10.md`;
  const before=readFileSync(path,'utf8');
  const marker='## personal-view-transfer / r1（生产对话）';
  const start=before.indexOf(marker);
  if(start<0)throw Error('Original curated scene missing');
  const next=before.indexOf('\n## ',start+marker.length);
  const end=next<0?before.length:next;
  const chosen=variants[selected-1];
  let block=`## personal-view-transfer / r${selected}（生产对话）\n`;
  for(const row of chosen.data.rows){
    block+='\n**chatgpt**：'+row.input+'\n';
    for(const reply of row.replies)block+='\n**'+role+'**：'+reply+'\n';
  }
  const after=before.slice(0,start)+block+before.slice(end);
  selections.push({role,path,before,after,variants:variants.map(v=>v.file),selected:chosen.file,reason:role==='古月娜'?'R1整组无具体无来源的身体细节，自己的选择与理由连贯。R2虚构惯常纹路经验；R3触觉解释与警句偏重。R1仍有评价感，不是达标判定。':'R3整组较简短，自己的选择明确，少了R1剑招比喻和R2潦草不如不做的泛化。仍有难得的评价口吻；不能认定性格已鲜明。'});
}
writeFileSync(evidence,JSON.stringify({usage,selections,scope:'Human comparison of intact two-turn variants; no stitched utterances; raw failures preserved; not a causal or human-quality pass'},null,2));
for(const item of selections)writeFileSync(item.path,item.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 观点回应减负\n- 缩短回答指导：先说自己的选择，需要时再展开理由；事实边界仍用共享契约。\n- 两角色各两版真实两轮检查：Gu仍偏修辞与触觉解释，Lu仍有评价口吻。展示按完整组比较，Gu留R1、Lu留R3，未判定人味达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 观点指导精简与完整样本比较\n- chat-humanizer回答分支去除强制具体理由、讲清楚和重复举例约束，保留详细请求展开、普通问句自然停顿、未知可坦白；共享契约仍约束事实。首轮本地失败是普通问句停顿指令被删，已恢复，失败日志保留。最终1767项通过：release/expression-view-guidance-compact-final-2026-10-10.log；类型检查通过（恢复停顿句前运行，后仅改字符串）。\n- 精简前后Gu/Lu各两轮新请求，共8调用，input${usage.input}/output${usage.output}/total${usage.total}，usage完整，stop，无重试。deepseek-flash，每调用500token上限，无新增语义评审。非流式隔离真实发送与IndexedDB，摘要/提取/结算替身；不是Android或长期效果验收。PowerShell因esbuild警告报告exit1，但四份完整报告与usage证明调用结束，不重跑。证据docs/{GUYUENA,LUXUEQI}-LIVE-PERSONAL-VIEW-TRANSFER-{R2,R3}-2026-10-10.json。\n- R2 Gu虚构纹路与魂力惯常操作，Lu泛化评价；R3 Gu未出现具体魂力习惯，但触觉解释、警句仍生硬；Lu较短仍点评。单样本不能归因精简有效，保留短指导以减少规则负担，待陌生主题验证。\n- 三版完整比较后Gu展示R1，Lu展示R3；旧文件、全部候选路径与选择理由保存于${evidence}，没有拼接句子。Gu连续494展示/84回放/412付费，累计input1300036/output48650/total1348686；本日连续146请求390085，冻结/独立用量不变。Lu本轮连续新增4调用15477token，不猜全局累计。\n- 目标未完成：事实外推、评价腔、人物辨识度与长期自然接续仍需验证。6.0.13不变，未打包、发布、改官网。\n`);
console.log(JSON.stringify({usage,selected:selections.map(x=>({role:x.role,file:x.selected}))}));
