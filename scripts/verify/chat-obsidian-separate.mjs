import {readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='D:/月起云归/VirtuGene/手机版';
const snapshot='release/obsidian-chat-separation-2026-10-10.json';
if(existsSync(snapshot))throw Error('Separation already recorded; do not overwrite evidence');
const reportFile='docs/GUYUENA-LIVE-FAMILIARITY-KNOWLEDGE-TRANSFER-R3-2026-10-10.json';
const report=JSON.parse(readFileSync(reportFile,'utf8'));
if(!report.complete||report.usage.calls!==3||report.usage.total!==8414)throw Error('Unexpected live evidence');
const metadata=/^(?:人工复核|复核[：:]|评价[：:]|原始证据|证据[：:]|用量|限制[：:]|验证[：:]|本日|本轮|本组|六轮全部|前三轮|正向亲近|去掉应用|DeepSeek|全部保留|时间[：:]|完整|恢复前|F:[/\\]|R\d+(?:未达标|局部)|连续累计|模型|实际\d|付费|独立|累计|说明[：:])/u;
function speaker(line){
  const normalized=line.replace(/^\*\*/u,'').replace(/\*\*[：:]/u,'：').replace(/[：:]\*\*/u,'：');
  const match=normalized.match(/^(chatgpt|古月娜|陆雪琪)(（[^）]*）)?[：:]\s*(.*)$/u);
  return match?{speaker:match[1]+(match[2]??''),text:match[3]}:undefined;
}
function separate(source){
  const groups=[];const discarded=[];let heading='',messages=[],active;
  const flushMessage=()=>{if(active){active.text=active.text.trimEnd();messages.push(active);active=undefined;}};
  const flushGroup=()=>{flushMessage();if(messages.length)groups.push({heading,messages});messages=[];};
  for(const line of source.replace(/\r\n/gu,'\n').split('\n')){
    const role=speaker(line);
    if(role){flushMessage();active=role;continue;}
    if(/^#{1,6}\s/u.test(line)){flushGroup();heading=line;continue;}
    if(metadata.test(line.trim())){flushMessage();discarded.push(line);continue;}
    if(active)active.text+='\n'+line;else if(line.trim())discarded.push(line);
  }
  flushGroup();return {groups,discarded};
}
const evidence=[];
for(const role of ['古月娜','陆雪琪']){
  const path=root+'/聊天验收/'+role+'-2026-10-10.md';
  const original=readFileSync(path,'utf8');
  let working=original;
  if(role==='古月娜'){
    working+='\n\n## familiarity-knowledge-transfer / r3（生产对话）\n';
    for(const row of report.rows){working+=`\n**chatgpt**：${row.input}\n`;for(const reply of row.replies)working+=`\n**古月娜**：${reply}\n`;}
  }
  const parsed=separate(working);
  let output='# '+role+' · 2026-10-10聊天记录\n';
  for(const group of parsed.groups){if(group.heading&&!group.heading.startsWith('# '))output+='\n'+group.heading+'\n';for(const message of group.messages)output+='\n**'+message.speaker+'**：'+message.text+'\n';}
  const roundtrip=separate(output);
  const messages=parsed.groups.flatMap(g=>g.messages);
  const after=roundtrip.groups.flatMap(g=>g.messages);
  if(JSON.stringify(messages)!==JSON.stringify(after))throw Error('Dialogue changed during separation');
  const expected=working.split(/\r?\n/u).filter(line=>speaker(line)).length;
  if(expected!==messages.length)throw Error('A speaker record was lost');
  evidence.push({path,original,working,output,metadata:parsed.discarded,messageCount:messages.length,sha256:createHash('sha256').update(output).digest('hex')});
}
// Save exact before/after data before either vault file is changed.
writeFileSync(snapshot,JSON.stringify({date:'2026-10-10',reportFile,evidence},null,2));
for(const item of evidence)writeFileSync(item.path,item.output);
mkdirSync(root+'/优化方向',{recursive:true});
const directions=root+'/优化方向/2026-10-10.md';
const notes='\n\n## 当前优化方向\n\n- 古月娜：保留对舞麟的亲近和已核对喜好；区分喜好、听到的计划与亲历，减少编造锻造细节。\n- 陆雪琪：用自己的高兴接小事，继续减轻评价口吻，保留沉静和主见。\n- 两人：有自己的选择，也跟随对方改口；不替普通分享安排生活。\n- 不采用本次声音尾卡和情绪字段精简候选；样本未显示可靠收益。\n- 最新Gu三轮仍虚构眼睛亮、耗时和心理，只能算资料接线改进。\n- 继续做少量新场景与长聊检查；目前未达到整体人味目标。\n\n对话见[[聊天验收/古月娜-2026-10-10]]、[[聊天验收/陆雪琪-2026-10-10]]；技术与用量见[[开发日志/2026-10-10]]。\n';
if(!existsSync(directions))writeFileSync(directions,'# 聊天优化方向 · 2026-10-10\n');
appendFileSync(directions,notes);
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 喜好与亲历来源修正、日志分离\n\n- Gu自有资料将“见过他选择休息日锻造”修为“听他说计划”；按相关话题说明已知喜好/听到的计划，不新增小说事实。不相关分享不带入这段，完整原著库仍在。旧完整行精确兼容，用户改写与保存原文不覆盖。\n- 165 Gu检查、类型通过。首次测试新增变量与已有同名变量冲突，失败保留release/guyuena-knowledge-kind-local-2026-10-10.log，修正后见-final。\n- Gu三轮真实R3：首轮喜好取回、末轮未假看云；第二轮仍编整天锻造、眼睛亮和当时心理，现有检查漏过，未达标。原始${reportFile}，release/guyuena-knowledge-kind-real-2026-10-10.log。\n- Flash实际3请求input7692/output722/total8414，usage完整、stop，单次上限500含推理、全组预算4无额外评分。数据库发送真实，摘要/提取/结算替身，上游非流式，非Android。Gu连续488展示/84回放/406付费，input1285566/output47738/total1333304，本日连续140请求374703tokens；冻结20请求51217、独立3请求7695另计。本轮Lu未新增付费调用。\n- 用户新增要求：对话与方向分开、方向简短。今天两角色文件保留场景标题、原话和多段消息，移除复核/用量说明；${snapshot}保存精确前后与剥离内容，逐条speaker/text回读一致。新方向文件[[优化方向/2026-10-10]]简短列下一步，详细技术/证据只在本开发日志。\n- 所有测试进程已结束，凭据未输出或存档；6.0.13保持，未打包、未发布、电脑版不动。\n`);
appendFileSync(root+'/00-总览.md','\n- 聊天原话与优化方向已分开：[[聊天验收/古月娜-2026-10-10]]、[[聊天验收/陆雪琪-2026-10-10]]；简短方向见[[优化方向/2026-10-10]]，技术证据及用量见[[开发日志/2026-10-10]]。\n');
console.log(JSON.stringify({snapshot,messageCounts:evidence.map(x=>({role:x.path.includes('古月娜')?'古月娜':'陆雪琪',count:x.messageCount})),usage:report.usage}));
