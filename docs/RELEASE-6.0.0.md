# VirtuGene 6.0.0 构建记录

构建及发布日期：2026-10-04（Asia/Shanghai）。已完成本地 release 安装包，并按用户后续要求上传 GitHub Releases、更新官网及 6.0 功能演示。按用户要求跳过真机验收，功能范围保持冻结。

## 发布记录

- 发行页：[VirtuGene 6.0.0](https://github.com/wzy6789/VirtuGene-Mobile/releases/tag/v6.0.0)，已设为最新正式版。
- 附件：`app-release.apk` 与 `app-release.apk.sha256`。GitHub 资产摘要与下方冻结 APK 的 SHA-256 一致，大小 59,366,330 字节。
- 发布源码快照：`6b54e350df68f7a9c167faee375e62bdaef6d8e4`，通过独立临时索引保存并推送为 `v6.0.0`；保留本地应用工作区和索引。
- 官网：[6.0 新功能演示](https://wzy6789.github.io/VirtuGene-Mobile/#release-6)，部署提交 `615ad6bc43939b8f7e59b816b49d0f02aecccfa7` 仅更新 `website/**`；[Pages 部署](https://github.com/wzy6789/VirtuGene-Mobile/actions/runs/37206971278) 成功。
- 演示使用本期生产构建的实际界面与示例账号，包含今日、收集箱、完成及撤销、真实交接录屏、五种小球状态；不展示未开放原型。
- 官网通过 175 项本地浏览器检查（320 / 390 / 600 / 768 / 1024 / 1440px）及 21 项线上浏览器检查（390 / 1440px），无脚本异常。线上图片、CSS、JS、SVG 和 WebM 返回 200。

## 安装包

- 交付文件：`release/VirtuGene-6.0.0.apk`
- 原始产物：`android/app/build/outputs/apk/release/app-release.apk`
- 大小：59,366,330 字节（约 59.4 MB）
- 包名：`com.virtugene.app`
- versionName：`6.0.0`
- versionCode：`39`（从 `38` 递增）
- 最低 Android API：24；targetSdk：36
- SHA-256：`BEE3D276F1069603539D2D4869809DD7A78C33BE83981F69B53ABE8E3637206B`

工程版本、package-lock 两处根版本、Android 版本、应用内更新说明均已统一。保留旧版更新历史。既有安装包签名继续使用同一证书，以保持覆盖升级兼容；`apksigner verify` 通过 v2 验证，证书 SHA-256 为 `ef38a01c9c1674a53537330e6de7ed6e3de86359715bc9c61af53ffc9de04016`，与既有发布记录一致。

APK 中全部 114 个 renderer 文件逐一与已验证构建做 SHA-256 比对，一致。复制后的交付 APK 与原始产物哈希一致。没有包含 `古月娜素材/`；该目录已被 `.gitignore` 排除，无该路径的历史提交。

## 本期说明

**让数字灵魂陪你行动。** 行动舱本期开放今日与收集箱，项目、风险、复盘将陆续到来。

- 从消息首页或助理聊天进入行动舱，集中查看今日重点、逾期、等待反馈与已完成行动，统计与助理每日整理使用同一数据口径。
- 临时事项先收集，再编辑和排期；重复任务按每次发生记录。完成、重点调整、补记跟进可以撤销，安排与实际联系分别留痕。
- 小球保留 12 种表情、目光跟随和聊天进入行动舱的接力动画。产品引导介绍待机、思考、忙碌、完成、遇到困难五个核心状态。
- 聊天流式呈现，DeepSeek 连接统一使用 Flash；世界、聊天、助理执行和设置按需加载。
- 保留已有数据，兼容升级、备份与同步，完善加载失败恢复与账号切换保护。

6.1 范围仍为项目中心，以及两个混合引用和日期控件视觉收尾。完整冻结记录见 [6.0.0 冻结与发布验收](RELEASE-6.0.0-GATE.md)。

## 本次验证

| 检查 | 结果 |
| --- | --- |
| TypeScript | 0 错误 |
| renderer 生产构建及静态依赖预算 | 通过；入口约 485 KB / gzip 162 KB |
| 正式分包、故障与升级提示 | 9 项通过，新增 6.0.0 更新说明只显示一次及关闭后持久化 |
| 行动舱 | 54 项数据 + 20 项 UI 通过 |
| 助理 | 1,228 项数据 + 157 项 UI 通过 |
| 小球 | 70 项通过 |
| 模型协议 | 363 项通过 |
| Android release 构建 | 成功，49 秒 |
| APK 版本、签名、renderer、复制哈希 | 全部核对通过 |
| 真机性能、耗电、后台恢复、通知到达 | 按用户要求跳过，未实测 |

消息首页实际 JS 请求含种子初始化，约 1.036 MB / gzip 441 KB；该结果来自 Chrome 正式构建请求集合与本地 gzip 计算，不是安卓耗时。沿用的 Gradle 9 弃用提示、验收 IIFE 的 import.meta 提示和两个已排入 6.1 的混合引用提示不影响本次构建及上述检查。

可复核日志：`.tmp-preview/release-6.0.0-renderer-build.txt`、`release-6.0.0-production.txt`、`release-6.0.0-cabin.txt`、`release-6.0.0-secretary.txt`、`release-6.0.0-orb.txt`、`release-6.0.0-providers.txt`、`release-6.0.0-android-build.txt`。发布前使用本页记录的同一份 APK，外部发布并未由本次构建自动执行。
