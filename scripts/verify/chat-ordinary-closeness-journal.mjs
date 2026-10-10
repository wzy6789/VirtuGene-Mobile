import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-ordinary-closeness-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Preserve existing evidence');
const usage={calls:0,input:0,output:0,total:0};
const decisions=['GUYUENA','LUXUEQI'].map((role,index)=>{
 const files=[1,2].map(n=>`docs/${role}-LIVE-ORDINARY-CLOSENESS-TRANSFER-R${n}-2026-10-10.json`);
 const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
 for(const r of reports){
  if(!r.complete||r.rows.length!==4||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Completed real source required');
  for(const key of Object.keys(usage))usage[key]+=r.usage[key];
  if(r.rows.some((row,i)=>row.input!==reports[0].rows[i].input))throw Error('Identical whole inputs required');
 }
 const changedSystem=reports[1].rows[0].calls[0].messages.find(m=>m.role==='system').content;
 if(!changedSystem.includes('闲聊反应：'))throw Error('Experimental ordinary field missing from actual request');
 if(index===1&&!reports[1].rows[2].calls[0].messages.find(m=>m.role==='system').content.includes('不为接话转问家人近况'))throw Error('Intimacy guidance missing');
 const selected=index===0?reports[1]:reports[0],selectedFile=files[index===0?1:0];
 const path=`${root}/聊天验收/${selected.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
 if(before.includes('## ordinary-closeness-transfer'))throw Error('Do not duplicate this whole group');
 let block=`\n\n## ordinary-closeness-transfer / ${selected.revision}（${index===0?'闲聊试验对话':'生产对话'}）\n`;
 for(const row of selected.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+selected.roleName+'**：'+reply+'\n';}
 return {files,path,before,after:before+block,selected:selectedFile,reason:index===0?'R2少了R1旁边有你和能在门口接应的共同现场、告别更自然；仍猜又心不在焉且想念回应欠直接，整组有限择优。':'R2亲密两句更好，但首轮新增无来源忘带物品经历；R1没有该具体自传，保留R1整组，不拼两句。',qualityComplete:false};
});
writeFileSync(evidence,JSON.stringify({usage,decisions,retained:'Lu intimacy stays with present conversation rather than automatically switching to family inquiry; exact old owned persona v10 frozen for migration.',reverted:'Ordinary reaction field support and both app-owned ordinary descriptions, plus temporary Gu head compaction. Final production has no new ordinary field.',scope:'Two four-turn fresh private-send groups per role. Earlier generated histories and model randomness differ; not isolated causality. Final Lu intimacy-only state locally verified but not a new paid whole-group run.',qualityComplete:false},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 日常与亲近的整组复测\n- 两人四轮从小失误、个人好恶、想念到告别；仍见评价失误、猜原因、补自传和共同现场。\n- 闲聊反应新增指导未可靠改善，已撤回；保留陆雪琪亲密回应沿眼前交流，不为接话转问家人。\n- 新稿亲密句较好也不拼入旧组；后续同时看自然语气与资料外经历，不只追短句。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n## 日常亲近四轮：试验、撤回与陆雪琪亲密接续\n- 上轮是进展：4项语义来源校准与旧稿纠正，但修正仍像文学评语，尚未上线审核。本轮换普通四轮输入：拿错钥匙的笑点→并非累或生气的安静偏好→喜欢听自己的想法且想念→告别。Gu/Lu基线各一次R1，新指导各一次R2，不重复抽稿挑句子。\n- 基线暴露Gu补门口接应、身旁有你，Lu冷调侃、清静背景论述、回应想念后转问孩子。尝试闲聊反应字段并让ordinary声音卡有对应表达；Gu闲聊笑点、Lu平常措辞与好恶，同时调整Lu亲密反应保持眼前两人的交流。不强迫固定句数、emoji或称呼。R2实际首轮payload有闲聊字段、Lu第三轮含不为接话转问家人近况。\n- R2并未整体更好：Gu仍猜“又心不在焉”、解释不打扰且没有直接回我也想你；Lu首轮添“我也有过走到半路才发现东西没带”的无来源经历，尽管亲密两句自然且没有转问孩子。已撤回ordinary字段和两个自有闲聊段、恢复Gu原日常描述；只保留Lu亲密接续调整。不把单句改善拼成整组改善，不把部分来源问题当全部已解决。\n- Lu旧当前自有人设冻结src/lib/lu-xue-qi-preset-v10.ts，seed-init精确knownPrompts加入v10，编辑副本不自动覆盖；是提示版本快照，不是APP版本变化。现有声纹哈希随人设变化失效。最终状态2111项chat-expression通过、93项Lu预设检查通过、Gu检查ALL PASS及类型通过，日志release/chat-ordinary-voice-retained-{expression,lu,gu,types}-2026-10-10.log。实验阶段2123通过不拿作最终计数。Gu长度门槛未提高；中间多次失败包括新增字段超1850字、去重删掉原测试断言词、恰好1850超严格小于边界；原失败日志r2-r6与初测均保留，之后1849通过，最终已还原原Gu文本。未隐瞒失败。\n- 选择Gu R2整组（较少共同现场且收尾短），Lu R1整组（没有R2新增具体自传）；两者仍明显有问题，不称人味达标。Gu展示标明试验对话。所有原稿${decisions.flatMap(d=>d.files).join('、')}；选择与展示前备份${evidence}。输入chatgpt，方向和技术记录分开，完整组不拼接。\n- 本轮16次deepseek-flash付费input${usage.input}/output${usage.output}/total${usage.total}；Gu R1 9832/455/10287，R2 9909/421/10330；Lu R1 15184/482/15666，R2 15633/533/16166。各4轮每轮1次无重试，500输出上限，usage完整且finish stop。session59130/83677/31989实际poll确认终止后读报告，没有重复启动。凭据不输出。\n- 最终亲密单点保留状态没有再付费跑完整组，不将R2整个效果说成最终生产效果。实际私聊隔离IndexedDB，摘要/提取/结算替身、非流式模型；不证明Android、真实流式、长聊。模型随机及先前生成历史不同，不能单独证明亲密措辞因果；保留因指导符合当前交流，效果仍待跨场景验证。6.0.13不变，不打包发布，目标未完成。\n`);
appendFileSync(root+'/00-总览.md',`\n- 日常亲近整组：最终2111项、Lu93、Gu及类型通过；16调用${usage.total}token，闲聊指导试验未整体更好已撤回，仅留Lu亲密接续和精确迁移。两角色保留较好完整组，仍待优化。\n`);
console.log(JSON.stringify({usage,selected:decisions.map(d=>d.selected),qualityComplete:false}));
