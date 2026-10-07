# 小球真机验收 · 2026-10-07

本轮检查：Android SDK/ADB 可用，`adb devices -l` 没有设备。没有 Android 帧时间、温升或耗电实测结果。浏览器检查不能替代该项验收，当前也没有重打 APK。

## 采集入口

`node scripts/verify/collect-orb-device.cjs --label dual-orb-dark` 仅采集已授权设备的诊断信息；多设备时加 `--serial`，自定义 SDK 可加 `--adb`。输出位于 `.tmp-preview/orb-device/`。设备未连接、未授权或 App 未运行时写入 `not-measured`，不标为通过。不会安装/启动 App、修改系统设置、重置计数器或读取聊天数据库。

采集包含设备/Android/WebView 版本、当前 App 包信息、gfxinfo 原始窗口帧统计、App 内存、当前电池和热状态。原始信息保留在本地，禁止把单次电池/热状态快照当成耗电/温升结论。报告默认 `buildMatch: unverified`，必须先确认测试包包含此次前端产物；冻结的6.0.0安装包不能证明本轮代码的性能。模拟器报告明确标记，不能充当手机实测。

## 场景与结果表

同一设备、同一候选测试包、固定亮度/刷新率/充电状态，分别测深浅色：

| 场景 | 执行 | 记录 |
| --- | --- | --- |
| 单球 | 44px聊天头部，持续待机、思考和忙碌各30秒 | JS帧内耗时p95、帧时间分布 |
| 双球 | 使用正式组件的测试页，44/52px同时可见，持续30秒 | 与单球对照；两球共用时钟 |
| 高反差 | 低落→开心、困倦→完成、开心→低落，连续操作 | 动作连续、状态不延迟、无重复回应 |
| 触碰/滚动 | 按压、滑出取消、反向打断、键盘弹起、快速切页 | 不粘住、不误触，不抢输入与滚动 |
| 暂停恢复 | 失焦/后台30秒、视口外、系统与应用减少动效 | 暂停后没有小球帧客户端，恢复不补播旧事件 |
| 持续运行 | 固定场景10分钟；与相同静态场景对照 | 内存趋势、热状态、电池趋势；不据一次快照判断 |

现有录制入口：`record-orb-personality.cjs` 导出双尺寸编排演示；`record-orb-motion.cjs` 导出真实聊天与面板。它们的桌面浏览器录像证明交互路径，不能填充上述真机数据栏。

## 指标边界

`dumpsys gfxinfo ... framestats` 提供窗口帧证据，输出随Android版本变化；不要将其直接标成“小球JS耗时”或“WebView GPU耗时”。可结合系统追踪/Perfetto及WebView远程调试分别检查主线程、渲染与GPU；记录真实设备刷新率，避免把所有设备统一套成16.67ms。

依据：[Android dumpsys](https://developer.android.com/tools/dumpsys)、[渲染速度检查](https://developer.android.com/topic/performance/rendering/inspect-gpu-rendering)、[系统追踪](https://developer.android.com/topic/performance/tracing)。官方渲染检查文档明确说明柱状图监测的是CPU侧的渲染流程；GPU异步执行，不能把柱状图直接当作GPU执行时间。
