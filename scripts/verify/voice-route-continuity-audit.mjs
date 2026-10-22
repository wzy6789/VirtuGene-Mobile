import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = '.tmp-preview/voice-route-continuity-20261015';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const text = path => readFileSync(path, 'utf8').replaceAll('\0', '');
const native = json(`${dir}/after.json`), baseline = json(`${dir}/before.json`), bridge = json(`${dir}/bridge-after.json`);
assert.equal(native.rejected,390); assert.equal(baseline.rejected,0);
assert.equal(native.routePollsDuringOneSecondStall,11); assert.equal(bridge.checks,392);
assert.ok(text(`${dir}/java-compile.txt`).includes('BUILD SUCCESSFUL'));
assert.ok(text(`${dir}/build.txt`).includes('built in'));
const sourceFiles = ['android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java',
  'android/app/src/main/java/com/virtugene/app/plugins/AudioRouteLoss.java', 'src/lib/voice-call/native-audio.ts', 'src/lib/voice-call/controller.ts'];
const report = {
  date: new Date().toISOString(), workdir: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认',
  phase: 'P1-native-route-continuity', goalComplete: false,
  apiCalls: 0, apiTokens: 0, microphone: false, apkBuilt: false, versionChanged: false, published: false,
  changes: ['Confirmed communication route is separate from passive route-list observations',
    'Unexpected modern communication route change/removal/permission error and known phone fallback trigger native suspension',
    'Native verification before capture bridge emission, PCM enqueue/write, stalled output retries and periodic playback observation',
    'Explicit selection window and pending selection remain allowed; late callback payload does not override current manager observation',
    'Native routeGeneration is consumed by JS; older generation events cannot pause or inject capture into a recovered session',
    'Native routeLost alone suspends JS capture; native/local suspension revision invalidates pending resume acknowledgement',
    'A stale native resume is paused again natively, or session closed if pausing fails; controller preserves latest pause reason',
    'Old stop rejection is scoped to its bridge serial and cannot suspend a restarted session'],
  verification: { nativeDecisionExecution: native, beforeNativeDecisionExecution: baseline, bridgeRaceExecution: bridge,
    controller: json('.tmp-preview/voice-call/controller-result.txt'), host: json('.tmp-preview/voice-call/host-result.json'),
    softwareLatencyBoundaryChecks: json('.tmp-preview/voice-call-latency-20261015/after.json').checks,
    nativeRouteSourceContracts: json('.tmp-preview/voice-call-rhythm-20261013/native-route-contract.json').checks.length,
    typescript: 'exit 0', webBuild: 'exit 0', javaCompilation: 'BUILD SUCCESSFUL (compileDebugJavaWithJavac only)' },
  failureAndCorrection: 'First output retry check used offset==0, polling on each zero-byte write retry. Production-loop JVM stall test failed; changed to one initial check and 100ms rechecks, 11 polls over the controlled 1s stall.',
  failureEvidence: `${dir}/native-bounded-poll-before-fix.txt`,
  limitations: ['JVM doubles execute extracted production callback, guard and write loop; suspend/resource behavior is doubled, not Android hardware execution',
    'Native compilation and JS races do not prove HFP/LE/OEM behavior, actual Bluetooth stability, physical stop latency or actual first sound',
    'Periodic 100ms route observation is software policy, not a measured physical stop guarantee; existing device callback also checks',
    'Null input/output route is unobserved, not a successful duplex proof; same-category wrong-remote-device pairing is not distinguished',
    'Modern private fallback protection targets known SCO/LE/wired-headset input and headphone output; output-only headphones/speaker/hearing-aid phone mic use is allowed',
    'Legacy <=30 SCO behavior remains unchanged and separately covered by existing contracts',
    'Extra native route queries have bounded retry cadence; real-device CPU/latency overhead is unmeasured',
    'No new UI preview or same-condition before/after recording in this native/bridge batch; installed APK not changed'],
  references: ['https://developer.android.com/develop/connectivity/bluetooth/ble-audio/audio-manager',
    'https://developer.android.com/reference/android/media/AudioRouting'],
  remaining: ['Finish P0 native/JS clock correlation and full call-level route timeline, including actual I/O observation evidence',
    'Endpoint/noise/hesitation policy comparison', 'Unpunctuated phrase latency and continuous inter-segment playback',
    'Further route I/O verification/recovery cases, permissions/lifecycle/protocol fault matrix and full plan acceptance',
    'P3 background continuous calling stays conditional and separate; preserve explicit background pause'],
  sourceHashes: sourceFiles.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
};
writeFileSync(`${dir}/audit.json`, JSON.stringify(report,null,2));
const statusPath = '.tmp-preview/voice-realtime-plan-20261015/status.json', status = json(statusPath);
status.goalComplete = false; status.phase = report.phase; status.milestones ??= [];
status.milestones.push({ phase: report.phase, evidence: `${dir}/audit.json`, date: report.date }); status.next = report.remaining;
writeFileSync(statusPath, JSON.stringify(status,null,2));
if (process.argv.includes('--log')) {
  appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md', `

## 实时通话P1：路由意外改道与恢复回执隔离

- 实际目录F:/VirtuGene-Mobile；可见执行模型GPT-6，推理强度未确认。业务MiMo实际请求/token/音频用量均0；没有读取真实密钥、开麦或Android设备，没有安装依赖、改版本、打包、装机或发布。
- 修改VoiceCallAudioPlugin.java、AudioRouteLoss.java、native-audio.ts、controller.ts；新增两个验证入口与审计脚本。冻结当前副本到${dir}/before/，未用HEAD覆盖并行修改。
- 确认缺口：现代通信路由变化原先只刷新列表；被动刷新还会覆盖observed communication值。现在单独保存confirmed route，系统意外改道/通信设备变空/权限丢失、已知私密耳机I/O退回手机时原生暂停。检查位于采集发往JS前、PCM入队及真正写入前、阻塞重试和播放观察；明确选择窗口允许变化，读当前manager而不信旧回调payload，不自动切路由/重建音轨/恢复外放。
- 原生routeGeneration透传并在桥接按代过滤，旧路由事件不会暂停恢复后的会话；routeLost单独到达也阻断采集。新增暂停revision防止新丢失/主动暂停被旧resume回执覆盖，旧回执若可能重开采集则再次原生pause；pause失败则close。controller保留最新暂停原因，旧stop失败按serial隔离，不影响重启后的会话。
- 实际执行生产回调/校验函数/输出循环的JVM double测试1231项、每场景30轮，原先390次危险路径均未暂停，修改后390次均进入暂停决策；保持主动切换、同类型不同I/O id、空路由未观察等情况，不把input id必须等于output id当规则。bridge/controller竞态392项，包含无generation旧插件、仅routeLost、过期paused、暂停中旧恢复、主动暂停、失败回退释放、旧stop失败及恢复原因保留。不是Android运行时/实际耳机验收，JVM中的suspend/资源是替身。
- 有失败记录：初版输出重试使用offset==0，零字节写入会每5ms查路由；实际生产循环抽取测试失败。已改routeChecked+100ms周期，模拟一秒阻塞只查询11次，原始失败${dir}/native-bounded-poll-before-fix.txt保留。不能据此声称真实设备成本已测。
- 必要回归：327控制器、129宿主、62既有时序边界、8路由源码契约、19原生输入契约通过；类型检查、Web构建及Android Java编译通过，未生成APK。既有haptics import.meta测试提示及包体/混合引用构建提示未消除，不虚写零告警。
- 证据${dir}/audit.json、before/after.json、bridge-before/after.json、comparison.json、java-compile.txt、build.txt。官方参考Android AudioManager通信路由指南与AudioRouting接口；未引入RTC/新供应商。
- 尚未验证/未完成：实际HFP/LE/OEM与物理首声/停声/CPU成本；空I/O表示未观察，未验证同类别另一台远端耳机的配对；旧<=30 SCO沿用原分支。尚需全局路由时间线/时钟关联、端点策略、无标点与句间播放衔接、扩展异常矩阵和方案总验收。本批没有同条件前后录屏或新UI预览，源码未装机；不要求用户补真机，不将其当方案当前交付前置。目标仍active，未宣称全方案达标。
`);
  appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md', '\n- [[开发日志/2026-10-15#实时通话P1：路由意外改道与恢复回执隔离|实时通话路由保护]]：意外改道/已知I/O回退暂停，旧恢复/回调隔离；1231 JVM与392桥接检查，327控制器/129宿主及Java编译通过。阻塞重试快轮询已修；非耳机实测，播放衔接与全方案继续，未付费/打包。\n');
}
console.log(JSON.stringify({ phase: report.phase, goalComplete: false, evidence: `${dir}/audit.json`,
  checks: { native: native.checks, bridge: bridge.checks }, noProviderCalls: true }));
