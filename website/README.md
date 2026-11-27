# 逢星之境

逢星（VirtuGene）的静态产品官网。正式域名为 [virtugene.com](https://virtugene.com/)，[GitHub Pages](https://wzy6789.github.io/VirtuGene-Mobile/) 提供项目镜像。

## 预览

在项目根目录运行以下命令，然后打开 [本地官网](http://127.0.0.1:4198/)。

```powershell
$env:VG_WEBSITE_PORT='4198'
node scripts/website-preview.mjs
```

## 正式版入口

- `index.html`、`atelier.css` 和 `atelier.js` 负责页面、导航和原图查看。三种相处方式由 `scene.css` 与 `scene.js` 呈现，`life.css` 定义记忆、待办与世界入口的交互样式。
- `assets/atelier/` 包含品牌玻璃、雨夜、记忆书页和标题字体。Noto Serif SC 和原 Allura 的许可证随字体分发。
- 首屏进入浏览器内的预写场景。访客可以接着聊天、显隐静音字幕、续读故事、回看记忆原话及勾选待办。交互不需要账户、相机、麦克风或模型调用。原生展开控件和示例文字也适用于禁用脚本的访问。Android 截图收在页末可展开的界面参考中。
- [设计依据](./DESIGN.md) 记录官网调研、配色、内容来源和交互边界。页面内保留原章节锚点与旧链接跳转。
- ECS 发布包以首页、两份说明页及引用的资源为范围。核验两域名与 GitHub Pages 的资源哈希、场景的展开与复位、原图查看、键盘操作、减少动态、无脚本和手机宽度。保留上一发布目录以便回滚。
