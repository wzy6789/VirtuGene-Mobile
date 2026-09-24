# VirtuGene Mobile 5.2.1（首个 Gitee 发布）

发布渠道：**Gitee 发行版**（本次起 Android 安装包与应用内更新不再走 GitHub）。
发布日期：2026-09-24。

## 这一版包含什么

- **跨场景记忆账本**：角色按实际知情范围召回单聊、群聊、朋友圈、日记、待办与星域经历；
  编辑、撤回或删除来源后，旧记忆不会再在后续对话里重新出现（见 `docs/CHARACTER-MEMORY-*.md`）。
- **发布渠道迁移**：应用内更新读取 Gitee 最新发行版及其 APK 附件；代码主仓库迁到
  `gitee.com/wang-zhiyi6789/virtu-gene`。
- 朋友圈设置新增「好友近况」分组（允许好友主动分享 / 默认分享节奏）；世界页补充
  「你带着」「你离开时发生的事」等面板。

## 产物

| 项 | 值 |
| --- | --- |
| 包内版本（aapt2 实测） | `versionCode='28' versionName='5.2.1'`，minSdk 24 / targetSdk 36 |
| 体积 | 4,115,671 B（约 3.9 MB） |
| SHA-256 | `2c0fb73755a5f6bffff4377361e070fc8d2273d607f35503eb845750f4d10078` |
| 签名 | `CN=Android Debug`，SHA-256 `ef38a01c…40:16`（与 5.0.4 起同一把，可覆盖升级、本地数据保留） |
| 发行版 | `https://gitee.com/wang-zhiyi6789/virtu-gene/releases/tag/v5.2.1` |
| 附件直链 | `https://gitee.com/wang-zhiyi6789/virtu-gene/releases/download/v5.2.1/app-release.apk` |

发布方式：`node scripts/gitee-release.mjs 5.2.1`（脚本自己构建 + 上传）。

## 线上核对（都已实测通过）

- `/releases/latest` → `tag_name = v5.2.1`，`id = 1164960`；
- **`attach_files` 在发行版对象里是空的**（Gitee 的固定行为），改查
  `/releases/1164960/attach_files` → 1 个附件，`size = 4,115,671 B`，
  `browser_download_url = …/releases/download/v5.2.1/app-release.apk`；
- 匿名下载该直链 → 逐字节等于本地构建产物（SHA-256 一致），`aapt2 dump badging` 线上包
  仍是 `versionCode 28 / versionName 5.2.1`；
- 固定路径 `https://gitee.com/<repo>/releases/download/v5.2.1/app-release.apk` 匿名返回 HTTP 200。

## 前端取包口径（新增代码必须照此实现）

Gitee 的发行版对象里 `attach_files` **永远是空的**，只读它的调用方会拿不到 APK。正确顺序：

1. 读发行版对象里的 `attach_files` / `assets`（有就用）；
2. 否则查 `/releases/{id}/attach_files`（匿名可读）；
3. 再否则用固定路径 `/releases/download/{tag}/app-release.apk`。

手机端 `src/lib/mobile-update.ts` 与官网 `website/main.js` 都已按这三步实现。

## 未完成 / 待办

1. **官网托管未迁移**：旧站仍托管在 GitHub Pages（其自动部署 workflow 已删除，内容停在 5.2.0），
   Gitee Pages 当前不可用。`website/` 已把 Android 下载地址改成 Gitee 直链，
   但 `canonical` / `og:url` / `og:image` 仍写 GitHub Pages 地址，换托管后需一并更新。
2. **官网图库有代差**：图库照片拍摄于 5.1.5 构建，而 5.2.x 改动了朋友圈设置、世界页面板与
   聊天窗口；需要时按当前构建重拍一轮。
3. **真机验收仍在欠**：跨场景记忆、朋友圈触屏长按、世界页新面板都需要在真机上过一遍。
4. GitHub 侧历史 Release（v5.1.4 / v5.1.5 / v5.2.0）保留作存档，无法从 App 内更新到；
   新版本一律只发 Gitee。
