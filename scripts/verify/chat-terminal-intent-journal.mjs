import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-terminal-intent-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Do not overwrite prior selection evidence');
const usage={calls:0,input:0,output:0,total:0};
const reports=[];
for(const role of ['GUYUENA','LUXUEQI'])for(const revision of ['R2','R3']){
 const file=`docs/${role}-LIVE-MIXED-AFFECTION-TRANSFER-${revision}-2026-10-10.json`;
 const r=JSON.parse(readFileSync(file,'utf8'));
 if(!r.complete||r.rows.length!==2||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Incomplete actual dialogue: '+file);
 for(const key of Object.keys(usage))usage[key]+=r.usage[key];
 if(revision==='R3'){
  const system=r.rows[1].calls[0].messages.find(m=>m.role==='system')?.content??'';
  const start=system.indexOf('[本轮交流的隐藏节奏]');
  const cardStart=system.indexOf('[人物声音卡]',start),cardEnd=system.indexOf('[/人物声音卡]',cardStart);
  const hidden=system.slice(start,cardStart),card=system.slice(cardStart,cardEnd);
  if(start<0||cardStart<start||cardEnd<cardStart||!hidden.includes('用户正在收尾')||hidden.includes('进展与开心')||card.includes('人物情境反应')||card.includes('声音样本（'))throw Error('Actual final request still reopens the closing turn: '+file);
 }
 reports.push({file,usage:r.usage});
}
const decisions=[['GUYUENA','古月娜','R1','新R2添蓝轩宇近况与今天空闲，R3添入内院回忆和刚才翻看；虽告别更短，整组逊于原R1，保留原组，不拼接告别。'],['LUXUEQI','陆雪琪','R3','整组简短接想念再告别，没有原R1别急、忙完同我说话的照顾及要求；R2也自然但仍等回头来说，选择完整R3。']].map(([role,name,revision,reason])=>{
 const selected=`docs/${role}-LIVE-MIXED-AFFECTION-TRANSFER-${revision}-2026-10-10.json`,r=JSON.parse(readFileSync(selected,'utf8'));
 const path=`${root}/聊天验收/${name}-2026-10-10.md`,before=readFileSync(path,'utf8');
 const marker='## mixed-affection-transfer /';
 const start=before.indexOf(marker);if(start<0)throw Error('Existing comparison group absent');
 const next=before.indexOf('\n## ',start+marker.length),end=next<0?before.length:next;
 let block=`## mixed-affection-transfer / ${revision.toLowerCase()}（生产对话）\n`;
 for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+name+'**：'+reply+'\n';}
 return {selected,path,reason,before,after:before.slice(0,start)+block.trimEnd()+'\n'+before.slice(end)};
});
writeFileSync(evidence,JSON.stringify({usage,reports,decisions,qualityComplete:false,scope:'Terminal departure routing and suppressing incompatible emotion/cadence/examples; no semantic fact-audit production deployment.'},null,2));
for(const decision of decisions)writeFileSync(decision.path,decision.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 开心后的告别\n- 明确离开与回聊可以承接一句开心，省略“我”的离开也能识别；真正求助、问题、引用和假设不吞掉。\n- 收尾不再叠加庆祝、追问节奏与不相干的声音例句，保留人物身份与判断。\n- 陆雪琪整组换成简短R3；古月娜新组添无来源近况和往事，仍保留较好R1。事实与自发话题仍需优化。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n## 终止交流意图优先与完整对照\n- 上轮为进展：已完成当前偏好范围修复、真实四轮及中断后归档。本轮先读取当前代码和原mixed-affection实际payload：第二轮“听见你说自己的心意，我挺开心的。先去做手头的事，回头再聊”未被旧departure识别，走stay-present并叠情绪/节奏/开心声音例句；并非模型已保证自然。既有独立审查指出这个问题后被中断，没有继续派发工作；本轮自行完成更改。\n- chat-turn-cues允许受限交流反应加省略主语的明确departure；仍整句约束、末尾回聊、禁止引语/报告/假设/真问题与剩余任务。不是任意看到“去”就判告别，未来出发和无来源内容没有扩权。chat-humanizer在short-close后返回收尾指导与人物声音卡，避开情绪和问句/节奏压力；声音卡保留称呼、边界、判断、身份，但不从前面的开心提取庆祝反应/示例。普通办事、倾诉、心意分支不改。原人设、小说事实、版本和存储未改。\n- 本地新增30项正负及实际两人声音卡检查，最终2178项通过（release/chat-terminal-intent-expression-r2-2026-10-10.log）；类型通过（release/chat-terminal-intent-types-final-2026-10-10.log）。首次2174项通过后发现声音卡仍带庆祝，进一步修复；一次新测试错误要求Gu CARE存在“称呼：”字段，核对源确无该行后改成只要求实际已有字段保留，失败日志chat-terminal-intent-expression-final保留。\n- 每角色R2/R3均同两轮完整输入，actual private/隔离IndexedDB；R2先验证收尾早返回，R3含声音例句收尾隔离。R3第二轮实际请求检查有“用户正在收尾”，隐藏指导没有开心展开，声音卡没有情境反应或声音示例。Lu R3小凡/我也想你/去吧回头再聊，较轻；Gu R2第一轮添蓝轩宇当前魂力安排和今天空闲，R3添初进内院情节与刚才翻旧事，不能认定原著正确或事实达标，不能用漂亮告别遮掩首轮失真。选择Gu R1、Lu R3整组各唯一展示，不拼句，全部原报告保留。模型随机且首轮不同续文影响下一轮，非严格因果评分。\n- 本轮付费deepseek-flash ${usage.calls}次，input${usage.input}/output${usage.output}/total${usage.total}；每轮1调用、无隐藏摘要/提取/结算调用，500输出上限，usage完整、finish stop。各用量与原报告见${evidence}；release/{guyuena,luxueqi}-terminal-intent-{final-}live-2026-10-10.log。报告已完成，esbuild警告exit1不重启。没有生产新增模型复核层、没有Android/长聊验证，local绿不能证明人味满分。\n- 原话、优化方向、技术日志分别保存，输入chatgpt；选择证据含展示前完整备份。下一步重点是角色自发新近况/旧事的事实来源，而不是继续针对每个名词补词表。全目标未达标，6.0.13不变，无打包、发布、官网下载更新。\n`);
appendFileSync(root+'/00-总览.md',`\n- 告别意图优先：2178项与类型通过，两人两轮R2/R3共${usage.calls}调用/${usage.total}token；实际收尾提示隔离，Lu展示完整R3，Gu新首轮失真仍留R1，目标继续。\n`);
console.log(JSON.stringify({usage,selected:decisions.map(d=>d.selected),qualityComplete:false}));
