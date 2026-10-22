# 通话中蓝牙回到听筒：恢复链路修复

用户确认问题发生在“先蓝牙正常，通话中又切回听筒”。工作目录F:/VirtuGene-Mobile；可见执行模型GPT-6，推理强度未确认。当前没有手机运行日志或已安装APK哈希，因此以下是源码中已复现的缺口，不将其直接等同为用户设备的唯一根因。

## 复现与修改

### 1. 原生音频重建丢失默认耳机保护

原来`AudioDefaultRoute.privateRequired`只存在于原生会话。JS在`inactive/capture_ended`后显式恢复并重建原生会话时，只传用户手选的preferredRoute；默认蓝牙不会被冒充为用户手选，因此其“不得回到手机音频”的保护也没有传过去。此时设备列表短暂不含耳机，新原生会话会接受听筒。

现在JS将“本逻辑通话已确认使用耳机”的隐私要求独立保存，通过`requirePrivateRoute`传给重建后的原生会话；原生重置时先恢复此约束。耳机未就绪时等待或保持暂停，不能静默选听筒。JS也拒绝旧原生实现返回的明确听筒/扬声器结果。此要求不等于用户指定某个设备ID；用户明确成功选择手机时仍允许，新的逻辑通话不继承旧实例状态。

修改：`src/lib/voice-call/native-audio.ts`、`AudioDefaultRoute.java`、`VoiceCallAudioPlugin.java`。先添加回归，旧实现在原生和桥接两层均出现60条失败；修改后通过。原稿保留`native-red.json`及`bluetooth-red-20261018.json`。

### 2. 被其他音频打断后未恢复通信模式

原来resume先尝试设置路由，之后才申请焦点，而且没有恢复被其他音频所有者改变的`MODE_IN_COMMUNICATION`。局部复现中恢复成功但mode仍为普通模式；焦点申请被拒绝时也可能已经改过其他通话的路由。

现在resume先检查会话仍可恢复、重新获得音频焦点，再恢复通信模式，最后选择/确认目标耳机并启动录音。焦点拒绝时不修改mode和路由。不删除后台安全暂停、不自动播放被打断的回答、不新增无限重连。

对应测试先失败60条，记录`mode-red.json`，修复后通过。首次新增布尔测试参数时旧JVM夹具只支持Integer扩展字段，发生编译失败；新增单独布尔flags并准确读取后才得到有效行为失败，不把夹具编译失败当产品根因。

## 验证证据

当前源码验证命令：`node scripts/verify/voice-bluetooth-continuity-final.mjs`。

原始目录：`.tmp-preview/voice-bluetooth-continuity-20261018/`，包含运行前后源码SHA-256、每命令输出、行为失败与通过报告。修改前源自当前工作副本的`before/`，没有用HEAD覆盖并行修改。

- 默认选路及恢复29场景、每场景30轮，1320条检查。
- 桥接默认隐私与显式选择，690条检查，覆盖失败/取消/迟到路由、手动选手机和新通话隔离。
- 必要回归复用默认耳机、权限生命周期、路由取消、控制器、原生路由、连续播放、类型检查与Web构建；具体退出状态见`call-regression-report.json`。
- Android只执行`:app:compileDebugJavaWithJavac --offline`，不执行assemble/package/install。

这些是实际生产方法配合Node/JVM替身的验证，不能证明Android系统、耳机物理双向声音、OEM稳定性或手机已安装版本生效。没有本轮同条件手机前后截图/录屏；本轮没有UI修改，也没有可听预览。

实际业务API/token/音频/麦克风用量0。未读取密钥、安装依赖、改版本、生成APK、安装或发布。保留此前用户不生成安装包的决定，不再次索要此许可。真实系统验收仍未验证，整体方案不声明全部达标。
