import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',evidence='release/chat-emotion-own-reaction-selection-2026-10-10.json';
if(existsSync(evidence))throw Error('Existing journal evidence must not be overwritten');
const files=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-QUIET-DISAPPOINTMENT-TRANSFER-R1-2026-10-10.json`);
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
const usage=reports.reduce((a,r)=>({calls:a.calls+r.usage.calls,input:a.input+r.usage.input,output:a.output+r.usage.output,total:a.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const decisions=reports.map((r,index)=>{
 if(!r.complete||r.rows.length!==3||r.usage.missingUsage||r.rows.some(row=>row.failed))throw Error('Completed reports required');
 if(!r.rows[0].calls[0].messages.find(m=>m.role==='system').content.includes('把自己的在意说给他听'))throw Error('Actual new direction missing');
 const path=`${root}/聊天验收/${r.roleName}-2026-10-10.md`,before=readFileSync(path,'utf8');
 if(before.includes('## quiet-disappointment-transfer'))throw Error('Group already curated');
 let block='\n\n## quiet-disappointment-transfer / r1（分享意图接续修复前，生产对话）\n';
 for(const row of r.rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**'+r.roleName+'**：'+reply+'\n';}
 return {path,before,after:before+block,selected:files[index],reason:'唯一完整新组；保留错误扩大时长与安慰延续，不是合格样本，不拼修复后的句子。'};
});
writeFileSync(evidence,JSON.stringify({files,usage,decisions,checks:2064,qualityComplete:false,scope:'Real three-turn new scenarios after own-reaction guidance; subsequent sharing correction verified locally only, no old-direction baseline'},null,2));
for(const d of decisions)writeFileSync(d.path,d.after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 反应与情绪点评\n- 平常分享直接说自己的在意；用户真问感受是否合理，仍认真回应，不封禁安慰用语。\n- “不用安慰，只想告诉你”接回分享心意。新实测仍扩大期待时长、保留减负解释；接续修复仅本地验证，整体未达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 人物自己的反应与分享意图更正\n- 上轮为进展：共同坐姿漏检修复，真实Lu旧稿零付费入库回放验证。这轮读取stay-present和emotion指导，替换同段关心表述为自己的在意/反应，避免未受邀请给用户感受评正常、应该、不丢人；用户明确求合理性判断仍回应。没有给输出增加安慰词禁令，inspect正常安慰可以过。新2项后2048与类型通过release/chat-emotion-own-reaction-2026-10-10.log、chat-emotion-own-reaction-types-2026-10-10.log。\n- 新quiet-disappointment-transfer三轮，两人分别明确舞麟/小凡，没去成展览不求重新安排，接着说不用安慰只是喜欢告诉你，最后讨论故事人物讲话。真实首轮payload均含新指导；旧指导没有同输入基线，不作因果改善宣称。两人没有出现正常/应该评语，但首轮Gu“等了有一阵子”、Lu“惦记了许久”把期待扩成时长；Gu第二轮“说出来就轻一点”在用户更正后仍猜负担，Lu更能说自己愿意听和自己的心意，但“分给我的一点”稍书面；第三轮两人说自己的作品观点，有可识别意见，未证明广泛性格稳定。\n- 根据第二轮问题继续检查correctsConversationIntent：旧规则只认“不是要你…而是…”，漏掉拒绝安慰+愿意分享的成对陈述。新增二者同时出现的接续识别，保留报告/引用/假设/提问/缺替代/另项请求范围；把字表达必须真的说告诉你/说给你听/分享，不把改稿等desired action泛化成分享。chooseConversationAction得到respond-clarification，沿当前内容说人物感受，不继续旧情绪解释。该补充之后未付费再跑，所以原三轮标题注明修复前，不拼句。16新项，最终2064通过release/chat-sharing-correction-verified-2026-10-10.log，类型通过release/chat-sharing-correction-types-2026-10-10.log；首次2063记录保留。\n- 本轮6实际调用input${usage.input}/output${usage.output}/total${usage.total}；Gu7545/420/7965，Lu11589/331/11920。deepseek-flash每次500输出上限，usage完整stop，每轮1调用无重试。非流式actual private/隔离IndexedDB，摘要/提取/结算替身，非Android/长聊；PowerShellexit1来自esbuild警告，report complete核实后不重跑。凭据仅内存，未输出/落盘。证据${files.join('、')}，release/{guyuena,luxueqi}-emotion-own-reaction-2026-10-10.log；完整备份与选唯一原组${evidence}。聊天输入chatgpt，分析/方向/技术分别保存。\n- Gu累计540展示/85回放/458付费，输入1412840/输出54199/总1467039；今日连续192调用508438。Lu本轮增加3调用11920。虽有本地和真实请求证据，内容仍有源外时长、书面点评、随机性和长聊漂移，目标未完成。6.0.13未改，不打包、不发布、不更新官网。\n`);
appendFileSync(root+'/00-总览.md','\n- 人物自身反应与分享更正：2064项与类型通过，两人新三轮6调用19885token；首轮仍补时长，分享更正后续仅本地验证。对话/方向/证据分开保存，目标继续。\n');
console.log(JSON.stringify({usage,checks:2064,qualityComplete:false}));
