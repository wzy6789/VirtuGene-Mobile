# VirtuGene 官网

官网是不依赖构建工具的静态页面，部署目录为 `website/`，可直接发布到 GitHub Pages 或任何静态服务器。
站点部署在**子路径** `/VirtuGene-Mobile/` 下，因此所有资源引用必须保持相对路径（`./assets/...`），不要改成 `/assets/...`。

## 页面结构（5 个主体章节）

| 顺序 | 区域 | 只回答一个问题 | 主要视觉 |
| --- | --- | --- | --- |
| — | 导航 | — | 品牌 · 体验 · 世界 · 下载（移动端只留品牌与下载） |
| 1 | 首屏 `#top` | VirtuGene 是什么？ | 品牌标题 + 一张精选人物图 |
| 2 | 相遇 `#meet` | 和角色聊天是什么感觉？ | 真实聊天界面截图 |
| 3 | 记忆与关系 `#memory` | 为什么值得持续相处？ | 三步经历示意 + 真实记忆界面 |
| 4 | 世界 `#world` | 为什么它不只是聊天？ | 世界星图 / 剧情现场 / 留下的经历（点击切换） |
| 5 | 下载 `#download` | 怎样开始使用？ | Android 与 Windows 下载入口 |
| — | 页脚 | — | 隐私说明、使用条款、GitHub |

主题是一句话：**“时间留下痕迹，角色因此变得不同。”**
品牌主张保持：**“让数字灵魂 / 拥有时间。”**

## 文件

```
website/
├── index.html          首页（5 章 + 导航 + 页脚 + 图片查看层）
├── styles.css          全部样式，按 7 段组织（见文件头注释）
├── main.js             全部交互，模块各自初始化
├── privacy.html        隐私说明（复用 styles.css 的 .document 段落）
├── terms.html          使用条款（同上）
└── assets/
    ├── selected/       首屏人物（hero-guyuena.webp，带透明通道）
    │                   + 原始文件留档（source-guyuena-front.png）+ 应用图标
    └── product/        正文使用的 5 张真实界面截图
        └── source/     未压缩原图，供点击放大与回溯
```

## 素材来源

首屏人物来自项目原始「古月娜素材」目录中的高分辨率原图
`古月娜桌宠V3/assets/guyue_na_front.png`（1120×1404）。
原始文件保留为 `assets/selected/source-guyuena-front.png`；发布用的
`hero-guyuena.webp` 只做了一件事——把纯黑背景抠成透明通道并转成 WebP，
人物本身没有裁切、没有镜像、没有调色。

其余 254×384 素材是带平台水印的缩略图，只适合小尺寸展示，本站没有使用。
完整选图表见仓库根目录 `docs/WEBSITE-5.0.5-REBUILD.md`。

正文截图全部由**当前手机端界面**重新截取（演示账号 + 演示内容），
文件名与页面内容一一对应，不再沿用旧目录里名实不符的图片。

## 本地预览

```bash
python -m http.server 4174 --directory website
# 或
npx serve website
```

浏览器打开 `http://127.0.0.1:4174/`。页面不依赖第三方字体、外部脚本或远程接口。

## 交互与动效

全站只有 6 类动效，都集中在 `main.js`：首屏光晕（仅在首屏可见时运行）、
区域进入（淡入 + 12px 位移，一次）、记忆连接线（进入视口点亮一次）、
世界切换（220ms 淡入淡出）、按钮反馈（颜色/边框，不移动点击目标）、
图片查看（淡入，无旋转飞入）。

约定：

- 进入动画由 JS 先“武装”（加 `.is-armed`）再播放。**没有 JS 时内容默认可见**，不会白屏。
- `prefers-reduced-motion: reduce` 下不武装、不播放，页面是完整的静态版。
- 每个交互独立初始化，单个模块报错不影响其它模块与静态内容。
- 世界切换使用原生按钮 + `role="tab"` 语义，支持方向键、Home、End。
- 图片查看支持关闭按钮、Esc、焦点回到触发按钮、滚动位置恢复，
  并用 token 防止快速切换时旧定时器覆盖新图片。

## 发布说明

推送 `website/` 到 `main` 后，`.github/workflows/deploy-pages.yml` 会自动部署到 GitHub Pages
（子路径 `/VirtuGene-Mobile/`）。

下载入口只指向真实存在的发布资产，版本号分别核对，不假定两个平台版本一致：

- Android：`https://github.com/wzy6789/VirtuGene-Mobile/releases/download/v5.0.5/app-release.apk`
- Windows：`https://github.com/wzy6789/virtugene/releases/download/v2.1.0/VirtuGene-Setup-2.1.0-win.exe`

更新下载入口时请同时核对 `releases/tag` 页面与资产是否真的存在——标签存在不代表安装包存在。

公开发布前，请确认角色图片拥有公开展示授权。
