# VirtuGene 手机版（Capacitor）

VirtuGene 桌面版（Electron）的同一套 React 代码通过 **Capacitor** 封装为 Android 应用。
手机版**完全自包含、不依赖也不修改桌面端代码**：

- AI 对话直接调用 DeepSeek API（Key 只存在本机 IndexedDB，AES-GCM 加密）
- AI 服务实现位于 `src/lib/ai/`（复制自桌面端 electron/services 的纯函数版本）
- 与桌面端通过**局域网直连**互传角色、对话与日记（协议见下）

## 目录

- [能力清单](#能力清单)
- [界面设计（微信式）](#界面设计微信式)
- [架构说明](#架构说明)
- [局域网同步协议](#局域网同步协议)
- [环境要求](#环境要求)
- [初始化与构建](#初始化与构建)
- [运行到手机](#运行到手机)
- [常见问题](#常见问题)

## 能力清单

| 能力 | 手机版 | 说明 |
| :--- | :--- | :--- |
| 注册 / 登录 / API Key 管理 | ✅ | 密码 PBKDF2 哈希、Key AES-GCM 加密，全部本机 |
| 角色对话（流式打字机、自检重试、分条回复） | ✅ | 与桌面端同一套 DeepSeek 调用逻辑 |
| 主动消息、记忆、情绪图谱、关系系统 | ✅ | 与桌面端同一套服务 |
| 角色生成（基因实验室） | ✅ | 联网搜索在手机端降级为仅按设定生成 |
| 手账（日记） | ✅ | 编辑、AI 批注、补记、年度回顾等 |
| 日记导出 | 部分 | TXT / Markdown / JSON 走系统下载；DOCX / PDF 请用桌面版 |
| 文档解析（docx/pdf 喂给角色） | ❌ | 请用桌面版生成后同步过来 |
| 自动更新 | ❌ | 通过应用商店渠道更新 |
| 局域网同步 | ✅ | 手机端作为 HTTP 客户端直连桌面端 |

## 界面设计（微信式）

手机端采用微信/QQ 风格的四栏底部导航，替代桌面端侧边栏：

```
┌─────────────────────────────┐
│        [当前 tab 页面]        │
│                             │
├─────────────────────────────┤
│ 💬 聊天  🧬 角色  📓 手账  👤 我的 │  ← 底部导航（含手势安全区）
└─────────────────────────────┘
```

- **聊天**：角色对话（消息气泡、输入框、情绪图谱按钮、心情打卡）
- **角色**：微信「通讯录」式角色列表（头像/名字/签名/标签/未读徽标），
  顶部「基因实验室」入口（基因库 / 创造基因）；点击角色直接进入聊天
- **手账**：日记（日历 / 时间线 / 写日记）
- **我的**：用户卡 + 完整设置入口 + 深色模式 + 局域网同步 + 版本 + 退出登录

顶部状态栏/刘海区域已通过 `viewport-fit=cover` + 品牌深色底色适配，不会出现白条。

## 架构说明

```
┌───────────────────────────────┐      ┌───────────────────────────────┐
│ 手机（Capacitor WebView）      │      │ 桌面（Electron，由桌面端维护）  │
│  src/lib/web-api.ts           │      │                               │
│   └─ src/lib/ai/*             │      │   同步服务（需实现协议，见下）   │
│      直接 fetch DeepSeek      │      │                               │
│                               │      │                               │
│   IndexedDB (Dexie)           │      │   IndexedDB (Dexie)           │
└───────────────┬───────────────┘      └───────────────┬───────────────┘
                │  局域网 HTTP（端口默认 46789）        │
                └─────────── GET  /sync/export ────────┘
                             POST /sync/import ────────┘
```

- **AI 直连**：`src/lib/ipc-client.ts` 在非 Electron 环境自动切换到 `src/lib/web-api.ts`，
  由 `src/lib/ai/` 下的纯函数实现 DeepSeek 调用、角色生成、记忆/情绪/摘要、日记助手。
- **手机端专属**：`src/lib/platform.ts` 平台检测、`MobileLayout`（四栏导航）、
  `MobileCharacterPage`（角色列表）、`MobileMePage`（我的）、`SyncSection`（同步客户端）。
- **不触碰桌面端**：手机版不引用 `electron/` 目录、不修改任何桌面端文件。

## 局域网同步协议

手机端是纯客户端，通过标准 HTTP 直连桌面端。桌面端需要实现以下两个端点
（响应需带 CORS 头 `Access-Control-Allow-Origin: *`，否则手机 WebView 无法读取）：

### GET /sync/export

返回数据快照（角色、会话、消息、记忆、情绪快照、关系状态、日记），格式：

```json
{
  "app": "VirtuGene",
  "kind": "sync-export",
  "exportedAt": "ISO 时间戳",
  "data": {
    "__meta__": { "app": "VirtuGene", "kind": "sync", "version": "2.0.1", "exportedAt": "..." },
    "characters": [...], "sessions": [...], "messages": [...],
    "memories": [...], "emotionSnapshots": [...], "characterStates": [...], "diaries": [...]
  }
}
```

### POST /sync/import

请求体为 `{ "data": { ...同上 data 结构... } }`，桌面端将数据合并进本机 IndexedDB 后返回：

```json
{ "ok": true }
```

或失败时 `{ "ok": false, "error": "原因" }`。

> 数据模型与桌面端 Dexie 表一致（见 `src/db/index.ts`）。互传内容**不含账号与 API Key**。

## 环境要求

| 组件 | 版本 | 说明 |
| :--- | :--- | :--- |
| Node.js | 18+ | 构建工具链 |
| JDK | 17+（推荐 21） | Android Gradle 构建（本机已装 Temurin 21） |
| Android SDK | API 36 | **本机已自动安装**（cmdline-tools + platform-tools + android-36 + build-tools 36.0.0，位于 `%LOCALAPPDATA%\Android\Sdk`） |
| Android Studio | 可选 | 安装 SDK 最省事的方式，也用于模拟器调试 |

> 本机（2026-08）已由脚本自动完成 SDK 安装与首次构建，`npm run mobile:build` 可直接产出调试 APK。
> 若换机器构建，按下方指引安装 SDK 即可。

### 安装 Android SDK（Windows）

方案 A —— Android Studio（推荐，一步到位）：

1. 下载安装 [Android Studio](https://developer.android.com/studio)（一路默认）。
2. 首次启动时选择 SDK 组件，装完即可。
3. 配置环境变量（或在项目 `android/local.properties` 写入）：
   ```powershell
   # 系统环境变量
   ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
   # PATH 追加 %ANDROID_HOME%\platform-tools（adb 用）
   ```

方案 B —— 仅命令行工具：

1. 下载 [commandlinetools-win](https://developer.android.com/studio#command-line-tools-only)，解压到
   `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`。
2. 设置 `ANDROID_HOME` 后执行：
   ```powershell
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   yes | sdkmanager --licenses
   ```

验证：`adb version` 能输出版本即就绪。

## 初始化与构建

```powershell
# 1) 首次：生成 android/ 工程（已存在则跳过），构建并同步 Web 产物
npm run mobile:init

# 2) 日常：改了前端代码后，重新构建并同步到 android/
npm run mobile:sync

# 3) 构建调试 APK（需要 Android SDK）
npm run mobile:build
# 产物：android\app\build\outputs\apk\debug\app-debug.apk
```

手动等价命令：

```powershell
npm run build:renderer
npx cap sync android
cd android
gradlew.bat assembleDebug
```

> 国内网络加速：`android/build.gradle` 已配置阿里云镜像优先、官方仓库兜底；
> `android/local.properties` 已写入本机 SDK 路径（勿提交到版本库）。

## 运行到手机

```powershell
# 手机开启「开发者选项 + USB 调试」，连上电脑
adb install -r android\app\build\outputs\apk\debug\app-debug.apk

# 或直接用 Capacitor 热调试（需要 SDK / 模拟器）
npx cap run android
```

手机浏览器预览（无需装 APK，适合快速看 UI）：

```powershell
npm run dev:renderer   # 已配置 host: true，局域网可访问
# 手机浏览器打开 http://<电脑IP>:5173
```

## 常见问题

- **顶部出现白条/白底**：确认 `index.html` 的 viewport 含 `viewport-fit=cover`；
  页面底色由 `globals.css` 的 `html { background:#0F0F1A }` 保证。
- **弹窗打不开/被遮挡**：手机端使用四栏导航，不依赖抽屉，Modal 不会被遮挡。
- **gradlew 卡在下载 Gradle 发行版**：首次构建需要联网下载 Gradle；若网络受限，
  可改用 Android Studio 打开 `android/` 目录构建，或手动配置 Gradle 镜像。
- **报错 "SDK location not found"**：按上文安装 Android SDK，并确认
  `ANDROID_HOME` 已设置或 `android/local.properties` 存在 `sdk.dir=...`。
- **手机上拉取/推送失败**：确认桌面端已实现同步协议并开启服务、两台设备在同一 Wi-Fi、
  手机填写的 IP 是桌面端显示的那个（不是 `127.0.0.1`）。
- **角色生成时联网搜索无效**：手机端 DuckDuckGo 检索受浏览器跨域限制会自动降级，
  仅按用户设定生成；不影响其他功能。

---

*品牌口号：Unlock Your Digital Soul.*
