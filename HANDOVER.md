# VirtuGene 手机版 — 进度交接文档（给新会话）

> 生成时间：2026-08-23 · 由原会话整理，供新会话无缝接手
> 新会话建议工作目录：`F:\VirtuGene-Mobile`（手机版独立工作区）

## 一、项目背景

VirtuGene 是"数字灵魂"聊天应用（角色扮演 AI，接 DeepSeek API）：

- **品牌**：主色 `#6C5CE7`（基因紫）、辅色 `#00CEC9`（生命青）；口号 *"Unlock Your Digital Soul"*
- **功能**：角色对话（流式打字机）、主动消息、记忆系统、情绪图谱（六维）、关系好感度、角色生成（基因实验室）、手账日记（AI 批注/补记/年度回顾/隐私锁等）
- **桌面版技术栈**：Electron + React 19 + TypeScript + Tailwind + Zustand + Dexie（IndexedDB）+ Web Crypto（密码 PBKDF2、API Key AES-GCM，全本地）

## 二、两个工作区（极其重要，先读这里）

| 工作区 | 内容 | 维护方 |
| :--- | :--- | :--- |
| `F:\VirtuGene` | **电脑版**（Electron）。最新提交 `6acd70e` = v2.0.2（"手账创新 + bug 修复"），工作区已干净 | **另一个工作聊天** |
| `F:\VirtuGene-Mobile` | **手机版**（独立，Capacitor Android）。无 git，自包含 | **本会话（手机版）** |

**用户的硬性约束（必须遵守）**：
1. **不要改电脑版代码** —— `F:\VirtuGene` 的 `electron/` 与共享 `src/` 都不动，电脑版由另一个工作聊天维护（"各干各的"）
2. **手机版必须自包含** —— AI 服务已复制到 `src/lib/ai/`，不引用 `electron/services`，不依赖电脑版
3. **只做安卓**（iOS 暂缓，需 macOS）
4. **UI 学习微信/QQ，简化**，不要照搬桌面侧边栏

## 三、手机版已完成进度

### 1. Capacitor 集成（全链路已通）
- `capacitor.config.ts`：appId `com.virtugene.app`、webDir `dist/renderer`、`cleartext+mixedContent`（允许手机 http 直连桌面同步）
- 脚本：`mobile:init` / `mobile:sync` / `mobile:build`；`scripts/mobile-init.mjs`、`scripts/gen-android-icons.ps1`
- 本机 Android SDK 已自动装好：`%LOCALAPPDATA%\Android\Sdk`（cmdline-tools + platform-tools + android-36 + build-tools 36.0.0），JDK 21（`D:\Java\jdk-21`）
- `android/build.gradle` 已配**阿里云镜像优先**（google/central 官方在部分网络被墙），`android/local.properties` 已写 SDK 路径
- 品牌图标已生成（`resources/icon.png` 2048² → 各 mipmap + adaptive）
- APK 版本：versionName `2.0.2` / versionCode `2`

### 2. 移动端 AI 直连（自包含，无需服务器）
- `src/lib/ai/`：**11 个纯函数服务**（deepseek、character-generator、proactive-chat、memory-consolidator、emotion-analyzer、context-consolidator、context-summarizer、diary-assistant、web-search、http、text）—— 从桌面端 `electron/services` 复制而来，零修改
- `src/lib/web-api.ts`：非 Electron 环境下的 `VirtuGeneAPI` **完整实现**，直接 fetch DeepSeek（Key 只在内存 store）
- `src/lib/ipc-client.ts`：`window.virtugene ?? webApi`（Electron 走 IPC，手机/浏览器走 webApi）
- **关键依据**：已实测 `api.deepseek.com` 支持 CORS（OPTIONS 预检通过，回显 origin、允许 authorization/content-type），手机 WebView 可直接 fetch，**无需** @capacitor/http 原生插件

### 3. 微信式手机 UI（4-tab 底部导航）
- `src/lib/platform.ts`：`IS_MOBILE` / `IS_CAPACITOR` / `IS_ELECTRON`
- `src/components/layout/MobileLayout.tsx`：底部四栏 **聊天 / 角色 / 手账 / 我的**，与 `useUIStore.activeView` 联动
- `src/components/character/MobileCharacterPage.tsx`：角色列表（微信通讯录式：头像/名字/签名/标签/**未读红点**，顶部"基因实验室"入口，点击进聊天）
- `src/components/layout/MobileMePage.tsx`："我的"页（用户卡 / 完整设置入口 / 深色模式开关 / 局域网同步 / 版本 / 退出登录）
- `MainLayout` 增加手机分支；`EmotionPanel` 手机端悬浮覆盖；`ChatWindow` 空态引导去角色页

### 4. 已修复的手机端 bug
- **顶部白色**：根因是 `index.html` viewport 缺 `viewport-fit=cover` → `env(safe-area-inset-top)` 失效，状态栏区域透出白色 body。已加 `viewport-fit=cover` + `theme-color` + `html/body` 背景 `#0F0F1A`（见 `index.html`、`src/styles/globals.css`）
- **基因实验室打不开**：根因是旧抽屉 `z-[60]` 盖住 Modal `z-50`。改用 4-tab 导航（无抽屉）后解决；`CharacterAddModal` 新增 `onSelected` 回调（选完角色切回聊天）

### 5. 局域网同步（手机端 = 纯 HTTP 客户端）
- `src/lib/sync.ts`：`collectSyncData` / `importSyncData`（Dexie 全表：角色/会话/消息/记忆/情绪/关系/日记；**不含账号与 API Key**）
- `src/store/sync-store.ts`：拉取/推送（fetch，带超时）
- `src/components/settings/SyncSection.tsx`：手机端 UI（IP + 端口 + 拉取/推送 + 状态）
- **协议（桌面端需自行实现）**：`GET http://<IP>:46789/sync/export`、`POST /sync/import`（请求体 `{data:...}`），响应带 CORS 头。完整协议见 `MOBILE.md`
- ⚠️ 桌面端同步服务端代码已被**还原删除**（用户要求不碰电脑版）——桌面端按协议自己实现即可互通

### 6. 桌面端零侵入（已确认）
- `electron/main.ts`（git 还原）、`preload.ts`、`diary-assistant.ts`（还原到原样）；`electron/ipc/sync.ts`、`electron/services/sync-server.ts` 已删除
- 电脑版 `F:\VirtuGene` git 现状：**干净**（对方已提交 v2.0.2）

## 四、当前产物

- **最新 APK**：`F:\VirtuGene-Mobile\android\app\build\outputs\apk\debug\app-debug.apk`（v2.0.2，约 4.45MB）
- 桌面快捷方式：`C:\Users\34568\Desktop\VirtuGene 手机版工作区.lnk` → `F:\VirtuGene-Mobile`
- 文档：`F:\VirtuGene-Mobile\MOBILE.md`（能力清单/UI 说明/同步协议/构建指引）、`README.md`

## 五、构建命令（在 `F:\VirtuGene-Mobile` 内执行）

```powershell
npm run mobile:build          # 全流程：build:renderer + cap sync + gradle assembleDebug
npm run mobile:sync           # 改代码后：重建 Web 产物并同步到 android
cd android; gradlew.bat assembleDebug   # 或直接增量构建
# 产物：android\app\build\outputs\apk\debug\app-debug.apk
npm run dev:renderer          # 手机浏览器预览（host:true，访问 http://<电脑IP>:5173）
```

注意：npm 11 会拦截 postinstall（esbuild 二进制），如 `vite build` 报 esbuild 错误，执行 `node node_modules/esbuild/install.js` 补装。

## 六、手机版已知限制（有意降级）

- 日记导出：DOCX / PDF 不支持（提示用桌面版）；TXT / Markdown / JSON 走系统下载
- 文档解析（docx/pdf 喂角色生成）：不支持（报错提示用桌面版）
- 自动更新：不支持（走应用商店渠道）
- 角色生成"联网搜索"：DuckDuckGo 受浏览器跨域限制，自动降级为仅按设定生成
- 未做：@capacitor/status-bar、本地通知、深链、iOS

## 七、并行协作注意事项

- 另一个工作聊天在维护 `F:\VirtuGene`（可能继续改 `src/db/`、`DiaryPage` 等并升版本）
- **两个工作区的共享代码（db、store、组件）改动不会自动同步**；手机版如需对齐，需手动把对方改动复制过来（复制时排除 electron 依赖）
- 原 `F:\VirtuGene` 中与手机版相关的提交已包含：`capacitor.config.ts`、`MOBILE.md`、`scripts/mobile-init.mjs` 等（对方 commit 里带了）

## 八、下一步建议（按优先级）

1. **手机真机验证**：装最新 APK（方式 B：拷到手机装；或 USB 连上后 `adb install -r`），重点测：四栏切换、角色页进聊天、基因实验室弹窗、状态栏区域颜色、暗色模式
2. **继续打磨手机 UI**：4-tab 细节、聊天页顶部收纳（打卡/情绪收进"更多"）、手账页窄屏适配（注意：手账页源码在电脑版那边也在改，避免冲突）
3. **桌面端同步对接**：把 `MOBILE.md` 的同步协议发给电脑版工作聊天，让其实现服务端
4. **增强项**（可选）：状态栏插件、本地通知（每日手账提醒）、深链

## 九、本会话已完成（2026-08-23 手机 UI 打磨）

- **4-tab 细节**（`MobileLayout.tsx`）：激活态图标胶囊高亮 + 微放大、聊天 tab 微信式未读红点徽标（总数，>99 显示 99+）、每 30s 定时刷新未读数、根容器 `pt-[env(safe-area-inset-top)]` 统一避让状态栏（targetSdk 36，Android 15+ 强制 edge-to-edge）
- **聊天页顶部收纳**（新文件 `ChatHeaderMoreMenu.tsx`）：手机端聊天头部只留角色名，打卡/情绪收进「⋯」更多菜单（💗 情绪图谱 / 😊 心情打卡 子视图）；情绪有数据时按钮右上角显示状态小点；打卡成功短暂显示 ✓。桌面端保持原样（心形按钮 + 打卡按钮）
- **手账页窄屏适配**：`DiaryPage` 头部按钮文字窄屏隐藏（📤/🧠 图标化）、统计卡窄屏 2×2、搜索框最小宽度缩小、手机端隐藏「← 聊天」冗余悬浮按钮（底部 tab 已有）；`DiaryCalendar` 图例与月份头部 flex-wrap；`DiaryChatPage` 头部紧凑化（归档徽标 sm+ 显示、角色选择 max-w 缩小、truncate）
- **EmotionPanel 手机端**：默认宽度自适应 `min(360, innerWidth)`、隐藏触摸无效的拖拽手柄
- **新手引导**：桌面式三步引导（锚点依赖侧栏）手机端不再显示（App.tsx 按 IS_MOBILE 关闭），避免欢迎弹窗后卡死
- 验证：`tsc --noEmit` 通过、`npm run mobile:build` 全流程成功，APK 已重建（`android\app\build\outputs\apk\debug\app-debug.apk`，约 4.68MB）

## 十、本会话已完成（2026-08-24 v2.0.3 交互大打磨）

- **版本更迭**：v2.0.2 → **v2.0.3**（versionCode 2 → 3），`package.json` + `android/app/build.gradle` + `changelog.ts` 已加 2.0.3 条目（启动会弹更新公告）
- **聊天页返回**（`ChatWindow.tsx`）：手机端头部加 ‹ 返回按钮（回角色页）+ **整页右滑返回手势**（新组件 `ui/SwipeBackView.tsx`，跟手阻尼 + 超阈值滑出触发 onBack，纵向滚动不拦截，INPUT/TEXTAREA 上不触发）
- **写日记页返回**（`DiaryChatPage.tsx`）：同样接入 SwipeBackView（右滑回手账管理器）
- **顶部白色修复**：`MobileLayout`/`AuthPage` 加顶部安全区品牌深色条；`android styles.xml` 状态栏/导航栏固定 `#0F0F1A` + 白色图标（Android <15 场景）；edge-to-edge 由 WebView 内深色条接管
- **底部导航升级**（`MobileLayout.tsx`）：emoji 图标 → **SVG 线性图标**；激活态顶部小圆点 + 胶囊高亮 + 文字加粗（微信/QQ 式强调）
- **角色页 A-Z 索引**（`MobileCharacterPage.tsx`）：按首字母分组（`lib/pinyin.ts` getInitial/getSortKey），右侧字母索引条点击跳转，组标题 sticky，组内拼音排序
- **键盘弹出隐藏 tab**（`MobileLayout.tsx`）：用 `visualViewport` 高度比判断键盘状态，输入聚焦时底部导航下滑隐藏（微信式，四个 tab 不顶上来）；切 tab 时强制恢复显示
- **过渡动画**：tab 切换加淡入上滑（`animate-tab-in`）
- **手账「⋯」菜单修复**：根因是头部 `overflow-x-auto` 裁剪 absolute 下拉菜单 → 移除 overflow，标题改 truncate
- **整体细节**：`MobileMePage` 表情包图标换 SVG 线性图标、行高加宽；`ChatHeaderMoreMenu` 菜单项表情包换 SVG
- 验证：`tsc` 通过、`mobile:build` 成功，APK `app-debug.apk` v2.0.3（约 4.67MB）

## 十一、本会话已完成（2026-08-24 版本回退 + 账号/存储核查 + bug 修复）

- **版本回退**：2.0.3 → **2.0.2**（用户要求不升级版本）。`package.json`、`android/app/build.gradle`（versionCode 2）、`changelog.ts`（移除 2.0.3 条目）已全部还原
- **账号保存核查**（结论：健全）：
  - 账号存 IndexedDB `users` 表（`user-repo.ts`）：用户名唯一、PBKDF2 密码哈希 + AES-GCM 加密 API Key（`crypto.ts`）
  - 登录态持久化（`auth-store.ts` zustand persist）：只存 userId/username 到 localStorage，`isLoggedIn` 强制 false + API Key 不落盘（安全设计：每次启动需重新输密码解密 Key）
  - 注册（`RegisterCard.tsx`）：前端校验用户名唯一 + Key 有效后才建账号
- **数据存储核查**（结论：健全）：
  - `db/index.ts` 13 个版本迁移链完整；message 分页用 `[sessionId+createdAt]` 复合索引
  - `diary-store.ts` 有回收站 7 天清理 + 同日多篇合并 + 新用户欢迎日记（均幂等）
  - 同步 userId 重映射（上轮加的 `remapDataToCurrentUser`）在 sync-store 层完成，不动共享 sync.ts
- **Bug 修复**：
  - **NotificationCloud 点击不切 tab**：手机端点击消息云后 `setMobileTab('chat')`，否则停在角色/我的页看不到会话
  - 确认 `model: 'deepseek-v4-flash'` 是**正确**的新模型名（DeepSeek 官方 2026-07 迁移 V4，deepseek-chat/reasoner 已停用），非 bug
  - SwipeBackView 事件回调里的死代码 cleanup 无害，保留
- 验证：`tsc` 通过、`mobile:build` 成功，APK v2.0.2（约 4.67MB，18:00）

## 十二、本会话已完成（2026-08-24 微信/QQ 式交互改版，版本保持 2.0.2）

- **聊天返回选人界面（微信式推入层）**：角色页点角色 → 聊天作为**角色 tab 之上的覆盖层**渲染（`ui-store` 新增 `chatFromCharacters`），底部 tab 仍高亮「角色」；聊天页 ‹ 返回 / 右滑返回 → 回到角色列表，不是 tab 跳变。直接点底部「聊天」tab 进入的 → 返回切到角色 tab（`ChatWindow.backToCharacters` 统一处理）
- **基因实验室去网格**（`GenePoolTab.tsx`）：手机端强制 A-Z 列表视图（隐藏网格/A-Z 切换按钮，屏幕小不用网格）
- **「全部气质」→「全部」**（GenePoolTab 分类筛选）
- **我的页点头像换头像**（`MobileMePage.tsx`）：用户卡头像可点击（✎ 角标）→ 打开 `UserProfileModal`（相册选图 / 拖拽 / emoji，压缩存储 + 更新 userRepo + auth-store）
- **日记 bug 修复**：
  - 段落操作按钮（编辑/上移/下移/删除）原来 `hidden group-hover:flex`，**触摸屏无 hover 无法使用** → 手机端常显、桌面端 hover 显示
  - 日记插图删除按钮同 bug → 手机端常显
  - 其余日记逻辑（自动生成、补写、AI 引导、回收站、去重迁移）核查无问题
- **提示词精简**（屏幕短）：写日记输入提示、AI 草稿说明、心情曲线说明、搜索提示等缩短
- 版本保持 **2.0.2**（versionCode 2，未升级）
- 验证：`tsc` 通过、`mobile:build` 成功，APK v2.0.2（约 4.69MB，18:46）

## 十三、本会话已完成（2026-08-24 会话列表 + 基因实验室横条 + 修复 2 个严重 bug）

- **「聊天」tab 改为微信式会话列表**（新文件 `MobileChatListPage.tsx`）：显示所有角色最近对话（头像/名字/最后消息预览/时间/未读红点），按最后消息时间倒序；点角色推入聊天（`ui-store` 新增 `chatFromList`），返回回到会话列表，**绝不跳「角色」页**；底部 tab 仍高亮「聊天」
- **聊天返回逻辑**（`ChatWindow.backToCharacters`）：按来源分流——chatFromCharacters → 回角色列表；chatFromList / 直接底部进入 → 回会话列表
- **基因实验室醒目横条**（`MobileCharacterPage.tsx`）：紫青渐变大横条放在角色列表最上方（🧬 +「培育新的数字灵魂」+ 箭头），右上角小按钮移除
- **修复严重 bug 1**：`MobileLayout` 渲染 `{tab === 'characters' && chatFromCharacters ? A : B}` 是 **JSX 运算符优先级陷阱**（`&&` 高于 `?:`，导致 tab 为手账/我的时误渲染角色页）→ 改为 `{tab === 'characters' && (chatFromCharacters ? A : B)}`
- **修复 bug 2**：角色页字母索引条 `absolute top-1/2` 原来相对内容容器定位，内容超高时索引条跑到内容中部（A 看不见）→ 索引条改放滚动容器内，relative 定位参照滚动容器可视区，滚动时固定在右侧中间
- 全量扫描确认无其他 `&& ... ? :` 同类陷阱
- 验证：`tsc` 通过、`mobile:build` 成功，APK v2.0.2（约 4.83MB，19:04）

## 十四、本会话已完成（2026-08-24 会话列表圆角卡片 + 去自动聚焦 + 顶部沉浸 + 日记导出修复）

- **会话列表圆角卡片**（`MobileChatListPage.tsx`）：微信/QQ 式——每行独立圆角矩形卡片（`rounded-2xl bg-surface border` + 间距 `space-y-2`），头像加面板底圈，替代原来的通栏列表
- **手机端不自动聚焦输入框**（`ChatInput.tsx` + `ChatWindow.tsx`）：mount 自动聚焦、发送后 re-focus、切角色 re-focus 全部按 IS_MOBILE 关闭——由用户主动点击输入框才进入聊天状态（桌面端保持原行为）
- **顶部白色修复（沉浸式）**：
  - `MainActivity.java`：原生设置 statusBarColor/navigationBarColor = `#0F0F1A` + 白色图标（`setAppearanceLightStatusBars(false)`）
  - `capacitor.config.ts` 新增 `SystemBars` 插件配置：`style: 'DARK'`（深色状态栏白图标）、`insetsHandling: 'css'`（WebView 全屏沉浸，安全区交给 CSS `env(safe-area-inset-top)`，由 MobileLayout/AuthPage 顶部深色条接管）——已 cap sync 生效
- **日记导出 bug 修复**（`DiaryPage.tsx` + `DiaryChatPage.tsx`）：手机端 DOCX/PDF 导出时 web-api 返回 `{ ok:false, error }` **不抛异常**，原代码 catch 不到、误报"已导出 N 篇" → 现在检查返回值 ok 字段，手机端明确提示"暂不支持导出 Word/PDF，请使用桌面版"
- 其余日记逻辑（自动生成、补写、AI 引导、ExtractModal）核查无问题
- 验证：`tsc` 通过、`mobile:build` 成功，APK v2.0.2（约 4.83MB，19:30）

## 十五、本会话已完成（2026-08-24 顶部白色彻底修复——兜底 24px 深色条）

- **根因**：此前顶部深色条高度 = `env(safe-area-inset-top)`，**无刘海屏该值为 0 → 深色条高度 0 → 状态栏区域透出根容器背景（浅色模式=白）**；且 AndroidManifest application 主题仍是浅色 `AppTheme`
- **修复**：
  1. `AndroidManifest.xml`：application 主题 `@style/AppTheme` → `@style/AppTheme.NoActionBar`（原生状态栏深色）
  2. `MobileLayout.tsx` / `AuthPage.tsx`：顶部深色条高度改为 `calc(env(safe-area-inset-top,0px) + 24px)`——**固定叠加 24px 兜底**，无刘海屏也有深色条；内容 padding 同步 `calc(... + 24px)`
  3. 保持 MainActivity 原生 statusBarColor `#0F0F1A` + 白色图标、SystemBars DARK、html 背景深色——四层保障，任何机型/主题顶部都不透白
- 验证：`tsc` 通过、`mobile:build` 成功，APK v2.0.2（约 4.83MB，19:37）

## 十六、顶部白色真正的根因（2026-08-24 最终修复）

- **根因**：Capacitor 的 **SystemBars 插件**在 WebView 加载后执行
  `getWindow().getDecorView().setBackgroundColor(getThemeColor(...android.R.attr.windowBackground))`——
  把**窗口 decorView 背景设置为主题 windowBackground 色**。原主题没定义 windowBackground，
  Capacitor 取到 AppCompat 默认的**白色**。Android 15+ 强制 edge-to-edge 时状态栏透明，
  透出的就是这层白色窗口背景——**在 WebView 里加任何深色条都无效**，因为状态栏后面不是 WebView 内容。
  之前的 MainActivity `setStatusBarColor` 也会被插件这行覆盖。
- **修复（styles.xml）**：给 `AppTheme.NoActionBar` 加
  `<item name="android:windowBackground">#0F0F1A</item>`——Capacitor 插件取到的窗口背景变成品牌深色，
  状态栏/导航栏区域无论系统栏透明与否都透出深色；同时保留 statusBarColor、windowLightStatusBar=false。
- **MainActivity 加固**：`applySystemBarColors()` 统一设置 statusBarColor/navigationBarColor/decorView 背景 = `#0F0F1A` + 白色图标，onCreate 时执行一次 + 300ms 延迟再强制一次（覆盖插件写入时机）
- 验证：`mobile:build` 成功，APK v2.0.2（约 4.83MB，19:44）

## 十八、本会话已完成（2026-08-25 Capgo 热更新接入——手机端自动迭代版本）

- **目标**：用户不再每次发 APK，手机上 Web 层改动自动更新
- **接入步骤**：
  1. `npm install @capgo/capacitor-updater@^8.51.14`（npm 缓存已在 D:\npm-cache；esbuild postinstall 被 npm 11 拦截需 `node node_modules/esbuild/install.js` 补装）
  2. `capacitor.config.ts` 增加 `CapacitorUpdater` 插件：**中国区配置**——`autoUpdate:'atBackground'`、`responseTimeout:60`、三个 URL 指向 `updater.capgo.com.cn`（香港基础设施，官方中国区文档推荐）
  3. `npx cap sync android` 插件已进原生工程（`capacitor.settings.gradle` 引入 `:capgo-capacitor-updater`）
  4. 新脚本 `scripts/capgo-upload.mjs` + `npm run capgo:upload`：自动 vite build → 上传到 Capgo 指定频道（production/beta），bundle 版本 = package.json version
- **验证**：APK 构建成功（9.36MB），classes4.dex 含 CapacitorUpdater 类、assets/capacitor.plugins.json 已注册 `ee.forgr.capacitor_updater.CapacitorUpdaterPlugin`
- **待用户操作**：注册 https://capgo.app 拿 API key → `$env:CAPGO_API_KEY="cap_xxx"` → 首次 `npx @capgo/cli app add com.virtugene.app --name "VirtuGene" --icon ./resources/icon.png` → 之后改代码后 `npm run capgo:upload production`
- **注意**：bundle 版本号必须唯一（= package.json version），发新版前先改 version；原生层改动（Java/Manifest）仍需发 APK，Web 层（UI/JS）走 OTA
- **国内网络关键问题（已解决）**：Capgo CLI(Node)默认不走系统代理 → 无法连接 api.capgo.app。解法：`D:\capgo-tools\undici-proxy.cjs` 用 undici ProxyAgent 全局代理，通过 `NODE_OPTIONS="--require D:/capgo-tools/undici-proxy.cjs"` 预加载。已登录（~/.capgo 保存 key）
- **应用已创建**：`VirtuGene` / `com.virtugene.app`（控制台 https://console.capgo.app/app/com.virtugene.app/channel/46082）
- **v2.0.2 已上传 production 频道**；`notifyAppReady()` 已加入 App 启动（`src/lib/capgo.ts`，否则新版本永远待定）
- **一键发布**：`npm run capgo:upload <channel>`（脚本内置代理预加载，自动 vite build + 上传，bundle 版本=package.json version）
- **注意**：Capgo 账号当前是 **Trial 试用版，15 天到期**；上传用代理 127.0.0.1:7897（用户本机 Clash）
- 版本保持 2.0.2

## 二十、本会话已完成（2026-08-26 自动更新改为免费 GitHub 方案，弃用收费 Capgo）

- **决策**：用户量"个人左右"，Capgo 最低 $12/月（无永久免费版，14 天试用）→ **放弃 Capgo，改用 GitHub Releases + 国内镜像加速，0 成本**
- **新增手机端更新器**：
  - `src/lib/update-config.ts`：GitHub 仓库配置 + 下载镜像列表（gh-proxy.com / ghfast.top / 官方兜底）
  - `src/lib/mobile-update.ts`：checkUpdate()（GitHub API 查最新 release）+ openApkDownload()（镜像探测 + 系统下载器下载）
  - `MobileMePage` 版本行改为「检查更新」入口：发现新版 → confirm → 打开镜像下载（系统下载器接管，用户点通知安装）
- **发布脚本**：`scripts/gh-release.mjs` + `npm run release <版本号>`——自动 mobile:build → GitHub API 创建 Release + 上传 APK
- **已清理 Capgo**：卸载 @capgo/capacitor-updater、移除 capacitor.config.ts 的 CapacitorUpdater 配置、删 src/lib/capgo.ts 与 scripts/capgo-upload.mjs、App.tsx 移除 notifyAppReady、清理 D:\capgo-tools（代理工具不再需要）
- **用户待办**：① 创建 GitHub 仓库 ② 填 update-config.ts 的 GITHUB_REPO ③ 生成 GITHUB_TOKEN ④ `npm run release 2.0.3`
- **注意**：GitHub 更新 = 每次用户点「检查更新」下载 APK 后需手动确认安装（系统要求），无法像 Capgo 静默；个人使用可接受
- 验证：tsc 通过、mobile:build 成功，APK v2.0.2（约 7.9MB，14:26，已无 capgo 插件）

## 二十二、本会话已完成（2026-08-26 v2.0.3 发布）

- **版本升级 2.0.3**：package.json、build.gradle（versionCode 3 / versionName 2.0.3）、changelog 已更新；APK 已重建（4.5MB，移除 Capgo 后更小）并发布 GitHub Release `v2.0.3`（https://github.com/wzy6789/VirtuGene-Mobile/releases/tag/v2.0.3）
- **聊天列表长按操作**（`MobileChatListPage.tsx`）：长按/右键弹菜单 → 置顶/取消置顶、从聊天列表移除/恢复。仅影响列表显示，**不删角色与消息**（新字段 `Character.chatListHidden`，chat-store 新增 `hideFromChatList`/`unhideFromChatList`，置顶放开预设限制）；长按 600ms 触发并抑制误触进聊天
- **设置整理**（`MobileMePage.tsx`）：局域网同步移入「完整设置」（SettingsPanel 已有 IS_MOBILE 分支）；「检查更新」从版本行拆出，版本号下方单列入口
- **输入隐藏底部导航**（`MobileLayout.tsx`）：focusin 输入框/文本域即隐藏底部 tab，失焦延迟恢复，visualViewport 兜底——四个 tab 不再顶到键盘上方
- **UI 优化**：会话列表卡片化 + 置顶📌标记 + 头部「已隐藏 N 个」入口
- **Bug 修复**：版本号裸标识符 `__APP_VERSION__`（update-config 原先带引号导致不替换）；长按误触；检查更新版本比较
- git 已推送 `dd3cf97`（main）
- 验证：tsc 通过、mobile:build 成功

## 二十三、本会话已完成（2026-08-26 下载提速优化）

- **问题**：用户反馈 APK 下载非常慢（GitHub 直连国内慢）
- **优化**：
  1. `update-config.ts` 镜像列表更新：按实测速度排序（gh.ddlc.top 最快 471ms → gh-proxy.com → ghps.cc → ghproxy.net → ghfast.top → 官方兜底），移除失效镜像（github.moeyy.xyz、gh-proxy.net、ghproxy.cc）
  2. `mobile-update.ts` `openApkDownload` 改为**并行测速**：同时 HEAD 所有镜像（5s 总超时），选成功且最快的打开——原来是串行（最坏 30s），现在最快 1s 出结果
  3. v2.0.3 APK 已重建（4.8MB）并替换 GitHub Release 资产
- **镜像状态（2026-08 实测，本机代理下）**：gh.ddlc.top 679ms、gh-proxy.com 1016ms、ghps.cc 2328ms 可用；官方直连兜底
- 验证：tsc 通过、mobile:build 成功

## 二十一、本会话已完成（2026-08-26 GitHub 仓库 + 首次发布）

- **仓库**：`wzy6789/VirtuGene-Mobile`（https://github.com/wzy6789/VirtuGene-Mobile）
- **git 已初始化并推送**：main 分支，提交 `8a42b3a`（182 文件，无敏感内容）；`.gitignore` 已补 Android 构建产物/APK/.capgo
- **`update-config.ts`** 已填 `GITHUB_REPO = 'wzy6789/VirtuGene-Mobile'`
- **首次发布成功**：`npm run release 2.0.2` → Release `v2.0.2` + `app-debug.apk`(7.5MB) 已上传
  - 地址：https://github.com/wzy6789/VirtuGene-Mobile/releases/tag/v2.0.2
- **发布脚本改进**：`scripts/gh-release.mjs` 现在**自动从 git 凭据子系统取 token**（Windows 凭据管理器,无需手动设 GITHUB_TOKEN）；修复了 ESM 语法问题（去 TS 类型、统一 import）
- **以后发版**：`npm run release <新版本号>` 一条命令完成（构建 → 建 Release → 传 APK）
- 版本保持 2.0.2

## 二十四、2.1.0 方案定稿（2026-08-26 · 数据安全专项 · 暂不实施，仅存档）

**用户拍板的原则**：安全、稳定、一键恢复。此方案 2.1.0 再做，现在不动代码。

### 痛点
所有数据（账号/角色/聊天/日记/记忆）存在 App 私有 IndexedDB + localStorage，**卸载重装即清空** → 用户"删了软件重登啥都没有，还要重新注册"。

### 三层数据保护
1. **自动备份到系统共享存储**（最关键，卸载不丢）
   - 数据变更后 debounce 自动备份全量 JSON 到 `Download/VirtuGeneBackup/backup.json`（共享存储不受卸载影响）
   - 重装首启检测到备份 → 弹「发现历史数据，一键恢复？」
2. **局域网同步兜底**（已有，增强恢复入口）：重装后也可从电脑同步恢复
3. **账号兜底**（防重新注册）：备份 JSON 含账号（用户名+PBKDF2 哈希+加密 Key 密文），恢复时库中无该账号 → 自动重建并登录

### 安全要点
- 备份文件**密码加密**（用户拍板：安全优先）
- 不含明文 API Key（仅加密密文）
- 恢复需验证身份（输密码解密备份）后再落库

### 实现要点
- 备份触发：数据写入 debounce 自动备份 + 设置页「立即备份」按钮
- 备份内容：复用现有 `collectSyncData`（已覆盖全表 users/characters/sessions/messages/memories/emotionSnapshots/characterStates/diaries）
- 存储位置：`@capacitor/filesystem` 写 Android 共享存储
- 恢复流程：首启检测 → 引导页（微信欢迎页式 UI）→ 输密码解密 → 全量导入 → 自动登录
- UI：设置页加「数据备份/恢复」区块（微信分组卡片风格）

### 2.1.0 顺带（UI 学习微信/QQ）
- 恢复引导做成微信欢迎页式（"检测到历史数据，是否恢复？"两按钮）
- 其余 UI 打磨项见 HANDOVER 前文（圆形头像、消息气泡尾巴、搜索等，未拍板的先不做）

## 二十五、2.1.0 方案完善（2026-08-26 · 微信/QQ 差距补齐 + 电脑版功能对齐）

### 一、未进聊天主界面之前的差距（会话/角色列表层）
| 功能 | 微信/QQ | 当前手机版 | 2.1.0 动作 |
| :--- | :--- | :--- | :--- |
| 会话列表排序 | 置顶 → 最近消息 → 未读 | ✅ 已有（置顶+时间倒序） | — |
| 置顶 | 长按/左滑置顶 | ✅ 已有（长按菜单） | 补左滑置顶 |
| 删除会话 | 左滑/长按删除 | ⚠️ 长按仅「从列表隐藏」 | 补左滑「删除会话」+「清空聊天记录」 |
| 标为已读 | 左滑标已读 | ❌ 无 | 新增 |
| 未读红点 | ✅ | ✅ 已有 | — |
| 最近消息预览 | ✅ | ✅ 已有 | — |
| 会话列表搜索 | ✅ 顶部搜索 | ❌ 无 | 新增（搜名字/消息） |
| 置顶/普通分组 | ✅ 分组显示 | ⚠️ 混合排序 | 分「置顶」区 |
| 左滑手势 | ✅ 核心交互 | ❌ 无（仅长按） | 新增（微信核心手势） |
| 会话多选/批量操作 | ✅（部分） | ❌ | 暂缓 |

### 二、聊天主界面内差距（桌面已有/手机需补）
| 功能 | 电脑版 | 手机版 | 2.1.0 动作 |
| :--- | :--- | :--- | :--- |
| 消息复制 | ✅ | ✅ 已有 | — |
| 消息引用 | ✅ | ✅ 已有 | — |
| 消息删除 | ✅ | ✅ 已有 | — |
| 失败重发 | ✅ | ✅ 已有 | — |
| 图片/拍照发送 | ❌ | ❌ | 新增（手机刚需） |
| 表情快捷回应 | ❌ | ❌ | 可选 |
| 语音消息 | ❌ | ❌ | 可选（暂缓） |
| 消息搜索 | ✅ 侧栏搜索 | ❌ | 新增（全局搜消息） |

### 三、电脑版有、手机端需要补的功能
| 功能 | 电脑版 | 2.1.0 动作 |
| :--- | :--- | :--- |
| 搜索基因（角色名过滤） | ✅ 侧栏搜索框 | 角色页补搜索框 |
| 角色编辑（改名/改头像/改 Prompt） | ✅ 右键编辑 | 手机端补「编辑角色」入口 |
| 角色档案卡（查看性格/标签） | ✅ | ✅ 已有（基因库点开档案） |
| 会话标题重命名 | ✅ | 手机端补 |
| 消息搜索全库 | ✅ 侧栏 | 新增 |
| 本地通知（每日手账提醒） | ✅ Electron 通知 | 新增 @capacitor/local-notifications |
| 文档导出（DOCX/PDF） | ✅ | 手机端保持提示用桌面版（降级） |
| 自动更新 | ✅ electron-updater | ✅ 已做 GitHub 镜像 |

### 四、2.1.0 最终范围（建议）
**P0（必须）**：
1. 数据备份/恢复（第二十四节方案，安全·稳定·一键恢复）
2. 会话列表左滑：置顶/标已读/删除会话（微信核心手势）
3. 消息图片发送 + 全屏预览
4. 角色页搜索框 + 编辑角色
5. 本地通知（每日手账提醒）

**P1（推荐）**：
6. 会话列表搜索（名字+消息）
7. 置顶分组显示 + 消息全局搜索
8. UI 细节：圆形头像、气泡尾巴、空态品牌化

**P2（可选/暂缓）**：语音消息、表情快捷回应、会话多选批量、深链

### 五、技术注意
- 左滑手势：新组件（类似 SwipeBackView 的列表项滑动），需与右滑返回手势区分方向
- 图片发送：压缩存 IndexedDB（复用 DiaryChatPage 的 compressImage），气泡渲染 + 全屏预览
- 删除会话 vs 删除角色：删除会话仅清空该角色会话记录（角色保留）；删除角色才连人带数据删
- 备份加密：密码派生 AES-GCM（复用 crypto.ts 模式），不与登录密码强绑定（允许独立备份密码）

## 二十七、本会话已完成（2026-08-26 v2.1.0 修复：左滑按钮透过 + 记住登录）

- **Bug 修复：左滑按钮未滑就显示**——根因是 SwipeActionItem 内容层用 `bg-surface`（半透明），底层操作按钮透过来了。修复：内容层改不透明 `bg-panel` + 边框，列表项改透明背景
- **记住登录（同一台手机不重复登录）**：
  - 新增 `src/lib/api-key-storage.ts`：API Key 用**设备随机密钥 AES-GCM 加密**后存 localStorage（非明文；设备专属，清数据/换设备需重新登录）
  - `auth-store.ts`：手机端(IS_MOBILE) persist 记住 userId/username/avatar/isLoggedIn；桌面端保持每次输密码（原安全设计）
  - `App.tsx` 启动：persist 恢复登录态 → loadPersistedApiKey 恢复 Key；恢复失败则退回登录页（避免"已登录但无法对话"）
  - LoginCard / RegisterCard：登录/注册后 `persistApiKey` 加密存 Key
  - MobileMePage 登出：`clearPersistedApiKey()` 清除加密 Key
- **发布**：v2.1.0 修复版 APK(5.0MB)已重新上传 GitHub Release；git 已推送 `59af0f2`
- 验证：tsc 通过、mobile:build 成功

## 二十八、本会话已完成（2026-08-26 v2.1.1 发布：资料卡 + 删除语义 + 密码修改 + 头像圆形）

- **v2.1.1 已发布**：GitHub Release `v2.1.1` + APK(4.6MB)，git 推送 `952db7b`
- **角色页点人物 → 先开资料卡**（CharacterProfileModal 美化：品牌渐变头部、圆形大头像、签名、分类标签、开场白），资料卡内「开始聊天」才进对话
- **删除=从列表隐藏，重新聊天自动恢复**：移除「已隐藏 N 个」入口；`selectCharacter` 自动清除 `chatListHidden`
- **修复基因实验室关闭误跳转**：CharacterAddModal 区分「纯关闭(×)」与「成功选中」——× 只关弹窗不切聊天（原 handleClose 无条件触发 onSelected）
- **新增修改密码**（ChangePasswordSection，设置→账号安全）：原密码验证 → 新密码两次确认(≥6位) → 用新密码重新加密 API Key → 更新 userRepo + 设备加密存储
- **头像圆形截取**：UserProfileModal 上传时 canvas 居中裁剪方形中心为圆 + 压缩 256px；Avatar 组件统一圆形
- 其他：设置「关于」区块、会话列表搜索、置顶淡紫区分、表情包换 SVG（基因库/创造基因去 emoji、空态 SVG）
- 验证：tsc 通过、mobile:build 成功

## 二十九、本会话已完成（2026-08-26 手机端语音生成：Edge-TTS 直连 + 系统兜底）

**方案（用户拍板）**：Edge-TTS 免费直连为主（不依赖电脑、无需代理、零成本、与桌面同款微软神经网络音色）+ 系统 speechSynthesis 兜底（无网络/接口失败也能出声）。用户主动点 🔊 才发声，绝不自动朗读。

**协议实测结论（关键）**：
- Edge-TTS 接口 `speech.platform.bing.com` 本机网络直连可用（无需翻墙）
- **服务器按 User-Agent 校验：只认桌面 Chrome/Edge UA，手机 UA 一律 403**（与 Origin 无关，实测 5 组 header 组合定位）
- 浏览器 WebSocket 无法自定义请求头 → 手机端在 `capacitor.config.ts` 加 `android.overrideUserAgent`（桌面 Chrome UA），WebView 全局生效（已 cap sync 验证写入 `android/.../capacitor.config.json`）
- Sec-MS-GEC 令牌 = `(unix秒向下取整300s + 11644473600) * 10^7` 拼接 `TrustedClientToken` → SHA-256 大写 HEX（Web Crypto 浏览器可算，协议与桌面 msedge-tts 1.x 一致）
- 音频帧：二进制消息内 `Path:audio\r\n` 之后为 MP3 分片，收齐到 `turn.end`；实测输出合法 MPEG 帧

**新增文件**：
- `src/lib/voice-map.ts`：音色池（18 个中文 Edge 声线）/ 6 档 band（先男女后性格）/ VoiceProfile 校验（与桌面同构，备份互通，sid 仅兼容字段）
- `src/lib/edge-tts.ts`：`edgeTTSSynthesize()` WebSocket 合成（25s 超时，SSML 转义，返回 MP3 ArrayBuffer）
- `src/lib/tts.ts`：`useTTS()` hook——Edge 直连主 + 系统语音兜底，同一时刻只播一句
- `src/lib/ai/voice-assigner.ts`：AI 声线判定（复刻桌面 electron/ipc/voice.ts，纯函数直连 DeepSeek，先男女后性格）

**接线**：
- `db/index.ts`：Character 新增 `voice?` 字段（桌面同型）
- `chat-store.ts`：`assignVoiceIfNeeded`（幂等）——创建角色/首次进入聊天时由 AI 判定声线落库固定
- `ChatWindow.tsx`：useTTS + `handleSpeak`（角色声线 → 语音，800 字上限）
- `MessageBubble.tsx`：AI 消息右侧常显 🔊（触屏可点，桌面 hover 同款）：播放中=暂停图标青色，合成中=转圈；复制按钮下移避让
- `capacitor.config.ts`：`android.overrideUserAgent` 桌面 UA（**必须 cap sync 生效**）

**验证**：tsc 通过、vite build 通过、APK 重建中。版本保持 2.1.1（未升；下次发布建议 v2.2.0，需先升 package.json + build.gradle + changelog.ts）

**注意**：手机端合成链路 = 用户点击 🔊 → WebSocket 直连微软接口（UA 已覆写为桌面 Chrome）→ 失败自动 speechSynthesis 兜底；若日后微软接口变更导致 403，检查 UA 是否被新规则拒收。

## 三十、本会话已完成（2026-08-27 语音交互修复 + ⋯菜单设置 + bug 检查）

**用户反馈 5 项全部处理**：

1. **点喇叭不再弹键盘**：根因是 ChatWindow 滚动容器 `onClick → focus 输入框`（微信式点空白聚焦）在手机端误触发。修复：手机端滚动容器去掉全局聚焦（只有点输入框才弹键盘），MessageBubble 喇叭/复制按钮 `stopPropagation`。同时修复键盘检测误判：Android adjustResize 模式下 visualViewport 与窗口同比例缩小 ratio≈1，原逻辑会把「键盘开着」反向覆盖回 false → tab 顶上来。改为 visualViewport 只负责确认弹起、恢复一律由 focusout 延迟检测完成（`MobileLayout.tsx`）
2. **切句/退出停止播放**：修复 useTTS 并发 bug——合成完成的异步回调未校验「当前是否还是这一句」，A 合成中点了 B，A 完成后照样播放。新增 `pendingKeyRef`，合成完成/失败时校验，过期结果直接丢弃；同一句再点（含合成中）即停止。退出聊天/切换会话：ChatWindow 的 `[currentSessionId]` effect 加 `stop()` + unmount cleanup 双保险
3. **⋯ 菜单加「设置」**（`ChatHeaderMoreMenu.tsx` 新增 `TtsSettings` 子视图，参考电脑端「角色语音」区块）：角色语音总开关（微信式开关）+ 朗读语速（慢 0.8/标准 1.0/快 1.2）+ 试听默认音色（Edge 直连 → 系统兜底）。`settings-store.ts` 新增 `ttsEnabled`/`ttsSpeed`（persist）；ChatWindow 朗读时总开关关闭隐藏 🔊、语速倍率叠加到角色语速（`combined = round(baseRate * ttsSpeed)`，与桌面一致）
4. **UI 优化**：喇叭按钮加大圆角（w-7 h-7 rounded-lg）、点击缩放反馈、播放中青色 + 光晕；设置菜单微信式分组卡片 + 分隔线
5. **bug 检查**：确认所有角色创建路径（自建/基因库克隆/引导页推荐/OnboardingModal）都走 `createCharacter` → `assignVoiceIfNeeded` 自动分配声线，无漏网；tsc + vite build + gradle 全通过

- 验证：tsc 通过、mobile:build 成功，APK 已重建（约 5.29MB）
- 版本保持 2.1.1（未升）

## 三十一、本会话已完成（2026-08-27 「有的角色放不出声音」根因修复）

**用户反馈**：有的角色能朗读、有的不能。

**根因（全量实测定位）**：Edge-TTS 服务端 **18 个中文音色里只有 7 个可用**，其余 11 个（Xiaoyou/Xiaohan/Xiaomeng/Xiaorui/Xiaomo/Xiaogui/Xiaozhen/Yunhao/Yunfeng/Yunze/Yunfan）连接挂起、服务器永不返回音频（实测 2 轮一致）。AI 给角色分配了死音色 → Edge 合成挂起 → 25s 超时 → 系统兜底（部分机型也不可靠）→ "放不出来"。与网络/UA 无关（极端 rate/pitch、控制字符均实测无碍）。

**修复**：
1. `voice-map.ts`：**VOICE_POOL 收缩为实测可用的 7 个**（女：Xiaoxiao/Xiaoyi/Xiaoxuan；男：Yunxi/Yunyang/Yunjian/Yunxia），AI 提示词自动只从活音色挑选；EDGE_VOICE_TO_SLOT 同步收缩
2. **点 🔊 必有声**（`ChatWindow.handleSpeak`）：声线缺失/音色不在池内 → 立即用默认音色（Xiaoxiao）播放，同时后台 `ensureCharacterVoice` 补分配/净化落库（一次点击即修复旧数据）
3. `chat-store` 新增 `ensureCharacterVoice` action：无 voice → AI 分配；已有死音色 → sanitize+complete 净化持久化；selectCharacter 改走该 action（覆盖两种路径）
4. 系统兜底加固（`tts.ts`）：等待 `voiceschanged` 加载语音引擎（Android getVoices 延迟加载），最多 1s
5. `sanitizeVoiceProfile` 加范围校验（rate/pitch 超 ±50 回退默认，防 Edge 拒单）；edge-tts 剥离 XML 非法控制字符；合成超时 25s → 12s（更快转兜底）

- 验证：全量音色实测（✅ 7 / ❌ 11）、tsc 通过、APK 已重建
- 版本保持 2.1.1（未升）

## 三十二、本会话已完成（2026-08-27 「死音色」根因结论 + 音色池扩至 9 个）

**用户追问**：为什么有死音色，能不能"弄活"？

**结论（调查实锤）**：**不能弄活——死音色是微软服务端下线的，不是我们能修的**：
- 查 Edge-TTS 官方音色列表接口（直连 HTTP 200）：zh-CN 仅返回 6 个，**11 个"死音色"全部不在微软自己的列表里** → 微软已把她们从免费 Edge 端点撤走（迁移到付费 Azure 语音服务，需 Azure 密钥 + 不同端点 + 按量付费）
- 合成挂起是"服务端没有该音色路由"的表现，与网络/代理无关（换网络路径服务端照样没有）；桌面版走代理同样救不回这些音色
- "弄活"唯一途径 = 接付费 Azure TTS（违背免费初衷 + 需注册 Azure/绑卡），暂不做

**顺带扩大音色池（用户在意声音多样）**：额外实测 12 个池外候选，又找到 **2 个活音色**：
- `zh-CN-liaoning-XiaobeiNeural`（东北方言·爽朗）、`zh-CN-shaanxi-XiaoniNeural`（陕西方言·质朴）
- **VOICE_POOL 现为 9 个**（女 5：Xiaoxiao/Xiaoyi/Xiaoxuan/Xiaobei(东北)/Xiaoni(陕西)；男 4：Yunxi/Yunyang/Yunjian/Yunxia）
- 方言音色已在提示词约束"仅限对应地域人设使用"，一般角色不选
- 其余候选（Xiaoshuang/Xiaoyan/Xiaochen/Yunhu/Yuncheng/Yunye/Yunjun/Yunqiu/Yunqi/Yunqing）全部实测死亡

- 验证：tsc 通过、APK 已重建
- 版本保持 2.1.1（未升）

## 三十三、本会话已完成（2026-08-27 语音四项要求：Edge 默认音色 / 方言用户自选 / 男女硬区分）

**用户要求**：① 默认音色必须是 Edge 音色而非系统音；② 方言让用户自己选；③ 男女声音严格区分，禁止男角色配女声/女角色配男声。

**改动**：
1. **默认音色 = Edge 晓晓（女）/ 云扬（男）**：`DEFAULT_VOICE`（女）已是 Edge；新增 `DEFAULT_MALE_VOICE`（云扬）。点 🔊 无声线时**先现场分配性别正确的声线**（`Promise.race` 最多等 4s），分配超时才用 Edge 默认音色兜底——系统语音只做 Edge 彻底失败的最后防线，不再是"默认音"
2. **方言改用户手动选**（`ChatHeaderMoreMenu` 语音设置新增「角色方言」区）：
   - AI 分配池 `VOICE_POOL` 移除方言（AI 永不自动选方言）
   - 方言拆到 `DIALECT_VOICES`（东北话 Xiaobei / 陕西话 Xiaoni，均女声）；校验池 `ALL_VOICES` = 两者合并
   - 设置里按角色切换：无 / 东北话 / 陕西话，选「无」恢复该性别标准音色；**仅女性角色可设**（方言只有女声，男角色显示不可设提示），切换落库 `setCharacterVoice`（chat-store 新 action）并同步内存
3. **男女硬区分（补了真实漏洞）**：原校验只保证 band 与 voice 性别一致，但 AI 给女角色返回男声拦不住（校验时不知道角色性别）。现在 AI 提示词强制输出 `gender` 字段，`voice-assigner` 解析后**硬校验：AI 判定的角色性别 ≠ 音色性别 → 强制修正为该性别默认音色**（男→云扬 / 女→晓晓）；试听也按角色性别（男声云扬/女声晓晓）
4. 修复连带 bug：`ensureCharacterVoice` 合法性检查改用 `ALL_VOICES`，避免用户手动设置的方言被误判非法覆盖

- 验证：tsc 通过、APK 已重建
- 版本保持 2.1.1（未升）

## 三十四、本会话已完成（2026-08-27 发语音功能：微信式按住说话 + 系统识别转文字 + 语音气泡）

**方案（用户拍板）**：微信式语音气泡（录音可回听 + 下方转文字小字）+ 系统语音识别（免费离线）+ 按住说话（上滑取消/60s 上限）。

**链路**：按住说话 → MediaRecorder 录音（webm/opus 单声道降噪，存 IndexedDB）+ @capgo/capacitor-speech-recognition 并行识别（安卓系统 SpeechRecognizer，zh-CN）→ 松手 ≥1s 发送：转文字作为消息 content 发给 AI（AI 理解文字），音频存 Message.audio 可回听 → AI 正常回复文字 → 用户可点 🔊 听 AI 的 Edge 语音（语音对话双向闭环）。

**新增/改动**：
- 依赖：`@capgo/capacitor-speech-recognition@^8.1.3`（Capacitor 8 兼容；插件 manifest 自带 RECORD_AUDIO，已 cap sync 进原生工程）
- `db/index.ts`：Message 新增 `audio?: { dataUrl; duration; text }`
- `src/lib/recorder.ts`：AudioRecorder 类（getUserMedia 单声道 + AnalyserNode 电平采样供声波 UI + MediaRecorder webm/opus + stop/cancel）
- `src/lib/speech-recognition.ts`：权限/可用性检查 + start/stop/cancel（partialResults 实时转写 + getLastPartialResult 取最终结果；非 Capacitor 环境优雅降级）
- `ChatInput.tsx`：新增麦克风按钮切换「按住说话」模式（再点切回键盘）；按住说话条：按住录音（声波电平 + 计时 + 震动）、上滑 >60px 取消、<1s 提示太短、60s 自动发送、转文字中状态；失败/无权限浮动 toast
- `ChatWindow.tsx`：`handleSendVoice`（content=转文字，audio 存消息，正常走 AI 回复管线）
- `MessageBubble.tsx`：微信式语音气泡（播放/暂停切换 + 由消息 id 稳定生成的波形条 + 时长 + 下方转文字小字）；模块级单例音频管理（同一时刻只播一条，微信式）
- 权限链路已验证：Capacitor WebView 原生 `onPermissionRequest` 放行 AUDIO_CAPTURE（申请 RECORD_AUDIO 后自动 grant）

**已知取舍**：转文字质量取决于手机自带语音识别引擎（谷歌服务机最佳，国产 ROM 一般可用）；识别空 → toast「没听清」重说；录音与识别并行占麦克风，个别机型可能互抢（真机验证项）；浏览器预览（非 Capacitor）语音按钮会提示设备不支持。

**「设备不支持语音识别」提示的三种成因与处理（2026-08-27 已修）**：
1. **浏览器预览**（http://电脑IP:5173）：非 Capacitor 环境无原生识别 → 现在提示「语音功能需安装 App 使用（浏览器预览不支持）」
2. **App 内但手机无系统语音识别引擎**（精简 ROM/关闭语音输入）→ 现在提示「手机未检测到系统语音识别，请用键盘输入」；可检查手机设置→语言与输入→语音输入是否开启
3. **权限被拒** → 现在提示「需要麦克风权限…请在系统设置中允许」
- 另：松手后转文字为空时也会复查识别可用性，区分「没听清」与「无引擎」，不再误报

**OPPO 等无系统识别引擎的手机 → 云端备用通道（2026-08-27 已实现，用户拍板）**：
- 根因：OPPO Find X9 的 ColorOS 不向第三方 App 开放标准 SpeechRecognizer 接口（`isRecognitionAvailable=false`），系统识别在 OPPO 上不可用（非设备故障，设置无解）
- 方案：新增**云端识别备用通道**（硅基流动 SiliconFlow · SenseVoice，OpenAI 兼容，国内直连、免费模型、中文识别好）
- `src/lib/cloud-asr.ts`：`transcribeWithSiliconFlow(dataUrl, key)` —— webm/opus → AudioContext 解码 → 16kHz 单声道 PCM16 WAV → POST `https://api.siliconflow.cn/v1/audio/transcriptions`（模型 `FunAudioLLM/SenseVoiceSmall`，30s 超时）
- `api-key-storage.ts`：新增通用 `persistSecret/loadSecret/clearSecret`（复用设备密钥 AES-GCM 加密，key 不落明文）
- `ChatInput`：松手后系统识别为空 → 自动读云端 key 转写录音（converting 状态保持）→ 成功即发送；无 key 提示「在 ⋯ 设置填云端识别 Key」
- 语音设置（⋯ → 设置）新增「云端识别」区：Key 输入（password）+ 保存/清除 + 注册说明
- **用户操作**：注册 cloud.siliconflow.cn（手机号）→ 创建 sk- 密钥 → App 语音设置粘贴保存

**内置 Key 已撤回（用户改主意 2026-08-27）**：
- 用户先授权把 `sk-fddmyuionznklppzjkcdcjhyslpvblzwmtkoqumamaooaqzi` 设为内置默认，随后改主意要求恢复"用户自填"
- 已彻底移除：`DEFAULT_CLOUD_ASR_KEY` / `getCloudAsrKey` 删除，key 字符串无残留（grep 验证）
- 现状：云端识别**仅走用户自填 Key**（设备加密存储）；未填时 OPPO 等无系统识别手机提示「在 ⋯ 设置填云端识别 Key 后可发语音」；设置 UI 显示「已配置 / 未配置」
- 验证：tsc 通过、APK 已重建

## 三十五、本会话已完成（2026-08-27 语音交互大改：DeepSeek 式点击即录 + 云端 Key 移入「我的」+ 修复 OPPO 进不了语音模式）

**用户反馈三项**：① 云端识别 Key 要放「我的」；② 填了 Key 仍提示"未检测到系统语音识别"；③ 点话筒没效果，体验差，学微信/DeepSeek。

**修复**：
1. **话筒改「点击即录」（DeepSeek 式）**（`ChatInput.tsx` 重构）：去掉「模式切换 + 按住说话」手势；点话筒直接开始录音（话筒变红 + 声波 + 计时 + 震动），再点停止发送；录音条可点停止，× 按钮取消；<1s 提示太短；60s 自动发送。转文字中显示「转文字中…」
2. **修复 OPPO 进不了语音模式的真 bug**：原来 `toggleVoiceMode` 用 `isSpeechAvailable()` 拦截，OPPO 返回 false 直接拒绝进入 → 填了云端 Key 也到不了转文字。现在**进入录音只要求麦克风权限**（不再检查系统识别可用性）；转文字环节系统识别 → 云端 Key → 精确提示（无 Key 提示去「我的 → 设置 → 语音」填）
3. **云端识别 Key 移到「我的 → 完整设置 → 语音」**（`SettingsPanel.tsx` 新增手机端「语音」区块：朗读开关 + 语速 + 云端识别 Key 配置/清除）；聊天 ⋯ 菜单的语音设置移除云端区（保留开关/语速/方言/试听），说明文字指向「我的」配置

- 验证：tsc 通过、APK 已重建
- 版本保持 2.1.1（未升）

- 验证：tsc 通过、APK 已重建
- 版本保持 2.1.1（未升）
