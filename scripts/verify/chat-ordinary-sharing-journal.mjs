import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const vault='D:/月起云归/VirtuGene/手机版', evidence='release/chat-ordinary-sharing-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Preserve existing selection evidence');
const files=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-ORDINARY-SHARING-TRANSFER-R1-2026-10-10.json`);
const correctedFiles=files.map(file=>file.replace('R1','R2'));
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8'))),corrected=correctedFiles.map(file=>JSON.parse(readFileSync(file,'utf8')));
const usage={calls:0,input:0,output:0,total:0};
for(const report of [...reports,...corrected]){
 if(!report.complete||report.rows.length!==3||report.usage.missingUsage||report.rows.some(row=>row.failed||row.calls.some(call=>call.finish!=='stop')))throw Error('Complete real dialogue required');
 for(const key of Object.keys(usage))usage[key]+=report.usage[key];
}
const decisions=reports.map((report,index)=>{
 const system=corrected[index].rows[1].calls[0].messages.find(message=>message.role==='system')?.content;
 if(!system?.includes('不必证明自己是怎样的倾听者'))throw Error('Repaired guidance missing');
 if(report.rows.some((row,i)=>row.input!==corrected[index].rows[i].input))throw Error('Same inputs required');
 const path=`${vault}/聊天验收/${report.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
 if(before.includes('## ordinary-sharing-transfer'))throw Error('Existing group needs comparison');
 let block='\n\n## ordinary-sharing-transfer / r1（生产对话）\n';
 for(const row of report.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+report.roleName+'**：'+reply+'\n';}
 return {path,before,after:before+block,selected:files[index],notSelected:correctedFiles[index],reason:index===0?'R2第二轮较短，但第三轮更长且像讲理；R1整组更简洁。':'R2多问别的想说什么，末轮“谁让，我都不会让”逻辑不清；R1关系表达与观点更连贯。',limitations:'R1也有过多追问、解释和论述；仅整组选优，不能证明全面达标。'};
});
writeFileSync(evidence,JSON.stringify({files,correctedFiles,usage,decisions,qualityComplete:false,scope:'Two rounds per role, fresh three-turn private send-service conversations in isolated IndexedDB; nonstream upstream, summary/extraction/settlement mocked. R1 missed clarification routing, R2 actual payload verifies repair; histories differ, not an isolated causal test.'},null,2));
for(const decision of decisions)writeFileSync(decision.path,decision.after);
appendFileSync(vault+'/优化方向/2026-10-10.md','\n\n## 分享本身与关系反应\n- 更正交流用意后接内容与心意，不自证会倾听；“倒也不用鼓励”已补接线，转述、假设、否定不误触发。\n- 真实复测接线生效，但两人新整组未更好：多问、长论述、陆雪琪末句逻辑不清；仅展示较好R1整组，继续优化。\n');
appendFileSync(vault+'/开发日志/2026-10-10.md',`\n\n## 分享用意：实际接线缺口与复测限制\n- 上轮仅范围记录。本轮修改chat-humanizer respond-clarification指导：用意作为交流边界，接内容和心意，不解释分享作用、不证明倾听者身份；仍保留自己的感受与不同意见。不加调用层，不改人设或版本。\n- 首轮新ordinary-sharing-transfer：开心的小成果→不求鼓励而分享→意见不同的假设，Gu/Lu各三轮。归档前检查实际payload发现“倒也不用鼓励”未识别，R1并未走新指导。此前看回复较好不等于接线有效，已更正。归档脚本检查失败发生在任何文件写入前，无错误日志写进Obsidian。\n- chat-turn-cues对直接拒绝安慰允许倒也/其实/真的/真/那前缀，仍整句匹配；新增正例与转述/假设/否定反例，本地2076项通过、类型通过。首次2064验证失败于改写指导后原有字串断言；恢复原句再通过，失败原日志保留。最终日志release/chat-ordinary-sharing-prefix-verified-2026-10-10.log及-types-2026-10-10.log。\n- R2同序列Gu/Lu各三轮，第二轮真实payload均含新指导，证明接线。Gu第二轮简短，但首轮仍问细节，末轮三条讲理；Lu第二轮额外问还有什么，末轮“谁让，我都不会让”逻辑不清，可能将人设原则生硬迁移。R2整组未更好，两角色各展示完整R1，不拼不同版本好句；全部R2仍保留项目证据。当前指导本地正确不证明整体表达质量提高，不能宣布完成。后续重点是减少无必要讲理与原则套用，保留人物当下立场。\n- 本轮12次deepseek-flash付费调用input${usage.input}/output${usage.output}/total${usage.total}，R1六次19967，R2六次20246。Gu六次15259/846/16105；Lu六次23331/777/24108。每轮一次，无质检重试，500输出上限，usage完整、finish stop。不因PowerShell esbuild警告exit1重跑，已核实报告complete及终端终止。\n- 原证据${[...files,...correctedFiles].join('、')}；展示前备份与选择理由${evidence}；模型日志release/{guyuena,luxueqi}-ordinary-sharing[-prefix]-live-2026-10-10.log。输入chatgpt，对话与方向、技术记录分开；凭据不输出。\n- actual private/隔离IndexedDB，摘要、提取、结算替身，非Android、非真实流式与长聊。目标继续，6.0.13不变，无打包、发布、官网下载更新。\n`);
appendFileSync(vault+'/00-总览.md',`\n- 分享前缀接线：2076项与类型通过，两角色同输入复测确认实际指导；12调用${usage.total}token。R2整组未更好，只展示较好R1，长论述与原则套用仍待优化。\n`);
console.log(JSON.stringify({usage,selected:files,qualityComplete:false}));
