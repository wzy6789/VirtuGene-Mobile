import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = '.tmp-preview/voice-realtime-plan-20261015';
const sourceFiles = ['src/lib/voice-call/controller.ts', 'src/lib/voice-call/context.ts',
  'src/lib/voice-call/native-audio.ts', 'src/lib/voice-call/mimo.ts', 'src/lib/voice-call/trace.ts',
  'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java'];
const comparison = JSON.parse(readFileSync(`${dir}/timeline-comparison.json`, 'utf8'));
const timeline = JSON.parse(readFileSync(`${dir}/timeline-after.json`, 'utf8'));
const context = JSON.parse(readFileSync('.tmp-preview/voice-context-latency-20261015/context-regression.json', 'utf8'));
const readText = path => readFileSync(path, 'utf8').replaceAll('\0', '');
const report = {
  date: new Date().toISOString(), workdir: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认',
  goalComplete: false, phase: 'P0-partial', apiCalls: 0, apiTokens: 0, microphone: false,
  apkBuilt: false, versionChanged: false, published: false,
  implemented: ['Bounded per-turn JS timeline with request/segment identity and separate enqueue/render observations',
    'All controller source-check timings now include contextual speech-review nested checks',
    'Native read completion and optional AudioRecord boottime frame timestamp, kept separate from JS time',
    'Explicit MiMo complete-audio/SSE/PCM capability manifest without imaginary realtime API'],
  verification: { comparison, timelineChecks: timeline.checks,
    contextCurrent: context.results.find(row => row.label === 'after'),
    contextHistoricalBaselineFailure: context.results.find(row => row.label === 'before'),
    typescript: 'exit 0 in terminal',
    nativeCompilation: /BUILD SUCCESSFUL/.test(readText(`${dir}/java-compile.txt`)),
    webBuild: /built in/.test(readText(`${dir}/build.txt`)),
    controller: JSON.parse(readFileSync('.tmp-preview/voice-call/controller-result.txt', 'utf8').trim()),
  },
  next: ['Integrate capture-clock correlation intervals and route-generation/I-O evidence without mixing clocks',
    'Measure populated DB and include actual query-row/transaction costs at all source checks',
    'Compare safe endpoint/local preparation overlap without new speculative model calls',
    'Improve unpunctuated phrase latency and inter-segment playback while preserving speech quality and cancellation',
    'Add bidirectional-route drift protection and bounded recovery with native event injection',
    'Expand MiMo synthetic protocol and turn/route matrix, >=30 rounds per primary scenario'],
  limitations: ['No real provider latency, physical first sound or Bluetooth/OEM compatibility evidence',
    'No same-condition before/after screenshots this implementation batch',
    'P3 background continuous calling is conditional and not enabled',
    'Codex project move unavailable through a confirmed official interface; no internal configuration edits'],
  sourceHashes: sourceFiles.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
};
writeFileSync(`${dir}/status.json`, JSON.stringify(report, null, 2));
if (process.argv.includes('--log')) {
  appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md', `

## MiMo实时通话方案实施：P0首批时间线与来源复核计数

- 工作目录F:/VirtuGene-Mobile；实际可见模型GPT-6，推理强度未确认。业务API请求/token/音频用量均0；未读密钥、未开麦、未新增依赖、未改版本、未打包安装或发布。
- 按桌面《实时通话与蓝牙稳定性优化方案》开始实施。新增trace.ts及timeline验证入口，修改controller/context/native-audio/mimo与VoiceCallAudioPlugin.java；保留当前并行改动，修改前快照位于${dir}/before/，未从HEAD复原。
- 已加入128条有界逐轮时间线，保留起始及最新停止记录；标明JS单调时钟。原生独立记录read完成、capture generation与可选AudioRecord boottime帧时钟，不跨时钟相减，不当作物理首声或精确声学端点。审核内部assertCurrent计入来源复核次数/累计耗时，不减少核验。
- 同条件30轮：修改前123项、修改后${timeline.checks}项，完整模型/语音输入hash、各类请求数量、实际授权检查次数与模拟首播等待不变。当前controller327项、latency62项、native-input-contract19项通过；类型检查、Web构建、原生Java编译通过，未生成APK。
- 失败如实保留：context-regression历史before快照不符合当前跨世界记忆撤权契约而失败；当前after56项通过。新timeline脚本首次CJS顶层await打包失败，改为async main后通过。构建仍有既有混合引用/包体提示；不是全方案验收通过。
- 证据${dir}/status.json、timeline-before/after.json、timeline-comparison.json、build.txt、java-compile.txt；context历史失败原始记录.tmp-preview/voice-context-latency-20261015/context-regression.json。
- 本批只完成P0部分可观测性，没有新增速度收益声明。待续：时钟区间关联、全部读取行数/事务、端点及本地准备重叠对照、无标点切句、连续播放与双向路由漂移保护、分层30轮协议/竞态覆盖。P3后台持续通话未启用。真实服务/蓝牙硬件/物理首声未验证，不要求用户提供真机；无同条件前后录屏。源码变化未装机。
`);
  appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md', '\n- [[开发日志/2026-10-15#MiMo实时通话方案实施：P0首批时间线与来源复核计数|MiMo实时通话方案P0首批]]：时间线/原生独立时钟/嵌套复核计数，30轮输入及请求一致；723项与327控制器、62节奏、56当前上下文通过。历史基线失败保留；未付费/打包，提速与蓝牙实施继续。\n');
}
console.log(JSON.stringify({ phase: report.phase, goalComplete: false, evidence: `${dir}/status.json`, verification: report.verification }));
