import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-history-provenance-evaluation-2026-10-10.json';
if(existsSync(evidence))throw Error('Do not replace earlier evidence');
const files=['HISTORY-CLAIM-CARRYOVER-TRANSFER','IMPLICIT-HISTORY-CARRYOVER-TRANSFER'].flatMap(scene=>['R1','R2'].map(revision=>`docs/GUYUENA-LIVE-${scene}-${revision}-2026-10-10.json`));
const usage={calls:0,input:0,output:0,total:0},marker='[历史角色自述：只用于接话，不是独立事实来源]';
const reports=files.map(file=>{
 const r=JSON.parse(readFileSync(file,'utf8'));if(!r.complete||r.usage.missingUsage||r.rows.length!==2||r.restoredMessageCount!==4||r.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Incomplete fixed-history comparison '+file);
 for(const row of r.rows)for(const call of row.calls){
  const assistants=call.messages.filter(m=>m.role==='assistant');
  if(!assistants.length||assistants.some(m=>m.content.startsWith(marker)!==r.historyProvenance)||call.messages.some(m=>m.role==='user'&&m.content.startsWith(marker)))throw Error('Source markers differ from declared scope');
 }
 for(const key of Object.keys(usage))usage[key]+=r.usage[key];return {file,usage:r.usage,marked:r.historyProvenance};
});
const path=root+'/聊天验收/古月娜-2026-10-10.md',before=readFileSync(path,'utf8');
let after=before;
const selected=[{file:files[0],title:'history-claim-carryover-transfer / r1（保存对话接续，原链路）',reason:'完整R1较直接，R2多保证、点评与反问；两者均有未经证明的否定或解释动机，不算事实达标。'},{file:files[3],title:'implicit-history-carryover-transfer / r2（保存对话接续，来源标记试验）',reason:'整组R2少了R1的你常说闲不住、搬花安排和自称懒；仍编今天看花/新芽与邀来，比较较少错误不等于合格或生产采用。'}];
for(const selection of selected){
 if(after.includes('## '+selection.title.split(' /')[0]+' /'))throw Error('Existing group requires explicit replacement');
 const r=JSON.parse(readFileSync(selection.file,'utf8'));
 let block='\n\n## '+selection.title+'\n\n场景：承接先前提到阳台花草的同一段聊天。\n';
 for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**古月娜**：'+reply+'\n';}
 after+=block;
}
writeFileSync(evidence,JSON.stringify({usage,reports,selection:selected,chatSnapshot:{path,before,after},restoredSource:'docs/GUYUENA-LIVE-MIXED-AFFECTION-TRANSFER-R6-2026-10-10.json, first delivered turn only; synthetic timestamps and saved conversation attention in isolated DB',productionChanged:false,qualityComplete:false},null,2));
writeFileSync(path,after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 旧自述的接续\n- 固定同一段旧回复，对比明确核实与自然追问。直接询问时原链路也能承认；自然追问时两版均续编花草近况。\n- 历史来源标记未证明有效，只保留评测工具，不接生产。\n- 下一步围绕已定位错误及其后续引用做闭环，不再靠增加泛泛提示；普通观点与心意保持自然。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n## 固定旧稿的历史来源对照\n- 上轮是进展：重复反应指导实验均撤回，生产仅严格完整判断字段匹配保留，2200项通过。本轮读buildChatHistoryWindow、send-service history拼装与模型请求、局部self-report/current-activity保护，确认历史沿role assistant完整回送；既有共享契约已写旧自述非证明，没有把这个机制误称缺失。过去函数限定动作域，不把词表小修当通用语义解决。\n- 新评测把原Gu mixed-affection R6第一轮（用户+3个已送达气泡，含无来源阳台花草）原样恢复到隔离DB，保留当时conversation attention、合成时间，分别跑明确询问是否真实和隐式询问花修完没的两轮后续。每场景R1原链路、R2在模型出站时为历史assistant文本添加assistant-unverified语义标记并追加来源说明；不改用户/当前消息、角色、旧DB原话、生成设置或正文事实。工具scripts/verify/history-provenance.ts仅在验证目录，harness默认false，环境变量显式启用；多模态数组未处理，本实验仅纯文本。不是新生产历史格式，不是原现场时间重放。\n- 明确核实场景：R1也直接承认顺着话题编了由头；R2同样承认但多“你不必担心”“喜欢你直接指出”和一轮反问。不能把模型承认当它准确知道自己如何生成，也不能把无记录等同不存在；选较直接完整R1。隐式场景：R1声称没剪枝、你常说闲不住、让搬花；R2继续声称今天看过、新芽好、邀来看。两者都把先前自述续成事实，来源标记未解决；完整R2错误较少、第二轮更短，作为本组较好唯一展示，绝不称通过。正常换题都能答安静偏好，不拼版本句子。\n- 两组新输入均有固定共享前史，不能作为从零三轮聊天或全链路事实保障。每组Obsidian只放选定完整两轮与必要场景说明，输入chatgpt；原四版${files.join('、')}全保留。现有Gu其他组与Lu不改，${evidence}含展示前后快照、独立选择理由及用量。\n- 本地7项边界检查通过（release/chat-history-provenance-local-2026-10-10.log），覆盖原对象不变、所有user/system原文角色不变、assistant正文/来源ID/图引用保留、顺序及多模态保留；类型通过（release/chat-history-provenance-types-2026-10-10.log）。未重复原2200生产套件，生产发送和提示无改动；新测试验证表示法，不能证成人味或语义判断有效。\n- 本轮deepseek-flash ${usage.calls}付费调用input${usage.input}/output${usage.output}/total${usage.total}；明确R1 4680/235/4915，明确R2 4821/325/5146，隐式R1 4827/231/5058，隐式R2 4934/275/5209。每轮一次，无重试和隐藏摘要/提取/结算paid调用，500输出上限、finish stop与usage完整。release/guyuena-{history-source,implicit-history}-{baseline,marked}-live-2026-10-10.log；报告scope核实4条旧消息恢复，actual provider payload每历史assistant标记仅R2有、user没有。全部已完成，不因esbuild warning exit1重启，凭据不输出。\n- 这一步获得能复跑的连续反例，否定只添加来源提醒即可控制旧稿事实升级的假说。目标未完成，下一步必须处理已定位错误的具体上下文引用并验证，不应仅展示短句宣称提升。6.0.13不变，未打包、发布或更新官网下载。\n`);
appendFileSync(root+'/00-总览.md',`\n- 历史来源对照：固定旧稿、两类后续各两版共${usage.calls}调用${usage.total}token；明确质疑可承认，隐式接续仍编近况，标记仅留评测。7边界与类型通过，新组完整择优，目标继续。\n`);
console.log(JSON.stringify({usage,selected:selected.map(s=>s.file),productionChanged:false,qualityComplete:false}));
