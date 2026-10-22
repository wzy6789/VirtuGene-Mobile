import { readFileSync, writeFileSync, appendFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = '.tmp-preview/voice-call-latency-20261015';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const providerRoot = '.tmp-preview/voice-call-provider-latency-20261015';
const providerDir = readdirSync(providerRoot).filter(name => name.startsWith('dry-run-') && existsSync(`${providerRoot}/${name}/report.json`)).sort().at(-1);
const providerReport = `${providerRoot}/${providerDir}/report.json`;
const provider = read(providerReport);
const indexed = read('.tmp-preview/voice-selected-suppression-20261015/full-call-summary.json');
const schedule = read(`${dir}/after.json`);
const typecheck = read(`${dir}/final-typecheck-command.json`);
const build = read(`${dir}/final-build-command.json`).value;
if (typecheck.exit_code !== 0 || build.exit_code !== 0 || provider.actualProviderRequests !== 0 || provider.errors.length || indexed.errors.length) throw Error('Final evidence is incomplete or not isolated');
for (const [source, target] of [
  ['.tmp-preview/voice-call/controller-result.txt', 'controller-result.txt'],
  ['.tmp-preview/voice-call/core-result.txt', 'core-result.txt'],
  ['.tmp-preview/voice-call/host-result.json', 'host-result.json'],
  ['.tmp-preview/voice-call/record-result.json', 'record-result.json'],
  ['.tmp-preview/voice-call/ui-result.json', 'ui-result.json'],
  ['.tmp-preview/voice-call/text-ui-result.json', 'text-ui-result.json'],
  ['.tmp-preview/voice-call/native-input-result.txt', 'native-input-result.txt'],
  ['.tmp-preview/voice-call-rhythm-20261013/rhythm-result.txt', 'rhythm-result.txt'],
  ['.tmp-preview/voice-call-bugcheck-20261013/after-result.txt', 'bugcheck-result.txt'],
  ['.tmp-preview/voice-latency-native-20261015/app-fixture/app-result-after.json', 'app-result.json'],
]) copyFileSync(source, `${dir}/${target}`);
for (const [name, previous, output] of [
  ['typecheck-final.txt', 'typecheck-during-ui-edit.txt', typecheck.output || 'Exit code 0; no diagnostics.\n'],
  ['web-build-final.txt', 'web-build-during-ui-edit.txt', build.output],
]) {
  if (existsSync(`${dir}/${name}`) && !existsSync(`${dir}/${previous}`)) copyFileSync(`${dir}/${name}`, `${dir}/${previous}`);
  writeFileSync(`${dir}/${name}`, output);
}
const files = [
  'src/lib/voice-call/controller.ts', 'src/lib/voice-call/utterance.ts', 'src/lib/voice-call/context.ts',
  'src/lib/character-memory.ts', 'src/db/memory-source-tombstone-repo.ts', 'src/db/index.ts',
  'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java',
  'scripts/verify/voice-call-controller.ts', 'scripts/verify/voice-call-context.ts', 'scripts/verify/voice-call-profile.mjs',
  'scripts/verify/voice-call-app.mjs', 'scripts/verify/voice-call-rhythm-preview.mjs',
  ...['voice-call-latency','voice-call-provider-latency','voice-context-latency','voice-reference-batch','selected-suppression-index'].flatMap(name => [`scripts/verify/${name}.ts`, `scripts/verify/${name}.mjs`]),
  'scripts/verify/voice-call-playback-start.mjs', 'scripts/verify/voice-call-latency-audit.mjs',
];
const report = {
  date: '2026-10-15', workdir: 'F:/VirtuGene-Mobile', codingModel: 'GPT-6', reasoningEffort: '未确认',
  goal: '完善语音系统，现在反应太慢，达不到通话效果，反应要极快',
  status: 'Source improvements and local regression complete for this iteration; real provider and phone performance unverified; goal remains active.',
  appVersion: read('package.json').version, appVersionChanged: false, dbVersion: 41, apkBuilt: false, installed: false, published: false,
  actualProviderCalls: 0, actualProviderTokens: 0, microphoneUsed: false, physicalAudioTested: false,
  changes: [
    'After 240ms quiet, recognize already captured voiced PCM while keeping 700ms final endpoint grace. A resumed clause can use a second early boundary; no more than two early boundaries per utterance, never when the ASR queue is full. Pure silence and discarded noise do not start requests. Voiced samples remain ordered and unique.',
    'Prepare the first TTS stream concurrently with track initialization; prefetch at most one next sentence after current PCM starts. Future PCM waits for prior full playback receipt and a fresh authorization check.',
    'AudioTrack capacity floor scales with sample rate; Android 12+ requests 40ms start threshold with device-default fallback. Actual device behavior has not been measured.',
    'Fresh source checks use one read transaction and independent queries concurrently; selected continuity and moment view evidence use keys/indexes. Database 41 adds a multi-entry suppression index; selected message, memory-source and summary-source IDs are checked without rescanning unrelated tombstones.',
    'Keep authorized cross-world memories per current MEMORY-SYSTEM.md, including newly added full-source checks from parallel work. No removal of checks, context, or thinking as a speed shortcut.',
    'Record actual ASR request duration, remaining ASR wait, first safe speech segment, cumulative review/check durations and counts. Overlapping durations are not additive wall time.',
  ],
  scheduling: { evidence: `${dir}/after.json`, checks: schedule.checks, before: read(`${dir}/before.json`).scenarios.map(x => x.metrics.firstPlaybackFromSpeechMs), after: schedule.scenarios.map(x => x.metrics.firstPlaybackFromSpeechMs), scope: schedule.scope },
  providerHarness: { evidence: providerReport, comparison: provider.comparison, sameActualDialogueInputs: provider.sameActualDialogueInputs,
    requestsPerRound: provider.rounds.map(x => ({variant: x.variant, requests: x.requests.length, asr: x.requests.filter(r => r.stage === 'asr').length})),
    scope: 'Offline Huihui speech replay, actual client and simulated SSE, artificial 120ms sink setup. No actual provider, physical playback or Android measurement.' },
  indexedChecks: { evidence: '.tmp-preview/voice-selected-suppression-20261015/full-call-summary.json', summary: indexed.summary, scope: indexed.scope, promptUnchanged: indexed.promptUnchanged },
  regression: { scheduling: schedule.checks, controller: 327, protocol: 107, host: 129, record: 68, context: 56, memory: 415,
    source: 21, migration: 16, existingScopeIndex: 10, selectedReference: 11, ui: 149, typedUi: 65, app: read(`${dir}/app-result.json`).checks,
    rhythm: 20, priorBugs: 4, jsAudioBridge: 49, nativeStartConfig: 27, nativeRouteContract: 8, nativeInputContract: 19,
    typecheckExitCode: typecheck.exit_code, webBuildExitCode: build.exit_code, javaCompile: '.tmp-preview/voice-latency-native-20261015/android-compile.txt',
    note: 'Counts overlap; source contracts, Java compilation and mocks are not hardware verification. Known IIFE, bundle size and mixed import warnings remain.' },
  correction: 'The initial cross-world defect suspicion was incorrect under the concurrent updated memory contract. The temporary explicit world restriction was removed; outdated tests now verify authorized cross-world continuity and revocation.',
  failuresRetained: ['Intermediate UI source build/type errors were resolved by parallel UI work; final command results are green.',
    'Full App fixture failures arose from duplicate timestamped Vite store instances and old onboarding setup; fixed in the verifier only.',
    'Selected-source batching initially hit PrematureCommitError; fixed, with original evidence retained.',
    'One early ASR boundary had limited benefit on a sentence with a comma pause; final two-boundary bounded strategy was retested on the same synthetic speech.'],
  preview: { url: 'http://127.0.0.1:4206/?virtugene-preview=mobile', command: 'node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4206',
    localServerRequired: true, actualComponent: true, state: 'simulated', externalModels: false, microphone: false, audibleSound: false,
    screenshot: `${dir}/isolated-call-preview.png`, beforeScreenshotOrRecording: 'None this iteration; performance comparisons use preserved source snapshots, never restored over parallel work.' },
  remaining: ['Measure real MiMo ASR, dialogue and TTS latency with approved test access; a question requesting bounded paid testing is pending.',
    'Current test process has no MIMO_API_KEY environment value; do not request a secret in chat or infer that the phone lacks configuration.',
    'No real Android/Bluetooth/thermal/long-call experience, physical first sound, installed APK hash validation or old-app downgrade validation.',
    'No supported official interface available to move this thread into the requested sidebar project; internal Codex state was not edited.'],
  hashes: files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
};
writeFileSync(`${dir}/audit.json`, JSON.stringify(report, null, 2));
if (process.argv.includes('--log')) {
  const log = 'D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md';
  const index = 'D:/月起云归/VirtuGene/手机版/00-总览.md';
  const heading = '语音极速链路：提前识别、连续播音与已选来源精确核验（真实通话未验收）';
  if (!readFileSync(log, 'utf8').includes(`## ${heading}`)) appendFileSync(log, `\n\n## ${heading}\n\n- 工作目录 F:/VirtuGene-Mobile；可见编码模型 GPT-6，推理强度未确认。源码当前 App ${report.appVersion}，本轮未升版；数据库新增41索引。产品API/付费调用0，实际产品tokens0，麦克风0；编码助手本轮独立计费量未确认。未打包、装机、发布或更改官网下载；手机现有APK不因此自动包含源码改动。\n- 240ms短停顿可先识别录下的语音，仍等700ms确认说完；续说尾句可再提前一次，每段话最多2次early，慢ASR队列满就延后，原30秒切段边界保留。短噪声/纯静音不请求，取消、后台、静音、换设备、切文字与挂断仍阻止迟到结果。普通完整短句1次ASR；带内部停顿的回放本次2次ASR，不能写成请求数完全不增加。\n- 首段TTS与音轨初始化并行；当前声音开始写入后至多预取下一句，下一句PCM必须等前句完整播放确认及fresh来源核验。新增时延/复核计数只记录真实阶段，不把累计并发时间相加当总等待；没有用预录应答假装人物已理解。\n- 原生按采样率设置100ms缓冲下限，Android12+请求40ms启动阈值，设备不支持时保留默认。27项实际配置方法模拟执行和Java离线编译通过；并非真机减少多少毫秒的证据。\n- 已选来源按主键/索引核验：约定不再全读开放候选，浏览证据使用momentId+characterId索引；schema41对已有suppressedMessageIds加多值索引，保留账号+角色复合索引。已选消息及memory/summary来源精确查询，每次重新读，不跨包缓存权限，不取消新版通用来源复核。8111旧记录/未知字段/缺数组、跨来源投影、归属、编辑、删除、转移、合并、事务和迁移回滚16项通过；旧安装包打开/降级未实测。\n- 数据对照（独立真实IndexedDB、桌面4倍降速、模拟文字/模型/10包PCM）：schema41本步每包6126→127行，核验中位75.95→28.2ms，模拟首回执1202.4→780.3ms，模拟整轮2113.1→1052.6ms；准备712.15→722.1ms未改善。完整模型输入hash相同，chat/shared/todo撤权都拒绝。此前三个查询小块的独立对照为37126→6126行，两个阶段不能拼成同一次手机测量。\n- 调度独立对照：固定模拟耗时三个场景2400→1700、2000→1600、2400→1900ms，包含真实最后有声帧至回执；62项新边界通过。离线惠惠“今天有点累，想听你说句话。”ABBA回放的模拟首网络PCM中位${provider.comparison.find(x=>x.variant==='before').firstPcmAfterSpeechMedianMs.toFixed(2)}→${provider.comparison.find(x=>x.variant==='after').firstPcmAfterSpeechMedianMs.toFixed(2)}ms，after2次ASR共4请求，before1次ASR共3请求；全部是模拟SSE，并包含人工120ms sink初始化。不能写成真实MiMo或Android首声，也不能宣称已整体快3–5倍。\n- 必要回归：控制器327、协议107、宿主129、记录68、记忆415、context56、来源21、精确来源11、迁移16、原索引10、UI149、文字UI65、整App导航15、节奏20、前轮bug4、JS音频桥49、原生启动27/路由8/输入19通过；最终tsc和网页构建通过，Java编译通过。断言有重叠；现有IIFE/分包/Gradle警告保留。最终命令原始结果位于本轮证据，不使用中途共享UI编辑造成的失败结果冒充最终通过。\n- 更正：我先按旧测试判断跨世界回忆是bug，随后核对最新MEMORY-SYSTEM.md与并行记忆维护日志，确认角色应保留有权知道的跨世界往事。撤掉临时worldId限制，按新契约补授权/撤权/非现场检查。其他任务新增的通用逐包复核保留；其性能回退已纳入新夹具，早期72/74行结果不再代表最终代码。\n- 失败证据保留：Vite timestamp模块导致夹具与真实页面持有两份store，已修验证脚本并通过整App导航；精确来源批处理初次PrematureCommitError已修；一段提前ASR在逗号续说回放收益不足，改为有界两段并复验。未覆盖/回滚并行代码以造基线。\n- 文件：${files.join('、')}。主证据 F:/VirtuGene-Mobile/${dir}/audit.json；前后调度在同目录before.json/after.json；索引在.tmp-preview/voice-selected-suppression-20261015/；原生在.tmp-preview/voice-latency-native-20261015/；最终离线服务入口回放 ${providerReport}。每个最终文件SHA-256见audit。\n- 实际组件隔离预览 http://127.0.0.1:4206/?virtugene-preview=mobile，需本地服务：node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4206。模型/麦克风/声音均隔离，只展示通话组件状态，不展示真实提速。截图已查看；本轮没有同条件改前UI截图/录屏，不用旧图伪造对照。\n- 剩余目标仍是实际通话快速、自然地接话，尚未达标验收。已向用户请求后续最多4轮/20次、不重试的真实MiMo计时授权，因为之前明确“不追加付费调用”；测试进程尚无环境Key，需本机配置，不在聊天收集密钥。默认计时入口严格dry-run，三条件缺一均不可发真实请求。真实服务、Android/Bluetooth/长通话听感尚未验证，目标保持进行中。侧栏项目移动缺少可确认官方接口，未编辑Codex内部状态或创建重复线程。\n`);
  const entry = '- [[手机版/开发日志/2026-10-15|2026-10-15 · 语音极速链路与来源精确索引]]：本地提速/迁移/回归完成；真实服务与手机通话待验证，目标仍在进行，未打包发布。';
  if (!readFileSync(index, 'utf8').includes(entry)) appendFileSync(index, `\n${entry}\n`);
}
console.log(JSON.stringify({ evidence: `${dir}/audit.json`, goalComplete: false, realApiCalls: 0, schedulingChecks: schedule.checks, providerComparison: provider.comparison }));
