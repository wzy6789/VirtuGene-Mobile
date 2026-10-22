# 蓝牙通话中途恢复：等待确认与取消保护 · 2026-10-18

工作目录：F:/VirtuGene-Mobile。实际可见编码模型：GPT-6；推理强度：未确认。

## 本轮修复的范围

用户确认故障发生在通话中，耳机仍连接手机但声音回到听筒；在上一轮“默认耳机保护跨原生重建保留”和“先焦点、后通信模式和选路”的基础上，本轮继续修复恢复链路。没有手机故障时的运行日志，因此不把源码缺口直接等同于该设备唯一根因。

原先首次通话对选路结果等待最多8秒，但resume只调用一次prepareDefaultRoute。系统接受请求、尚未确认设备时，resume立即报headset_unavailable；上层resume还有2秒桥接超时，不能容纳正常的异步耳机恢复。

现在恢复等待实际通信设备确认，100ms检查一次、最多8秒。期间录音和播放保持暂停，禁止自动降级听筒或扬声器。原生立即确认时立即完成，不固定增加8秒等待。上层resume等待至少9秒，覆盖原生8秒限时和回传余量；其他普通桥接操作的超时不变。旧版Android重新建立SCO通道也走确认流程，避免启动SCO的内部暂停把自己的待恢复请求取消。

挂断、切后台、焦点丢失、主动暂停、关闭会话都会取消待恢复请求和轮询；迟到确认不能重新打开通话。重复resume不能抢走首个请求；显式改选路由仅在请求身份有效后取消旧恢复，过期选择不能取消新恢复。等待期间重新核验麦克风授权与系统静音；到达超时边界后，即使设备刚变为就绪也不再启动。

本轮没有新增自动重连或自动重播被中断回答。用户明确选择手机仍被保留，不把手机选择强制改回耳机。

## 改动与证据

生产文件：

- android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java：独立待恢复请求、8秒确认、取消与权限检查，旧SCO恢复保护。
- src/lib/voice-call/native-audio.ts：仅resume的桥接时限与原生等待对齐。

验证文件：scripts/verify/voice-default-headset.mjs、voice-native-lifecycle.mjs、voice-headset-preference-bridge.ts、voice-route-recovery-native.mjs；归档入口scripts/verify/voice-bluetooth-resume-final.mjs。

运行入口：`node scripts/verify/voice-bluetooth-resume-final.mjs`。独立证据目录：`.tmp-preview/voice-bluetooth-resume-20261018/`。

- before/保存本轮修改前的实际工作副本，没有用HEAD覆盖其他任务代码。
- native-red.json：新增异步恢复用例先在旧实现失败，1890条检查中360条失败；它是新增后续边界用例之前的有效失败记录。
- native-after.json、bridge-after.json：最终源码行为报告。
- call-regression-report.json和call-regressions/：必要回归及逐项原始输出。
- report.json：最终状态、生产源码哈希、运行期间源码一致性、Java编译及回归退出状态。
- rejected-source-changing-run/：首轮完整回归各命令通过，但过程中修改了取消身份顺序与超时边界，源码哈希不一致，该轮不作为最终通过；汇总脚本随后还因未生成的桥接结果而退出。修正汇总对缺失文件的处理，冻结生产源码后重跑，不隐去失败过程。

最终通过项以report.json为准，不用旧报告替代新源码验收。

## 未验证与使用边界

本轮是Node/JVM替身执行实际生产方法，以及类型检查、Web构建和Android Java编译。没有Android系统/OEM的实际回调时序、双向蓝牙声音、物理耳机稳定性、功耗或已安装APK哈希验证，不能据此宣称用户手机已修复。

没有本轮同条件手机前后截图/录屏；这次修改没有可用网页预览来证明蓝牙声音。模型业务请求、token、麦克风与真实音频调用均0；未读取密钥，未新增依赖、改版本、生成APK、安装或发布。整体实时通话方案不声明全部达标。

后续仅保留安装版本对应的系统音频路由与焦点证据确认；本轮不主动索要真机、打包或付费测试，也不添加新的优化方向。
## 最终本地验证结果

最终归档report.json为passed=true，运行前后所列生产源码哈希一致；三个执行阶段均exit0，11项子回归均exit0。原生默认耳机/恢复41场景各30轮，2040条检查；桥接750条检查，失败0；权限生命周期1350条检查，路由请求取消810条检查。类型检查、Web生产构建、Java离线编译均通过。Java仅compileDebugJavaWithJavac，没有assemble/package/install。既有构建告警不等同失败，也不据此推断硬件表现。