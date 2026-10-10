import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-gu-voice-compaction-comparison-2026-10-10.json';
if(existsSync(evidence))throw Error('Existing journal evidence must not be overwritten');
const files=['R2','R3'].map(revision=>`docs/GUYUENA-LIVE-LISTENING-CHOICE-TRANSFER-${revision}-2026-10-10.json`);
const reports=files.map(file=>JSON.parse(readFileSync(file,'utf8')));
if(reports.some(r=>!r.complete||r.rows.length!==3||r.usage.missingUsage||r.rows.some(row=>row.failed))||reports[0].guVoiceCompaction||!reports[1].guVoiceCompaction)throw Error('Completed controlled variants required');
if(reports[0].rows.some((row,index)=>row.input!==reports[1].rows[index].input))throw Error('Different input sequences');
const comparison=reports[0].rows.map((row,index)=>{
  const original=row.calls[0].messages.find(m=>m.role==='system').content;
  const candidate=reports[1].rows[index].calls[0].messages.find(m=>m.role==='system').content;
  return {input:row.input,systemCharsBefore:original.length,systemCharsAfter:candidate.length,systemCharsSaved:original.length-candidate.length};
});
const usage=reports.reduce((a,r)=>({calls:a.calls+r.usage.calls,input:a.input+r.usage.input,output:a.output+r.usage.output,total:a.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const path=root+'/聊天验收/古月娜-2026-10-10.md',before=readFileSync(path,'utf8');
const heading='## listening-choice-transfer / r1（生产对话）';
const start=before.indexOf(heading);
if(start<0)throw Error('Prior whole group missing');
const next=before.indexOf('\n## ',start+heading.length),end=next<0?before.length:next;
let block='## listening-choice-transfer / r2（生产对话）\n';
for(const row of reports[0].rows){block+='\n**chatgpt**：'+row.input+'\n';for(const reply of row.replies)block+='\n**古月娜**：'+reply+'\n';}
const after=before.slice(0,start)+block+before.slice(end);
const reason='R2整组没有R1的虚构声音轻、不爱重复和脖子酸；比R3少一个明确以前独处得久的自述。R2仍有陪骂引导、末轮我想去热闹的地方与前面选择不一致，不视为达标。';
writeFileSync(evidence,JSON.stringify({files,usage,comparison,selected:files[0],reason,before,after,productionAdopted:false,qualityComplete:false,scope:'One fresh paired three-turn diagnostic; no statistical attribution of quality, input totals also reflect different generated histories'},null,2));
writeFileSync(path,after);
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 重复语气指导的对照\n- 试验只精简古月娜自有重复指导，事实和末尾声音卡保留，每轮少591个system字。\n- 偏爱表达更直接，但仍补未经核实的经历；仅一组三轮对照不足以启用。保留整组较好原版，继续处理观点连续性与源外自述。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 古月娜自有声音指导精简实验，未启用生产\n- 上轮为进展：跨会话原话来源校验已接线并通过两角色完整固定稿夹具。本轮继续内容层，读取runtime、care和声音卡，发现care作者反应在头部与尾部重复。新增compactGuYueNaOwnedVoice保守实验：必须是Gu来源、原保存人设完整含当前自有care、请求恰有一个尾声音卡；只去自有care头部的重复反应行，判断行仅在尾卡完整覆盖时去重。身份、消息场景、原著资料与用户外部文字保留；编辑过的care整体不处理，存储不改。\n- 实验只在chat-human-live的显式LIVE_GU_VOICE_COMPACT开关执行，runner用专用测试环境变量控制且Gu-only/不可与旧稿回放混用，报告记录开关。正式send-service没有调用该函数，因此没有启用未经验证的候选。baseline/candidate其余生成、人物proactivity、原有源校验和单次重试保持同版；候选仅在发送前改system，真实代理记录的是改后的payload。\n- 同一listening-choice-transfer三输入，当前生产R2与候选R3各3实际请求，不与以前不同代码的R1直接当作受控基线。两组均complete，usage无缺失、stop、无重试。system每轮均少591字。输入token原版7687、候选6598（此组约14.2%降低，后续history不同也影响总数，不能把所有差值归因于去重）。\n- R2仍倾向回执+陪骂，末轮突然说自己想去热闹的地方，和前面安静选择不一致。R3首轮“我偏心你”更直接，后续仍讲“以前独处得久”的未核实自述、“别把我丢在人堆里”的附加条件以及听察声音，未证明更自然、可靠。一次随机三轮不证明广泛性格增益，不启用生产；数据使下一步转向观点连续与自述出处，而非继续盲减提示。没有追加付费请求直到挑到漂亮稿。\n- 本轮6实际调用，输入${usage.input}/输出${usage.output}/总${usage.total}；baseline7687/464/8151，candidate6598/451/7049；每次500输出上限。deepseek-flash实际private send/IndexedDB，非流式，摘要/提取/结算替身，非Android/长期漂移验收。凭据内存读取，无输出/落盘。raw证据${files.join('、')}，release/guyuena-voice-{base,compact}-2026-10-10.log，终止句柄核实后才读complete JSON；PowerShellexit1为esbuild警告，未重复启动。\n- 8项新本地验证覆盖字数下降、尾卡契约逐字保留、身份/来源/场景、无完整尾卡判断保留、其他角色不改、用户外部文字、无尾卡不改、编辑care不改，最终1994项通过release/chat-gu-voice-compaction-verified-2026-10-10.log；类型通过release/chat-gu-voice-compaction-types-2026-10-10.log。不把本地契约通过等同于模型人味。\n- 整组选择R2替换旧R1，${reason}。候选与原R1原报告都保留；原展示备份、完整替换、比较${evidence}。没有拼不同版本句子，输入标chatgpt。Lu对话组与人设未改，尚未启动同类实验。\n- Gu连续累计531展示/85回放/449付费，输入1389814/输出53068/总1442882；今日连续183调用484281。Lu无新增调用。全面自然度、来源和长聊仍未完成；6.0.13不变，不打包、不发布、不更新官网。\n`);
appendFileSync(root+'/00-总览.md','\n- Gu提示去重对照：1994项与类型通过，6实际请求15200token；候选节省输入但内容证据不足，生产未启用。只展示较好整组R2，问题与实验原稿分开保留，目标未完成。\n');
console.log(JSON.stringify({usage,comparison,productionAdopted:false,qualityComplete:false}));
