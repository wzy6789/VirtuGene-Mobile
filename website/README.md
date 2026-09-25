# VirtuGene 官网

官网是不依赖构建工具的静态页面，部署目录为 `website/`，可直接发布到 GitHub Pages 或任何静态服务器。
站点部署在**子路径** `/VirtuGene-Mobile/` 下，因此所有资源引用必须保持相对路径（`./assets/...`），不要改成 `/assets/...`。

## 页面结构（7 个章节）

| 顺序 | 区域 | 只回答一个问题 | 主要视觉 |
| --- | --- | --- | --- |
| — | 导航 | — | 品牌 · 理念 · 体验 · 世界 · 界面 · 下载（移动端只留品牌与下载） |
| 1 | 首屏 `#hero` | VirtuGene 是什么？ | 品牌标题 + 精选人物图（景深 / 边缘光 / 分层入场） |
| 2 | 理念 `#manifesto` | 它和别的 AI 有什么不同？ | 一句主张 + 四条原则 |
| 3 | 相遇 `#meet` | 和角色聊天是什么感觉？ | 真实聊天界面（玻璃展示卡） |
| 4 | 记忆与关系 `#memory` | 为什么值得持续相处？ | 三步经历示意 + 真实记忆界面 |
| 5 | 世界 `#world` | 为什么它不只是聊天？ | 星环 / 轨道 / 星云 + 三个界面切换 |
| 6 | 界面 `#gallery` | 产品真的存在吗？ | 8 张真实界面（点击可放大） |
| 7 | 下载 `#download` | 怎样开始使用？ | Android 与 Windows 下载入口 |
| — | 页脚 | — | 隐私说明、使用条款、GitHub |

主题是一句话：**“时间留下痕迹，角色因此变得不同。”**
品牌主张保持：**“让数字灵魂 / 拥有时间。”**

## 动态视觉系统

页面不是“静态官网 + 一点 hover”，而是一套分层的动态系统，全部集中在 `main.js`：

| 模块 | 职责 |
| --- | --- |
| `Performance` | 先判定 high / medium / low + `prefers-reduced-motion`，后面所有模块据此降级 |
| `Ticker` | 全站**唯一**的 requestAnimationFrame 主循环，所有逐帧效果挂在它上面 |
| `PointerEngine` | 全站**唯一**的指针状态源（x/y、慢跟随 fx/fy、快跟随 hx/hy、速度、归一化位置） |
| `ParticleEngine` | 星尘粒子 canvas：低密度慢速漂浮，只有枢纽粒子近距离才连线，指针靠近才被唤醒，快速移动时才有短拖尾 |
| `DepthSystem` | 首屏景深：人物位移最大、光晕次之、文字最小；人物 3D 倾斜；边缘高光跟随指针 |
| `TiltSystem` | 产品截图的轻微 3D 倾斜 + 玻璃反光（幅度 ≤ 5°，离开自动回正） |
| `MagneticSystem` | 按钮磁吸 + 局部光斑（位移上限个位数像素） |
| `ScrollSystem` | 顶部进度线、导航毛玻璃、分层进入动画、记忆连接线点亮、当前章节高亮 |
| `Tabs` | 世界切换：原生按钮 + ARIA tab，键盘可用，切换时淡入/缩放/模糊，宇宙层随 tab 变色 |
| `Lightbox` | 图片查看：淡入淡出 + 毛玻璃背景，Esc / 焦点 / 滚动位置恢复，token 防止旧定时器覆盖新图 |
| `AmbientSync` | 环境光跟着内容走；标签页不可见时暂停所有持续动画 |

背景是 5 层：底雾渐变 → 4 组环境光 → 星尘 canvas → 鼠标光场/核心 → 颗粒。
层序写在 `styles.css` 文件头。

约定：

- 内容默认可见：进入动画是**JS 先“武装”再播放**，脚本失效时页面照常可读。
- `prefers-reduced-motion: reduce`：不武装、关粒子、关指针光场、关磁吸，页面是完全静态版。
- 低配（`.tier-low`）关掉 blur、颗粒、星环旋转与边缘光；手机（`.tier-medium`）弱化粒子、不做 tilt。
- 每个模块独立初始化并各自 try/catch，单个模块报错不影响其它模块与静态内容。


## 文件

```
website/
├── index.html          首页（7 章 + 导航 + 页脚 + 图片查看层 + 全局视觉层）
├── styles.css          全部样式，按 10 段组织（见文件头注释与层序说明）
├── main.js             全部交互，11 个模块各自初始化
├── privacy.html        隐私说明（复用 styles.css 的 .document 段落）
├── terms.html          使用条款（同上）
└── assets/
    ├── selected/       首屏人物（hero-guyuena.webp，带透明通道）
    │                   + 原始文件留档（source-guyuena-front.png）+ 应用图标
    └── product/        9 张真实界面截图（正文 5 张 + 画廊 8 张复用）
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

全部逻辑都在 `main.js`，11 个模块各自 `try/catch` 初始化：

- 首屏：分 6 层入场（品牌 → 标题 → 描述 → 按钮 → 人物），CSS 关键帧 + `--enter-delay`，不依赖 JS。
- 指针：一个 `pointermove` 监听（`PointerEngine`），其余模块只读状态，不再各自乱监听。
- 粒子：canvas + DPR 上限 1.5；桌面约 85 颗、手机约 52 颗、低配不启用。
- 截图卡：`data-tilt` 轻微 3D 倾斜 + 反光扫过；点击进入图片查看。
- 世界切换：原生按钮 + `role="tab"` 语义，支持方向键、Home、End，切换时淡入/缩放/模糊。
- 图片查看：支持关闭按钮、Esc、焦点回到触发按钮、滚动位置恢复，
  并用 token 防止快速切换时旧定时器覆盖新图片。

## 发布说明

推送 `website/` 到 `main` 后，`.github/workflows/deploy-pages.yml` 会自动部署到 GitHub Pages
（子路径 `/VirtuGene-Mobile/`）。

下载入口只指向真实存在的发布资产，版本号分别核对，不假定两个平台版本一致：

- Android：`https://github.com/wzy6789/VirtuGene-Mobile/releases/download/v5.2.3/app-release.apk`
- Windows：`https://github.com/wzy6789/virtugene/releases/download/v2.1.0/VirtuGene-Setup-2.1.0-win.exe`

更新下载入口时请同时核对 `releases/tag` 页面与资产是否真的存在——标签存在不代表安装包存在。

公开发布前，请确认角色图片拥有公开展示授权。
