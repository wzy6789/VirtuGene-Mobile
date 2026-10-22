import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-realtime-closeout-20261015';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const regression = json(`${dir}/regression.json`);
assert.equal(regression.passed, true); assert.equal(regression.sourceUnchangedDuringRegression, true);
for (const file of regression.sourceHashesAfter) assert.equal(hash(file.path), file.sha256, `source changed after regression: ${file.path}`);
const clock = json('.tmp-preview/voice-clock-route-20261015/summary.json');
for (const file of clock.files) assert.equal(hash(file.path), file.sha256);
const protocol = json('.tmp-preview/voice-local-protocol-20261015/report.json');
for (const file of protocol.sourceHashes) assert.equal(hash(file.path), file.sha256);
const phrases = json('.tmp-preview/voice-utterance-policy-20261015/comparison.json');
assert.equal(hash('src/lib/voice-call/utterance.ts'), phrases.currentHash);
const browser = json('.tmp-preview/voice-segment-playback-20261015/browser-comparison.json');
assert.equal(json('.tmp-preview/voice-segment-playback-20261015/browser-after.json').controllerHash, hash('src/lib/voice-call/controller.ts'));
assert.equal(browser.fullInputHashUnchanged, true); assert.equal(browser.modelRequestsUnchanged, true); assert.equal(browser.heardUnchanged, true);
const correction = json('.tmp-preview/voice-context-overlap-20261015/utf8-correction.json');
assert.equal(correction.oldBrowserEvidenceWithdrawn, true);
const segment = json('.tmp-preview/voice-segment-playback-20261015/after.json');
const ui = json('.tmp-preview/voice-call/ui-result.json');
const diagnostics = json('.tmp-preview/voice-call-evidence-20261015/report.json');
const echo = json('.tmp-preview/voice-segment-playback-20261015/echo-after.json');
const recovery = json('.tmp-preview/voice-segment-playback-20261015/recovery-after.json');
const remaining = [
  '真实MiMo端到端时延、识别质量、物理首声/停声、蓝牙双向/OEM/长通话功耗未验证；不要求用户补做真机实验。',
  '700ms仍会截断更长犹豫；轻声低于门限、电视等能量混淆未解决。没有证明更短判停或普遍3–5倍提速。',
  '无标点分句只覆盖可辨句法边界，没有通用毫秒截止保证；1024码点是安全缓冲上限。部分英文片段更保守。',
  '按设备/网络自适应抖动缓冲未实施；当前仅增加实际队列、阈值、欠载观测，不清零缓冲。',
  '路由保留即时切换提示、30秒确认、挂断取消及手动继续；建议的分级等待提示与等待中安全降级未调整。',
  'Android真实授权/撤权、通知拒绝、前台服务资格与进程重建未运行；不能把源码断言或JVM替身写成系统验收通过。',
  'P3锁屏/后台持续通话未实施，仍保留后台安全暂停；没有发布安装包，也没有源码装机生效证明。',
];
const report = { date: new Date().toISOString(), workdir: 'F:/VirtuGene-Mobile', model: 'GPT-6', reasoningEffort: '未确认',
  phase: 'user-requested stage closeout; wait for next instruction', overallGoalComplete: false,
  actualProviderCalls: 0, providerTokens: 0, localProtocolHttpRequests: protocol.actualLocalHttpRequests,
  microphone: false, androidRuntime: false, versionChanged: false, apkBuilt: false, published: false,
  regression, checks: { segmentController: segment.checks, segmentPrimaryScenarios: segment.rows.length,
    segmentBoundedBufferScenarios: segment.boundedRows.length, clockBridge: clock.bridge.checks, clockJava: clock.native.checks,
    protocol: protocol.checks, utterancePolicy: phrases.checks.after, diagnosticIntegration: diagnostics.checks,
    speakerEcho: echo.checks, speakerRecovery: recovery.checks, ui: ui.checks },
  contextOverlapCorrection: correction, segmentBrowser: browser, remaining,
  failuresRetained: readdirSync(dir).filter(name => name.startsWith('rejected-')),
  noBeforeAfterVideo: true, noNewLibraryArtifact: true,
  existingPreview: { command: 'node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4216',
    address: 'http://127.0.0.1:4216/?virtugene-preview=mobile', startedThisCloseout: false, requiresLocalServer: true,
    scope: 'Actual UI with simulated state; no model, microphone or sound; not a performance demonstration.' } };
writeFileSync(`${dir}/audit.json`, JSON.stringify(report, null, 2));
const [oldContext, newContext] = correction.corrected.summary;
const md = `# 实时通话与蓝牙优化：阶段收尾（2026-10-15）

按用户“暂时进入收尾工作”要求停止新增改造，当前修改与必要回归已整理。**本阶段收尾不等于整体目标全部达标。** 不再自主追加付费测试、真机验收、版本或发布工作，等待下一步指令。

工作目录 F:/VirtuGene-Mobile。可见编码模型 GPT-6，推理强度未确认；产品API请求、token与音频用量均0。编码代理自身计费/精确token不可见，不报为0。沿用工作副本6.1.4，未修改版本；AGENTS记录的用户指定发布版6.1.0也未改写。没有APK构建、装机或发布。

## 已完成

- 本地上下文准备可与最终判停等待重叠，正式ASR转写后每轮最多提前一次；续说立即取消，台账写入等有效轮末，来源授权仍逐次核验。没有新增推测性LLM/TTS或缩减完整上下文。
- 同一音轨按segment起止frame连续播放；最多一个未来合成、一个200ms安全前缀。逐9600字节复核来源；停止、撤权、错误回执均不能把待播内容记入已听历史。原生drain改由现有进度ticker观察，不阻塞PCM写线程。
- 修复无AEC扬声器在句间“生成中”误收角色回声；独立评审又复现恢复后outputPending残留，已在确认原生停止及显式恢复后清除。暂停和TTS失败恢复均可重新识别用户语音；AEC/耳机及首PCM前插话保留。
- 无标点回复在可辨完整句法边界提前分句，保护数字、URL、英文单词与跨delta代理对；未找到安全边界时最多1024码点，异常明确停止。700/400/能量自适应同帧比较发现误切，生产保留700ms。
- 路由generation、实际输入/输出/通信设备观察彼此分开；已知私人路由回退停止输出，不自动外放或重播。低开销时钟往返区间与采样末帧估计单列，缺失/过期/旧generation均保持未知，不直接跨时钟相减。短read跨100ms批边界修正尾帧计数。
- 增加实际queued frames、峰值毫秒、可选buffer/start threshold/underrun、原生写完时间及收到/入队/预取PCM字节观测；没有把配置最大队列或写入回执当作物理出声。
- 本机HTTP/SSE模拟器执行实际MimoCallClient，ASR/LLM/TTS六类主分层各30轮，${protocol.actualLocalHttpRequests}次localhost请求，${protocol.checks}项检查通过；验证分片、背压、服务错误、取消迟到、短测试超时及无自动重试。

## 验证与前后效果

最终${regression.results.length}个必要检查全部exit 0，期间以下生产文件hash未变。包括控制器、核心/传输、宿主/上下文、JS输入桥接、路由、连续播放、回声/恢复、真实组件UI、类型检查和Web构建。Java仅compileDebugJavaWithJavac通过，未执行assemble。

| 验证 | 结果与范围 |
|---|---|
| 连续播放控制器 | ${segment.checks}项；${segment.rows.length}个主场景、${segment.boundedRows.length}个100ms有限缓冲场景；合成PCM与软件帧时钟 |
| 存量DB播放对照 | 每版本30轮，完整输入hash、模型请求与已听历史相同；备好200ms前缀场景，句间软件空隙P50 ${browser.summary[0].gap.p50.toFixed(1)}→${browser.summary[1].gap.p50.toFixed(1)}ms、P95 ${browser.summary[0].gap.p95.toFixed(1)}→${browser.summary[1].gap.p95.toFixed(1)}ms；不是物理声音 |
| 核验成本 | 上述前缀分块使每轮复核9→10，实际读取40341/40377→40468/40504行，多一次127行复核；不隐藏安全检查代价 |
| 时钟/原生观察 | JS ${clock.bridge.checks}、JVM实际方法${clock.native.checks}项；360个短read批边界修正后帧误差0，替身不是Android运行 |
| 分句/判停候选 | ${phrases.checks.after}项；15分层×30轮×3策略，较短策略误切；未把合成能量测试当ASR准确率 |
| UI/收尾集成 | UI ${ui.checks}，诊断集成${diagnostics.checks}，回声${echo.checks}、暂停/失败恢复${recovery.checks}项 |

证据更正：原上下文重叠浏览器页缺UTF-8声明，旧1593.5→1253.6ms结论已撤回，原稿归档browser-pre-utf8/。统一编码并断言后每版本30轮重跑：软件首播P50 ${oldContext.softwarePlaybackFromSpeech.p50.toFixed(1)}→${newContext.softwarePlaybackFromSpeech.p50.toFixed(1)}ms，P95 ${oldContext.softwarePlaybackFromSpeech.p95.toFixed(1)}→${newContext.softwarePlaybackFromSpeech.p95.toFixed(1)}ms；输入hash、WAV、每表读取/请求/事务一致。该阶段正常台账36次写入，提前0次；不是固定业务数量。此对照是4倍CPU桌面Chrome、真实隔离DB和模拟服务，不能宣称Android或真实MiMo达到该速度。

收尾失败保留：旧测试将新增clock诊断计入音频事件总数，已分别核验并保留原隔离/清理断言；详细模拟报告超过Node默认输出缓冲，测试启动器改为有界8MiB。原失败在rejected-*，没有作为通过结果。构建仍有既有import.meta测试打包、混合引用和chunk体积告警；未扩展本轮优化范围。

## 未完成或未验证

${remaining.map(item => '- ' + item).join('\n')}

后续仅建议：重新授权后再安排真实服务计时；另行决定路由分级恢复交互、缓冲自适应和通用无标点等待策略。本次没有执行这些后续工作，也不向用户追加真机任务。

## 文件与证据

本批主要生产文件：src/lib/voice-call/{controller,utterance,native-audio,clock,trace,lifecycle}.ts；VoiceCallAudioPlugin.java；VoiceCallDialog.tsx两条错误文案。此前本方案还有context.ts、character-memory.ts的端点写入闸门、voice-call-store.ts本地准备开关及AudioRouteLoss.java路由保护；没有覆盖并行UI/记忆改动。精确本轮验证文件及SHA256在regression.json。

- 总审计：F:/VirtuGene-Mobile/${dir}/audit.json
- 最终逐命令退出状态/日志：F:/VirtuGene-Mobile/${dir}/regression.json
- 连续播放：F:/VirtuGene-Mobile/.tmp-preview/voice-segment-playback-20261015/
- 时钟/Java方法：F:/VirtuGene-Mobile/.tmp-preview/voice-clock-route-20261015/summary.json
- 本机HTTP：F:/VirtuGene-Mobile/.tmp-preview/voice-local-protocol-20261015/report.json
- 分句/候选：F:/VirtuGene-Mobile/.tmp-preview/voice-utterance-policy-20261015/comparison.json
- UTF-8更正：F:/VirtuGene-Mobile/.tmp-preview/voice-context-overlap-20261015/utf8-correction.json

可复用实际组件隔离预览：执行node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4216，再打开http://127.0.0.1:4216/?virtugene-preview=mobile。需要本地服务，本轮未启动此端口；仅UI模拟状态，无模型/麦克风/声音，不能演示或证明声学提速。没有同条件改前改后截图/录屏，没有新增Library文件。没有可确认官方侧栏项目迁移接口，未编辑Codex内部数据库或建立重复任务。
`;
const document = 'docs/VOICE-REALTIME-CLOSEOUT-2026-10-15.md'; writeFileSync(document, md);
const statusPath = '.tmp-preview/voice-realtime-plan-20261015/status.json';
const status = json(statusPath); status.goalComplete = false; status.phase = report.phase;
status.closeout = { date: report.date, evidence: `${dir}/audit.json`, regressionPassed: true, document, actualProviderCalls: 0 };
status.next = remaining; writeFileSync(statusPath, JSON.stringify(status, null, 2));
if (process.argv.includes('--log')) {
  const path = 'D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md', heading = '## 语音实时通话阶段收尾';
  if (!readFileSync(path, 'utf8').includes(heading)) {
    appendFileSync(path, `\n\n${heading}\n\n- 按用户“暂时进入收尾工作”停止新增方向，只完成当前修复与必要回归；阶段收尾不等于全部目标达标。工作目录F:/VirtuGene-Mobile，可见编码模型GPT-6、推理强度未确认；业务MiMo API/token/音频用量0，localhost模拟HTTP ${protocol.actualLocalHttpRequests}次。没有麦克风、Android运行、版本修改、APK/安装/发布；编码代理自身实际计费用量不可见。\n- 主要实现controller/utterance/native-audio/clock/trace/lifecycle、VoiceCallAudioPlugin及VoiceCallDialog错误映射：segment frame连续播放，最多一个未来TTS+200ms前缀，逐9600字节新核验，ticker drain不阻塞写入；native/JS往返区间、可选采样估计与实际I/O、队列/underrun/阈值只读观测。短read尾样本跨批偏移已修，360边界帧误差0。\n- 评审复现并修复两条路径：句间生成状态无AEC误打断；暂停/合成失败恢复后outputPending残留导致听不见。回声17、恢复8与诊断74项通过，AEC/耳机/首PCM前插话保留。独立评审复验恢复后ASR1→2，未声称评审覆盖Android。\n- 最终${regression.results.length}个命令exit0且期间生产hash未变：327控制器、107核心、62节奏、55传输、17用量、129宿主、56上下文、49JS输入、19源契约、路由392/1231、连续播放${segment.checks}、桥接4/原生drain27、UI${ui.checks}，tsc与Web构建通过；Java仅编译通过无assemble。clock JS${clock.bridge.checks}/Java${clock.native.checks}，本机协议${protocol.checks}，分句${phrases.checks.after}另有独占证据。\n- 真实隔离DB+模拟音频30轮：就绪前缀的句间软件空隙P50 ${browser.summary[0].gap.p50.toFixed(1)}→0ms、P95 ${browser.summary[0].gap.p95.toFixed(1)}→0ms；大PCM分块多一次127行复核（9→10次），读取40341/40377→40468/40504，输入/请求/已听历史一致。UTF-8旧浏览器结果已撤回，修正后上下文重叠阶段软件首播P50 ${oldContext.softwarePlaybackFromSpeech.p50.toFixed(1)}→${newContext.softwarePlaybackFromSpeech.p50.toFixed(1)}ms。两组不是手机/真实MiMo/物理声音，不能拼成普遍提速倍数。\n- 失败保留：clock诊断使旧音频事件计数断言失败，已分流诊断且保留原断言；报告超过默认spawn输出缓冲，增加有界8MiB后重跑。rejected-*保留；此前UTF-8编码、原生回调/背压/中包撤权/第三短句及恢复失败证据在各目录。现有import.meta、混合引用与chunk告警仍在，不追加清理。\n- 未完成/未验证：真实服务首声、蓝牙/OEM/声学/功耗；更短判停与轻声/电视混淆；通用无标点毫秒截止；设备/网络自适应缓冲；路由分级等待/安全降级交互；Android实际权限/撤权/通知/服务/进程重建。700ms经候选误切对照保留；P3后台持续通话未做，保留后台安全暂停。不是所有目标达标，不要求用户提供手机测试。\n- 总文档${document}、证据${dir}/audit.json与regression.json；各文件hash与精确命令在证据内。实际组件隔离预览启动node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4216，地址http://127.0.0.1:4216/?virtugene-preview=mobile，需要服务、本轮未启动；无模型/麦克风/声音，非性能演示。没有同条件前后录屏/新Library产物。停止继续实施，等待用户下一步。\n`);
    appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md', '\n- [[开发日志/2026-10-15#语音实时通话阶段收尾|语音实时通话阶段收尾]]：连续播放、回声及恢复修复、时钟/I/O观测、本机协议矩阵与20项最终命令通过；未付费/打包，整体目标未全部达标，后续等待指令。\n');
  }
}
console.log(JSON.stringify({ document, evidence: `${dir}/audit.json`, localRegressionPassed: true, overallGoalComplete: false, remaining: remaining.length }));
