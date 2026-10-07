# 6.0.0 助理整合版安装包核对

构建日期：2026-10-05。本轮按用户授权整合今日安排、助理对话与待处理事项，页面标题使用用户给助理取的名字。

## 安装包

- 文件：`release/VirtuGene-6.0.0-assistant.apk`
- 应用 ID：`com.virtugene.app`
- 版本：`6.0.0`，Android `versionCode 40`，可覆盖此前 code 39 构建。
- 大小：59,379,495 字节。
- SHA256：`9A40F932EC3BE1702A26B450C5A113B6F2564905AD79EA5EEEBBE180CBA0A450`
- 签名：`apksigner verify` 通过，v2 签名有效；沿用原升级签名，证书 SHA256 为 `ef38a01c9c1674a53537330e6de7ed6e3de86359715bc9c61af53ffc9de04016`。
- Android：minSdk 24，targetSdk / compileSdk 36。

此前 `release/VirtuGene-6.0.0.apk` 是 2026-10-04 的 code 39 历史安装包，保留原文件。本次安装请使用带 `assistant` 的新文件。

## 核验

类型检查、Vite 生产构建、Capacitor 同步与 Android release 构建全部通过。APK 内 121 个前端产物逐一与当前 `dist` 比较 SHA256，全部一致；包信息核验确认版本为 6.0.0 / 40。

新增整合检查 23 项数据与 15 项界面通过；既有助理 1,228 项数据与 157 项界面、待办组件 54 项数据与 20 项界面通过。导航归属修正后重新通过类型检查、生产构建与正式构建 9 项检查，确认助理属于消息详情、返回消息列表。主入口 gzip 约 162.28 KB。

真机验收按用户明确要求跳过；上述结果不代表真机性能或实际通知到达情况。没有执行外部发布。

功能范围与数据契约见 [助理整合实现记录](ASSISTANT-HUB-INTEGRATION-2026-10-05.md)。
