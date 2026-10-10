import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-mixed-affection-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Do not replace evidence');
const files=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-MIXED-AFFECTION-TRANSFER-R1-2026-10-10.json`);
const usage={calls:0,input:0,output:0,total:0};
const decisions=files.map(file=>{
 const r=JSON.parse(readFileSync(file,'utf8'));
 if(!r.complete||r.rows.length!==2||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Complete bounded actual dialogue required');
 const system=r.rows[0].calls[0].messages.find(m=>m.role==='system')?.content;
 if(!system?.includes('用户直接表达了心意，接他这次说的想念、喜欢或爱'))throw Error('Current direction missing from actual request');
 for(const key of Object.keys(usage))usage[key]+=r.usage[key];
 const path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
 if(before.includes('## mixed-affection-transfer'))throw Error('Existing whole group requires explicit comparison');
 let block='\n\n## mixed-affection-transfer / r1（生产对话）\n';
 for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';}
 return {selected:file,path,before,after:before+block,reason:'新全输入组每角色只生成一次，完整保留，不拼句；仅本场景观察，非多版因果对照。',limitations:'收尾仍有忙完来找我/别急等多余照顾或要求；未证明长聊、所有语气及小说喜好表现。'};
});
writeFileSync(evidence,JSON.stringify({usage,decisions,retainedChange:'Accurate common affection direction for actual longing, liking or love, rather than labelling every declaration as liking; explicit character boundaries preserved.',diagnosis:'Existing actual mixed turn already routed to affection. No parser bug or new feeling keyword added.',qualityComplete:false},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 接具体心意，不点评表达方式\n- 混合句原本就走亲密分支；修正把所有心意写成喜欢的指导，想念、喜欢、爱按当下原话接，拒绝边界仍保留。\n- 两人新两轮直接回应想念并收尾，未添往事与家人；古月娜短、陆雪琪含蓄，仍有多余照顾和回访要求，继续验证。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n## 混合表达中的具体心意\n- 上轮是进展：日常指导实测未可靠改善已撤回，只留Lu亲密接续与旧自有精确迁移。本轮先假设“喜欢听观点+想念”可能错分；读取actual Gu ordinary-closeness R2第三轮系统，发现确已respond-affection、亲密反应，否定此假设，不误改词法。实际不准确处是DIRECT_AFFECTION_DIRECTION把喜欢、想念、爱统一写作“用户直接表达了喜欢”。\n- 更改共享方向为接原话具体心意、说自己的真实感受与态度，不点评来聊天、说话方式或坦率程度；仍按人物和关系并可说明界限，不强制相同爱意，保持消息而非共同现场。无新关键词识别，无额外模型层，不改任何角色原文或版本。\n- 新增12项混合语句、喜好/第三方/引用负例检查。最终chat-expression2123项通过（release/chat-mixed-affection-expression-r4-2026-10-10.log）；chat-policy81数据+18实际编辑表单通过（release/chat-mixed-affection-policy-2026-10-10.log）；类型通过（release/chat-mixed-affection-types-2026-10-10.log，session81746实际poll确认终止）。初测失败于旧措辞断言：先“这轮说你自己的感受”，再“是否愿意靠近或你需要的界限”；改为完整导向常量的接线检查与当前“也可以坦率说明界限”加原不愿成为恋人人设的边界检查，未删除分支/不迎合要求。r2/r3失败日志保留，测试绿不算模型评分。\n- 新mixed-affection-transfer每人2轮，仅各生成一次；首轮沿已认领身份，混合“喜欢听想法”和“有点想你”，第二轮开心后告别。实际payload有新指导；Gu简短“我也想你”与愿意说，Lu“我也想你”与静、欢喜，随后收尾；无具体旧事或询问孩子。仅新场景观察，不是与旧四轮相同完整输入比较，前文环境不同、模型随机，不能说提示变化独立导致改善。\n- 尚存Gu忙完来找我、Lu别急/忙完说话稍多余，Lu心里很静较书面。这只是本组较自然且事实没有增补，不称完整人味达标或全部情绪问题已修复。${files.join('、')}；release/{guyuena,luxueqi}-mixed-affection-live-2026-10-10.log；选择与展示前备份${evidence}。新输入组全组仅一版，输入chatgpt，对话不混分析，优化方向简短，旧失败不被覆盖。\n- 本轮4次deepseek-flash付费input${usage.input}/output${usage.output}/total${usage.total}；Gu4850/178/5028，Lu7581/162/7743。每轮一次，无重试，500输出上限，finish stop和usage完整。actual private/隔离IndexedDB，非流式上游，摘要/提取/结算替身；非Android和长聊。不因esbuild警告exit1重启，凭据不输出。\n- 完整目标仍未完成：古月娜原著喜好、连续日常、人物差异与事实稳定性需更多当前状态证据。6.0.13不变，无打包、发布或官网下载更改。\n`);
appendFileSync(root+'/00-总览.md',`\n- 具体心意指导：2123项、81数据+18表单与类型通过；两人两轮4调用${usage.total}token，直接回应想念、未补往事。非长聊结论，整组分开存，目标继续。\n`);
console.log(JSON.stringify({usage,selected:files,qualityComplete:false}));
