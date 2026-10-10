import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-listening-reaction-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Existing journal evidence must not be overwritten');
const files=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-LISTENING-CHOICE-TRANSFER-R1-2026-10-10.json`);
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
const usage=reports.reduce((a,r)=>({calls:a.calls+r.usage.calls,input:a.input+r.usage.input,output:a.output+r.usage.output,total:a.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const decisions=reports.map((r,index)=>{
  if(!r.complete||r.rows.length!==3||r.usage.missingUsage||r.rows.some(row=>row.failed))throw Error('Incomplete dialogue evidence');
  const system=r.rows[0].calls[0].messages.find(m=>m.role==='system').content;
  if(!system.includes('说出你这个人真正在意的一点'))throw Error('Candidate direction missing from actual request');
  const path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
  if(before.includes('## listening-choice-transfer'))throw Error('Scene already curated');
  let block='\n\n## listening-choice-transfer / r1（生产对话）\n';
  for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';}
  return {path,before,after:before+block,source:files[index],reason:'唯一完整新组，保留缺陷原话；不是达标样本，未拼句或重复花额度选漂亮结果。'};
});
writeFileSync(evidence,JSON.stringify({usage,files,decisions,qualityComplete:false,findings:['Gu unsupported quiet voice and dislike of repetition, embodied neck pain','Lu unsupported one-sentence rejection detail','No actual-model baseline for this exact new input sequence; causal improvement unproven']},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 倾诉中的人物反应\n- 倾诉可以有自己的关切、不同感受或短反应，不只宣告在听；不要求长安慰或自动解题。\n- 新实测仍编共同习惯、身体体验和退稿细节。下一步分清当下偏爱与有来源的了解，当前不能宣称人味达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 倾诉方向改动与新迁移对话暴露的来源缺口\n- 上轮为进展：失落/沮丧识别与恢复状态实际修改，付费请求显示作者回应正确入卡，但内容仍空泛。本轮读取当前stay-present与listen附加指导，原stay-present末句“让下一句话留给他”偏向被动回执；替换该方向为当前人物在意的一点及自己的反应，保留短回应、停顿、用户节奏和未知留白。未强制每条有信息、未封禁“我听着”、未加固定答案或改角色事实许可。此为提示改动，不是内容保证。\n- 新增6检查，最终1938通过：release/chat-listening-reaction-final-2026-10-10.log；类型通过：release/chat-listening-reaction-types-2026-10-10.log。首个失败是旧测试要求原句“没讲明的就留白”，保留该未知边界措辞；第二个失败是旧测试固定“纯反应或自己的态度”字串，改为核对同一语义的新允许短反应/人设原话/未知留白，未撤销边界。两个失败日志chat-listening-reaction[-verified]-2026-10-10.log保留，不只记录绿项。\n- 新三轮listening-choice-transfer：退稿后的委屈但不求改法、明确换题的假设下午选择、用户保留不同选择再问人物偏好。两人均以真实身份明确舞麟/小凡，经actual private send/IndexedDB（非流式，摘要/提取/结算替身；非Android），实际请求已含新方向。假设场景不是当下同处现场。当前新组没有同输入旧方向基线，不能把与此前不同语料的差异当因果改善。\n- Gu首轮仍“我在”并询问饮食，末轮编“你平时声音放得轻”“你又不爱重复”“久了脖子酸”，说明内容关心未稳定改善、熟悉感仍可由虚构习惯支撑。Lu首轮补“被人一句话退回来”（用户只说退回，方式未知）并主动让先搁着；后续有独立安静偏好与心意，但不能掩盖第一轮缺陷。引用的体验与习惯未经本文来源证明，本地规则仍漏过，后续应解决来源归属而非继续增加安慰话库。\n- Gu3调用输入7644/输出367/总8011；Lu3调用11677/459/12136；本轮共${usage.calls}调用输入${usage.input}/输出${usage.output}/总${usage.total}。deepseek-flash，每次500输出上限，usage无缺失、stop，未重试。PowerShellexit1为esbuild警告；报告complete和原始用量核实，不据退出码重跑。凭据仅内存读取，不输出、不落盘。原报告${files.join('、')}；release/{guyuena,luxueqi}-listening-choice-2026-10-10.log。\n- 每组仅唯一R1完整展示，输入标chatgpt，无分析混入对话；失败原话保留。选择和原展示备份${evidence}。没有补模型请求追漂亮样本。\n- Gu新增3付费8011；连续累计525展示/85回放/443付费，输入1375529/输出52153/总1427682；今日连续177调用469081。Lu本轮新增3调用12136。总体自然度、源外细节、习惯事实与长聊仍开放；目标未完成。6.0.13不变，不打包、不发布、不更新官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 倾诉反应优化：1938项与类型通过；古月娜/陆雪琪各三轮真实迁移组已分别记录，仍发现来源外习惯与细节，人味目标未完成。\n');
console.log(JSON.stringify({usage,qualityComplete:false}));
