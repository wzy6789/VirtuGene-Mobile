# 逢星之境

逢星（VirtuGene）的静态产品官网。正式域名为 [virtugene.com](https://virtugene.com/)，[GitHub Pages](https://wzy6789.github.io/VirtuGene-Mobile/) 提供项目镜像。

## 预览

在项目根目录运行以下命令，然后打开 [本地官网](http://127.0.0.1:4198/)。

```powershell
$env:VG_WEBSITE_PORT='4198'
node scripts/website-preview.mjs
```

## 正式版入口

- `index.html`、`atelier.css` 和 `atelier.js` 构成首页。隐私与条款页共用样式。
- `assets/atelier/` 保存新设计的紫玻璃、夜窗、记忆书页、界面局部和标题字体。Noto Serif SC 和原 Allura 的许可证随字体一同分发。
- `assets/v7/` 中的聊天、星域、助理、世界、记忆及场景截图来自独立示例资料。录屏仅在用户主动播放时开始。官网不会请求模型、相机或麦克风。
- [设计依据](./DESIGN.md) 记录官网调研、配色、内容来源和交互边界。页面内保留原章节锚点与旧链接跳转。
- ECS 发布包以首页、两份说明页及引用的资源为范围。核验两域名、资源哈希、视频分段、原图查看、键盘操作、减少动态、无脚本和手机宽度。保留上一发布目录以便回滚。
