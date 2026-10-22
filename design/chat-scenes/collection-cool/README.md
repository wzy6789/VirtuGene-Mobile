# 雪夜书房与雾海观景室

两套独立原创 Blender 空间，不是咖啡厅换色：雪夜书房有整墙实体书、裸枝雪林、蓝灰阅读椅、台灯与热茶；雾海观景室有宽幅海窗、真实水面与远礁、漂白白蜡木、亚麻躺椅和羊毛毯。所有几何与程序节点材质均由本目录脚本创建，没有外部模型/贴图、库存图片或在线生成调用。

## 复现

工作目录 `F:/VirtuGene-Mobile`。使用本机已有便携 Blender 4.5.3：

1. `blender -b -t 6 --python design/chat-scenes/collection-cool/build-scenes.py -- --preview`：450×1000 构图。
2. `blender -b -t 6 --python design/chat-scenes/collection-cool/build-scenes.py -- --export`：每景真正 2160×4800 原生源稿、1440×3200 分层及原始 `.blend`，再导出真实相机遮挡 mask。
3. `python design/chat-scenes/collection-cool/export-runtime.py`：本地 Pillow 下采样、alpha 裁切、WebP 压缩及 SHA-256。
4. `python design/chat-scenes/collection-cool/verify-assets.py`：像素合成、裁切、可见性、尺寸、解码预算核对。
5. `python design/chat-scenes/collection-cool/audit-composites.py`：独立读取实际 WebP 三层和 clean plate 重构，核对压缩 poster、2160 源稿、静态 depth 及前景/窗口遮挡；保留差图与缺失桌面负向验证。
6. `blender -b -t 6 --python design/chat-scenes/collection-cool/inspect-blends.py`：只读重新打开原始 `.blend`，核对固定相机、实际杯口与台灯投影、独立几何签名和外部图像依赖。

可用 `--scene snow-study` 或 `--scene mist-coast` 单独重现。优先使用已有 RTX 5060 OptiX，无 GPU 时退化到 6 线程 CPU。共享机器上高分渲染按代理交接顺序运行，不并行争用显存。

## 交接契约

每景固定相机与 1440×3200 设计坐标。完整 poster 是 **clean plate → casing → foreground → table** 同像素合成；poster 首屏与静态兜底，与不透明分层底图互斥接管，不能叠出双重杯子或椅子。clean plate 的相机射线不显示独立前景，但保留物理灯光传输；独立桌面内包含杯、灯、笔记本、花器及各自的桌面接触阴影。

窗口雨/雪/微雾可见性来自全场景相机深度 emission pass。书椅、窗框、草枝、桌面等都是真实遮挡，不是 UI 猜测的矩形。分层 alpha 采用完整场景可见覆盖率，避免把两份抗锯齿边缘相乘而产生黑边。窗口、薄前景与桌面保持静止，局部蒸汽、光感、雪/微雾由统一宿主生命周期驱动；这两景不承诺可任意移动的前景视差。

`scene-export.json` 包含 1080×2400 / 1440×3200 档、360×800 图库缩略图、实际 cropped alpha 图层与窗口遮罩、可选真实杯口 `cupMouth`、局部光源 `lightRect`，以及按实际宽×高×4 计算的 RGBA 解码字节。成本估算不等于 Android GPU 或真实耗电测量。

雾海没有饮品，不创建蒸汽锚点。雪夜书房的蒸汽只允许从实际杯口出现。各景色彩只描述视觉环境，不写入人物记忆或剧情。

模型与推理强度：未确认。当前没有 Android 原生 GPU/输入法实测证据；产品生命周期与聊天阅读由主任务验证。

## 独立合成复核

`asset-checks.json` 与 `composite-audit.json` 分开记录一般资产检查和实际重构。`source-composite-proof.png` 每张从左至右为：原生 2160 源稿等比缩至设计尺寸、PNG 分层重构、RGB 绝对差×8。未做位置/色彩校正。PNG 重构与 uncompressed poster 要求逐像素完全相同；实际 WebP 重构与压缩 poster 存在正常压缩差，2160 与 1440 Cycles 独立采样/抗锯齿也不宣称逐像素相同。

复核使用 RGB 差图，避免 RGBA 差图 alpha 恒为 0 时 `getbbox()` 隐藏颜色误差。压缩比较的项目容差是平均通道差≤1/255、P99≤8、差值>16 的通道比例≤0.1%；独立源稿采样容差是平均≤1.5/255、P99≤12、差值>16 比例≤0.5%。这些是素材漂移检测阈值，不是行业标准或肉眼无差保证；报告同时保留实际最大误差。实际移除桌面层的内存负向夹具必须被拒绝。

静态层的 `depthFactor/maxOffsetPx` 均为 0，且与 manifest motion 全部一致。窗口 mask 与各层沿同一设计坐标重构；剔除一像素抗锯齿边缘后，完全不透明前景与窗口效果内部交集必须为 0。像素边缘采样不写成 Android 原生验证。
