import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';

const root = 'D:/月起云归/VirtuGene/手机版';
const reportNames = readdirSync('docs').filter(name => /^LUXUEQI-LIVE-.*-2026-10-09\.json$/u.test(name));
const reports = reportNames.map(name => ({ name, data: JSON.parse(readFileSync('docs/' + name, 'utf8')) })).sort((a, b) => a.data.date.localeCompare(b.data.date));
if (reports.length !== 17 || reports.some(({ data }) => !data.usage || !data.providerCalls)) throw Error('Live evidence is missing or still running; do not journal unfinished usage');
const totals = reports.reduce((sum, { data }) => ({ calls: sum.calls + data.usage.calls, input: sum.input + data.usage.input, output: sum.output + data.usage.output, total: sum.total + data.usage.total }), { calls: 0, input: 0, output: 0, total: 0 });
const recovered = reports.flatMap(({ name, data }) => data.providerCalls.filter(call => call.finish === 'length').map(call => ({ name, ...call })));
const checks = JSON.parse(readFileSync('docs/LUXUEQI-CHECKS-2026-10-09.json', 'utf8'));
if (!checks.pass) throw Error('Final local checks have not passed');
const scope = '本地实际私聊发送入口与IndexedDB回读，真实DeepSeek V4.1 Flash（deepseek-flash）请求；上游非流式JSON，摘要、记忆提取与结算为替身。complete只代表传输与保存，不评分人味。早期对照固定主动倾向0.5；boundary、continuity后组以及新增温柔接线组按预设0.2。';
const summary = { date: '2026-10-09', scope, totals, recovered, reports: reports.map(({ name, data }) => ({ file: 'docs/' + name, scene: data.scene, revision: data.revision, complete: data.complete, turns: data.rows.length, usage: data.usage })), checks: 'docs/LUXUEQI-CHECKS-2026-10-09.json', note: 'First 32 calls used the initially authorized first desktop DeepSeek credential. The remaining 73 calls used the desktop credential matched to the subsequently specified user key. No key contents are stored.' };
writeFileSync('docs/LUXUEQI-USAGE-2026-10-09.json', JSON.stringify(summary, null, 2));

let dialogue = `# 陆雪琪 · 2026-10-09 真实对照记录\n\n${scope}\n\n共${reports.length}组，${totals.calls}次实际调用，input ${totals.input} / output ${totals.output} / total ${totals.total} tokens（含思考、失败与恢复）。一个原作组先截断再恢复，测试只跑到第四轮，不隐去该失败。\n\n`;
for (const { name, data } of reports) {
  dialogue += `## ${data.scene} / ${data.revision}\n\n时间：${new Date(data.date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）。${data.complete ? '传输完整' : '未完成整组'}；调用${data.usage.calls}，input ${data.usage.input} / output ${data.usage.output} / total ${data.usage.total}。原始证据：\`F:/VirtuGene-Mobile/docs/${name}\`。\n\n`;
  for (const row of data.rows) {
    dialogue += `chatgpt：${row.input}\n\n`;
    for (const reply of row.replies) dialogue += `陆雪琪：${reply}\n\n`;
    if (row.calls.some(call => call.finish === 'length')) dialogue += `本轮包含截断及原生恢复；逐次返回与用量保留于原始JSON，没有把恢复算作新用户一轮。\n\n`;
  }
}
dialogue += '## 人工复核与限制\n\n早期有恋人例句越过身份条件、编造天琊在匣与未眠近况、滴血洞经历串错和将天琊说成白色寒气剑；均保留在上方原话。调整后原作组能区分蓝色剑光与滴血洞人物，记不清的指定章台词明确不逐字编造。新温柔组能回应小凡的想念和害羞，也明确反对伤及无辜；退场后撤去恋人语气。\n\n仍可见审视与许可措辞、自认无证据的误会、多余邀聊与少量对比旁人的话，不能宣称完全贴合原著或真人人味达标。贴合度只覆盖已核对的核心背景与本次情境，不是逐章全文验收。每组最长八轮，小样本不证明长期稳定；群聊、主动聊天、真机和真实摘要/提取质量未验收。新关系补充目前只接私聊，使用实际可用的用户原话；复杂非开头声明和超出本地加载范围的身份原话仍依赖原人设与可用记忆。用户编辑的人设不强行加补充。\n\n返回 [[手机版/00-总览|手机版开发总览]]。\n';
writeFileSync(root + '/聊天验收/陆雪琪-2026-10-09.md', dialogue);

const source = readFileSync('src/lib/lu-xue-qi-preset.ts', 'utf8');
const prompt = source.match(/systemPrompt: `([\s\S]+?)`,\s*\n\};/u)?.[1];
if (!prompt) throw Error('Missing final authored persona');
const oldCard = readFileSync(root + '/角色设定/陆雪琪.md', 'utf8');
const releaseHeader = oldCard.split('## 完整人设')[0];
const card = releaseHeader + `## 完整人设（可复制）\n\n${prompt}\n\n## 关系承接与验证\n\n开发实现借鉴古月娜相认后的熟悉与温柔：用户明确说是鬼厉/张小凡后，由当前可用用户原话提供关系补充与温柔语气参考；退出或否认后撤去。不开新婚姻、不把陆雪琪写成其他作品的人物，不从角色自己的旧台词认定用户身份。只处理原样预设与未被用户编辑的副本；编辑过的人设仍由用户定义。\n\n当前最终接入58项、表达1433项、既有预设声音135项、类型与网页构建通过；真实模型${totals.calls}次调用，完整好坏原话见[[手机版/聊天验收/陆雪琪-2026-10-09|对照记录]]。最长八轮，不代表长聊或真人人味达标。补充只接私聊，群聊和主动入口靠完整人设，尚未做真实专项验收。\n\n## 背景依据\n\n- [官方人物编年史](https://zhuxian.wanmei.com/net/201517history/)：门派、师承与基础人物关系。\n- [官方剧情梳理](https://zx.wanmei.com/hot/20160729/index.html)：张小凡与陆雪琪失散后，和碧瑶被困滴血洞，区分经历归属。\n- [官方五大神器介绍](https://zhuxian.wanmei.com/news/gamenews/200801/20080102103153.shtml)：天琊蓝光，寒冰剑白光寒气。只借小说背景说明，不引入游戏技能或续写。\n- [DeepSeek官方模型说明](https://api-docs.deepseek.com/zh-cn/news/news260910/)：V4.1 Flash使用deepseek-flash模型名。\n\n以上官方游戏整理用于交叉核对基础事实，不等同逐章核对小说。聊天习惯、温柔示例和关系选择是应用演绎，不是原作台词；未核对的细节不能冒称原文。\n\n返回 [[手机版/00-总览|手机版开发总览]]。\n`;
writeFileSync(root + '/角色设定/陆雪琪.md', card);

const entry = `\n## 陆雪琪：原作基础、温柔关系承接与Flash真实复验\n\n本轮继续完成陆雪琪设计优化，用户补充要求贴合原作、认领鬼厉或张小凡后借鉴古月娜机制温柔相处，并指定V4.1 Flash测试凭据。测试密钥只在内存中用于代理，未打印、未写入项目、日志或进程参数；早期32次使用用户先指定的桌面首条DeepSeek凭据，后续73次使用与用户后来明确指定密钥匹配的桌面条目。\n\n- 陆雪琪默认身份未定；相认后熟悉而温柔、坦率说想念，不重做初见，不借用古月娜婚姻/人物往事。保留陆雪琪师门牵挂、独立判断和对碧瑶的尊重，不为所爱伤害无辜。校正天琊蓝光与滴血洞人物；来源与完整设定见[[手机版/角色设定/陆雪琪|角色卡]]。\n- 发现通用声音样本会把“小凡”亲密样句带入初见与鬼厉讨论；撤出未受身份条件保护的样句。私聊新增lu-xue-qi-runtime：只读取当前可用用户原话的明确自称、否认和退出，不读角色自己编的身份，过滤引用/转述/假设。提供单独关系提示和受认领条件保护的温柔声音示例；不写身份事实缓存，不改保存人设。五个完整开发旧版仅对未编辑、未公开副本迁移，用户编辑与原记录保留。\n- 修复共享直接心意识别遗漏“我有点/有一点/有些/有一些喜欢你或想你”的问题；保留否认、引用、假设和实际对象边界。没有新增每轮评审模型调用。\n- 真实对照17组，105次实际调用；input 295674 / output 11976 / total 307650 tokens（含思考及失败/恢复）。原作R1第四轮发生一次length，原生恢复仍错误把陆雪琪放进滴血洞，整组只完成4轮，不能计作通过。最终原作R3完成6轮；新增温柔TENDERNESS能短而温柔接住小凡，也反对伤无辜。所有好坏原话按chatgpt/陆雪琪保存在[[手机版/聊天验收/陆雪琪-2026-10-09|完整对照]]；汇总证据F:/VirtuGene-Mobile/docs/LUXUEQI-USAGE-2026-10-09.json。\n- 陆雪琪58项实际IndexedDB与关系接线、共享表达1433项、既有预设声音135项、TypeScript与网页构建通过。检查及真实用量分开计数。本地检查原生进程exit均0，证据docs/LUXUEQI-CHECKS-2026-10-09.json及release/luxueqi-final-*.log。此前PowerShell直接重定向原生stderr将警告显示为shell失败，已用Node子进程保留真实退出码，不以shell状态误判检查结果。\n- 检查时发现另一个发布流程已将版本改为6.0.13/build55并记录发布及资源核对；本优化任务未自行递增版本、生成APK或再次发布，保留该发布状态。独立源码当前版本为6.0.13，不将后续测试记录误说为打包阶段已做的验收。\n- 仍有自认无证据的误会、许可/审视用词、多余邀聊、比喻和对旁人的对比。温柔示例有复用，不证明自由表达稳定；原作只核对核心事实，未逐章全文验收。最长八轮、私聊、真实上游非流式；摘要/提取/结算为替身。群聊、主动入口、超长历史/复杂声明、真机和全量人味仍有验证限制。新补充依赖当前实际加载的原话，不声称永久确定性身份状态。原有iife import.meta、静态/动态重复引用和大chunk警告仍在。\n\n返回 [[手机版/00-总览|手机版开发总览]]。\n`;
const journal = root + '/开发日志/2026-10-09.md';
if (!readFileSync(journal, 'utf8').includes('## 陆雪琪：原作基础、温柔关系承接与Flash真实复验')) appendFileSync(journal, entry);
const index = root + '/00-总览.md';
let indexText = readFileSync(index, 'utf8');
indexText = indexText.replace('角色接入通过本地验证，未做真实模型长聊验收。', '角色接入及相认温柔机制通过本地验证，已做Flash真实短场景对照；最长八轮，未认定长聊和人味达标。');
if (!indexText.includes('[[手机版/聊天验收/陆雪琪-2026-10-09')) indexText += '\n## 陆雪琪对照\n\n- [[手机版/聊天验收/陆雪琪-2026-10-09|陆雪琪 · 17组真实对照，含原作串错与修正、相认温柔及退出边界]]。\n';
writeFileSync(index, indexText);
console.log(JSON.stringify({ totals, groups: reports.length, checks: checks.pass, journalWritten: true }));
