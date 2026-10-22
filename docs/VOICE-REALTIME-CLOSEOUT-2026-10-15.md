# 实时通话与蓝牙优化：阶段收尾（2026-10-15）

按用户“暂时进入收尾工作”要求停止新增改造，当前修改与必要回归已整理。**本阶段收尾不等于整体目标全部达标。** 不再自主追加付费测试、真机验收、版本或发布工作，等待下一步指令。

工作目录 F:/VirtuGene-Mobile。可见编码模型 GPT-6，推理强度未确认；产品API请求、token与音频用量均0。编码代理自身计费/精确token不可见，不报为0。沿用工作副本6.1.4，未修改版本；AGENTS记录的用户指定发布版6.1.0也未改写。没有APK构建、装机或发布。

## 已完成

- 本地上下文准备可与最终判停等待重叠，正式ASR转写后每轮最多提前一次；续说立即取消，台账写入等有效轮末，来源授权仍逐次核验。没有新增推测性LLM/TTS或缩减完整上下文。
- 同一音轨按segment起止frame连续播放；最多一个未来合成、一个200ms安全前缀。逐9600字节复核来源；停止、撤权、错误回执均不能把待播内容记入已听历史。原生drain改由现有进度ticker观察，不阻塞PCM写线程。
- 修复无AEC扬声器在句间“生成中”误收角色回声；独立评审又复现恢复后outputPending残留，已在确认原生停止及显式恢复后清除。暂停和TTS失败恢复均可重新识别用户语音；AEC/耳机及首PCM前插话保留。
- 无标点回复在可辨完整句法边界提前分句，保护数字、URL、英文单词与跨delta代理对；未找到安全边界时最多1024码点，异常明确停止。700/400/能量自适应同帧比较发现误切，生产保留700ms。
- 路由generation、实际输入/输出/通信设备观察彼此分开；已知私人路由回退停止输出，不自动外放或重播。低开销时钟往返区间与采样末帧估计单列，缺失/过期/旧generation均保持未知，不直接跨时钟相减。短read跨100ms批边界修正尾帧计数。
- 增加实际queued frames、峰值毫秒、可选buffer/start threshold/underrun、原生写完时间及收到/入队/预取PCM字节观测；没有把配置最大队列或写入回执当作物理出声。
- 本机HTTP/SSE模拟器执行实际MimoCallClient，ASR/LLM/TTS六类主分层各30轮，540次localhost请求，6291项检查通过；验证分片、背压、服务错误、取消迟到、短测试超时及无自动重试。

## 验证与前后效果

最终20个必要检查全部exit 0，期间以下生产文件hash未变。包括控制器、核心/传输、宿主/上下文、JS输入桥接、路由、连续播放、回声/恢复、真实组件UI、类型检查和Web构建。Java仅compileDebugJavaWithJavac通过，未执行assemble。

| 验证 | 结果与范围 |
|---|---|
| 连续播放控制器 | 2397项；180个主场景、120个100ms有限缓冲场景；合成PCM与软件帧时钟 |
| 存量DB播放对照 | 每版本30轮，完整输入hash、模型请求与已听历史相同；备好200ms前缀场景，句间软件空隙P50 77.7→0.0ms、P95 122.8→0.0ms；不是物理声音 |
| 核验成本 | 上述前缀分块使每轮复核9→10，实际读取40341/40377→40468/40504行，多一次127行复核；不隐藏安全检查代价 |
| 时钟/原生观察 | JS 1923、JVM实际方法2432项；360个短read批边界修正后帧误差0，替身不是Android运行 |
| 分句/判停候选 | 1052项；15分层×30轮×3策略，较短策略误切；未把合成能量测试当ASR准确率 |
| UI/收尾集成 | UI 151，诊断集成74，回声17、暂停/失败恢复8项 |

证据更正：原上下文重叠浏览器页缺UTF-8声明，旧1593.5→1253.6ms结论已撤回，原稿归档browser-pre-utf8/。统一编码并断言后每版本30轮重跑：软件首播P50 1718.0→1385.4ms，P95 1967.6→1631.9ms；输入hash、WAV、每表读取/请求/事务一致。该阶段正常台账36次写入，提前0次；不是固定业务数量。此对照是4倍CPU桌面Chrome、真实隔离DB和模拟服务，不能宣称Android或真实MiMo达到该速度。

收尾失败保留：旧测试将新增clock诊断计入音频事件总数，已分别核验并保留原隔离/清理断言；详细模拟报告超过Node默认输出缓冲，测试启动器改为有界8MiB。原失败在rejected-*，没有作为通过结果。构建仍有既有import.meta测试打包、混合引用和chunk体积告警；未扩展本轮优化范围。

## 未完成或未验证

- 真实MiMo端到端时延、识别质量、物理首声/停声、蓝牙双向/OEM/长通话功耗未验证；不要求用户补做真机实验。
- 700ms仍会截断更长犹豫；轻声低于门限、电视等能量混淆未解决。没有证明更短判停或普遍3–5倍提速。
- 无标点分句只覆盖可辨句法边界，没有通用毫秒截止保证；1024码点是安全缓冲上限。部分英文片段更保守。
- 按设备/网络自适应抖动缓冲未实施；当前仅增加实际队列、阈值、欠载观测，不清零缓冲。
- 路由保留即时切换提示、30秒确认、挂断取消及手动继续；建议的分级等待提示与等待中安全降级未调整。
- Android真实授权/撤权、通知拒绝、前台服务资格与进程重建未运行；不能把源码断言或JVM替身写成系统验收通过。
- P3锁屏/后台持续通话未实施，仍保留后台安全暂停；没有发布安装包，也没有源码装机生效证明。

后续仅建议：重新授权后再安排真实服务计时；另行决定路由分级恢复交互、缓冲自适应和通用无标点等待策略。本次没有执行这些后续工作，也不向用户追加真机任务。

## 文件与证据

本批主要生产文件：src/lib/voice-call/{controller,utterance,native-audio,clock,trace,lifecycle}.ts；VoiceCallAudioPlugin.java；VoiceCallDialog.tsx两条错误文案。此前本方案还有context.ts、character-memory.ts的端点写入闸门、voice-call-store.ts本地准备开关及AudioRouteLoss.java路由保护；没有覆盖并行UI/记忆改动。精确本轮验证文件及SHA256在regression.json。

- 总审计：F:/VirtuGene-Mobile/.tmp-preview/voice-realtime-closeout-20261015/audit.json
- 最终逐命令退出状态/日志：F:/VirtuGene-Mobile/.tmp-preview/voice-realtime-closeout-20261015/regression.json
- 连续播放：F:/VirtuGene-Mobile/.tmp-preview/voice-segment-playback-20261015/
- 时钟/Java方法：F:/VirtuGene-Mobile/.tmp-preview/voice-clock-route-20261015/summary.json
- 本机HTTP：F:/VirtuGene-Mobile/.tmp-preview/voice-local-protocol-20261015/report.json
- 分句/候选：F:/VirtuGene-Mobile/.tmp-preview/voice-utterance-policy-20261015/comparison.json
- UTF-8更正：F:/VirtuGene-Mobile/.tmp-preview/voice-context-overlap-20261015/utf8-correction.json

可复用实际组件隔离预览：执行node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4216，再打开http://127.0.0.1:4216/?virtugene-preview=mobile。需要本地服务，本轮未启动此端口；仅UI模拟状态，无模型/麦克风/声音，不能演示或证明声学提速。没有同条件改前改后截图/录屏，没有新增Library文件。没有可确认官方侧栏项目迁移接口，未编辑Codex内部数据库或建立重复任务。
