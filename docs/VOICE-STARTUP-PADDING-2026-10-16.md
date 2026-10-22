# 旧安卓超短首段 EOF：有界静音启动与语音帧映射

工作目录 `F:/VirtuGene-Mobile`；可见模型 GPT-6，推理强度未确认。业务 API/Token 0，无麦克风调用；不升版、不构建 APK、不安装、不发布。当前只验证软件实现，不宣称真实耳机/OEM音质或声学时延。

## 解决的具体问题

上一阶段降低首段阈值后，API24–30 仍可能把有效缓冲钳制到比完整短音频更大的值。例如 5ms 音频已全部到达，系统最小缓冲为 100ms；无后续音频时，原来会一直等到 drain 超时。

Android 的有效缓冲不保证等于请求值，因此改后读取实际值；setter 拒绝或抛异常时，只要有效容量仍可读，也可以判断是否需要备用处理。[AudioTrack 官方参考](https://developer.android.com/reference/android/media/AudioTrack#setBufferSizeInFrames(int))

## 实现与代价

- 仍先尝试降低阈值。只针对旧系统、播放尚未推进、当前完整供给边界等于已写语音帧、且没有其他待写包的首段，才进入备用路径。
- 在原语音末尾追加零值 PCM，数量仅补足实际有效启动门槛。不是新合成语音，不删除或改变原语音最后一个样本。首次实际读取的缓冲仍受既有 3 秒 admission 上限约束，临时数组最多 9600 字节；意外更大/不可读的阈值保留失败，不进行无界分配。
- 写入复用现有串行输出执行器，非阻塞写、5ms 让步、10 秒写入上限；再次核对 epoch、运行/暂停、track 身份及实际路由。停止不等网络，照常 pause/flush/release。
- `AudioStartupPadding` 只记一段静音范围。`writtenFrames` 与返回的 `playedFrames` 始终是原语音帧；原生播放头走在静音范围内时语音位置不增加，走出静音后再按正确偏移计入后续语音。
- 停止回执先映射真实进度，再清除静音范围和队列状态。静音不能让后一句提前记成 heardText，也不能复活旧轮。
- 诊断同时输出 `startupPaddingFrames`、`nativeQueuedFrames`。控制器的 queuedFrames/峰值包含实际待播静音；额外保留 voiceQueuedFrames，不能用减去静音的数字冒充物理队列减少。

这是旧系统的特殊兼容处理：可能在首段后留下静音间隔，不能声称每种设备更快或音质不变。现代系统仍使用低阈值路径，不因此统一加垫包。尚未改变运行中欠载后的短尾音处理。

## 重放和证据

不需服务、Key、麦克风或真实模型。项目依赖与 JDK 已安装时：

```powershell
node scripts/verify/voice-startup-padding.mjs
node scripts/verify/voice-startup-padding.mjs --before
```

第一条执行当前实现；第二条执行冻结的修改前当前工作副本并应失败。没有使用 Git HEAD 覆盖源码。证据在 `.tmp-preview/voice-startup-padding-20261016/`。

- 720 个主用例：API24/30 × 8k/24k × 5/25ms 语音 × 40/100/300ms 最小缓冲，每分层 30 轮。
- 7207 项断言包含原语音和末样本不变、全部新增字节为静音、真实进度才生成回执、静音不能推进后一句、后续语音偏移、停止映射及重置。逐字节检查合并为每例一次结果，没有把每个零字节膨胀成单独用例。
- 另覆盖排队后取消/暂停/换路由/停止、超出既有上限，以及可选 resize 返回错误和抛异常。getter 失败并不被假造为 0。
- 实际 Java drain、队列写入、head、stop、观测方法与生产帧映射器在 JVM 设备/时钟/执行器替身中运行。真实 Android 调度、听感和耳机路由不在其证明范围。
- 既有短首段脚本保留为阈值单元回归，明确把新排队委托留给专门集成验证；它的“阈值本身不能突破钳制”不再代表当前完整备用路径未实现。
- 控制器补充断言：物理队列仍有 100 帧静音时，语音待播为 0、只有完整语音进入历史，峰值真实队列不被低报。既有时钟 getter 故障回归覆盖新的实际队列 getter，未知仍缺省。

最终复核及当前源码 SHA-256：`.tmp-preview/voice-startup-padding-20261016/final/report.json`。本轮无同条件真实手机前后截图/录屏，无可替代原生硬件验收的 UI 预览。

## 剩余范围

不可读/超界的设备缓冲、运行中欠载后的短尾音、能量 VAD 的语音与背景声区分、通用无标点等待上限，以及原方案中未运行的 Android 系统/真实服务证据仍需如实列出。后台持续通话依旧为条件项，不因本次变化启用。整体方案不据此宣称完成。

## 后续核验：运行中短尾音与模型边界

固定 Android 7/11/12/16 的 AOSP tag 检查普通混音路径：已经离开初始填充状态的 Track 会直接通过 `isReady`，所检查的 `disable` 没有把填充状态重置；Android 12 客户端在释放写入包时可重启因欠载停用的活跃 Track。这是源码推断，不等于执行 Android，也不覆盖快混音/OEM。[Android 12 服务端](https://android.googlesource.com/platform/frameworks/av/+/refs/tags/android-12.0.0_r1/services/audioflinger/Tracks.cpp)、[客户端](https://android.googlesource.com/platform/frameworks/av/+/refs/tags/android-12.0.0_r1/media/libaudioclient/AudioTrack.cpp)

按该普通混音参考行为补测 2880 个运行中短尾音用例：API24/30/31/36 参数 × 8k/24k × 5/25ms 尾音 × 0/100/2000ms 空闲 × 短/完整首段，每层 30 轮。包括原先 720 首段用例，18727 项通过，尾字节保持且没有重复垫包。把模型改为每次空缓冲都重新填充，测试按预期失败；没有为了通过该反例改生产逻辑。

最初反例测试也意外通过，原因是替身重启条件错误使用累计写入帧而非当前待播帧。两份误通过报告保留为 `rejected-total-frame-model-*`，不计入结果；修正后参考模型通过、反例失败。原首段用例起点为 0，重新运行仍包含全部首段断言。

早先纯策略仿真使用“每次欠载后重新达到阈值”的压力模型，不能冒充上述普通混音路径。新增启动门槛仅用于首次播放的单独变体，输入 schedule、seed、PCM 和尾样本逐行一致，2880 行配对；每个模型 21571 项。24k/100ms、30轮的参考变体：稳定首帧 fixed40/adaptive 均 P50/P95 60/62ms；持续慢供给欠载为 2399→2185 次，首帧 75/78→172/179ms，仍有明显欠载和启动代价，不能照搬旧压力模型中的 809→240 次收益。

```powershell
node scripts/verify/voice-startup-padding.mjs --running-tail
# 反例应失败，不是当前生产回归失败：
node scripts/verify/voice-startup-padding.mjs --running-tail --reset-on-every-underrun
node scripts/verify/voice-playback-buffer-policy.mjs --aosp-startup-only
node scripts/verify/voice-playback-buffer-policy.mjs
node scripts/verify/voice-running-tail-audit.mjs
```

无需服务、Key、麦克风。源码已固定并保存在 `.tmp-preview/voice-running-tail-20261016/aosp/`，审计可离线重放；最后一条同时校验上一轮 Web/Java 验证后的生产源码未变。证据 `.tmp-preview/voice-running-tail-20261016/audit.json`。当前结论是参考普通混音模型内未复现运行中短尾音停滞；OEM/快混音与声学范围仍未验证，不能扩大为所有设备已通过。
