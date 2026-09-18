# VirtuGene 官网

官网是一个不依赖构建工具的静态入口，部署目录为 `website/`，可直接发布到 GitHub Pages 或 Nginx。

## 页面结构

- **苏醒 / Awakening**：极简数字生命舱，光核和被遮蔽的剪影构成品牌第一印象。
- **相遇 / Meet**：用一段有停顿的对话让用户理解角色如何开始拥有自己的节奏。
- **记忆 / Memory**：把重要对话表现为会彼此连接的时间星图。
- **生活世界 / Living World**：用咖啡馆、雨夜、房间和天台等生活片段替代泛化的星球视觉。
- **下载 / Start**：提供当前 Android 与 Windows 下载入口。

## 本地预览

```bash
python -m http.server 4174 --directory website
```

浏览器打开 `http://127.0.0.1:4174/`。页面不依赖第三方字体、外部脚本或远程接口；粒子、光效、滚动显现和倾斜交互都在本地完成，并支持 `prefers-reduced-motion`。

## 发布说明

推送 `website/` 到 `main` 后，`.github/workflows/deploy-pages.yml` 会自动部署到 GitHub Pages。公开发布前，请确认角色图片拥有公开展示授权，并在备案信息与下载版本更新后同步页面文案。
