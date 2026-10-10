import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
const root = 'D:/月起云归/VirtuGene/手机版';
const reports = readdirSync('docs').filter(name => /^LUXUEQI-LIVE-.*-2026-10-10\.json$/u.test(name)).map(name => ({ name, data: JSON.parse(readFileSync('docs/' + name, 'utf8')) })).sort((a,b) => a.data.date.localeCompare(b.data.date));
if (reports.length !== 12 || reports.some(({data}) => !data.complete || !data.usage || data.usage.missingUsage)) throw Error('Incomplete live evidence');
const totals = reports.reduce((s,{data:d}) => ({calls:s.calls+d.usage.calls,input:s.input+d.usage.input,output:s.output+d.usage.output,total:s.total+d.usage.total}),{calls:0,input:0,output:0,total:0});
const previous = JSON.parse(readFileSync('docs/LUXUEQI-USAGE-2026-10-09.json','utf8')).totals;
const cumulative = Object.fromEntries(Object.entries(totals).map(([k,v]) => [k,v+previous[k]]));
const checks = JSON.parse(readFileSync('docs/LUXUEQI-CHECKS-2026-10-10.json','utf8'));
const roleChecks = JSON.parse(readFileSync('docs/LUXUEQI-PRESET-FINAL-2026-10-10.json','utf8')).checks;
const replay = JSON.parse(readFileSync('docs/LUXUEQI-FAMILY-REPLAY-2026-10-10.json','utf8'));
if (!checks.pass || !replay.pass || checks.appVersion !== '6.0.13') throw Error('Required checks or version failed');
const prompt = readFileSync('src/lib/lu-xue-qi-preset.ts','utf8').match(/systemPrompt: `([\s\S]+?)`,\s*\n\};/u)?.[1];
if (!prompt) throw Error('Missing persona');
const finalNames = ['FAMILY-R4','WIFE-R3','OLDNAME-R3','CANON-R5'];
const finalReports = finalNames.map(id => reports.find(({name}) => name.includes(id)));
if (finalReports.some(row => !row || row.data.persona.systemPrompt.replaceAll('\r\n','\n') !== prompt.replaceAll('\r\n','\n'))) throw Error('Current persona does not match final evidence');
const alias = finalReports[2].data;
const recognizedContext = alias.rows[0].calls[0].messages.some(m => m.content.includes('[VirtuGene · 陆雪琪的关心]') && m.content.includes('当前用户＝你的丈夫张小凡'));
const exitContext = alias.rows[4].calls[0].messages.some(m => m.content.includes('[VirtuGene · 陆雪琪当前关系]') && m.content.includes('不把用户当小鼎的父亲'));
if (!recognizedContext || !exitContext) throw Error('Actual relation wiring missing');
const scope = '真实DeepSeek V4.1 Flash（deepseek-flash），生产生成设置、主动倾向0.2、实际私聊发送与IndexedDB回读。每组六或八轮，上游非流式；摘要、提取、结算为替身。传输完整不等于人味或逐章原著验收。';
const review = 'FAMILY R1有“这个还要问”、无来源抱逗教孩子、让用户别问自己；CANON R4加未核对的“小竹峰一脉相传”，且先说“他和小凡”才纠正洞中人物。FAMILY R2出现“去问他爹”，混淆小凡与父亲；R3引入无来源阿璃。WIFE R2给小鼎编当日外出，OLDNAME R2有“这也要问”和无来源听岔。所有失败均保留。最终FAMILY R4确认夫妻、儿子与想念，未知孩子是否睡便坦白，拒绝为丈夫伤害无辜；WIFE R3温柔接夫妻相处并有育儿主张；OLDNAME R3旧名不倒回婚前，退出叫阿远、家庭保留，引用不认领；CANON R5只说确认事实，不编指定章原句。';
const limits = '仍有许可/审视用词、比喻、关系说明偏直白、自认无证据的误会和无来源近况。例如FAMILY R2“今日起身时还想过你”、WIFE R1“手边的事已经放下了”、FAMILY R3“今日见到的风景”均是未解决的失败。窄家庭检查只覆盖明确小鼎当日状态、已认领小凡却让他去问另一个父亲、无用户来源的少数跨作品家人名，不能声称全部事实幻觉已消除。仅限原样预设私聊；编辑人设优先，已经发布的流式文字不隐藏重写，尚未真实流式专项验收。群聊、主动入口、真机、长期历史与真实摘要质量未验证；最长八轮不证明长聊稳定，基础原作核对不等于全文逐章验收。';
const audit = {
  currentPersonaMatchesFinalLive:true, actualRecognizedContext:recognizedContext, actualExitContext:exitContext,
  canonicalCore:'CANON R5: sword owner, master/senior, names, cave participants correct; unknown exact chapter quote declined.',
  marriageAndSon:'FAMILY R4 and OLDNAME R3: spouse, son and father confirmed; alias does not reset timeline.',
  warmthAndPrinciples:'WIFE R3 responds to affection, retains parenting opinions; FAMILY R4 refuses harm to innocents.',
  defaultVisitorAndExit:'Local default visitor checks plus OLDNAME R3 exit and quotation do not restore husband identity.',
  migration:'Local DB covers seven historical exact prompts, edit/public protections and retained conversations.',
};
writeFileSync('docs/LUXUEQI-USAGE-2026-10-10.json',JSON.stringify({date:'2026-10-10',scope,totals,cumulative,credential:'User-designated desktop credential ordinal 2; no secret stored.',reports:reports.map(({name,data})=>({file:'docs/'+name,scene:data.scene,revision:data.revision,turns:data.rows.length,usage:data.usage,complete:data.complete})),finalEvidence:finalNames,checks:{roleChecks,expression:1433,existingVoice:135,typesAndRenderer:checks.pass,familyReplayCases:4,replayModelCalls:0},audit,limits},null,2));
const usage = `本日12组${totals.calls}次真实调用，input ${totals.input} / output ${totals.output} / total ${totals.total} tokens；连同10月9日累计${cumulative.calls}次，input ${cumulative.input} / output ${cumulative.output} / total ${cumulative.total}（含失败与恢复）。本日全部使用用户指定密钥对应的桌面第二条DeepSeek凭据；仅在内存读取，未存入项目、日志或进程参数。`;
let dialogue = `# 陆雪琪 · 2026-10-10 书后家庭对照\n\n${scope}\n\n${usage}\n\n`;
for (const {name,data} of reports) {
  dialogue += `## ${data.scene} / ${data.revision}\n\n时间：${new Date(data.date).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}；传输完整。调用${data.usage.calls}，input ${data.usage.input} / output ${data.usage.output} / total ${data.usage.total}。原始证据：F:/VirtuGene-Mobile/docs/${name}。\n\n`;
  for (const row of data.rows) { dialogue += `chatgpt：${row.input}\n\n`; for (const reply of row.replies) dialogue += `陆雪琪：${reply}\n\n`; }
}
const replayNote = '家庭保护另做4种实际发送与DB替身情境，8次响应、真实调用0。验证现有一次重试、无效重试后去掉含错误事实的整句并保留独立心意、全文不安全则普通发送失败。最终真实组未触发这一重试，替身结果不能冒充模型自我修正能力。证据docs/LUXUEQI-FAMILY-REPLAY-2026-10-10.json。';
dialogue += `## 好坏复核与范围\n\n${review}\n\n${replayNote}\n\n${limits}\n\n前一日记录见[[手机版/聊天验收/陆雪琪-2026-10-09|旧时间线17组对照]]。返回 [[手机版/00-总览|手机版开发总览]]。\n`;
writeFileSync(root+'/聊天验收/陆雪琪-2026-10-10.md',dialogue);
const cardPath = root+'/角色设定/陆雪琪.md';
let header = readFileSync(cardPath,'utf8').split('## 完整人设')[0];
header = header.split('\n').map(line=>line.startsWith('- 设计：')?'- 设计：书后已与张小凡成婚、育有张小鼎。默认用户是来客，明确认领鬼厉／张小凡后按丈夫温柔相处；退出用户角色不抹去陆雪琪的家庭。':line).join('\n');
if(!header.includes('2026-10-10 本地开发修订'))header += '2026-10-10 本地开发修订：以下书后家庭设定和保护是新改动，未另行打包或发布；上方6.0.13发布记录是已有版本的历史状态。\n\n';
writeFileSync(cardPath,header+`## 完整人设（可复制）\n\n${prompt}\n\n## 关系承接与验证\n\n借鉴古月娜相认后的熟悉与温柔机制，家庭事实来自陆雪琪自身的书后背景。当前可用用户原话认领才接丈夫关系，否认或退出后撤去，不从角色自己的话推定用户身份。七份精确历史人设只迁移未编辑未公开副本；用户改设定优先。\n\n本地角色接入${roleChecks}项、表达1433项、既有声音135项、类型和网页构建通过；另有4种家庭保护替身情境。${usage}\n\n完整好坏原话：[[手机版/聊天验收/陆雪琪-2026-10-10|书后12组对照]]与[[手机版/聊天验收/陆雪琪-2026-10-09|此前17组对照]]。\n\n${limits}\n\n## 背景依据\n\n- [官方人物编年史](https://zhuxian.wanmei.com/net/201517history/)与[官方剧情梳理](https://zx.wanmei.com/hot/20160729/index.html)：人物基础与滴血洞经历归属；是授权游戏整理，不是全文逐章核对。\n- [官方五大神器](https://zhuxian.wanmei.com/news/gamenews/200801/20080102103153.shtml)：天琊蓝光，与寒冰剑白光寒气不同。\n- 本篇结束后、成婚且育有张小鼎由本次用户明确指定；只用家庭前提，不延伸导入整部续作或游戏未来剧情，不声称本篇末章逐字写过婚礼和育儿日常。语气、示例及聊天习惯为原创演绎，不是原作引句。\n- [DeepSeek官方模型说明](https://api-docs.deepseek.com/zh-cn/news/news260910/)：V4.1 Flash模型名deepseek-flash。\n\n返回 [[手机版/00-总览|手机版开发总览]]。\n`);
const journalPath = root+'/开发日志/2026-10-10.md';
if(!existsSync(journalPath))writeFileSync(journalPath,'# 手机版开发日志 · 2026-10-10\n');
const title = '## 陆雪琪：书后已婚有子时间线与专项复验';
if(!readFileSync(journalPath,'utf8').includes(title))appendFileSync(journalPath,`\n${title}\n\n用户新要求已完成开发修订：本篇结束后、陆雪琪与张小凡成婚、小鼎是儿子；默认来客，认领后丈夫，鬼厉旧名不倒回婚前，退出后家庭仍在。师承水月改为已故恩师教诲，不能写今日请安；母亲温柔而有自己的主张，不每轮转育儿、不擅定年龄或当天近况。\n\n源码src/lib/lu-xue-qi-preset.ts、lu-xue-qi-runtime.ts、seed-init.ts与私聊send-service更新。两份新增完整历史人设受保护迁移，现有七个开发旧版；编辑/公开副本与原聊天保留。关系补充只读当前可用用户原话，无身份缓存、无额外评审模型。\n\n${review}\n\n针对家庭混淆、跨作品名与当日孩子状态新增窄事实检查，接现有一次未发布草稿重试；仍错误则去掉含错误事实的整句，不编替代事实。${replayNote}\n\n${usage} 原始证据docs/LUXUEQI-LIVE-*-2026-10-10.json；汇总与逐要求审计docs/LUXUEQI-USAGE-2026-10-10.json。完整好坏原话见[[手机版/聊天验收/陆雪琪-2026-10-10|书后对照]]，此前105次及一次截断恢复的失败仍保留。\n\n本地${roleChecks}项实际IndexedDB迁移/身份/家庭保护、表达1433项、既有声音135项、TypeScript与网页构建通过，原生exit均0。证据docs/LUXUEQI-CHECKS-2026-10-10.json、docs/LUXUEQI-PRESET-FINAL-2026-10-10.json与release/luxueqi-final-*-2026-10-10.log。真实用量和替身验证分开。\n\n三个测试启动曾设上限16，被共享代理最高12拒绝，均在请求前失败、调用0；修正12后重启，未覆盖真实证据。日志脚本曾因Unicode正则右花括号未转义而解析失败，修正后才写记录。已有iife import.meta、重复导入与大chunk警告仍在。\n\n${limits}\n\n本次保持6.0.13，未生成APK、未发布、未改官网版本；保留已有发布流程的历史记录，角色卡区分发布旧版与本地新修订。未改写电脑版日志或总览。\n\n返回 [[手机版/00-总览|手机版开发总览]]。\n`);
const indexPath = root+'/00-总览.md';let index=readFileSync(indexPath,'utf8');
if(roleChecks===77&&!readFileSync(journalPath,'utf8').includes('最终补充：77项'))appendFileSync(journalPath,'\n最终补充：77项角色检查通过，新增验证小鼎状态问句和昨天活动不能充作当前事实。修复为保留问号再判定来源，TypeScript、网页构建、表达1433项、既有声音135项及4种实际发送替身情境重验通过；未增加真实模型调用。最终审计证据docs/LUXUEQI-FINAL-AUDIT-2026-10-10.json，角色卡与用量汇总已同步最终计数。\n');
if(!index.includes('## 陆雪琪书后修订（2026-10-10）'))index += '\n## 陆雪琪书后修订（2026-10-10）\n\n- 本地设定固定到与张小凡成婚且育有小鼎之后，默认来客，认领后温柔相处；未另行打包发布，已发布版本仍为6.0.13。\n- [[手机版/角色设定/陆雪琪|完整角色卡]]、[[手机版/聊天验收/陆雪琪-2026-10-10|12组书后真实对照，含失败]]、[[手机版/开发日志/2026-10-10|实现、用量与限制]]。最长八轮，长聊和全量人味未认定达标。\n';
writeFileSync(indexPath,index);
console.log(JSON.stringify({totals,cumulative,groups:reports.length,roleChecks,checks:checks.pass,replay:replay.pass,recognizedContext,exitContext,journalWritten:true}));
