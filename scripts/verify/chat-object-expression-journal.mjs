import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['docs/GUYUENA-LIVE-ORDINARY-TASTE-HOLDOUT-R1-2026-10-10.json','docs/LUXUEQI-LIVE-ORDINARY-TASTE-HOLDOUT-R3-2026-10-10.json'];
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Actual final transport evidence missing');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const selections=reports.map((r,i)=>{
 const name=i?'陆雪琪':'古月娜';
 const path=root+'/聊天验收/'+name+'-2026-10-10.md';
 const before=readFileSync(path,'utf8');
 const heading=`## ordinary-taste-holdout / ${i?'r3':'r1'}（生产对话）`;
 const transcript=r.rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**'+name+'**：'+reply).join('\n\n')}`).join('\n\n');
 const section='\n'+heading+'\n\n'+transcript+'\n';
 const start=before.indexOf('\n## ordinary-taste-holdout /');
 const end=start<0?-1:before.indexOf('\n## ',start+4);
 const after=start<0?before+'\n'+section:before.slice(0,start)+section+(end<0?'':before.slice(end));
 return {path,before,after};
});
const evidence='release/chat-object-expression-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,checks:2575,typeCheck:true,policyChecks:{data:81,realEditForms:18},qualityComplete:false,selections,findings:['Gu具体表达不声张的怪趣味，Lu以顺手稳妥为先，未新编孩子/天气/过往相处。','Lu仍替用户推测选择依据、用修行概括器物，Gu仍评论用户喜欢方式；不是稳定人味完成证据。','LuR3整组比R2无无关家庭假设与成语，替换整组R2；所有历史原稿项目保留。']},null,2)+'\n');
for(const s of selections)writeFileSync(s.path,s.after);
const heading='## 表达落在事物上：共用提示去重';
const log=root+'/开发日志/2026-10-10.md';
if(!readFileSync(log,'utf8').includes(heading)){
 appendFileSync(log,`\n${heading}\n- 上轮有进展：Lu关系上下文减重与不同选择接线改变生产状态、真实对照暴露新的问题。本轮先读共享契约与directChatGuidance实际代码，发现本人偏好并允许不同选择时，会叠具体偏好与通用看法两段重复提示；元交流说明过多、正在谈的器物被挤到后面。\n- directChatGuidance已找到independentPreference就不再叠通用isViewExchange段；没有确立本人偏好的实际观点问题继续用原路径。共用客户端/网关契约原有情绪行调整为反应与立场落在具体事物上，不必再解释怎样接话/接住心意。不是限制情绪、取消亲近或一概禁止比喻。\n- 新2项方向去重/普通观点保留，本地最终2575项（release/chat-object-expression-local-final-2026-10-10.log），类型（release/chat-object-expression-types-2026-10-10.log）过；chat-policy81数据与18实际编辑页（release/chat-object-expression-policy-2026-10-10.log）过。初次新测试用了未被isViewExchange支持的“怎么分”，改为实际已有支持的“你怎么看”后通过；失败日志保留，不通过改阈值掩盖生产错误。\n- 真实杯子双角色两轮：GuR1说夸张手柄像张牙舞爪的手，偏好不声张、细节藏怪趣味；LuR3先看握稳/顺手，保持不同立场。两组无新家庭往事、近期天气或重复追究身份；两位对象关注有区别。Lu第二句仍猜用户多半按合意而非奇怪选择，第三句转整齐修行类观点；Gu开头“说得过去”仍像点评。不能凭两轮宣布长期人物鲜明或人味达标。\n- ${sources.join('、')}保存原始请求、输出、上屏与调用，${evidence}含两份聊天文件更新前后全文与取舍。Gu本组唯一整组R1首次保存；Lu整组R3替代之前整组R2，未拼接好句，R1/R2/R3原稿项目全留。Obsidian原话仅chatgpt/角色/场景，优化方向单独简要记录，电脑版不改。\n- deepseek-flash共${usage.calls}调用/input${usage.input}/output${usage.output}/total${usage.total}，Gu2次5327token、Lu2次7573token，无额外付费审核、摘要或提取，无质检重试；两进程均terminal，报告complete/final stop/usage齐；warning退出1未因退出码重跑。policy真实浏览器session43862已poll至exit0，非只看日志认定结束。\n- 下一步复用实际失败处理推测他人偏好理由与人物自己的具体反应，补未测内容而非反复同杯子；人物熟悉原著、长聊稳定、复杂身份与跨入口表现仍有未验证项。目标保持活跃，6.0.13未变，未打包发布或更新官网。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 表达落在事物上\n- 本人偏好已明确时，用一份具体方向，减少元交流提示重复。\n- 让情绪与趣味来自事物细节；少点评对方、少推测他选择的理由。\n- 保持两位自己的关注点，避免所有话题都转成家庭或修行。\n');
 appendFileSync(root+'/00-总览.md',`\n- 具体表达/提示去重：2575检查、类型、policy81+18通过，${usage.calls}调用/${usage.total}token。Gu杯子整组R1/Lu整组R3保存，人物差异初显但有推测与点评，目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
