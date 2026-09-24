# VirtuGene Mobile 5.2.2（渠道迁回 GitHub）

发布日期：2026-09-24。这一版只有渠道变更：**Android 安装包与应用内更新从 Gitee 迁回 GitHub Releases**。

## 为什么迁回

前一天把渠道切到了 Gitee，当天又迁回，原因记在 `docs/BUILD-AND-RELEASE.md` 第 9 节：

- Gitee 下载确实快（本机实测同一个 4 MB 的 APK：Gitee ~700 KB/s / 5.6 秒；
  GitHub 77–229 KB/s / 18–52 秒），国内体验差距明显；
- 但 **Gitee 的匿名 API 有频率限制**：反复调用 `/releases/latest` 后返回
  `403 Forbidden (Rate Limit Exceeded)`（带令牌才 200）。应用内「检查更新」只能匿名调用，
  一旦限流 `checkUpdate()` 会静默返回 null，用户看到的是「已是最新」——更新通道不可靠。
- 另外 Gitee Pages 不可用，官网静态托管无法跟着代码仓库一起迁。

结论：**更新通道的可靠性优先于下载速度**，先回 GitHub；将来若再迁，必须先落 `release.json`
（版本号 + 附件直链 + sha256，走 Gitee raw 路由，实测不限流、0.49s）作为 API 的兜底。

## 改了什么

- `src/lib/update-config.ts`、`src/lib/mobile-update.ts`：恢复 GitHub API +
  「国内镜像优先（gh.ddlc.top / gh-proxy.com / ghps.cc / ghproxy.net / ghfast.top）、官方兜底」。
- `scripts/gh-release.mjs`、`scripts/gh-upload-apk.mjs` 恢复；删除
  `scripts/gitee-release.mjs`、`scripts/save-gitee-token.ps1`；`npm run release` 指回 gh-release。
- 新增 `scripts/ipv4-forward.mjs`：本机到 GitHub 的 IPv6 路径坏了、git 的 libcurl 不回落 IPv4，
  用它起一个只走 IPv4 的本地转发，`git -c http.proxy=http://127.0.0.1:8443 push origin main` 即可。
- 版本 5.2.2（`versionCode 29`），changelog 说明渠道已迁回。
- 官网下载入口与版本字样回到 GitHub Releases 的 v5.2.2 附件。

## 产物与线上核对

| 项 | 值 |
| --- | --- |
| 发行版 | `https://github.com/wzy6789/VirtuGene-Mobile/releases/tag/v5.2.2` |
| 资产 | `app-release.apk` 4,115,919 B |
| SHA-256 | `04c31deb5819d1bb4fe889b2ba7bdd36c07b3150303a711b744f38521f5cba78` |
| 包内版本（aapt2 实测线上包） | `versionCode='29' versionName='5.2.2'` |
| 签名 | `ef38a01c…40:16`（与 5.0.4 起同一把，可覆盖升级） |
| 回下载比对 | 线上包与本地构建逐字节一致（sha256 相同） |
| 官网 | 已由 GitHub Pages 部署（提交含 website/**），页面 v5.2.2、下载按钮指向 v5.2.2 附件，实测 HTTP 200 |

## 已知取舍 / 待办

1. **5.2.1 那一版用户需要手动装一次**：5.2.1 的包内置的是 Gitee 更新器，而 Gitee 上的最新发行版
   仍是 5.2.1，所以它不会提示 5.2.2。按「不再使用 Gitee」的要求，这次没有往 Gitee 补发 5.2.2；
   若希望这批用户能自动收到 5.2.2，需要往 Gitee 补发一次（一次性动作）。
2. **官网下载按钮是 GitHub 直连**（实测 229 KB/s，比 Gitee 慢，但比之前 77–148 KB/s 好）；
   应用内更新走的是镜像竞速，通常更快。若要把官网也提速，可以给页面加一层镜像选择。
3. **官网图库仍是 5.1.5 时期的照片**，而 5.2.x 改过朋友圈设置、世界页面板与聊天窗口；
   口径要对齐需按当前构建重拍一轮。
4. GitHub Pages 的部署由推送 `website/**` 触发；本机推 GitHub 需要先起 `scripts/ipv4-forward.mjs`
   （见 `docs/BUILD-AND-RELEASE.md` 第 8 节）。
