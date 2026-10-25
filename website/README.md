# VirtuGene 官网

静态 HTML/CSS/JavaScript 官网，部署目录 `website/`。当前为 **7.0.0 Android 体验展示**，不表示已公开发行 7.0.0；公开下载 URL 与改版前一致：Android 6.1.0、Windows 2.1.0。下载区与常见问题明确版本差别。

## 预览

```powershell
node scripts/website-preview.mjs
```

打开 `http://127.0.0.1:4190/`。该服务仅提供官网静态文件，支持视频 Range 请求，禁用麦克风与摄像头。不读取真实用户资料、不调用模型。可用 `VG_WEBSITE_PORT` 设置端口。

## 页面与实现

| 文件/区域 | 责任 |
| --- | --- |
| `index.html` | 首屏、三种体验、角色记忆、日常与世界、真实画廊、下载和折叠问题 |
| `site-7.css` | 当前排版、花体品牌、手机与桌面布局、产品截图材质及可访问状态 |
| `site-7.js` | 体验 tab 键盘控制、录屏弹窗及暂停、图片查看器焦点循环、旧锚点兼容 |
| `styles.css` / `living-light.css` | 原有基础变量、全局环境光、粒子与生命光丝、导航及图片查看 |
| `main.js` | 保留原有材质与动效基础，单一 Ticker，离屏/后台暂停和减少动态降级 |
| `assets/v7/` | 七张真实新版组件截图、无声场景录屏、花体字体及许可证、分享图 |
| `privacy.html` / `terms.html` | 静态隐私和条款，无装饰箭头 |

详细视觉规则见 [DESIGN.md](./DESIGN.md)。所有资源保持相对路径，以支持 GitHub Pages 的 `/VirtuGene-Mobile/` 子路径。旧 `#release-6`、`#meet`、`#world` 链接继续对应新版相关章节。

历史 `assets/product/`、`assets/release-6/` 和 `release-6.css/js` 留档，本版首页不再加载它们。

## 展示素材与边界

- 截图由当前实际组件生成，使用独立来源的虚构账号、手动记忆和事项，包含聊天、茶室场景、人物通话、角色记忆、世界首页、助理今日和星域目录。
- 对话为展示文本，不是真实模型采样；通话为无声合成状态，不代表真实识别、音质、延迟、蓝牙或锁屏已验收。
- `scenes.webm` 是实际聊天组件切换场景的录屏，手动播放，不自动预取。关闭弹窗或切换到后台会暂停。
- 世界首页截图保留生活助理在上、中间四入口、剧情续接卡片在下的当前关系；官网没有更改应用布局。
- 字体来源于应用现有 Allura 子集，许可证 `assets/v7/OFL-Allura.txt`；未更换应用图标。

素材采集和验证：`scripts/verify/website-7-{fixture.tsx,capture.mjs,record.mjs,baseline.mjs,look.mjs}`。原始证据在 `.tmp-preview/website-7-20261025/`，包含来源哈希与模型/媒体隔离计数。可读实施记录在 Obsidian 手机版开发日志中。

## 验证

```powershell
node scripts/verify/website-7.mjs
node --check website/site-7.js
```

需先启动静态预览。验证覆盖六种宽度、实际截图、tab/菜单/图片查看/录屏键盘与焦点、减少动态、无脚本、图片失败降级、公开下载链接不变以及子路径资源。

## 发布

推送仅有 `website/**` 的改动，由 `.github/workflows/deploy-pages.yml` 部署。`scripts/deploy-site-github.mjs` 是 Git Data API 的现有发布通道；调用前必须检查远端与当前官网差异，不能带入应用并行修改。页面改版不授权发布 APK 或变更官网下载版本。
