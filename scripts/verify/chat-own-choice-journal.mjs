import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const paths=[
 'docs/GUYUENA-LIVE-OWN-CHOICE-QUESTION-FOLLOWUP-R1-'+date+'.json',
 'docs/GUYUENA-LIVE-OWN-CHOICE-QUESTION-FOLLOWUP-R2-'+date+'.json',
 'docs/GUYUENA-LIVE-OWN-CHOICE-QUESTION-FOLLOWUP-R3-'+date+'.json',
 'docs/GUYUENA-LIVE-OWN-CHOICE-RHYTHM-HOLDOUT-R1-'+date+'.json',
 'docs/GUYUENA-LIVE-OWN-CHOICE-RHYTHM-HOLDOUT-R2-'+date+'.json',
 'docs/GUYUENA-LIVE-CANON-HOME-CHOICE-RHYTHM-HOLDOUT-R1-'+date+'.json',
 'docs/GUYUENA-LIVE-CANON-HOME-CHOICE-RHYTHM-HOLDOUT-R2-'+date+'.json',
];
const groups=paths.map(path=>({path,...JSON.parse(read(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.usage.missingUsage||g.rows.some(row=>row.failed||!row.replies.length||row.calls.some(call=>call.finish!=='stop'))))throw Error('Completed real dialogue evidence required');
const baseline=JSON.parse(read('docs/GUYUENA-LIVE-MIXED-HOME-CONTINUITY-HOLDOUT-R1-'+date+'.json','utf8'));
const count=baseline.rows.slice(0,2).reduce((n,row)=>n+1+row.replies.length,0);
if(groups.slice(0,3).some(g=>g.rows.length!==1||g.restoredMessageCount!==count||g.rows[0].input!==baseline.rows[2].input))throw Error('Unchanged original two-turn diagnostic required');
const systemOf=g=>g.rows[0].calls[0].messages.find(m=>m.role==='system').content;
if(groups.slice(0,2).some(g=>systemOf(g).includes('这一轮是在问你的想法'))||!systemOf(groups[2]).includes('这一轮是在问你的想法'))throw Error('Actual final prompt and earlier absence required');
if(groups[6].rows.length!==1||groups[6].rows[0].input!==groups[5].rows[1].input||groups[6].rows[0].calls.length!==2||!groups[6].rows[0].calls[0].replayed||groups[6].usage.calls!==1||groups[6].rows[0].calls[0].raw!==groups[5].rows[1].calls[0].raw||groups[6].rows[0].calls[1].replayed)throw Error('Exact old paid draft and one actual repair required');
const usage=groups.reduce((sum,g)=>({calls:sum.calls+g.usage.calls,input:sum.input+g.usage.input,output:sum.output+g.usage.output,total:sum.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
if(usage.calls!==16||usage.total!==49764)throw Error('Actual usage does not match');
const checks=JSON.parse(read('release/chat-own-choice-checks-'+date+'.json','utf8'));
if(!checks.pass||checks.rows.length!==5||checks.rows.some(row=>row.code!==0))throw Error('Final production checks required');
const logs=Object.fromEntries(checks.rows.map(row=>[row.name,read(row.log,'utf8')]));
if(!logs.expression.includes('PASS chat-expression: 3013 checks')||!logs.gu.includes('252 assertions')||!logs.lu.includes('PASS luxueqi-preset: 123')||!logs.stream.includes('PASS chat-stream: 176 checks')||logs.types.trim())throw Error('Final check content missing');
const evidence='release/chat-own-choice-evidence-'+date+'.json';
write(evidence,JSON.stringify({usage,checks,groups:groups.map(g=>({path:g.path,scope:g.scope,usage:g.usage,rows:g.rows.map(row=>({input:row.input,replies:row.replies}))})),selectedWholeDaily:paths[4],selectedWholeCanon:paths[5],selectedSingleChoiceDiagnostic:paths[2],selectedSingleRepairDiagnostic:paths[6],qualityComplete:false,causalNaturalnessImprovementProven:false,limits:['All three fixed choice continuations omitted a repeated question, including the unmodified baseline; not causal proof.','The intermediate soft cue was absent from the actual prompt because lexical topic distance skipped it; final cue verified present.','Final four-turn daily dialogue still asks the user opinion in turn three, but not repeated data completion after actor choice.','Original novel-background group contains an unsupported remembered tease; it is retained whole, not patched with the repair.','One exact-draft repair proves a path through the current inspector and budget, not stable whole-dialogue improvement.','Still unresolved: general semantic memory scope, full source-aware personality fidelity and long-chat stability; Lu Xueqi has local regression checks only this round.']},null,2)+'\n');
const heading='## 人物自己的回答与原著日常：接续和旧玩笑来源';
const journal=root+'/开发日志/'+date+'.md';
if(!read(journal,'utf8').includes(heading))append(journal,`\n${heading}\n\n- 前一轮用户授权发布6.0.18已真实完成，是权威发布状态的进展；本轮回到持续聊天目标，不继续打包、改版本或发布。中途工具调用被打断，重新观察同一实时验证句柄确认其终止及完整原稿，没有重启已完成的付费运行。用户补充审查应结合原著背景和说话风格。\n- 单次细节问句后的节奏提示原来排除question模式，且关键词距离会把“陶瓷更正→颜色选择”误判成新话题。新增人物受邀说自己的取舍时的可选接续提示，只在前一真实回复轮有实质提问时出现，明确换话题、引用、转述、否定和任务保持边界。保留具体好奇和必要澄清；无额外模型评审、禁止问句或标点压平。\n- 固定恢复旧十轮的原始前两轮，三次只新生成第三轮，不改历史：R1未修改时没有再问；R2初版提示因推断换题未进入实际请求，也未再问但把摆件写成颜色多；最终R3实际请求明确包含新提示，答自己的简单偏好，无回问。不能根据这三次证明提示导致改善。最初测试把“算运气吗”当成显式人物选择，暴露该启发式识别边界，缩回已明确支持的选择/观点表达；完整原始历史回归补入，避免只测空history。失败日志均保留。\n- 伞面四轮日常R1在说自己偏好后又问“你呢”；最终R2该轮自己说图案偏好，后续能保留彼此不同的趣味、接轩宇画龙设想。仍有第三轮“你说呢”、景象比喻，不是所有问句都应删除，也不能证明长期自然度。最佳整组保留R2，前稿仍在项目。\n- 原著背景四轮：东海小吃街往事→现在汤味变化→轩宇画吃饭设想→想念，首次真实模型能正确说谢邂推荐与店的联系，但补“你还笑过我口味重”。来源词形检查此前只拦之前/上次笑我，未拦带“过”的旧玩笑。扩展过去体及嘲笑/取笑/打趣，支持匹配的直接本人原话，否定、假设、引用、第三方与不同对象不提供证据。共用质检与一次修正；修正耗尽时逐句去除已识别的旧玩笑，独立偏好保留，全部不合格则无新增助手记录，不用罐头替代。\n- 为节约用量，原著组R2不是整组重跑：恢复原始第一轮，重放第二轮实际错误模型原稿（不计付费），一次实际修正只说自己的浓汤喜好。该修正不拼入四轮R1；整组原稿和单次诊断分别展示。来源复核可读的第74/75章副本，保留短释义，不复制全文；不声称正版源可访问。[第74章](https://nh5.com/library/chapter/2449/74.html)，[第75章副本](https://www.loying.org/book/douluo3/17766.html)。\n- 最终3013表达检查、252古月娜、123陆雪琪、176真实私聊流式/IndexedDB检查与类型通过，5套真实子进程退出0。新增数据库流程证明两次旧玩笑稿不会恢复bestDraft，独立偏好保留、全假则没有新增assistant。早期一次合法原话测试被repeat-user命中，调整到真实“先前本人说过→当前问喜好”的连续语境；保留失败及诊断日志，不绕过检查。PowerShell重定向会将esbuild stderr警告标成shell退出1，即使模型证据complete/真实检查通过；没有因此重复付费，最终本地子进程日志单独捕获并核对退出0。\n- 实际模型${usage.calls}调用，输入${usage.input}、输出${usage.output}、合计${usage.total}token；模型DeepSeek V4.1 Flash，上游非流式，输出上限500。无额外分类、评审或摘要调用；重放原稿零付费且不计新生成。各组用量与全原稿见${evidence}，最终本地检查release/chat-own-choice-checks-${date}.json。\n- 未解决：未证明整体人味达标；原著组首版有虚构旧玩笑，修正只证明单次路径；一般语义范围、长聊稳定与Lu完整真实验收仍开放。真实模型仍可能换词补经历、过度比喻或附加追问。\n`);
const direction=root+'/优化方向/'+date+'.md';
if(!read(direction,'utf8').includes('## 自己的选择与原著家常'))append(direction,'\n## 自己的选择与原著家常\n\n- 问人物自己的选择，就让人物说自己的趣味；不把接话变成补问资料。\n- 往事用书中已有依据，家常自然接当前变化；设想不冒充发生过。\n- 亲近不靠虚构旧玩笑证明，保留正常打趣与不同好恶。\n- Gu继续验证完整原著日常；Lu独立真实验收仍待完成。\n');
const chats=root+'/聊天验收/古月娜-'+date+'.md';
const selected=[{g:groups[4],note:'四轮完整日常'}, {g:groups[5],note:'四轮完整原著背景日常'}, {g:groups[2],note:'恢复旧原稿前两轮后的一次独立续聊'}, {g:groups[6],note:'恢复原始第一轮并重放第二轮旧稿后的单次修正'}];
let text=read(chats,'utf8');
for(const {g,note} of selected){
 const h=`## ${g.scene} / ${g.revision}（${note}）`;
 if(!text.includes(h))text+='\n'+h+'\n\n'+g.rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')}`).join('\n\n')+'\n';
}write(chats,text);
const index=root+'/00-总览.md';
if(!read(index,'utf8').includes('## 人物选择与原著日常接续'))append(index,'\n## 人物选择与原著日常接续（2026-10-11）\n\n- [[手机版/聊天验收/古月娜-2026-10-11|日常、原著背景完整对话与独立续聊]]。\n- [[手机版/优化方向/2026-10-11|简短优化方向]]；[[手机版/开发日志/2026-10-11|实际用量、失败、验证边界]]。整体目标尚未完成，本轮未发布。\n');
const audit='docs/CHAT-QUALITY-CURRENT-AUDIT-'+date+'.md';
if(!read(audit,'utf8').includes('## 人物受邀表达与旧玩笑来源'))append(audit,`\n## 人物受邀表达与旧玩笑来源\n\n- 当前选择/观点接续保留人物自己的贡献，明确换话题优先于弱关键词距离；实际最终请求验证新提示存在，基线也没追问，不能声称因果改善。\n- 原著背景新四轮仍出现“你还笑过我口味重”，过去体漏检已补，共用现有一次重试，耗尽不恢复旧玩笑。176真实私聊检查证明独立偏好保留/全假不写入，整组首稿未拼接修正。\n- ${evidence}：16实际调用/${usage.total}token；3013表达、252Gu、123Lu、176流式/IndexedDB和类型通过。Lu本轮只有本地回归，完整自然度与原著风格尚未证明，qualityComplete=false。本轮不发布。\n`);
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
