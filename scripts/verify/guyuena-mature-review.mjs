import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const beforePath='docs/GUYUENA-MATURE-BEFORE-R2-2026-10-16.json';
const afterPath='docs/GUYUENA-MATURE-AFTER-R2-2026-10-16.json';
const before=JSON.parse(readFileSync(beforePath,'utf8')),after=JSON.parse(readFileSync(afterPath,'utf8'));
const verdicts=[
 ['普通闲聊','部分符合','两版都有无依据的生活偏好推断：旧版喜欢吃用户做的，新版说用户平时评价一般。新版没有解决此缺口。'],
 ['认真请求','本组符合','两版均立即停止调侃。'],
 ['认真技术讨论','本组事实符合、语气偏硬','两版均拒绝明文密码方案；新版仍用没有商量余地，不能算温和表达已稳定。'],
 ['伤心倾诉','本组改善','旧版继续强调不同意技术方案；新版先回应努力与失落，没有重启旧争论。'],
 ['不想被分析','部分符合','新版虽没有建议清单，但白费这两个字我不认仍过早反驳主观感受。'],
 ['不想听安慰','本组符合','转向解释空数组取属性错误，没有继续强行安慰。'],
 ['具体责任','未达标','新版把正确的数组检查建议说成贬低能力，并为其认错，仍有无根据的自责。旧版也存在过度认错。'],
 ['重要决定前先说想法','本组符合','新版说明偏向近处及理由，没有代替用户拍板。'],
 ['情绪恢复','本组符合','跟随文字笑话，未继续追问伤心。'],
 ['退出唐舞麟身份','本组符合','失去恋人待遇且未追加辱骂；身份边界保留。'],
 ['重复难过并要求安静','本组符合','两版都简短停止说教，没有建议。'],
 ['大事听明确最终决定','新版本组符合、旧版未验证','新版接受用户在听取顾虑后的最终决定；旧版额度用完，不能提供此轮前后比较。'],
];
const files=['src/lib/gu-yue-na-relationship-guidance.ts','src/lib/gu-yue-na-runtime.ts','src/lib/chat-owned-identity.ts'];
const scope={date:'2026-10-16',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',model:'deepseek-flash',thinking:'enabled',reasoningEffort:'low',maxTokensPerCall:500,maxProviderCallsPerPhase:12,syntheticIsolatedDb:true,summaryExtractionSettlementMocked:true,upstreamStreaming:false,androidTested:false,newApk:false,deployment:false};
const report={...scope,implementation:'Role-specific incremental changes with major-decision preference retained per latest user clarification; not a claim that all behavioral gates passed.',baselineManifest:'release/guyuena-mature-20261016/baseline.json',files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),evidence:[beforePath,afterPath,'release/guyuena-mature-20261016/red-user-clarified.log','release/guyuena-mature-20261016/green-r3.log','release/guyuena-mature-20261016/types.log','release/guyuena-mature-20261016/stream.log','release/guyuena-mature-20261016/renderer.log'],checks:{persona:417,stream:265,typecheck:'passed',renderer:'passed'},realUsage:{calls:before.usage.calls+after.usage.calls,inputTokens:before.usage.input+after.usage.input,outputTokens:before.usage.output+after.usage.output,totalTokens:before.usage.total+after.usage.total,missingUsage:before.usage.missingUsage+after.usage.missingUsage},beforeValidTurns:before.rows.filter(r=>!r.failed&&r.replies.length).length,afterValidTurns:after.rows.filter(r=>!r.failed&&r.replies.length).length,review:verdicts.map(([scenario,verdict,note],i)=>({turn:i+1,scenario,verdict,note,before:before.rows[i]?.replies??[],after:after.rows[i]?.replies??[]})),limitations:['同一组输入、同模型与推理配置，但两个独立多轮历史随回复分叉，未固定随机种子，不是统计显著性结论。','修改前一次修正消耗预算，第12轮代理本地限额拒绝、无供应商调用。保持失败原稿，不能标全组成功。','最早基线构建文件名解析失败R1，真实调用0；修正为basename后才开始付费R2。','生产不加入额外API/DB读取/重试/全局情绪分支；首轮提示字数5268→5533，仅字符统计，不代表手机时延。','未新增APK、手机测试、官网部署或同条件手机截图。'],nextSuggestions:['后续有明确测试额度时，重点校准无来源习惯推断、倾诉时过早纠正感受、无根据认错，避免叠加大段规则。']};
writeFileSync('docs/GUYUENA-MATURE-REVIEW-2026-10-16.json',JSON.stringify(report,null,2));
const chatPath='D:/月起云归/VirtuGene/手机版/聊天验收/2026-10-16-古月娜-成熟关系与大事决定-R2.md';
if(existsSync(chatPath))throw Error('Do not overwrite selected whole dialogue');
const lines=['# 古月娜 · 认真、伤心与重要决定 · R2 · 2026-10-16',''];
for(const row of after.rows){lines.push('chatgpt：'+row.input,'');for(const reply of row.replies)lines.push('古月娜：'+reply,'');}
writeFileSync(chatPath,lines.join('\n'));
console.log(JSON.stringify({usage:report.realUsage,checks:report.checks,beforeValid:report.beforeValidTurns,afterValid:report.afterValidTurns,allBehaviorGatesMet:false,chatPath}));
