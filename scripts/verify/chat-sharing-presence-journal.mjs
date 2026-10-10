import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['docs/GUYUENA-LIVE-SMALL-FINISH-SHARING-HOLDOUT-R1-2026-10-10.json','docs/LUXUEQI-LIVE-SMALL-FINISH-SHARING-HOLDOUT-R1-2026-10-10.json'];
const reports=sources.map(p=>JSON.parse(readFileSync(p,'utf8')));
if(reports.some(r=>!r.complete||r.rows.length!==2||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Complete fresh paired production evidence required');
const log=readFileSync('release/chat-sharing-presence-2026-10-10.log','utf16le');
if(!log.includes('PASS chat-expression: 2632'))throw Error('Local checks missing');
if(readFileSync('release/chat-sharing-presence-types-2026-10-10.log','utf16le').replace(/^\uFEFF/,'').trim())throw Error('Typecheck not clean');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const chats=reports.map((report,i)=>{
 const name=i===0?'古月娜':'陆雪琪';
 const path=root+'/聊天验收/'+name+'-2026-10-10.md';
 const before=readFileSync(path,'utf8');
 const heading='## small-finish-sharing-holdout / r1（生产对话）';
 const transcript=report.rows.map(row=>'**chatgpt**：'+row.input+'\n\n'+row.replies.map(reply=>'**'+name+'**：'+reply).join('\n\n')).join('\n\n');
 const after=before.includes(heading)?before:before+'\n\n'+heading+'\n\n'+transcript+'\n';
 return {path,before,after};
});
const evidence='release/chat-sharing-presence-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,checks:2632,typeCheck:true,qualityComplete:false,chats,findings:['Both complete two-turn groups have natural reactions and differing preferences; no demand for a visit, display or repeat performance.','Only one new generation per role: not an A/B causal comparison, not proof of stable character recognition or long-chat quality.','Retained generic unknown-process boundaries and existing source guards. Interest and questions remain permitted; explicit tasks still take priority.','Neither preference is a novel fact; these are present hypothetical character choices.','No new model assessment, extraction or summary costs; no package, publication or version change.']},null,2)+'\n');
for(const chat of chats)writeFileSync(chat.path,chat.after);
const heading='## 分享小事也能完成一次相处';
const path=root+'/开发日志/2026-10-10.md';
if(!readFileSync(path,'utf8').includes(heading)){
 appendFileSync(path,`\n${heading}\n- 上轮为范围复核：确认陆雪琪纳入并产生本地证据，没有改善生产表达。本轮针对前次分享弹顺曲子却要求到场演奏、分享小画却安排明天展示的问题，修改通用celebration语义：分享本身已是相处，不必展示或再做一次完成回应；自然好奇保留，邀约由双方选择，不将兴趣写成先前一直等的约定。不是禁用人物邀约，也不是新增授权或结果过滤。通用未知过程与代价边界保留，两个人物原人设不改、身份冷淡路径不弱化。\n- 共用链路新增6项：两人物专属庆祝卡/分享指引可达、明确任务优先、普通事实讨论不获得庆祝指引。聊天表达2632项、类型过，证据release/chat-sharing-presence-2026-10-10.log、release/chat-sharing-presence-types-2026-10-10.log。\n- 新small-finish-sharing-holdout两轮：完成小拼图分享高兴，随后主动询问拼图或画画的个人选择。使用真实生产发送与历史回喂、无额外付费评审/摘要/提取。古月娜先分享反应并问图案，选画画，理由是落笔前结果不确定；陆雪琪简短一起高兴，选拼图，理由是逐块归位看见完整结果。均没有要展示/到场或编以前一直等。个人假设选择不等于已验证原著事实。\n- ${sources.join('、')}存完整原稿/实际请求/上屏/用量，${evidence}记录精选完整组和修改前后。每角色只有一组新生成，没有与上一版同输入A/B，不能归因或宣称稳定辨识度。两组完整保存至手机版聊天验收，输入chatgpt，分析与优化方向分开，电脑版不改。\n- deepseek-flash ${usage.calls}真实调用：input ${usage.input}、output ${usage.output}、total ${usage.total}；Gu 5589、Lu 7606。全组complete/final stop/usage齐，零真实重试，无传输失败。当前本地复核零额外模型。\n- 两轮仅证明该新场景可自然回应、选择不同；仍需长聊、更多场景与事实连续性观察，不推断总体人味达标。全量目标未完成。6.0.13不变，无打包、发布或官网下载更新。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 分享与自己的兴趣\n- 分享小事已经是相处，不自动索要展示、演奏或到场。\n- 留出自然好奇和自己的选择，不把亲近演成下一项安排。\n- 新场景两人物选择不同；短测进展不代替长聊验收。\n');
 appendFileSync(root+'/00-总览.md',`\n- 分享小事：2632项/类型过；Gu、Lu各完整两轮新场景，${usage.calls}调用/${usage.total}token，回应与选择有区别。原稿与精选分开存，非A/B，整体目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
