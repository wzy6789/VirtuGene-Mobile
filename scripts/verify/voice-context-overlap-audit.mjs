import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-context-overlap-20261015';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const browser = json(`${dir}/browser-comparison.json`), virtual = json(`${dir}/comparison.json`);
const simulation = json(`${dir}/after.json`);
const memory = readFileSync(`${dir}/memory-regression.txt`, 'utf8').replaceAll('\0', '');
const host = json('.tmp-preview/voice-call/host-result.json'), context = json('.tmp-preview/voice-call/context-result.json');
assert.equal(browser.actualReadsUnchanged, true); assert.equal(browser.fullInputHashesUnchanged, true);
assert.equal(browser.modelRequestCountsUnchanged, true); assert.ok(browser.guards.every(guards => guards.length === 7));
assert.ok(memory.includes('415 assertions') && memory.includes('ALL PASS'));
assert.equal(host.checks, 129); assert.equal(context.checks, 56);
const sourceFiles = ['src/lib/voice-call/controller.ts', 'src/lib/voice-call/context.ts', 'src/lib/voice-call/trace.ts',
  'src/lib/character-memory.ts', 'src/store/voice-call-store.ts'];
const report = {
  date: new Date().toISOString(), workdir: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认',
  phase: 'P1-local-context-overlap', goalComplete: false, apiCalls: 0, apiTokens: 0,
  microphone: false, apkBuilt: false, versionChanged: false, published: false,
  implementation: ['Host explicitly enables one local early context preparation per voice turn, only after final ASR result',
    'Any resumed voiced frame invalidates preparation; immutable revision and final transcript checked before accepting',
    'Source/owner/visibility/revision checks still run before real model transmission, synthesis and PCM append',
    'Early context cannot initialize world/relationship state; cold initialization falls back to final preparation',
    'Local memory retrieval prefix is read-only; unchanged final endpoint releases normal ledger writes and validations',
    'Cancellation rejects bookkeeping gate; no speculative LLM/TTS requests, no repeat early attempts',
    'Wall preparation, endpoint gate wait, overlap, residual wait and discarded attempt count remain distinct'],
  browser, virtual, virtualChecks: simulation.checks,
  regression: { memory: 415, controller: 327, host: host.checks, context: context.checks,
    usage: json('.tmp-preview/voice-latency-native-20261015/usage-after.json').checks,
    revokedTransmission: json('.tmp-preview/voice-call-followup-20261015/transmission-after.json'),
    typescript: 'exit 0', webBuild: 'exit 0; existing bundle/mixed-reference warnings remain' },
  failuresAndCorrections: ['Initial synthetic pause fixture called a nonexistent controller.pause; corrected to native paused event',
    'Write-probe failed: eager memory retrieval made 32 writes (claims/evidence/knowledge/usage) before endpoint, despite identical input hash',
    'Corrected by deferring existing bookkeeping behind endpoint gate, not by removing bookkeeping; final 7 guards and 30-round stocked-DB comparison pass',
    'One intermediate browser run used an updated post-run guard and failed it; final before/after run uses the same complete fixture; initial raw comparison retained under browser-initial/'],
  limitations: ['Synthetic service/audio stages and desktop CPU throttling are not Android or MiMo latency',
    'Continued speech can discard one early local query and require final fresh preparation; local DB work can increase in that case, bounded to one early attempt',
    'Slow ASR is unaffected; no universal 3-5x speedup claimed',
    'No new UI preview or same-condition before/after video in this data-pipeline batch',
    'Source changes are not delivered to an installed APK'],
  remaining: ['Complete P0 clock correlation/route timeline and query accounting scope',
    'Input/endpoint policy comparison with noise and hesitation fixtures',
    'Unpunctuated phrase latency and continuous inter-segment playback',
    'Bidirectional Bluetooth route drift protection and bounded state recovery',
    'Expanded simulated MiMo protocol/late-event/lifecycle matrix and final plan audit',
    'P3 background continuous calling remains a conditional separate scope; current background pause preserved'],
  sourceHashes: sourceFiles.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
};
writeFileSync(`${dir}/audit.json`, JSON.stringify(report, null, 2));
const statusPath = '.tmp-preview/voice-realtime-plan-20261015/status.json';
const status = json(statusPath);
status.goalComplete = false; status.phase = report.phase;
status.milestones ??= []; status.milestones.push({ evidence: `${dir}/audit.json`, date: report.date, phase: report.phase });
status.next = report.remaining;
writeFileSync(statusPath, JSON.stringify(status, null, 2));
if (process.argv.includes('--log')) {
  const b = browser.summary[0].softwarePlaybackFromSpeech, a = browser.summary[1].softwarePlaybackFromSpeech;
  appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md', `

## 实时通话P1：最终转写后的本地上下文准备与判停重叠

- 实际目录F:/VirtuGene-Mobile；可见模型GPT-6，推理强度未确认。业务MiMo实际API请求/token/音频用量均0；没有读取真实密钥/私人备份、没有麦克风/真实声音/手机测试，没有安装依赖、升版本、生成安装包、装机或发布。
- 生产变化controller.ts、context.ts、trace.ts、character-memory.ts、voice-call-store.ts：正式ASR结果后最多提前准备一次本地上下文；续说任一有效帧取消旧准备，最终轮末+文本/语音版本一致才接受。保留700ms判停，不提前LLM/TTS，不缩减完整上下文，不减少来源核验。记忆共享文件只加可选beforeLedgerWrite闸门字段和调用点，默认路径不改；修改前快照在${dir}/before/。
- 发现并修正了真实副作用：检索会向memoryClaims/Evidence/Knowledge/Usage各写8行，直接提前运行违反“未确认输入不留事实”边界。失败证据guards-run.txt/guards-run-2.txt保留；已将相同32次写入等到有效最终轮末后放行，取消则0写入。缺世界/关系状态时提前准备不初始化，最终路径正常初始化。7个真实DB闸门/撤权/取消检查通过。
- 四个可控时序分层各30轮/版本，修改后${simulation.checks}项，快速ASR下首播P50分别1360→1100ms、1860→1600ms、1160→1060ms；慢ASR1900ms不变。完整模型/TTS输入与WAV hash、请求次数、必要源检查次数一致。初始模拟pause调用不存在方法，已改为原生paused事件后重跑。
- 最终有存量资料对照（每版本30轮，4倍CPU桌面Chrome，真实隔离IndexedDB+模拟MiMo/播放）：软件首播相对语音末帧P50 ${b.p50.toFixed(1)}→${a.p50.toFixed(1)}ms，P95 ${b.p95.toFixed(1)}→${a.p95.toFixed(1)}ms；最终残余准备P50 481.4→214.7ms。2000消息、13605失效记录（含8105同账号其他角色）、10000无关知识、5000约定、10000动态已读；完整模型输入hash、WAV、数据库每表读取/事务/请求数逐轮一致。不是Android/物理首声或MiMo服务计时，不承诺普遍提速倍数。最初未加写入闸门的数字另存browser-initial，不与最终数据拼接。
- 时间口径：contextPreparationMs是起止wall time，可能含endpoint gate等待；contextEndpointGateWaitMs单列，不当CPU耗时。contextPreparationOverlapMs表示重叠wall区间，不能与累计复核时间相加；contextResidualWaitMs才是最终判停后仍等待的准备。
- 回归：415记忆、327控制器、129宿主、56上下文、17用量归属通过；撤权准备禁止模型派发通过，类型检查及Web构建通过。既有haptics测试打包import.meta提示和构建包体/混合引用提示保留，不虚写零告警。
- 证据${dir}/audit.json、comparison.json、browser-comparison.json、before/after.json、browser-before/after.json、browser-final-run.txt、memory-regression.txt、build.txt。没有本轮同条件前后录屏；无需界面/麦克风预览来证明时序，无新增Library产物。
- 尚未完成：时钟关联与路由时间线、端点策略/噪声夹具、无标点切句/句间衔接、蓝牙双向路由漂移保护与有限恢复、MiMo异常矩阵及总验收；P3后台持续通话保持独立条件项。续说会浪费至多一次本地候选准备，需一次最终新准备，不能说所有情况下查询数不增加；慢ASR无收益。方案目标保持active，不因当前局部通过宣称全方案完成，也不要求用户提供真机。
`);
  appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md', '\n- [[开发日志/2026-10-15#实时通话P1：最终转写后的本地上下文准备与判停重叠|实时通话P1上下文重叠]]：只读准备与轮末重叠、台账写入等最终确认；每组30轮有存量资料首播P50约1594→1254ms，输入与读取逐轮一致；取消/撤权与415记忆回归通过，蓝牙/播放后续继续，未付费/打包。\n');
}
console.log(JSON.stringify({ phase: report.phase, evidence: `${dir}/audit.json`, goalComplete: false, softwareTiming: browser.summary }));
