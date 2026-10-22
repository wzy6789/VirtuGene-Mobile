# Android系统验收用例准备（未运行）

工作目录F:/VirtuGene-Mobile；本轮可见编码模型GPT-6，推理强度未确认。本项落实原方案8、10的系统证据缺口，不是新增产品功能。

## 已准备

- `android/app/src/debug/java/com/virtugene/app/plugins/VoiceAcceptanceActivity.java`与debug Manifest：只显示固定说明的前台宿主，不启动MainActivity、WebView、数据库、麦克风或模型链路。仅debug源集；本轮实际合并的release Manifest不含该Activity。
- `VoiceCallServiceInstrumentationTest.java`：在明确指定、主动启用的API33+模拟器上运行实际VoiceCallService。只注册capture=false票据，要求RECORD_AUDIO保持拒绝；不使用真实音频设备或调用模型。
- `scripts/verify/voice-android-system.mjs`：默认dry-run，不连接ADB。`--run`还要求专用环境开关、emulator序列号、硬件类型及两份已安装APK的预期SHA-256；脚本不下载、不构建、不安装。选择准确测试类，避免把模板用例或空运行当通过。失败输出、安装二进制哈希及清理结果记录本地。

运行范围是两轮三项，而不是全部Android门槛：

| 运行 | 断言 |
|---|---|
| 通知允许，2项 | 文字服务在真实OS成为前台服务、通知有挂断动作；旧通知PendingIntent不结束替换后的服务，当前通知能结束自己的服务 |
| 通知拒绝，1项 | 同一文字服务仍能成为前台服务，OS通知授权保持拒绝、麦克风授权保持拒绝 |

拒绝通知的断言不把`getActiveNotifications()`当作通知抽屉可见性证明。Android可能延后展示前台通知，因此允许场景有单独20s观察上限；这是测试等待，不是通话时延承诺。机制依据：[Android通知权限](https://developer.android.com/develop/ui/compose/notifications/notification-permission)、[前台通知延后行为](https://developer.android.com/reference/android/app/Notification#FOREGROUND_SERVICE_DEFERRED)。

## 本轮实际验证

- `:app:compileDebugJavaWithJavac --offline`通过：debug宿主Java编译通过。
- `:app:processReleaseMainManifest --offline`通过：实际release合并Manifest无测试宿主，debug合并Manifest有宿主。
- 默认dry-run及未授权`--run`拒绝分支已执行；拒绝发生在任何ADB调用前。
- `:app:compileDebugAndroidTestJavaWithJavac --offline`失败：本地没有已声明的`androidx.test.ext:junit:1.3.0`和`androidx.test.espresso:espresso-core:3.7.0`缓存，未进入新增仪器用例的Java编译。**新增instrumentation代码尚未编译通过、未在Android运行，不能声称测试已通过。** 没有为绕过离线缺失而换依赖版本或使用替身伪造编译。
- SDK仍无模拟器、系统镜像和AVD；未下载依赖、未生成/安装APK、未改版本、未发布，业务API/token/音频用量0。没有同条件手机截图/录屏或Library上传。

原始证据在`.tmp-preview/voice-plan-current-audit-20261016/`：`instrumentation-offline-compile.txt`、`debug-host-compile.txt`、`release-manifest-check.txt`、`android-run-guard.txt`与`android-acceptance-readiness.json`。

## 后续执行条件

用户当前“不打包”边界未撤销。需要另行明确允许下载模拟器/系统镜像及现有测试依赖，并生成、安装仅系统验收使用的debug和androidTest APK；保持不改版本、不发布、不调用模型、不使用用户真机。当前没有执行这些步骤。

获准且完成环境准备后，先完成instrumentation编译并审查任何失败，再仅在新建的隔离模拟器安装两份本地APK。不要指向用户手机；该脚本会force-stop目标测试App并修改模拟器中的通知/麦克风授权，使用独立AVD而非有用户数据的环境。两份本地APK的SHA-256应与脚本查到的已安装base.apk一致。

```powershell
# 默认只看执行范围，不连接设备、不构建或安装：
node scripts/verify/voice-android-system.mjs

# 以下仅在另行获准、环境与APK均已准备之后运行：
$env:VIRTUGENE_VOICE_SYSTEM_ACCEPTANCE = '1'
node scripts/verify/voice-android-system.mjs --run --serial emulator-5554 `
  --target-sha256 <本地debug-APK的SHA256> --test-sha256 <本地androidTest-APK的SHA256>
```

完成这三项也不能代替麦克风权限窗口、服务类型切换、焦点丢失、真实Activity/进程重建的系统用例；这些仍需按原验收表继续处理。真实MiMo时延、物理耳机/OEM/功耗仍是原方案排除的当前证据范围，不要求用户补做手机实验。整体目标保持未完成。
