# 原创壁炉小屋与夜行列车

这两景是独立建模的固定机位空间，不是咖啡厅换色。壁炉小屋使用石砌火口、木梁、绒布阅读椅、编织毯与低茶几；列车使用全景窗、黄铜饰条、蓝色卧铺座椅、行李架、阅读灯、窗外夜山与稀疏车站灯。

素材完全由 `build-scenes.py` 的原始几何与程序材质生成。没有下载模型、照片或字体，没有在线图像生成调用。模型与推理强度未确认；本任务仅负责美术资源，不修改聊天业务或运行时。

## 重现

使用本机官方便携 Blender 4.5.3：`C:/Users/34568/.cache/virtugene-tools/blender-4.5.3-windows-x64/blender.exe`。项目根目录运行：

1. `blender -b --python design/chat-scenes/collection-warm/build-scenes.py -- --scene hearth-cabin --preview`，先检查450×1000构图；列车将场景名改成 `night-train`。
2. 同一命令将 `--preview` 改成 `--export`，导出原始 `.blend` 与1440×3200分层。
3. 改成 `--mask`，导出真实几何深度遮挡后的效果区与窗框可见性遮罩。
4. 改成 `--source`，以原生2160×4800重新渲染完整美术源稿，不放大已有图片。
5. `python design/chat-scenes/collection-warm/export-runtime.py`，离线下采样、裁切、编码与散列，写入运行资源与来源文件。
6. `python design/chat-scenes/collection-warm/verify-assets.py`，实际解码验证尺寸、RGBA像素预算、SHA-256、遮罩、无压缩中性位合成与WebP接管误差。

`render-all.py` 依次执行两景的分层、遮罩、源稿，每次只有一个GPU作业。进程、退出码、时长和日志在 `render-jobs.json`，不是伪造的渲染成功清单。

## 合成与边界

设计坐标均为1440×3200，运行主线为 DOM 2.5D；真实建模、光照、阴影与材质只在离线 Blender 中计算。每景只有一个固定相机；poster 是 clean plate + casing + foreground + table 的精确未压缩中性位合成，运行 WebP 的有损误差另行量化。

clean plate 不含三个独立前景组。整个茶几、杯碟、杯内茶面及接触关系共用 table 组，避免杯移动而影子留在原处。casing 与 foreground 的 alpha 均乘入各自的实际场景深度可见性；不能把窗框、窗台或前帘直接覆盖到实际位于它们前面的椅背上。最后的源稿/poster对照发现过这个前帘问题，补了可失败的回归检查并修复，不以第一版绿色的文件校验代替目视核查。

沿用 `windowMask` 资源字段，但壁炉的 `effectArea` 明确为 `hearth`：粒子只能在真实火口内，木柴、炉栅、石边与前景都已参与遮挡。列车的 `effectArea` 为 `window`，雨由实际窗框、帘子和座椅遮挡。列车 foreground 帘子与窗区相邻，故 `depthFactor=0`；其他微视差仅允许低于效果区的前景。`cupMouth` 和 `lightRect` 都是相机投影的设计坐标。

设置图库只需360×800 thumbnail，不必预先解码六套完整 poster。每一运行质量档均记录真实裁切尺寸与 width×height×4 成本，文件压缩小不等于解码内存小。此估计不包含浏览器内部副本、纹理缓存与Android GPU开销，不替代原生实测。
