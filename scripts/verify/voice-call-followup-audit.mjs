import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir='.tmp-preview/voice-call-followup-20261015';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const comparison=read('.tmp-preview/voice-preparation-20261015-r2/comparison.json');
const median=xs=>{const values=[...xs].sort((a,b)=>a-b);return(values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2;};
const preparation=comparison.results.map(r=>({label:r.label,medianMs:median(r.samples.map(s=>s.prepareMs)),rows:r.samples[0].preparation.rows,
 suppressedRows:r.samples[0].preparation.tables.memorySourceTombstones,promptHashes:[...new Set(r.samples.map(s=>s.promptHash))]}));
const files=['src/lib/voice-call/controller.ts','src/lib/voice-call/context.ts','src/lib/character-memory.ts','src/lib/chat/reviewed-speech.ts','src/store/voice-call-store.ts','src/lib/voice-call/record.ts','scripts/verify/voice-call-boundary-audit.ts','scripts/verify/character-memory.ts'];
const report={date:'2026-10-15',workdir:'F:/VirtuGene-Mobile',codingModel:'GPT-6',reasoningEffort:'未确认',appVersionChanged:false,apkBuilt:false,published:false,realApiCalls:0,modelTokens:0,
 userConstraint:'Paid testing declined explicitly; only local isolated verification is authorized.',
 fixes:['Early recognition reserves one queue slot for the final tail, avoiding three-clause loss during slow ASR.',
 'Speech resumed after an endpoint joins the still-recognizing pending turn instead of erasing it. Unuploaded tails merge within the existing two-slot/30-second bounds. Discarded short noise releases the predecessor endpoint.',
 'Fresh source validation occurs before dialogue transmission, as well as before synthesis/playback.',
 'Stable request ids associate overlapping TTS usage receipts with the correct persisted request, including out-of-order callbacks.',
 'Preparation queries use exact selected message/source ids for suppression checks in current history, speech samples, summaries and final candidate checks; genuine historical candidate retrieval retains scoped indexes.'],
 boundaries:read('.tmp-preview/voice-call-boundary-audit-20261015/after.json'),
 transmission:{before:read(`${dir}/transmission-before.json`),after:read(`${dir}/transmission-after.json`)},
 usage:read('.tmp-preview/voice-latency-native-20261015/usage-after.json'),
 preparation:{samples:preparation,promptUnchanged:comparison.promptUnchanged,errors:comparison.errors,scope:'real isolated IndexedDB; CPU 4x desktop; simulated model/audio. No actual API, Android or physical first-sound measurement.'},
 limitations:['Real MiMo latency and Android/Bluetooth sound remain unverified; goal not achieved.',
 'JS capture receipt timing can understate native silence after a stalled main thread; explicitly not physical latency evidence.',
 'No same-condition before UI screenshots or recording for these nonvisual changes.',
 'Old-race test injection was updated from single-get to batched read boundary; it still verifies actual deletion/edit and excludes stale prompt contents.',
 'No supported official sidebar-project move interface; internal Codex state was not changed.'],
 hashes:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))};
writeFileSync(`${dir}/audit.json`,JSON.stringify(report,null,2));
if(process.argv.includes('--log')){
 const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md';
 const heading='语音本地续验：慢识别续说保留、用量归属和准备扫描';
 if(!readFileSync(log,'utf8').includes('## '+heading))appendFileSync(log,`\n\n## ${heading}\n\n- 工作目录F:/VirtuGene-Mobile；可见编码模型GPT-6，推理强度未确认，编码用量未确认。用户明确暂不允许付费测试，继续本地；真实产品API0、tokens0、麦克风0。未升App版本、未打包发布。目标仍在进行，未认定实际快速通话达标。\n- 已复现与修复：两次early占满队列后第三小句丢失；现在early只使用空闲识别路径，给最终尾句留槽。停顿800ms后继续说、首ASR未完成时原先取消前句；现在同轮保留并合并未上传尾段，不重发已上传PCM。100ms噪声discard可恢复原终点，不永久等待；重复续说仍在2槽/每WAV30秒内。界面已进入回复/播音时继续沿用打断与归档。\n- 传输前fresh来源核验补齐：修改前反例会把已撤回准备内容传给1次模拟dialogue、TTS0；改后模型/TTS均0。并行两句TTS的usage现在按稳定requestId而非最后同stage归属，正常/乱序回执17项均过；真实store→controller→IndexedDB保存与旧无ID记录兼容。\n- 准备阶段修改已从被中断的工作保留并验证：context近期消息/已选记忆来源、声音样本、摘要依赖、最终候选/引用均按相关ID查抑制；真正候选历史检索仍读账号角色复合索引，未剪上下文或跨轮缓存授权。6次准备对照前后：${JSON.stringify(preparation)}。完整模型输入hash一致；桌面4倍降速、真实隔离DB与模拟传输，不能作为手机普遍提速。详见.tmp-preview/voice-preparation-20261015-r2/comparison.json。\n- 必要回归：边界反例与修后、噪声/重复续说通过；控制器327、host129、context56、usage17、记忆415通过；tsc和网页构建通过。全记忆旧用例先因单get钩子未触发失败，适配新bulkGet读取边界后仍要求实际删除/编辑发生并排除旧内容，最终通过。既有IIFE/分包警告保留。\n- 证据F:/VirtuGene-Mobile/${dir}/audit.json；边界before/after在.tmp-preview/voice-call-boundary-audit-20261015/；usage在.tmp-preview/voice-latency-native-20261015/；改动文件及当前hash见audit。没有本轮改前UI图/录像，不伪造视觉对照。\n- 限制：主线程阻塞后JS收包时间会低估录音停顿，已有receipt口径标记，仍不能证明物理首声。真实MiMo/Android/蓝牙/长通话尚未验证，不再请求或执行本轮付费调用；保留整体目标进行中。\n`);
 const index='D:/月起云归/VirtuGene/手机版/00-总览.md';
 const entry='- [[手机版/开发日志/2026-10-15|语音本地续验]]：修复慢识别续说丢话及并发用量归属，准备扫描对照完成；用户暂不允许付费测试，真实通话速度尚未验收。';
 if(!readFileSync(index,'utf8').includes(entry))appendFileSync(index,'\n'+entry+'\n');
}
console.log(JSON.stringify({preparation,promptUnchanged:comparison.promptUnchanged,evidence:`${dir}/audit.json`,goalComplete:false}));
