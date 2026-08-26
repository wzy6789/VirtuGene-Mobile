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
