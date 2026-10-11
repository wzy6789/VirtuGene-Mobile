import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const paths=[1,2].map(n=>`docs/GUYUENA-LIVE-CANON-FAMILY-CASUAL-ONE-FEELING-HOLDOUT-R${n}-${date}.json`);
const reports=paths.map(path=>JSON.parse(read(path,'utf8'))),fresh=reports[1];
if(reports.some(report=>!report.complete||report.rows.length!==4)||fresh.generationMode!=='production'||fresh.usage.missingUsage||fresh.rows.some(row=>row.failed||row.calls.length!==1||row.calls[0].replayed||row.calls[0].finish!=='stop'))throw Error('Four complete fresh production turns required');
if(reports[0].rows.some((row,index)=>row.input!==fresh.rows[index].input))throw Error('Do not change original comparison inputs');
const system=fresh.rows[1].calls[0].messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
if(!system.includes('[相邻观点原话]')||!system.includes('不是应用已判定选择相同')||!fresh.rows[1].replies.join('').includes('我写的是羹，你写的是肉'))throw Error('Actual context wiring and speaker attribution required');
const checksPath=`release/chat-linked-choice-final-checks-${date}.json`,checks=JSON.parse(read(checksPath,'utf8'));
if(!checks.pass||checks.rows.length!==5||checks.rows.some(row=>row.code!==0)||!read(`release/chat-linked-choice-final-expression-verified-${date}.log`,'utf8').includes('PASS chat-expression: 3446 checks')||!read(`release/chat-linked-choice-final-stream-verified-${date}.log`,'utf8').includes('PASS chat-stream: 220 checks'))throw Error('Final local and actual DB verification required');
const edgeExpressionLog=`release/chat-linked-choice-expression-final-edge-${date}.log`,edgeTypesLog=`release/chat-linked-choice-types-final-edge-${date}.log`;
const decode=path=>{const bytes=read(path);return bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');};
if(!decode(edgeExpressionLog).includes('PASS chat-expression: 3448 checks')||decode(edgeTypesLog).trim())throw Error('Nested hypothetical source-boundary checks required');
if(JSON.parse(read('package.json','utf8')).version!=='6.0.22')throw Error('Do not change the released version');
const evidence=`release/chat-linked-choice-evidence-${date}.json`;
write(evidence,JSON.stringify({paths,checksPath,edgeExpressionLog,edgeTypesLog,newPaidUsage:fresh.usage,priorUsageCountedAgain:false,selectedWholeGroup:paths[1],newPackages:0,newReleases:0,version:'6.0.22',qualityComplete:false,findings:[
 'The prior actual menu question was an open choice, not a two-option choice; the adjacent view frame did not recognize it. The initial local case exposed that omission before payment.',
 'Open addressed choices now reach the actor-perspective path, and linked also/matching-choice replies compare exact adjacent original speech without an application judgement of agreement.',
 'User historical contextual just-likes claims have a bounded direct-source check. A single dated event does not support recurrence; ordinary past background preference wording and completed single events are left alone.',
 'Report, hypothesis and writing scope survive commas both for incoming sources and outgoing direct habit assertions. Sources must match the complete historical context, not just a current broad liking.',
 'Fresh R2 distinguishes the actual soup vs meat choices and replies with a conditional Xie Xie joke instead of the prior unsupported habitual ordering claim. The first actor choice varied across runs, so this is not a deterministic causal experiment or wider transfer proof.',
 'One-sentence affection and cold identity exit remain correct in this fresh four-turn group, one provider call per turn.',
 'The production check is deliberately lexical; equivalent canon evidence not represented in supplied sources is not semantically validated. Unrecorded statements with other grammatical forms remain possible.',
 'The first offline stream run lost its handle and had no matching live Node process or result manifest; an isolated hidden background final runner then verified the latest code. Paid dialogue was not restarted.',
 'Other scene quality, poetic overstatement, example dependence, long-term drift and real Lu Xueqi full optimization remain incomplete.'
 ]},null,2)+'\n');
const chat=root+'/聊天验收/古月娜-'+date+'.md';
let content=read(chat,'utf8');const oldHeading='## canon-family-casual-one-feeling-holdout / r1（完整四轮）',newHeading='## canon-family-casual-one-feeling-holdout / r2（完整四轮）';
const group=newHeading+'\n\n'+fresh.rows.map(row=>'**chatgpt**：'+row.input+'\n\n'+row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')).join('\n\n')+'\n\n';
if(!content.includes(newHeading)) {
 const at=content.indexOf(oldHeading);
 if(at<0)throw Error('Previous whole group must exist before replacement');
 const next=content.indexOf('\n## ',at+oldHeading.length);
 content=content.slice(0,at)+group+(next<0?'':content.slice(next+1));write(chat,content);
}
if(content.includes(oldHeading)||content.split(newHeading).length!==2)throw Error('Keep one whole selected version only');
const journal=root+'/开发日志/'+date+'.md',heading='## 分清相邻选择，旧事不升级为过去喜好';
if(!read(journal,'utf8').includes(heading))append(journal,`\n${heading}\n\n- 前一轮为进展：一句数量要求、当下又想你的原话识别和流式落库完成，实际模型发现旧事扩大为过去喜好，以及说想到一块却两人选不同。本轮承接两个具体缺口，目标仍是自然、准确的相处，不仅让检查变绿。6.0.22不改，无打包发布。\n- chat-view-continuity.ts增加相邻“我也想添/选/试、我也喜欢、我们想到一块”等接话。将你刚才的实际回答与对方当前原话同框，应用不预判两人一致；相同可以自然高兴，不同也轻松接各自选择，保留原句与转题范围，不写永久偏好。没有前轮回答或前轮不问观点，不造一个角色立场。\n- 初次真实原话本地测试失败：菜单“你想在上面添一道什么菜”不属于旧二选一/理由问句，新增相邻分支仍没有前轮观点可接。chat-turn-cues.ts补直接开放式选择（想看什么、想添什么等），作为角色自己的观点请求处理；不授予操作权限、事件真实性或新现实场景。另一次本地测试发现“我听朋友说，你想看什么书”被当直接问角色，补齐转述来源。失败日志 release/chat-linked-choice-expression-{initial,fourth}-${date}.log 保留，不删除失败用例。\n- chat-user-habit-risk.ts对“你以前/从前/过去+场合+就/总爱或喜欢”增加过去场合喜好的检查；必须有对应的完整直接原话，不用当前想吃或一次吃饭证明。普通已知背景“你以前喜欢锻造”、单次“以前点过”不卷入此语法。材料、转述、假设跨逗号仍保持范围，不把后面的我变成独立来源。纠正后仍不合格时沿已有摘录入口删除该句，其他独立当前建议原字保留，不追加第三次生成。此规则仍是有限文字对应，不是语义事实审查；作品语义等价、指代和其他语法尚不能据此判正确。\n- 新60項本地检查：相邻真实菜品选择、相同/不同的原话、实际prompt接线、开放式选择与转述边界、未答或非观点不制造立场、过去场合直接来源、一次旧事/当下偏好/材料不支持、允许完成事件与普通背景、摘录保留独立建议。3448表达、321古月娜、123陆雪琪、类型退出0。${checks.rows.map(row=>row.log).join('、')}。\n- 新6項Gu/Lu实际流式与IndexedDB替身检查，复用原R1真正生成的旧喜好raw：审核前不闪现、纠正后只落替身当前建议、仍最多一次纠正；最终220检查退出0；随后仅补两个过去前缀中嵌入如果/要是的边界例，表达3448与类型再验通过，未改变流式预算或传输机制。最终两份补测日志见edgeExpressionLog与edgeTypesLog证据字段。这不是Lu真实模型。初次离线长测试会话句柄丢失且无完整结果；核对无对应活动Node进程后用隐藏的独立进程完成最终验证，保留初始部分日志。真实模型未因句柄丢失或stderr警告重新调用。\n- 相同四条输入新production R2：角色这次选银耳莲子羹，chatgpt仍说闷罐牛肉和想到一块；真实第二轮请求已包含相邻原话区块，回复“哪有想到一块，我写的是羹，你写的是肉”，随后假设谢邂知道会斗两句，没有再新增过去爱点的习惯。自己有选择，打趣也沿实际内容；第三轮“我也想你，舞麟。”、第四轮退出后“不会。”保持一句。本轮首选菜品本身发生随机变化，不能把一次结果称为确定因果或跨场景已验收。作品语气和全部家常的质量仍需拓展。${paths[1]}。\n- 新增实际模型${fresh.usage.calls}调用，input ${fresh.usage.input} / output ${fresh.usage.output} / total ${fresh.usage.total}token。R1已在上轮记录，不重复累计。DeepSeek V4.1 Flash生产思考low、最大500输出，每轮一次、无纠正、finish stop、usage完整；没有额外语义评审或第二组付费重跑。原日志release/chat-linked-choice-fresh-r2-${date}.log（UTF16LE）；PowerShell esbuild警告exit1与报告complete分别核实，不当支付失败重跑。汇总${evidence}。\n- 聊天验收这一场景用更好的完整R2替换原完整R1，不拼句子，不改其他场景；两个版本全稿与请求仍在项目。输入标chatgpt，分析与优化方向另存。\n- 尚未解决：其他语法的旧习惯/假近况、原著声音的稳定差异、诗化与郑重、样本依赖和长期漂移；古月娜未达停止门槛，陆雪琪真实全面优化仍在后续。\n`);
const direction=root+'/优化方向/'+date+'.md',title='## 相邻选择先分清';
if(!read(direction,'utf8').includes(title))append(direction,`\n${title}\n\n- 开放式选择也接自己的观点。\n- 说想到一块时，先看双方实际选了什么。\n- 不同可以轻松接，不必争胜。\n- 一次旧事不升级为过去喜好。\n- 引述和假设不当独立记忆来源。\n`);
const index=root+'/00-总览.md',entry='## 相邻菜品选择与过去场合喜好（2026-10-11）';
if(!read(index,'utf8').includes(entry))append(index,`\n${entry}\n\n- [[手机版/聊天验收/古月娜-2026-10-11|家庭菜单完整R2替换R1]]；[[手机版/优化方向/2026-10-11|简短方向]]。\n- [[手机版/开发日志/2026-10-11|3448表达、220流式与新增14325token，含失败证据]]。\n- 已发布仍为6.0.22，本轮无发布，整体目标未完成。\n`);
console.log(JSON.stringify({newPaidUsage:fresh.usage,expressionChecks:3448,streamChecks:220,selectedWholeGroup:paths[1],qualityComplete:false,newPackages:0,newReleases:0}));
