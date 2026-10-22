# 午后与雨夜咖啡厅资产

这是原创 Blender 固定相机空间，并非把平面 AI 图片拆成可疑的重复图层。所有木作、杯碟、绿植、织物座椅、吧台、街楼及程序材质均由本目录脚本生成，不依赖下载的模型或材质。没有在线图像生成调用。

## 重现

使用官方便携 Blender 4.5.3；当前本机为 `C:/Users/34568/.cache/virtugene-tools/blender-4.5.3-windows-x64/blender.exe`。命令从项目根目录执行：

1. `blender -b --python design/chat-scenes/cafe/build-cafe.py -- --preview`：450×1000 构图试渲染。
2. `blender -b --python design/chat-scenes/cafe/build-cafe.py -- --export`：两场景 1440×3200 同相机独立图层及 `.blend`。
3. `blender -b --python design/chat-scenes/cafe/build-cafe.py -- --mask`：真实几何深度的窗区与窗框可见性遮罩。
4. `blender -b --python design/chat-scenes/cafe/build-cafe.py -- --source`：真正 2160×4800 完整美术源稿；不对低分辨率图片插值放大。只补雨夜源稿时使用 `--source-night`，不重复渲染午后或运行图层。
5. `python design/chat-scenes/cafe/export-runtime.py`：现有 Pillow 离线下采样、裁切、压缩、合成和哈希。不会绘制或生成新内容。
6. `python design/chat-scenes/cafe/verify-assets.py`：解码像素、哈希、锚点、遮挡、压缩后接管差异检查。
7. `blender -b --python design/chat-scenes/cafe/inspect-blend.py`：实际打开已保存的 `.blend`，核对相机、关键物体和外部依赖；不改写源场景。
8. `python design/chat-scenes/cafe/audit-final-assets.py`：独立核对两套源稿、精确相机一致性、中性位逐像素合成，以及最大允许植物/桌面位移与雨窗遮罩没有交集。

## 合成与遮挡

设计坐标恒为 1440×3200，所有质量档共享同一 `camera-export.json`。层级为 `base → casing → plant → table`。杯与杯垫、接触阴影、勺子、笔记本及整个桌面同属 table，保证视差时不会只移动杯子、影子却留在原地。clean plate 没有这些独立物体。

窗框是独立裁切层，但窗台实际上在座椅后方，因此把完整几何可见性 mask 离线乘入 alpha；不能直接把未遮挡窗台叠在座椅前。雨遮罩同样来自真实相机及完整几何，排除座椅与横竖窗框。运行用 mask 是白色 RGB + 可见性 alpha，直接使用 alpha mask，不是把灰度图不透明地当遮罩。

窗口与 casing 均保持静止。桌面/植物仅允许有界微视差，最大分别 6/5 设计像素；它们与窗区有明确距离，不会在此范围进入雨区。主光、接触阴影与材质在离线 Cycles 渲染中完成。雨、蒸汽与微尘交给宿主现有统一时钟及暂停机制，不为素材增加第二套 RAF。

poster 使用 clean plate 与最终裁切层在中性位置逐像素合成后输出，避免完整 poster 常驻背景上再叠同一物体。2160 源稿是完整物理场景的美术源稿；运行 poster 则来自最终分层合成，二者职责不同。

## 成本和边界

`scene-export.json` 按每张实际裁切后的宽×高×4 记录 RGBA 解码估算，并分别记录 poster 保留与接管后释放的总数。这不是 Android 实测内存，也不含浏览器内部复制或合成缓存。`asset-provenance.json` 包含原作者、工具、修改方式、尺寸与 SHA-256。

实际组件在不同聊天状态下的可读性、生命周期与性能由主实现验收。本目录的离线检查不能代替 Android GPU 或键盘验证。工作目录 `F:/VirtuGene-Mobile`；当前实际模型与推理强度未确认。
