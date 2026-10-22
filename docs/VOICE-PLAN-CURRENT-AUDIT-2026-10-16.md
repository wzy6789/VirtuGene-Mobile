# 实时通话方案：当前逐项验收（2026-10-16）

原规格：桌面 `VirtuGene-Mobile-实时通话与蓝牙稳定性优化方案-2026-10-15.md`。以下按原规格核对，不用已完成项目重新定义目标。工作目录F:/VirtuGene-Mobile；编码模型GPT-6，推理强度未确认。

本次没有新增业务行为。新增当前回归入口 `scripts/verify/voice-plan-current-audit.mjs`，固定本轮源码SHA-256并保留每条命令输出。旧阶段报告保留原状态，不作为当前整体完成证明。

## 规格与证据对应

“本地已验”仅指该行声明的软件范围，不等于Android系统执行或真实服务验收。

| 原规格 | 当前实现与核对结果 | 直接证据、限制 |
|---|---|---|
| 1、2、9：现有架构、仅MiMo、完整音频ASR | 本地已验：保留原controller/lifecycle/native-audio、HTTP/SSE；没有新增RTC或供应商 | mimo.ts能力声明；本轮core、local-protocol。ASR仍为完整WAV，不宣称双向音频流 |
| 2、11：既有功能不因新链路退回 | 本地已验：文字输入、静音、语音模式、字幕默认关、手动字幕保留 | 本轮native-input/input-contract、actual-ui；不是系统麦克风权限弹窗测试 |
| 3：贯通身份和有界时间线 | 本地已验：turn/request/segment及route generation，首32+末96、最多128事件 | trace.ts、controller.ts；本轮timeline、evidence |
| 3：诊断不含密钥、私人原文和设备名 | 本地已验：trace显式字段投影，数值设备类型；业务聊天记录与诊断分离 | trace.ts；timeline字段投影/界限测试。不上传日志 |
| 3：原生最后采样帧与JS接收区分 | 本地已验：批末帧、短read尾计数、可选AudioRecord时间戳；缺失保持未知 | 本轮clock-native/native-input；JVM不证明驱动声学时钟准确 |
| 3：跨时钟区间而非直接相减 | 本地已验：有界探测、往返区间、generation/过期保护 | clock.ts、native-audio.ts；本轮clock-bridge/clock-native |
| 3、4：ASR/上下文/正文/可说短句/TTS/写入/播放分别计时 | 本地已验：分阶段trace及计数，首正文与首短句分开、写入与render分开 | 本轮timeline、evidence；不把重叠阶段累计相加 |
| 3、4：物理首声与物理停声 | 排除当前证据范围：没有外部录音或硬件耦合计时 | 原方案10.1明确不是要求用户补实验；不能用软件帧回执代替 |
| 4：1.2–1.5s/P95 2.5–3s等候选预算 | 未证实真实服务达标；规格写明是试验预算、非SLA | 本地各模拟分层和逐轮原始记录可审阅；不作普遍3–5倍速度承诺 |
| 5.1：比较判停策略、先保完整性 | 已完成本地比较：700/400/能量候选同帧对照；较短策略误切，生产保留700ms | utterance-policy各15层×30轮×3策略。长犹豫、轻声与背景电视区分仍有限；没有捏造语义VAD |
| 5.1、9：提前ASR和续说合并 | 本地已验：240ms提前识别、700ms最终端点分离，有界队列及续说取消 | 本轮boundaries/latency；合成PCM编码词标记验证不漏段，不代表真实中文ASR正确率 |
| 5.2：所有来源核验计数含嵌套审核 | 本地已验：reviewSpeech嵌套回调纳入计数，事务用时分列 | context.ts:246起、controller.ts来源计时；本轮evidence；不相加嵌套时间 |
| 5.2：选中来源批量、账号/角色/世界/版本/撤权 | 本地已验：bulkGet、单只读事务及源版本校验，传输与播放前保持新鲜核验 | context.ts:194起；本轮transmission/core；存量DB逐轮完整输入哈希一致 |
| 5.2：大量无关失效记录及零匹配 | 有存量资料的隔离IndexedDB已验；候选检索不搬入逐PCM核验 | voice-selected-suppression/knowledge-scope历史同条件对照；最新phrase browser额外每段4次核验/508行，候选索引搜索不重复。历史性能仅属对应旧阶段 |
| 5.3：无标点受控等待且不逐字合成 | 本地已验：完整短句候选首450/后700ms，数字/URL/代理对、条件/否定范围保护 | 最新phrase final/1110、queue540、controller840；无安全边界仍等待final或1024码点报错；不称通用语义端点 |
| 5.3：先审核再合成/播放 | 本地已验：计时与普通分句共用串行审核队列；撤权停止、取消后不能复活 | phrase queue/controller及本轮transmission；不省略质检换时延 |
| 5.3：连续音轨、segment帧区间与最多一条未来合成 | 本地已验：200ms前缀、9600字节分块核验、native目标frame drain | 最新headset final中的segment2397；本轮native-drain；不是耳机无缝声学证明 |
| 5.3：小而非零的设备/供给缓冲 | 本地已验：40–160ms有界反馈，完成轮且真实供给欠载才训练，取消/换路由清空 | playback-buffer-policy/native-audio；本轮buffer-bridge/native。AOSP参考与压力模型区分，不宣称所有OEM收益 |
| 5.3：短EOF与尾音 | 本地已验：API31阈值处理；旧API仅初始一次有界补静音，语音/物理队列帧区分 | 本轮padding/native-drain；running-tail固定AOSP源码参考模型已验，非Android运行，>3s/不可读缓冲仍不支持此回退 |
| 5.3：不猜测TCP/TLS重复连接根因 | 遵守：未因new HttpURLConnection就改网络框架或声称重复TLS | MimoStream保持现有协议；无握手实测，不虚构收益 |
| 6：本地停止优先、旧轮失效、取消迟到PCM | 本地已验：停止回执与generation、AbortSignal、预取与审核竞态 | 本轮core/latency/boundaries、最新路由和segment回归。物理残声未知 |
| 6：回声保护、预卷及续说完整性 | 本地已验：无AEC扬声器outputPending保护，确认恢复后清除；不把设备丢失当说完 | 本轮speaker-echo/recovery、boundaries；真实AEC质量未验 |
| 6：历史只记最终转写及确认已播放内容 | 本地已验：完整已播segment投影；generatedText不冒充heardText | 本轮core/native-drain；phrase各轮完整PCM/已听哈希。不支持臆测词级已听 |
| 6：旧END、同ID重开、资源所有权 | Java注册表、会话所有权及本地单元测试覆盖；实际通知PendingIntent交付尚未验 | VoiceCallServiceSessions/AudioSessionAuthority/MimoStreamLifecycle测试；通知OS分发仍是系统缺口 |
| 7.1：单一音频所有者、新旧API分层、通道确认 | 本地已验：API31通信设备选择及有效get确认；旧SCO广播确认、8k转换 | 最新headset1200、native-route及route桥接。设备可选≠真实双向通话 |
| 7.1：输入/输出实际route与首帧观察 | 本地已验：录音/播放getRoutedDevice与通信设备分列，异常安全暂停 | 本轮clock-native、最新原生路由回归；OS返回值由替身提供，不证明硬件 |
| 7.2：默认耳机、断连不外放、用户手选手机优先 | 本地已验：新通话默认耳机，未就绪等待8s；手选偏好只在有效确认后保留，新通话重置 | 最新headset final/default-headset、preference-bridge；未验证用户手机安装包 |
| 7.2：分级等待、取消与恢复 | 本地已验：4s恢复操作、带call/session/request取消确认、旧结果不覆盖新恢复 | 最新route-recovery360/native780和对应实际组件预览；显式继续，不自动重播 |
| 8：API24–30、31+权限与隐私开关 | 已验软件分支：拒绝、迟到授权、权限弹窗暂停/恢复、后台取消、隐私静音 | 最新permission1350；OS权限窗口与系统撤权交付仍未执行 |
| 8：API33通知拒绝、API34服务类型、target35焦点资格 | 不完整：异常路径与类型所有权本地可验，实际OS资格/通知可见性未验 | VoiceCallService及生命周期源检查、JVM替身不足以通过Android系统验收 |
| 8：前台最小化与系统后台区分 | 软件层暂停/恢复可验；真实Activity/进程重建未验 | 本轮actual-ui与生命周期夹具；不得声称WebView/OS生命周期已实测 |
| 8、9：后台持续通话P3 | 条件项未启用：没有额外产品授权，保留后台安全暂停与JS心跳 | 原规格10.2明确“若明确需要”；不把删暂停/心跳当已原生化 |
| 9：MiMo capability、背压、超时、usage | 本地已验：实际客户端与本机HTTP/SSE，540请求、六个主分层各30轮 | 本轮local-protocol6291项；15ms仅夹具超时，不修改生产45s；真实服务计费未知 |
| 10：同条件、各主分层30轮、输入哈希、费用与失败样本 | 本地已有逐轮证据，失败/撤回结果保留；范围各报告单列 | 最新phrase browser30/30、controller各90；running-tail2880；没有拼成真实服务总体均值 |
| 10：Android模拟器验证权限/通知/服务/进程 | 缺失：SDK无emulator.exe、无system-images、无AVD | 本轮environment.json；不下载镜像、不构建/安装APK绕过现有约束，JVM不能替代 |
| 11：现有验证入口与源码映射 | 本轮补跑19个命令，当前回归SHA-256证明执行期间所列源码未变 | 本轮regression.json；最新phrase final另含类型检查和Web构建。没有执行live provider脚本 |
| 12、14：本地预览、证据位置、日志与边界 | 已交付实际组件隔离预览命令，模型/麦克风/声音隔离；维护手机版Obsidian日志 | route-recovery UI与下述启动命令；本轮无手机前后录屏，不伪造 |
| 14、15：无付费、无版本/APK/发布、无外部消息 | 遵守当前授权；本轮业务API/token/音频用量0，代码代理自身费用不可见 | 所有请求只到localhost；不读取密钥、不安装依赖、不上传Library |
| AGENTS：侧栏项目归属 | 未验证：没有可确认身份的官方迁移接口 | 不编辑Codex内部数据库、不创建重复编码任务 |

## 当前结论

本地实现与本地验证能覆盖的项目已有证据；**整体完成尚未得到证明**。原方案要求的Android系统/模拟器验收仍缺权限窗口、通知拒绝、前台服务资格及实际进程生命周期证据。真实服务与物理声音是原方案明确排除的当前证据范围，不把它们改写为用户必须补做的前置条件；也不因此声称真实通话速度达标。

下一步只处理逐项核验明确暴露的缺口；不继续凭猜测添加提速功能。当前环境无模拟器且维持不打包/不安装的约束时，不能用更多JVM绿色项补成OS证明。P3不是本期必做项，没有后台持续通话完成声明。

## 交付与复现

- 本轮完整日志、生产文件hash：`.tmp-preview/voice-plan-current-audit-20261016/regression.json`。
- Gradle离线单测27个通过（26个通话相关，1个模板），失败/错误0：`gradle-unit-report.json`及XML。第一次启动在断言前失败，日志保留；原因是PATH多余双引号进入java.library.path。仅本次子进程去除PATH中的双引号，再以`--no-daemon`重跑；未修改系统PATH或项目业务配置。
- 上一阶段仍对应当前源码的必要回归：`.tmp-preview/voice-phrase-deadline-20261016/final/report.json`及其浏览器逐轮记录。
- UI隔离预览：`node scripts/verify/voice-route-recovery-ui.mjs --serve --port 4196`，打开 `http://127.0.0.1:4196/after?virtugene-preview=mobile`。需要本地服务；不是Android耳机演示，未连接模型或麦克风。本轮不启动常驻服务。
- 没有本轮同条件手机截图/录屏，没有Library保存、APK安装哈希或装机生效证据。没有改写旧桌面版日志。

离线Java单测的本机复现方式（PowerShell，工作目录`F:/VirtuGene-Mobile/android`）：

```powershell
$testProcessPath = $env:Path
try {
    $env:Path = $testProcessPath.Replace('"', '')
    .\gradlew.bat :app:testDebugUnitTest --offline --no-daemon
} finally {
    $env:Path = $testProcessPath
}
```

命令没有assemble/package APK或安装任务。它执行JVM单测，不会变成Android模拟器测试。
