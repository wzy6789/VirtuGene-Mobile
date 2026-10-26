# VirtuGene 官网

静态HTML/CSS/JavaScript官网，部署目录 website/。当前设计为“有角色的星海”，保留 **7.0.0 本地体验展示**事实标识。公开下载仍为Android 6.1.0、Windows 2.1.0。

## 本地预览

在项目根目录执行：

```powershell
node scripts/website-preview.mjs
```

打开 http://127.0.0.1:4190/。需要本地静态服务，支持视频Range请求。只读取官网静态资源，不读取真实用户资料、不调用模型或原生接口，麦克风与摄像头被禁用。可用VG_WEBSITE_PORT设置端口。

## 实现

| 文件 | 责任 |
| --- | --- |
| index.html | 六章节、示例事实标识、原图链接、静态降级、下载与帮助 |
| site-7.css | 完整独立首页样式、环境材质、响应布局、静态模式及弹窗 |
| main.js | 单一RAF与指针状态、粒子池、场景光色、表面反馈、菜单与图片查看 |
| site-7.js | 原有体验tab状态及键盘控制、手动录屏、焦点循环、旧锚点兼容 |
| assets/star-sea/ | 独立生成的干净环境底图，不含产品界面 |
| assets/v7/ | 七张真实组件截图、无声场景录屏、原花体字体与许可证、分享图 |
| privacy.html / terms.html | 原静态说明与条款 |

首页只加载site-7.css；styles.css、living-light.css及旧版资源继续留档，隐私/条款仍可使用原基础样式。新版不叠加旧引擎。所有素材使用相对地址，支持GitHub Pages子路径。旧#release-6、#meet、#world锚点保留兼容。

## 素材边界

App截图是实际组件配合独立虚构账号、对话、记忆与事项。通话为合成的无声状态，不代表真实识别、音质或时延已经验收。scenes.webm为原实际聊天组件的场景切换，手动播放。世界首页的生活助理、四入口、剧情卡片关系保持原样。

本次内置图像生成共8次：六章节、手机首屏、干净背景。只使用背景作为新增生产图；不使用生成图重绘的Logo、人物或App界面。现有原人物、V标、Allura字体及OFL许可证继续保留。

设计规则见 [DESIGN.md](./DESIGN.md)。当前概念、基线、截图、录屏和详细核验留在 .tmp-preview/website-star-20261026/；上轮产品截图来源证据仍在 .tmp-preview/website-7-20261025/。模型与推理强度无法从当前运行配置确认，不猜测。

## 验证

先启动本地预览，再执行：

```powershell
node scripts/verify/website-star-regression.mjs
node scripts/verify/website-star-fx.mjs
node scripts/verify/website-star-delivery.mjs
node --check website/main.js
node --check website/site-7.js
```

覆盖六种宽度、横屏、键盘与焦点、媒体手动播放、无脚本及图片失败、下载链接、动态生命周期、输入响应、真实浏览器帧耗时与独立合成慢帧降档。合成输入单独记录，不写成真实慢设备测量。不要用旧website-7.mjs覆盖前轮输出。

## 发布

仅同步website/**，由.github/workflows/deploy-pages.yml部署。使用Git Data API前核对当前远端及本轮源文件基线，保留远端其他路径，非强制推进并记录回滚父提交。大量并行App改动不能带入发布，不改本地HEAD或索引。页面改版不授权发布APK、修改应用或更新官网下载版本。
