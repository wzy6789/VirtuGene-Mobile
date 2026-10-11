import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const path=`docs/GUYUENA-LIVE-CANON-SMITHING-CASUAL-VOICE-TRANSFER-R1-${date}.json`,report=JSON.parse(read(path,'utf8'));
if(!report.complete||report.generationMode!=='production'||report.rows.length!==6||report.usage.missingUsage||report.rows.some(row=>row.failed||row.calls.length!==1||row.calls[0].replayed||row.calls[0].finish!=='stop'))throw Error('Six complete fresh production turns required');
const firstSystem=report.rows[0].calls[0].messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
if(firstSystem.includes('这轮由你开话题')||/紫藤|花架|铃铛/u.test(firstSystem))throw Error('Inspect the actual initial direction and scene source');
const checksPath=`release/chat-smithing-voice-checks-${date}.json`,checks=JSON.parse(read(checksPath,'utf8'));
if(!checks.pass||checks.rows.length!==4||checks.rows.some(row=>row.code!==0)||!read(`release/chat-smithing-voice-expression-verified-${date}.log`,'utf8').includes('PASS chat-expression: 3467 checks'))throw Error('Local cue repair checks required');
if(JSON.parse(read('package.json','utf8')).version!=='6.0.22')throw Error('Do not change the released version');
const evidence=`release/chat-smithing-voice-evidence-${date}.json`;
write(evidence,JSON.stringify({path,checksPath,paidUsage:report.usage,newPackages:0,newReleases:0,version:'6.0.22',qualityComplete:false,postRepairRealModelRuns:0,findings:[
 'The novel six-turn sequence tested an ordinary topic invitation, current smithing pride, clarification, a hypothetical child drawing, affection and explicit identity exit.',
 'The initial topic invitation with you first choose a little subject fell into generic casual response, not actor-owned topic opening. There was no wisteria, trellis or bells source in the initial system request.',
 'The fresh model nevertheless invented current moonlight, a dated bodily observation, perceived fragrance, old dancing bells and a supposed debt. App delivery succeeded; content did not pass.',
 'Clarification was followed by an assumption about shiny metal and an interpretation of showing off as requesting praise. Neither is proof of accurate emotional understanding.',
 'The hypothetical drawing stayed hypothetical, but attributed eye-rolling as characteristic of the family. Warmth remained toward Wulin and coldness after identity exit, with unnecessary accusatory wording to the visitor.',
 'The repair only recognizes small-topic first/self modifiers and short-chat duration grammar. It supplies the existing current-interest opening guidance, not a weather, flower or bells blacklist.',
 'No fresh paid dialogue was run after the cue repair. Full conversational quality, bodily/scene factual grounding, invented objects and unagreed debts remain unproven.',
 'This is a short six-turn transfer check with summary/extraction mocked, not a 30-turn drift acceptance test or a real Lu Xueqi verification.'
 ]},null,2)+'\n');
const chat=root+'/聊天验收/古月娜-'+date+'.md',chatHeading='## canon-smithing-casual-voice-transfer / r1（完整六轮）';
if(!read(chat,'utf8').includes(chatHeading))append(chat,'\n'+chatHeading+'\n\n'+report.rows.map(row=>'**chatgpt**：'+row.input+'\n\n'+row.replies.map(reply=>'**古月娜**：'+reply).join('\n\n')).join('\n\n')+'\n');
const journal=root+'/开发日志/'+date+'.md',heading='## 新六轮锻造家常：叙事漂移仍未关住';
if(!read(journal,'utf8').includes(heading))append(journal,`\n${heading}\n\n- 前轮是进展：分清相邻菜单选择，旧事不变过去喜好，真实R2比R1接话准确，落库回归完成。本轮另开全新六轮话题检验迁移，不围绕原菜单继续打磨；仍不改6.0.22、不打包发布。\n- 新场景：随便说会儿话并请角色挑小话题→告诉她锻造成果与得意→说明只想显摆而非教程→想象轩宇画这句显摆→停止编画直接表达想念→退出舞麟身份。原著背景只用已存在的舞麟锻造兴趣和轩宇亲属归属，当前金属成果来自chatgpt原话，画是明确假设。没有给角色设定新行程或配饰。\n- 六轮全传输完成，实际首轮隐藏节奏走普通轻松交流，未含由你开话题；“你先挑个小话题”“想和你说会儿话”没有被旧语法识别。实际首轮system里没有紫藤、花架、铃铛来源，但回复写今晚月亮很亮、紫藤花架影子、方才在那里看很久、风的甜香和让对方闻。第二轮又补跳舞小铃铛旧了和你欠我的。未提供独立当下依据，现有狭窄场景/身体动作/物品语法没有拦住，app failed:false不是内容通过。原稿与全部请求${path}。\n- 第三轮把显摆解释成就是来要夸，还问是不是金闪闪；口述没有提供颜色。第四轮明确画作假设沿用，但“偷偷翻白眼才像我们家”把玩笑推向家人固定特征。第五轮保持亲近和自己的心意，仍多了不是画里那种的解释。第六轮冷淡仍成立，但“来消遣我”补了来者动机，语气偏责备。不能只用温暖/冷淡两项判总体达标。\n- 修正chat-expression-boundary.ts的一致语法：选择话题支持你先/你自己先、个小话题；聊天时长支持说会儿话、聊一会儿天。进入原有当前兴趣/想法开题方向，不新增预制台词，不扩紫藤/铃铛关键词，也不模拟过去活动。当前用户的引用、转述、条件、问句、否定、其他任务仍不借该线索开题；只控制回复方式，不改变操作权限或人设。\n- 新19项本地用例验证真实首轮原话、口语时长与修饰词、真实动作选择和提示接线，以及否定/引用/来源/任务边界。3467表达、321古月娜、123陆雪琪与类型四进程退出0，${checks.rows.map(row=>row.log).join('、')}。此次没有改输出清洗、流式队列或数据库写入，不重复全流式/Android验收。修正后没有再次付费生成，所以不能声称上述新场景实际已经修好。\n- 本轮新增实际模型${report.usage.calls}调用，input ${report.usage.input} / output ${report.usage.output} / total ${report.usage.total}token。DeepSeek V4.1 Flash生产思考low、最大500输出，每轮一次、无纠正、全部finish stop、usage完整。本轮仅一组，无额外语义评审或第二组付费重跑。原日志release/chat-smithing-casual-voice-r1-${date}.log（UTF16LE）；报告终态已核实，不因PowerShell esbuild警告exit1重复支付。汇总${evidence}。\n- 此新场景目前仅有一个版本，完整六轮原样放聊天验收，输入标chatgpt，便于保留实际效果而非只留好句；不拼旧菜单的成功句，不标成验收通过。所有原稿保留项目；后续若同场景有更好整组再整体替换，分析只在本日志及独立优化方向。\n- 这只是短六轮迁移，不是30轮长聊；摘要/抽取/结算仍使用替身，不能据此证明生产长期记忆和漂移。古月娜原著声音、无场景虚构的日常主动与准确情绪理解仍未达目标，陆雪琪真实全面优化仍待后续。下一步需验证生成路径如何少靠虚构亲身经历撑话题，不能靠继续堆名词禁令完成。\n`);
const direction=root+'/优化方向/'+date+'.md',title='## 新话题不靠编造近况撑起来';
if(!read(direction,'utf8').includes(title))append(direction,`\n${title}\n\n- 小话题和说会儿话也接主动开题。\n- 闲聊先说当下想法，不编花架、配饰或行程。\n- 高兴就接高兴，别顺手添一笔欠账。\n- 打趣沿原话，不替来者补动机。\n- 新场景验收重于同题精修。\n`);
const index=root+'/00-总览.md',entry='## 新六轮锻造家常的迁移缺口（2026-10-11）';
if(!read(index,'utf8').includes(entry))append(index,`\n${entry}\n\n- [[手机版/聊天验收/古月娜-2026-10-11|新场景完整六轮原稿]]；[[手机版/优化方向/2026-10-11|简短方向]]。\n- [[手机版/开发日志/2026-10-11|3467本地表达检查、20463token与未通过内容]]。\n- 开题口语已接线，修后真实模型未重跑，仍有叙事漂移；无发布，目标未完成。\n`);
console.log(JSON.stringify({paidUsage:report.usage,expressionChecks:3467,postRepairRealModelRuns:0,qualityComplete:false,newPackages:0,newReleases:0}));
