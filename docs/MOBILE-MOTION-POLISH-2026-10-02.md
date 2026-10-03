# 移动界面动画精修 · 2026-10-02

本轮围绕用户要求的顺滑、快速反馈与连续操作，修改真实应用的弹窗、页面手势、助理卡片和设置详情。深色界面保持主要设计方向。

## 实现

- 弹窗进入 300ms、同层接续 260ms、旧层交叉退出 140ms。阻尼曲线增加初始响应，关闭会捕获当前姿态；接续复用遮罩，避免亮度重新淡入。层级由已绑定的弹窗记录确定，修复 React 先插入新 portal 再移除旧 portal 时“办事习惯”窗口误判层级造成的闪动。
- 手势释放等待从 220ms 降到 110ms。旧页捕获拖动位移后，在同次提交中清除外层变换，新页不再继承位移后跳回。回弹与释放途中可重新拖动，重复 touchend 不会取消已提交的动作。页面进入 300ms、退出 180ms。
- 助理卡片默认保持普通会话行大小。展开和关闭从当前可见高度衔接；晚到数据和屏幕宽度变化由 ResizeObserver 平滑重定向，结束释放高度。关闭立即禁用隐藏控件，账号变化清除旧内容。
- 设置详情使用方向明确的轻位移，返回先恢复原滚动位置；快速反向最多保留一个短暂视觉副本。首开不叠加详情动画，密钥、账号、日记、同步详情不保留副本。聊天设置的原生 details 在支持的浏览器中平滑展开，旧 WebView 仍可正常展开。
- 视觉副本在克隆前检查节点数量，900 个节点以上及视频等媒体直接跳过复制。滚动位置用 WeakMap 存储，清理 HTML ID、表单身份和密码原值，冻结副本中的装饰动画。访问权限撤回后下一帧移除；减少动态效果、窗口变化及进入后台都会清理相应动画。

主要文件：`src/components/ui/useModalMotion.ts`、`src/components/ui/useMobilePageMotion.ts`、`src/components/ui/usePageSwipe.ts`、`src/lib/mobile-motion.ts`、`src/components/secretary/useSecretaryDisclosureMotion.ts`、`src/components/settings/useSettingsDetailMotion.ts`。样式仍放在已有主题样式文件中。

## 验证

- TypeScript 与生产构建通过；已有大包与混合导入警告保留。
- 弹窗专项 18 项、页面/手势动画专项 23 项、助理展开专项 7 组通过，包含打断姿态、逐帧交接、快速反向、尺寸变化、减少动态效果及清理。
- 助理真实聊天动效专项通过：深浅主题、长历史滚动、最新消息定位、五个窗口接续、会话替换、快速反向及无浏览器运行错误。真实“办事习惯”接续失败后完成修复，并重新运行整套通过。
- 设置动效专项通过：进入/返回方向、滚动恢复、原生详情展开与反向、敏感详情不保留副本、窄屏、减少动态效果、关闭清理。设置 UI 55 项通过。
- 既有手势 31 项、UI polish 104 项、mobile-refinement 151 项、worldD 43 项通过。

专项脚本：`scripts/verify/run-modal-motion.cjs`、`run-page-motion.cjs`、`run-secretary-disclosure.cjs` 自建临时服务并自动关闭。`run-settings-motion.cjs` 与 `run-secretary-motion.cjs` 使用现有 17899 验证服务；先生产构建并构建相应 fixture。

截图、逐帧几何和测试报告位于 `.tmp-preview/modal-motion-20261002/`、`page-motion-20261002/`、`secretary-disclosure-20261002/`、`settings-motion-20261002/`。浏览器检查没有测量 Android 真机帧率，也未在本轮生成 APK。
