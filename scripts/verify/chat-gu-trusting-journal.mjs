import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const paths=[`docs/GUYUENA-LIVE-PARTNER-VIEW-PATH-HOLDOUT-R2-${date}.json`,...['R1','R2'].map(rev=>`docs/GUYUENA-LIVE-PARTNER-SMALL-SHARING-HOLDOUT-${rev}-${date}.json`)];
const groups=paths.map(path=>({path,...JSON.parse(read(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.usage.missingUsage||g.rows.some(r=>r.failed)))throw Error('Incomplete live evidence');
const usage=groups.reduce((s,g)=>({calls:s.calls+g.usage.calls,input:s.input+g.usage.input,output:s.output+g.usage.output,total:s.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
const evidence=`release/chat-gu-trusting-evaluation-${date}.json`;
write(evidence,JSON.stringify({usage,groups:groups.map(g=>({path:g.path,usage:g.usage,rows:g.rows.map(r=>({input:r.input,replies:r.replies}))})),qualityComplete:false,selection:{path:'R2',sharing:'R2'},assessment:{path:'Less adversarial than R1, preserves river preference, direct affection. Still qualifies partner position as right and adds togetherness not requested.',sharingR1:'Invents inference about prior owner, phrases looking without an image; taste response lively; affection does not clearly reciprocate.',sharingR2:'Shorter and directly reciprocates affection; no explicit I-look claim, but infers being frightened, asks an already implied detail, and uses unnecessary you-insist wording.',limitations:'No broad naturalness result. Path R2 before shared sensory wording adjustment, sharing R2 after. Model sampling differences not causal proof; no fresh Lu personality generation in this turn.'},scope:'Actual private send plus isolated IndexedDB, DeepSeek Flash thinking low; output cap500; each scene max6 calls. All initial draft stop. Summary/extraction/settlement mocked. No Android, no paid semantic critic.'},null,2)+'\n');
const journal=root+'/开发日志/'+date+'.md',heading='## 古月娜伴侣语气：信任、具体好恶与文字感知';
if(!read(journal,'utf8').includes(heading))append(journal,`\n${heading}\n- 前一轮改权威代码并完成实际请求复核，是进展。本轮继续古月娜优先，不把陆雪琪较好单组当两角结束。已有Gu去重试验曾没有证明改善，因此未再次开启同类候选、未删除原著资料。\n- Gu运行时伴侣关系说明从反复列冷落/盘问/揣测动机禁令，换为简短的熟悉、信任、具体好恶和平常商量；身份必须真实用户选择，退出仍冷淡。原文资料、旧消息、用户改写和完整care所有权条件保持，不写回数据库人设。观点示例去掉“你喜欢整齐的话…我想听”的额外索取，转为说自己的具体理由，例句是应用语气适配，不是原著对白或永久喜好。\n- 本地聊天表达2868、古月娜真实IndexedDB接入221、类型检查通过。共享文字感知表述后表达2868、语气契约81+18实际编辑检查、真实网关传输/停止检查通过；没有仅凭这些绿灯宣布人味。日志release/chat-gu-trusting-expression-final-${date}.log、chat-gu-trusting-preset-${date}.log、chat-gu-trusting-types-${date}.log、chat-gu-trusting-policy-${date}.log、chat-gu-trusting-gateway-${date}.log。\n- 沿河同场景Gu R2为3调用8832token，比R1少动机盘问、龙族亲水泛化和结尾约路，仍保持自己的沿河选择；最后直接我也想你/开心。第二轮“你走得轻松也挺对”略有批准感，补一起走不是当前明确邀约，但没有宣称已经同行。属于局部较好，不能外推所有分歧。整组R2展示，旧R1原稿保留。\n- 新书签场景R1为3调用8474token，普通分享回应较活泼，但猜旧主人闲情，文字描述里说“我看一眼也想笑”有未见物品却声称看过的歧义；爱意仅说收下而未直接回应喜欢。基于这次来源问题，修改共享契约同一条事实说明：仅文字时是听描述，可联想/反应/好奇，图片才提供实际可见内容；不封禁看字、不剥联想，不加每轮付费评审，也不承诺模型必遵守。\n- 同书签R2为3调用8392token，最后明确我也喜欢你，未出现我看一眼的说法；但首轮把愣一下说成吓到，明知以为真鸟仍问折得像吗，最后“你非要分开说”多了评判意味。选R2整组只是少来源问题且心意直接，失败句完整保留，不标优秀或稳定达标；不要拼接R1好句。共享感知措辞的因果收益未被多样本证明，Gu仍会盘问/猜测或责怪坦率表达。\n- 本轮实际${usage.calls}调用/input ${usage.input}/output ${usage.output}/total ${usage.total}（含推理），usage齐全，均一次首稿stop，无额外评审或摘要付费。每调用输出最多500，每组三轮；没有无止境重刷。原稿${paths.join('、')}；汇总${evidence}；日志release/chat-gu-trusting-path-live-${date}.log、chat-gu-trusting-sharing-live-${date}.log及chat-gu-trusting-sharing-r2-live-${date}.log。\n- 三组是实际私聊send-service和隔离IndexedDB，上游非流式，摘要/提取/结算替身，不能代表Android体验或完整长期质量。Lu本轮没有真实生成，静态跨角色边界检查保留。未打包、未发布、版本6.0.15不动；下一步处理对明确心意的附带评判及对文字细节的重复追问，不以此单组停止整个目标。\n`);
const chat=root+'/聊天验收/古月娜-'+date+'.md';
let content=read(chat,'utf8');
for(const g of [groups[0],groups[2]]){
 const pathScene=g.path.includes('VIEW-PATH');
 const scene=pathScene?'partner-view-path-holdout':'partner-small-sharing-holdout';
 const title=pathScene?'散步路线、不同偏好与心意':'书签分享、不同偏好与心意';
 content=content.split(/\n(?=## )/u).filter(block=>!block.startsWith('## '+scene+' /')).join('\n').trimEnd()+`\n\n## ${scene} / r2（${title}）\n\n`+g.rows.map(r=>`**chatgpt**：${r.input}\n\n`+r.replies.map(s=>`**古月娜**：${s}`).join('\n\n')).join('\n\n')+'\n';
}
write(chat,content);
const direction=root+'/优化方向/'+date+'.md',mark='## 古月娜信任语气仍需收尾';
if(!read(direction,'utf8').includes(mark))append(direction,`\n${mark}\n- 信任与具体好恶优先，少用盘问证明主见。\n- 文字分享可以联想，不冒充看过物品。\n- 不责怪对方说清心意，不追问已经讲明的细节。\n- 新话题有改善，仍未稳定自然；Lu本轮未实测。\n`);
const index=root+'/00-总览.md',markIndex='古月娜信任语气：9调用/25698token';
if(!read(index,'utf8').includes(markIndex))append(index,`\n- ${markIndex}；整组较好版本见[[手机版/聊天验收/古月娜-${date}|古月娜原话]]，改动、失败与共享表述未证明的收益见[[手机版/开发日志/${date}|日志]]。仍未达标，未发布。\n`);
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
