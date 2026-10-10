import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-MIXED-TURN-HOLDOUT-R1-2026-10-10.json`);
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Actual dialogue transport evidence incomplete');
const replay=JSON.parse(readFileSync('release/chat-usual-expression-replay-2026-10-10.json','utf8'));
if(!replay.pass||replay.modelCalls!==0)throw Error('Captured regression did not pass');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const chat=root+'/聊天验收/古月娜-2026-10-10.md';
const before=readFileSync(chat,'utf8');
const heading='## mixed-turn-holdout / r1（生产对话）';
const transcript=reports[0].rows.map(row=>`**chatgpt**：${row.input}\n\n${row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')}`).join('\n\n');
const after=before.includes(heading)?before:before+'\n\n'+heading+'\n\n'+transcript+'\n';
const evidence='release/chat-mixed-turn-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,checks:2589,typeCheck:true,replay:'release/chat-usual-expression-replay-2026-10-10.json',qualityComplete:false,selection:{guyuena:'whole mixed-turn-holdout/r1',luxueqi:'no new whole-group selection because actual r1 invents usual expression'},chat:{path:chat,before,after},findings:['Gu接书签笑点、保留自己的阅读选择、按换话题回应想念；该三轮无明显新近事或习惯编造。','Lu前两轮有模板开场和书签用途解释，最后不像你平常的样子虚构了用户习惯。','新守卫与已有一次重试/整句省略机制经2589本地和完整三轮DB回放验证，不宣称最后改动已通过新真实生成。']},null,2)+'\n');
writeFileSync(chat,after);
const log=root+'/开发日志/2026-10-10.md';
const logHeading='## 连续轻松话题转心意：平常表达的证据';
if(!readFileSync(log,'utf8').includes(logHeading)){
 appendFileSync(log,`\n${logHeading}\n- 前一轮属于进展：提示去重、具体情绪契约落地，两位实际物件观点对照与2575项检查提供新证据。本轮先看当前情绪/视角/身份提示和真实runner，再增加未测的书签笑点→阅读偏好→换话题想念三轮组，不自动改用户措辞，不以旧两轮证明全局完成。\n- Gu完整三轮能接小玩笑、坦白自己想翻到最后，并直接回想念；没有此前家庭近事或今日天气。Lu先问看哪本、次轮讲书签用途、末轮说“只是突然这样讲，倒不像你平常的样子”，构造了缺原话支持的用户通常表达。这条具体缺口属于已有AffectionHistoryRisk的频次/长期行为证据范畴，不是单纯不够温柔。\n- 扩已有检查为直接心意轮中“这样说/倒不像你平常的样子/语气”等短范围比较；不是任意风格比较，也不把当前普通器物比较看成情感习惯。本人明确“我平常不这么说”可支持；第三方/引用不能。按句与分句位置保留问号、假设/转述前缀的归属，避免条件跨逗号变断言。私聊/群共用检查，主动消息无当前心意不自动套比较型规则。新14项当前样本、整句保暖、两模式、语境/本人来源，2589通过release/chat-usual-expression-local-2026-10-10.log，类型release/chat-usual-expression-types-2026-10-10.log通过。\n- 另用Lu实际三轮原稿执行隔离actual send-service/IndexedDB回放，第三轮原稿连续喂两次，证实已有一次重试后删除整句历史比较，保留完整独立当下心意。前三轮共4fixture、零付费，release/chat-usual-expression-replay-2026-10-10.json/log通过；它是回放不是新生成、不替换实际失败原稿，也不进入聊天精选拼句。\n- ${sources.join('、')}保留实际完整请求/模型/上屏/调用，${evidence}保存Gu聊天文件前后与选择；Gu新组三轮唯一R1完整保存。Lu该组真实R1有虚构习惯，不新增精选；所有原稿留项目，不把修复后回放的好句拼到真实组中。chatgpt标识、聊天原话与简短优化方向/技术日志分开，电脑版不改。\n- deepseek-flash共${usage.calls}付费/input${usage.input}/output${usage.output}/total${usage.total}；Gu3次7909、Lu3次11239，无额外付费审核/摘要/提取，也无真实重试。两进程已终止且complete/final stop/usage齐；warning退出1没重复请求；回放只fixtures不花额度。最后新历史比较护栏仅本地及回放验收，真实模型是否换成另一种习惯说法仍未知。\n- 仍需验证长聊身份来源、主观性格稳定、情感丰富而不固定句、与原著熟悉度和所有入口；Lu解释书签/询问过多及Gu较平淡亲近也未完整打磨。目标活跃未完成，6.0.13不变，无打包/发布/官网下载更新。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 轻松话题转心意\n- 接当前玩笑与自己的偏好，换话题就转过去。\n- 眼前想念不证明对方平常怎样表达；保留当下回应，不编长期对比。\n- 陆雪琪减少用途解释与询问，古月娜继续丰富亲近的自然变化。\n');
 appendFileSync(root+'/00-总览.md',`\n- 新三轮轻松→观点→心意：2589项/类型/零付费完整回放通过，${usage.calls}调用/${usage.total}token。Gu整组R1保存，Lu虚构通常表达不精选，最后护栏无新生成验收；目标未完成，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
