# 手机版 UI 精修 · 2026-10-01

以 5.3.0 工作区为基础，延续紫青数字生命主题。这轮聚焦搜索、空列表、加载状态、聊天操作和底部面板。

## 参考与取舍

- [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)：2026-10-01 GitHub 页面显示约 132.2k Stars。阅读公开 SKILL.md 与 pro-rules，参考其优先检查可操作性、状态反馈、语义控件与动态偏好的流程；本轮没有安装或运行其工具。
- [Awesome DESIGN.md](https://github.com/VoltAgent/awesome-design-md)：同日页面显示约 119.1k Stars。继续使用本地 design-md-reference skill，参考 Raycast 的安静面板、细边框与操作分组；保留既有品牌颜色、字体和头像。
- Stars 用来选择参考来源，具体数值、视觉效果与交互仍以项目实际渲染和检查为准。公开品牌分析不作为官方品牌规范使用。

## 完成的改动

- 消息与角色列表统一使用 `ConnectionEmptyState`：轨道插画、清晰标题、说明和下一步按钮。搜索无结果可直接恢复列表。
- 角色筛选无结果时，清除按钮同时清空关键词和性格标签，避免残留筛选使列表仍然为空。
- 角色加载使用三行占位面板，维持列表节奏；减少动态偏好下不播放脉冲。
- 聊天长按操作和顶部更多操作统一使用底部 Modal。保留置顶、标为已读、隐藏列表、情绪、心情及语音设置的原有行为。
- 底部面板与手机版共享深浅主题变量，避免 Portal 使用另一套旧面板颜色。操作行、关闭按钮、心情选项和语音开关增加触摸空间。
- 心情选项保留表达情绪的 emoji，同时显示文字并提供无障碍名称；生活助理入口和更多按钮改用线性 SVG。
- 语音开关展示真实 `aria-checked`；更多按钮展示 `aria-expanded`。搜索框与消息输入框补齐稳定名称。
- Modal 打开时聚焦面板，避免自动弹出输入键盘；Tab 焦点留在当前层，嵌套关闭后恢复上一层焦点，最终关闭恢复入口。长表单保持固定框架与独立滚动。
- 搜索清空和发送目标扩展至 48px；录音展开后清除隐藏输入框边框，保持已有变形交互。

## 验证

- TypeScript 与 Vite 正式构建通过。构建仍提示较大的主包与既有静态/动态导入混用。
- ui-polish、mobile-soul、mobile-refinement、swipes、character-ui、character-scroll、group-layout、character-create 八套浏览器回归通过。
- 新 ui-polish 101 项检查覆盖深浅主题、320/390/430px、搜索恢复、标签清除、操作面板、真实语音开关状态、五种心情目标、焦点循环、嵌套关闭与长表单稳定滚动。减少动态模式同样通过。
- physical-ui 23 项交互检查通过，覆盖标签、按压、字号、中文输入、录音生命周期和小屏溢出；原生录音/识别使用测试替身。
- Playwright 使用真实键盘在 320/390/430px 视口核对操作面板边界与焦点循环；深浅主题截图存于 `.tmp-preview/ui-polish-20261001/`。截图账户与角色为本地测试数据，无模型或语音网络调用。

运行：正式构建后执行 `node scripts/verify/build.mjs`，启动 `scripts/verify/serve.cjs`，运行 `node scripts/verify/run-suite.mjs ui-polish mobile-soul mobile-refinement swipes character-ui character-scroll group-layout character-create`。

本轮未改变版本号或生成 APK。安卓真机帧率与系统键盘行为尚未实测。
