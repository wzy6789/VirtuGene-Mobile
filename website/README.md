# VirtuGene 官网

这是无需构建工具的静态官网，可直接部署到 Nginx。

## 文件

- `index.html`：品牌理念、真实产品界面、数据边界和发布状态
- `assets/`：从当前 Android 版本直接采集的产品截图
- `styles.css`：响应式视觉系统与动效
- `privacy.html`：隐私说明
- `terms.html`：使用条款

## 本地预览

```bash
python -m http.server 4174 --directory website
```

浏览器打开 `http://127.0.0.1:4174/`。官网没有数据收集表单，也不依赖第三方字体或脚本。

## 上线前

备案通过后，将 `website/` 上传到 `/opt/virtugene/site/`，恢复根域名解析并签发 HTTPS 证书。取得备案号后，把页脚的“备案审核中”替换为真实备案号并链接到 `https://beian.miit.gov.cn/`。
