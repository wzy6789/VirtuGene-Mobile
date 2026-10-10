import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-sharing-correction-live-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Existing evidence must not be overwritten');
const files=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-QUIET-DISAPPOINTMENT-TRANSFER-R2-2026-10-10.json`);
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
const usage=reports.reduce((a,r)=>({calls:a.calls+r.usage.calls,input:a.input+r.usage.input,output:a.output+r.usage.output,total:a.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const decisions=reports.map((r,index)=>{
 if(!r.complete||r.rows.length!==3||r.usage.missingUsage||r.rows.some(row=>row.failed))throw Error('Complete actual report required');
 if(!r.rows[1].calls[0].messages.find(m=>m.role==='system').content.includes('用户正在更正这次交流的用意'))throw Error('Actual correction request missing');
 const oldFile=files[index].replace('R2','R1'),old=JSON.parse(readFileSync(oldFile,'utf8'));
 if(r.rows.some((row,i)=>row.input!==old.rows[i].input))throw Error('Different input sequence');
 const path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
 const heading='## quiet-disappointment-transfer / r1（分享意图接续修复前，生产对话）',start=before.indexOf(heading);
 if(start<0)throw Error('Prior displayed group missing');
 const next=before.indexOf('\n## ',start+heading.length),end=next<0?before.length:next;
 let block='## quiet-disappointment-transfer / r2（生产对话）\n';
 for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';}
 return {path,before,after:before.slice(0,start)+block+before.slice(end),selected:files[index],previous:oldFile,reason:index===0?'R2没有R1的等了一阵子时长，也不再讲分享会变轻；自己的愿意听更明确。仍有我不是只听大事的人解释和末轮补问，不称整体达标。':'R2没有R1的惦记许久；接分享时短而自然，末轮保留独立观点。首轮准备着去仍扩大期待含义，心意表达平淡，不称整体达标。'};
});
writeFileSync(evidence,JSON.stringify({files,usage,decisions,productionChangesThisTurn:0,scope:'One fresh same-input rerun per role; actual correction guidance confirmed, different generated prior histories mean not a controlled isolated causal test',qualityComplete:false},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 分享更正的真实接续\n- 两人第二轮确实接回愿意听小事的心意，不再解释分享会减负；整组R2替换旧R1。\n- 仍有多余解释、追问和把期待扩大成准备，不能凭一次较好组判定稳定。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 分享意图接续的同输入复测\n- 上轮为进展：人物自身反应指导与拒绝安慰+明确分享的意图识别实际修改，2064项通过但更正后尚未实测。本轮读取当前代码和终端通过证据，保留正式去重关闭，Gu/Lu各完整重跑quiet-disappointment-transfer三输入一次，不调角色原文、不加更多禁令、不多次生成挑好稿。\n- 实际两人第二轮payload均含respond-clarification指导；Gu回应乐意听小事，未延续R1“说出来就轻一点”推断，Lu回应愿意告诉她的心意。第三轮跟随作品问题，普通偏好与假设没有被强制绕回安慰。首轮没有旧R1等一阵子/惦记许久；这只是本组减少的错误，不能说所有隐含时长问题解决。\n- 尚存：Gu第二轮“我不是只听大事的人”略解释式、第三轮额外追问；Lu“准备着去”由期待扩大为准备行为，亲近反应仍偏淡。系统接线可核实，但两版前文原稿不同且模型随机，不能将所有差异定为单一改动的因果效果。无需因较好结果结束全目标，长期性格、源外细节和多种场景仍需证据。\n- 两人整组R2各替换同输入R1，全部原始文件和旧展示备份见${evidence}，不拼句，不保留同组多版展示；输入chatgpt，优化方向简短且与对话分开。原证据${files.join('、')}；release/{guyuena,luxueqi}-sharing-correction-live-2026-10-10.log。\n- 本轮6真实调用input${usage.input}/output${usage.output}/total${usage.total}；Gu7586/412/7998，Lu11525/344/11869。deepseek-flash每次500输出上限，各三轮每轮1调用无重试，usage完整、stop。非流式actual private/隔离IndexedDB，摘要/提取/结算替身，非Android与长聊。现有生产2064和类型已通过，本轮无生产变更，因此不重复全套测试。PowerShellexit1是esbuild警告，Gu实时session终止与报告complete核实后读取，没有重复启动。凭据不输出/落盘。\n- Gu累计543展示/85回放/461付费，输入1420426/输出54611/总1475037；今日195调用516436。Lu本轮新增3实际调用11869。目标未完成。6.0.13不变，不打包、不发布、不更新官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 分享更正复测：两人实际第二轮接线确认，R2整组入选替换R1；6调用19867token，仍有表达/细节限制，不声称全面达标。\n');
console.log(JSON.stringify({usage,selected:files,qualityComplete:false}));
