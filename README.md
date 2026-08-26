# VirtuGene 手机版工作区

本目录是 **VirtuGene 手机版（Capacitor Android）的独立工作区**，与 `F:\VirtuGene`（电脑版 Electron）**完全隔离、互不影响**：

- 手机版**不引用、不修改**电脑版任何代码（无 `electron/` 目录）
- AI 服务实现位于 `src/lib/ai/`（复制自桌面端 electron/services 的纯函数版本，手机版自包含）
- 电脑版升级/改动不会波及本目录，反之亦然

## 快速上手

```powershell
# 构建调试 APK
npm run mobile:build
# 产物：android\app\build\outputs\apk\debug\app-debug.apk

# 手机预览（局域网）
npm run dev:renderer   # 手机浏览器访问 http://<电脑IP>:5173

# 改了代码后增量构建
npm run mobile:sync && cd android && gradlew.bat assembleDebug
```

## 目录结构

| 路径 | 说明 |
| :--- | :--- |
| `src/` | React + TS + Tailwind 全部前端代码（含手机端专属：`MobileLayout`、`MobileCharacterPage`、`MobileMePage`、`SyncSection`、`lib/ai/`、`lib/web-api.ts`、`lib/platform.ts`） |
| `android/` | Capacitor Android 工程（已配置阿里云镜像、SDK 路径、品牌图标） |
| `scripts/` | `mobile-init.mjs`（初始化）、`gen-android-icons.ps1`（生成图标） |
| `resources/icon.png` | 品牌图标源图（2048²） |
| `MOBILE.md` | 详细文档：能力清单、微信式 UI 说明、**局域网同步协议**、构建/安装指引 |

## 局域网同步（手机端 = HTTP 客户端）

手机端按 `MOBILE.md` 中的协议直连桌面端：
- `GET  http://<桌面IP>:46789/sync/export`（拉取）
- `POST http://<桌面IP>:46789/sync/import`（推送）

桌面端需自行实现这两个端点（带 CORS 头）。互传角色/对话/日记，**不含账号与 API Key**。

---

*品牌口号：Unlock Your Digital Soul.*
