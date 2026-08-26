# VirtuGene - 项目开发计划书 (v3.0)

> **本计划书已整合 API Key 注册机制、原生软件封装要求及 VirtuGene 品牌视觉规范。**
>
> **给 AI 编程助手的特别指令**：以上所有代码生成，必须严格遵循 **VirtuGene** 品牌调性。在写 CSS 时，主动使用 `#6C5CE7` 和 `#00CEC9` 作为主辅色。在写 UI 文案时，尽量包含"基因"、"灵魂"、"序列"等词汇。不要生成任何看起来像"通用后台管理模板"的界面。

---

## 0. 核心设计哲学（VirtuGene 品牌基因）

- **名称寓意**：**Virtue（美德/能力） + Gene（基因）**。我们不是制造冰冷的工具，而是**孵化拥有独特"性格基因"的数字灵魂**。
- **产品口号（Slogan）**：*"Unlock Your Digital Soul."* （解锁你的数字灵魂）
- **视觉隐喻**：界面中适当融入**DNA 双螺旋抽象线条**或**基因序列点阵**作为装饰元素（如加载动画、Logo 底纹），让用户潜意识里将"角色性格"与"基因"绑定。

---

## 1. 技术栈与架构（已拍板）

### 1.1 桌面方案选型：Electron

**决策：使用 Electron，不使用 Tauri。**

理由：
- Electron 主进程与前端共用 JS/TS 生态，API 代理可直接在 `main process` 或 `preload` 中完成，无需额外 Rust 环境或 sidecar 进程
- 降低环境搭建门槛，保证 Windows / macOS 开发体验一致
- 包体大小可接受（目标 < 150MB）

| 层级 | 技术选型 | 关键说明 |
| :--- | :--- | :--- |
| **前端 UI** | React 18 + TypeScript + Tailwind CSS | 所有交互必须模拟原生桌面手感（点击涟漪、平滑过渡、无浏览器滚动条跳跃） |
| **状态管理** | Zustand + `zustand/persist` | 持久化存储用户登录态及 API Key |
| **本地数据库** | IndexedDB (via Dexie.js) | 存储聊天记录、角色数据、会话数据、用户数据 |
| **API 代理** | Electron Main Process（`ipcMain` + `net` 模块） | 前端通过 `ipcRenderer` 发起请求，主进程携带用户 API Key 转发给 DeepSeek。**废弃 Express 后端**，消除 sidecar 子进程的运维复杂度 |
| **桌面封装** | Electron + `electron-builder` | 配置 `frameless: true` 无边框窗口，自定义标题栏，打包 `.exe` / `.dmg` |

### 1.2 架构拓扑

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process                              │
│  ┌──────────────────────────────────────────────┐   │
│  │  ipcMain handlers                             │   │
│  │  - chat:stream   (SSE 流式转发 DeepSeek)      │   │
│  │  - chat:stop     (中断生成)                   │   │
│  │  - key:validate  (校验 API Key 有效性)        │   │
│  └──────────────────────────────────────────────┘   │
│                        ↕ ipc                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  Renderer Process (React App)                │   │
│  │  Zustand → Dexie(IndexedDB) → UI Components  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                           ↕ HTTPS (携带用户 Key)
                    DeepSeek API
```

---

## 2. 用户注册/登录逻辑（API Key 管理）

**首次注册即绑定 API Key，后续登录自动加载，支持换 Key。**

### 2.1 数据模型

```typescript
interface User {
  id: string;           // UUID
  username: string;     // 唯一用户名
  passwordHash: string; // PBKDF2 哈希值（不存明文）
  apiKey: string;       // DeepSeek API Key（加密存储）
  createdAt: number;    // 时间戳
}

interface Session {
  id: string;           // UUID
  characterId: string;  // 关联角色
  title: string;        // 会话标题（默认"新对话"）
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;           // UUID
  sessionId: string;    // 关联会话
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

interface Character {
  id: string;           // UUID
  name: string;         // 角色名
  avatar: string;       // 头像 emoji 或本地路径
  systemPrompt: string; // 系统提示词
  tags: string[];       // 性格标签
  isPreset: boolean;    // 预设角色不可删除
  isCustom: boolean;    // 用户自建角色
  createdAt: number;
}
```

### 2.2 密码安全（严于 Base64）

使用 **Web Crypto API — PBKDF2** 对密码做单向哈希后存入 IndexedDB：

```typescript
// lib/crypto.ts — 密码哈希工具
async function hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: s, iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return {
    hash: btoa(String.fromCharCode(...new Uint8Array(bits))),
    salt: btoa(String.fromCharCode(...s))
  };
}

async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  const salt = Uint8Array.from(atob(storedSalt), c => c.charCodeAt(0));
  const { hash } = await hashPassword(password, salt);
  return hash === storedHash;
}
```

- API Key 也使用 `crypto.subtle.encrypt`（AES-GCM）加密后存入 IndexedDB
- 明文仅保留在内存 Zustand store 中，不落盘

### 2.3 注册流程 (Register)

- **UI**：注册卡片，包含用户名、密码、确认密码、**DeepSeek API Key（输入框类型为 password，带"显示/隐藏"切换）**。
- **前置校验（已修正）**：点击注册时，**先调用后端 `key:validate` 验证 Key 有效性**，通过后才允许提交注册表单。避免用户填了两遍表单才知道 Key 无效。
- **存储**：验证通过后，PBKDF2 哈希密码 + AES-GCM 加密 API Key，存入 IndexedDB。自动跳转登录。

### 2.4 登录流程 (Login)

- **UI**：登录卡片（用户名 + 密码）。
- **逻辑**：比对 IndexedDB 中 `passwordHash`。成功后，AES-GCM 解密 `apiKey`，存入内存 Zustand store。用户无需二次输入 Key。

### 2.5 余额不足 & API 报错处理（关键交互）

当调用 DeepSeek 返回 **402 Payment Required** 或 **Insufficient Balance** 错误时：

1. **界面反馈**：聊天输入框上方弹出**警告横幅（Banner）**。
2. **文案与跳转**：横幅文案为 `⚠️ DeepSeek 账户余额不足，请前往平台充值后继续对话。`，"前往平台充值"为可点击超链接，通过 `shell.openExternal` 跳转 `https://platform.deepseek.com/api_keys`。
3. **交互保留**：仅禁止发送新消息，历史聊天记录依然可查看。

### 2.6 设置页面 — API Key 管理

在设置页面（Phase 5）中提供：

| 功能 | 说明 |
| :--- | :--- |
| **查看 Key** | 脱敏显示（如 `sk-****xxxx`） |
| **更换 Key** | 重新输入 → `key:validate` 验证 → AES-GCM 重新加密存储 → 更新内存 Zustand |
| **注销账号** | 二次确认后清除 IndexedDB 中该用户及相关数据 |

---

## 3. 界面 UI 定义

### 3.1 配色方案

| 角色 | 色值 | 用途 |
| :--- | :--- | :--- |
| 主色（基因紫） | `#6C5CE7` | 主按钮、选中态、Logo 主色、用户消息气泡 |
| 辅色（生命青） | `#00CEC9` | 强调文字、链接、加载动画、AI 消息气泡点缀 |
| 毛玻璃 | `backdrop-blur-2xl` + 半透明网格 | 所有卡片，背景叠加微弱 DNA 螺旋水印 |

### 3.2 Logo 与品牌露出

- 侧边栏顶部放置 **"VirtuGene"** 文字 Logo，字母 `G` 和 `E` 设计成双螺旋拼接感（CSS 或 SVG）。
- Splash Screen：基因链条旋转的 Loading 动画 + 口号 "Unlock Your Digital Soul"。

### 3.3 原生软件感

- `frameless: true` + 自定义 TitleBar（最小化/最大化/关闭按钮，拖拽区域 `-webkit-app-region: drag`）
- 屏蔽浏览器默认右键菜单，使用自定义上下文菜单
- 深色/浅色模式切换开关（左下角侧边栏底部）

### 3.4 界面布局拓扑

```
┌─────────────────────────────────────────────────┐
│ TitleBar     VirtuGene    ─  □  ✕              │
├──────────┬──────────────────────────────────────┤
│ Sidebar  │ Content Area                         │
│          │                                      │
│ 👤 角色1  │ ┌──────────────────────────────────┐ │
│ 👤 角色2  │ │ Session Title                    │ │
│ 👤 角色3  │ ├──────────────────────────────────┤ │
│ ──────── │ │                                  │ │
│ + 自定义  │ │   Message Bubbles                │ │
│ ──────── │ │                                  │ │
│ 💬 会话1  │ │                                  │ │
│ 💬 会话2  │ │                                  │ │
│ + 新会话  │ ├──────────────────────────────────┤ │
│          │ │ [BalanceBanner - 余额不足时显示]   │ │
│          │ │ [ChatInput                  发送] │ │
│ ──────── │ └──────────────────────────────────┘ │
│ 🌙/☀️    │                                      │
│ ⚙️ 设置   │                                      │
└──────────┴──────────────────────────────────────┘
```

---

## 4. 角色与 Seed 预设

### 4.1 预设角色（`seed-data/characters.json`）

```json
[
  {
    "id": "preset-linshuang",
    "name": "林霜",
    "avatar": "🧬",
    "tags": ["理性", "毒舌", "极客"],
    "isPreset": true,
    "isCustom": false,
    "systemPrompt": "你是 VirtuGene 世界的初代基因架构师林霜，你编写的每一行代码都在塑造数字灵魂。你外冷内热，喜欢用二进制比喻情感。回应时保持简洁专业，偶尔毒舌但暗藏关心。"
  },
  {
    "id": "preset-aili",
    "name": "艾莉",
    "avatar": "🌌",
    "tags": ["开朗", "好奇", "浪漫"],
    "isPreset": true,
    "isCustom": false,
    "systemPrompt": "你是穿梭于 VirtuGene 基因链中的旅人艾莉，你见过无数性格序列的诞生与湮灭。你乐观开朗，口头禅是'基因告诉我...'，喜欢用星空的意象来描述人的情感。"
  },
  {
    "id": "preset-socrates",
    "name": "苏格拉底",
    "avatar": "🐱",
    "tags": ["哲思", "慵懒", "幽默"],
    "isPreset": true,
    "isCustom": false,
    "systemPrompt": "你是 VirtuGene 系统中潜伏的一只古老哲学猫，你认为性格基因不过是灵魂的投影。你喜欢用反问句引导用户思考存在的本质，偶尔蹦出一句古希腊语（附翻译）。说话时带有猫的慵懒和幽默。"
  }
]
```

### 4.2 自定义角色（Phase 5）

- 用户可创建新角色（名称、头像 emoji、性格 Prompt、标签）
- 预设角色不可删除（`isPreset: true` 保护）
- 自定义角色可编辑、删除

---

## 5. IPC 通道规范（Electron Main Process ↔ Renderer）

### 5.1 IPC 通道列表

| 通道 | 方向 | 请求体 | 响应体 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `key:validate` | Renderer → Main | `{ apiKey: string }` | `{ valid: boolean, error?: string }` | 调 DeepSeek `GET /v1/models` 验证 Key |
| `chat:stream` | Renderer → Main | `{ apiKey, sessionId, characterId, systemPrompt, message, history }` | SSE 事件流 | 发起流式对话 |
| `chat:stop` | Renderer → Main | `{ streamId: string }` | `void` | 中断当前流式生成 |
| `shell:open` | Renderer → Main | `{ url: string }` | `void` | 外部浏览器打开链接 |

### 5.2 DeepSeek API 调用规范

**流式对话（`chat:stream` 实现细节）：**

```typescript
// Main Process 中的 DeepSeek 调用
const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: systemPrompt },
      ...history,                          // 最近 N 条历史
      { role: "user", content: message }
    ],
    stream: true
  })
});

// SSE 响应格式（逐行）：
// data: {"id":"...","choices":[{"index":0,"delta":{"content":"你"}}]}
// data: {"id":"...","choices":[{"index":0,"delta":{"content":"好"}}]}
// data: {"id":"...","choices":[{"index":0,"delta":{"content":null},"finish_reason":"stop"}]}
// data: [DONE]
```

### 5.3 错误码映射

| DeepSeek HTTP 状态码 | IPC 错误类型 | 前端行为 |
| :--- | :--- | :--- |
| 200 + stream | — | 正常流式渲染 |
| 401 | `auth:invalid_key` | 提示"API Key 无效，请前往设置页面更新" |
| 402 | `billing:insufficient` | 显示 BalanceBanner，带跳转链接 |
| 429 | `rate:limited` | 提示"请求过于频繁，请稍后重试" |
| 5xx | `server:error` | 提示"基因链接中断，请重试" |

### 5.4 历史上下文配置

| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| 发送历史条数 | 20 条（10 轮对话） | `history` 数组中取最近消息，避免 token 超限 |
| 前端展示 | 全量（虚拟滚动） | 无分页，按需加载渲染 |

---

## 6. 项目文件结构

```text
virtugene/
├── CLAUDE.md                       # 本计划书
├── package.json                    # 根配置
│
├── electron/                       # Electron 主进程
│   ├── main.ts                     # 入口：窗口创建 + IPC 注册
│   ├── preload.ts                  # contextBridge 暴露安全 API
│   ├── ipc/
│   │   ├── chat.ts                 # chat:stream / chat:stop
│   │   ├── key.ts                  # key:validate
│   │   └── shell.ts               # shell:open
│   └── services/
│       └── deepseek.ts            # DeepSeek API 调用封装（SSE 解析）
│
├── frontend/                       # React + Vite (Renderer)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── assets/
│       │   ├── logo.svg
│       │   └── dna-bg.svg
│       ├── components/
│       │   ├── ui/                # Button, Input, Card, Modal, ContextMenu
│       │   ├── layout/
│       │   │   ├── TitleBar.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   └── MainLayout.tsx
│       │   ├── auth/
│       │   │   ├── LoginCard.tsx
│       │   │   ├── RegisterCard.tsx
│       │   │   └── AuthGuard.tsx
│       │   ├── chat/
│       │   │   ├── ChatWindow.tsx
│       │   │   ├── MessageBubble.tsx
│       │   │   ├── ChatInput.tsx
│       │   │   └── BalanceBanner.tsx
│       │   ├── settings/
│       │   │   └── SettingsPanel.tsx    # Key 管理 + 注销
│       │   ├── character/
│       │   │   ├── CharacterList.tsx
│       │   │   └── CharacterEditor.tsx  # 自定义角色创建/编辑
│       │   └── splash/
│       │       └── SplashScreen.tsx
│       ├── db/
│       │   ├── index.ts           # Dexie 实例 + 表定义
│       │   ├── user-repo.ts
│       │   ├── character-repo.ts
│       │   ├── session-repo.ts
│       │   └── message-repo.ts
│       ├── store/
│       │   ├── auth-store.ts      # Zustand persist（用户 + Key 内存态）
│       │   ├── chat-store.ts      # 当前会话/角色/消息
│       │   └── theme-store.ts
│       ├── hooks/
│       │   ├── useChat.ts
│       │   └── useStreamChat.ts   # IPC 流式聊天 hook
│       ├── pages/
│       │   ├── SplashPage.tsx
│       │   ├── AuthPage.tsx
│       │   └── ChatPage.tsx
│       ├── lib/
│       │   ├── crypto.ts          # PBKDF2 哈希 + AES-GCM 加解密
│       │   └── ipc-client.ts      # Renderer 侧 IPC 调用封装
│       └── styles/
│           └── globals.css
│
├── seed-data/
│   └── characters.json            # 3 个预设角色
│
├── resources/                      # 打包资源
│   └── icons/                      # 应用图标（ico / icns / png）
│
└── electron-builder.yml            # electron-builder 打包配置
```

---

## 7. 开发阶段（Phase 1 ~ 6）

请按此顺序执行，每完成一个 Phase 停下来让我测试。

### Phase 1: 基建 + 注册/登录（带 API Key）

- [ ] 初始化项目：根 `package.json`、`frontend/`（Vite + React + TS + Tailwind）、`electron/`（TS + Electron）
- [ ] Electron 主进程骨架：窗口创建、`frameless: true`、preload 脚本
- [ ] 前端 IndexedDB 初始化（Dexie.js）：User 表、密码哈希工具（PBKDF2）
- [ ] 实现 `key:validate` IPC 通道（调 DeepSeek `GET /v1/models`）
- [ ] 实现注册页面（含 API Key 输入框 + 显示/隐藏切换 + 提交前 Key 验证）
- [ ] 实现登录页面
- [ ] 实现 AuthGuard 登录态守卫
- [ ] 完成 Zustand auth-store（用户名 + Key 内存态，`zustand/persist` 持久化登录态）

**验收标准**：
- 注册时 Key 无效则当场拒绝，不进入表单提交
- 注册成功后重启应用，仅凭用户名密码能成功登录并加载该账号的 Key
- 密码以 PBKDF2 哈希存储，API Key 以 AES-GCM 加密存储

---

### Phase 2: 品牌主布局与侧边栏

- [ ] 实现 `MainLayout`（TitleBar + Sidebar + 内容区）
- [ ] 实现自定义 TitleBar（无边框窗口、拖拽区域 `-webkit-app-region: drag`、最小化/最大化/关闭）
- [ ] 侧边栏左上角显示 "VirtuGene" Logo（含 DNA 元素）
- [ ] 深色/浅色模式切换开关（左下角侧边栏底部）
- [ ] 首次启动时从 `seed-data/characters.json` 导入预设角色到 IndexedDB
- [ ] 实现角色列表（头像、名称、标签），侧边栏渲染

**验收标准**：
- 主布局品牌感强烈，配色严格遵循 `#6C5CE7` / `#00CEC9`
- 窗口可拖拽、最小化、最大化、关闭正常
- 暗色/亮色切换正常

---

### Phase 3: 会话管理 + 聊天窗口 + 消息存储

- [ ] 实现 Session 数据模型，IndexedDB session-repo
- [ ] 侧边栏角色下方显示该角色的会话列表（按时间倒序）
- [ ] 新建会话按钮、会话重命名、会话删除
- [ ] 实现 `ChatWindow`（消息列表 + 自动滚底）
- [ ] 实现 `MessageBubble`（用户紫色，AI 灰色 + 青色点缀）
- [ ] 实现 `ChatInput`（发送按钮 + Enter 发送 + Shift+Enter 换行）
- [ ] 实现 IndexedDB 消息存储与按 sessionId 查询
- [ ] 点击侧边栏会话切换聊天上下文，历史消息自动恢复

**验收标准**：
- 多会话随意切换，消息隔离正确
- 刷新后会话列表和历史消息依然存在
- 消息气泡样式符合品牌调性

---

### Phase 4: AI 流式对话 + 完整错误处理

- [ ] 实现 Main Process 中 `chat:stream` IPC（SSE 流式转发 DeepSeek）
- [ ] 实现 `chat:stop` 中断流式生成（AbortController）
- [ ] 前端 `useStreamChat` hook：打字机效果渲染 + 错误捕获
- [ ] 实现 `BalanceBanner` 组件（402 余额不足）
- [ ] 实现全部错误码映射（401 / 402 / 429 / 5xx）+ 对应 UI 反馈
- [ ] Banner 出现时禁用输入框，历史消息仍可查看

**验收标准**：
- 有效 Key → 打字机效果流式输出，对话流畅自然
- 无效 Key（401）→ 提示"API Key 无效，请前往设置页面更新"
- 余额不足（402）→ 横幅正确显示，"前往平台充值"通过 `shell.openExternal` 打开官网
- 频繁请求（429）→ 提示"请求过于频繁，请稍后重试"
- 服务端错误（5xx）→ 提示"基因链接中断，请重试"

---

### Phase 5: 设置页面 + Key 管理 + 自定义角色

- [ ] 实现设置按钮入口（侧边栏左下角齿轮图标）
- [ ] 实现 `SettingsPanel`：查看 Key（脱敏 `sk-****xxxx`）、更换 Key（验证后更新）、注销账号
- [ ] 实现 `CharacterEditor`：创建/编辑自定义角色（名称、头像 emoji、Prompt、标签）
- [ ] 角色列表区分预设（带标识）和自定义（可编辑/删除），预设角色不可删除
- [ ] 用户注销后清除该用户 IndexedDB 数据，返回注册页

**验收标准**：
- 更换 Key 后旧 Key 被覆盖，下次对话使用新 Key
- 新建的自定义角色出现在侧边栏，可正常对话
- 删除自定义角色时关联会话和消息一并清理
- 注销后数据清除干净，重新注册无残留

---

### Phase 6: 桌面化打磨（打包成真实软件）

- [ ] 配置 `electron-builder.yml`（Windows NSIS / macOS DMG）
- [ ] 配置应用图标（ico / icns / png 多尺寸）
- [ ] 实现 Splash 基因动画（首次启动 / 冷启动时展示，口号 "Unlock Your Digital Soul"）
- [ ] 自定义右键菜单（屏蔽浏览器默认菜单）
- [ ] 打包脚本：`npm run build` + `npm run electron:build`
- [ ] 生成 `.exe`（Windows）或 `.dmg`（macOS）安装包
- [ ] 最终 UI 走查：确保无浏览器痕迹（地址栏、F5 刷新、右键菜单等）

**验收标准**：
- 双击软件图标独立运行，无浏览器地址栏
- 启动时 Splash 动画流畅，品牌口号可见
- 窗口拖拽、最小化、最大化、关闭均正常
- 安装包可正常安装和卸载

---

## 8. 配色与 CSS 变量

```css
:root {
  /* 品牌主色 */
  --color-gene-purple: #6C5CE7;
  --color-life-cyan: #00CEC9;

  /* 浅色模式 */
  --bg-primary: #FFFFFF;
  --bg-secondary: #F8F7FF;
  --bg-glass: rgba(255, 255, 255, 0.6);
  --text-primary: #1A1A2E;
  --text-secondary: #6B7280;
  --msg-user: #6C5CE7;
  --msg-user-text: #FFFFFF;
  --msg-ai: #F3F4F6;
  --msg-ai-accent: #00CEC9;
  --border-color: #E5E7EB;
}

.dark {
  --bg-primary: #0F0F1A;
  --bg-secondary: #1A1A2E;
  --bg-glass: rgba(15, 15, 26, 0.7);
  --text-primary: #F0EDFF;
  --text-secondary: #9CA3AF;
  --msg-user: #7C6FF7;
  --msg-user-text: #FFFFFF;
  --msg-ai: #1E1E36;
  --msg-ai-accent: #00CEC9;
  --border-color: #2A2A4A;
}
```

---

## 9. 品牌文案规范

| 场景 | 文案 | 禁止文案 |
| :--- | :--- | :--- |
| 欢迎语 | "解锁你的数字灵魂" | "欢迎使用" |
| 注册 CTA | "播种你的基因序列" | "注册账号" |
| 登录 CTA | "唤醒数字灵魂" | "登录" |
| 空会话 | "尚无基因序列，选择角色创建会话吧" | "暂无数据" |
| 加载中 | "正在唤醒数字灵魂..." | "加载中..." |
| 网络错误 | "基因链接中断，请重试" | "请求失败" |
| 401 错误 | "基因序列验证失败，请检查 API Key" | "401 Unauthorized" |
| 402 错误 | "⚠️ DeepSeek 账户余额不足，请前往平台充值后继续对话。" | "402 Payment Required" |
| 成功提示 | "性格基因已就绪" | "操作成功" |
| 退出确认 | "断开灵魂链接？" | "确定退出？" |
| 删除确认 | "这段基因序列将被永久抹除" | "确定删除？" |
| 新建角色 | "培育新的数字灵魂" | "创建角色" |

---

## 10. 注意事项与约束

1. **安全性**：API Key 仅存于用户本地 IndexedDB（AES-GCM 加密），后端/主进程中不做任何持久化。代码中绝不硬编码任何 API Key。
2. **离线能力**：无网络时，用户仍可查看历史聊天记录和会话列表。仅发送新消息和验证 Key 需要网络。
3. **性能**：聊天消息列表需虚拟滚动（超过 200 条消息时，使用 `@tanstack/react-virtual`）。
4. **兼容性**：目标平台 Windows 10+ 和 macOS 11+。
5. **包体大小**：Electron 打包后 < 150MB。
6. **初版不做多用户同时登录**：同一时间仅一个用户登录。切换用户需注销后重新登录。

---

*本计划书为 VirtuGene 项目的唯一权威文档，所有开发决策以此为准。*
