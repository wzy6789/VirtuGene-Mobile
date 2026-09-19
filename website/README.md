# VirtuGene 官网

官网是一个不依赖构建工具的静态入口，部署目录为 `website/`，可直接发布到 GitHub Pages 或 Nginx。

## 页面结构

VNext 把官网组织成一条完整的产品叙事：

1. **苏醒 / Awakening**：单一角色、光核与短句，建立品牌第一印象。
2. **理念 / Why VirtuGene**：TIME、MEMORY、RELATIONSHIP、WORLD 四个核心原则。
3. **相遇 / Meet**：一段有停顿的对话，让角色先以声音而非功能出现。
4. **记忆 / Remember**：把重要对话表现为会彼此连接的时间星图。
5. **关系 / Relationship**：用时间线展示关系从陌生到共同经历的变化。
6. **世界 / World**：咖啡馆、雨夜、房间和天台组成可以回到其中的生活空间。
7. **能力 / Capabilities**：集中说明 Talk、Remember、Relationship、World、Create、Timeline。
8. **产品 / Product**：一台主设备随滚动切换 TALK、MEMORY、WORLD、CREATE 四个章节。
9. **界面画廊 / Interface Gallery**：使用 `assets/product/latest/` 中的真实手机端截图。
10. **场景 / Scenarios**：长期陪伴、角色共创、共同世界与长期故事。
11. **开始 / Begin**：提供 Android 与 Windows 下载入口。
12. **Footer**：隐私说明、使用条款与品牌收束。

## VNext 构图系统

- 页面只保留一条叙事主轴，章节之间使用统一的内容宽度、间距和标题层级，避免大面积无意义黑场。
- 首屏只突出一个角色；记忆与世界使用独立视觉资源；产品展示只保留一台主设备，并通过滚动切换真实界面。
- 世界段落的四个场景会随着滚动聚焦，关系段落用一条时间线解释变化，界面画廊提供桌面网格和移动端横向浏览两种布局。
- 所有动态都在本地完成，移动端、触摸设备与 `prefers-reduced-motion` 有降级规则；页面不依赖第三方字体、外部脚本或远程接口。

## 本地预览

```bash
python -m http.server 4174 --directory website
```

浏览器打开 `http://127.0.0.1:4174/`。页面不依赖第三方字体、外部脚本或远程接口；指针光场、滚动镜头、记忆节点、关系时间线、世界场景和产品章节切换都在本地完成，并支持 `prefers-reduced-motion`。

## 发布说明

推送 `website/` 到 `main` 后，`.github/workflows/deploy-pages.yml` 会自动部署到 GitHub Pages。公开发布前，请确认角色图片拥有公开展示授权，并在备案信息与下载版本更新后同步页面文案。
