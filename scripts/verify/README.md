# VirtuGene 5.0.0 验收脚本（Phase 1 / 2a / 2b-0 … 2b-6 / Phase 3 / 3b / 3c / Living World A–E）

2026-10-03 失败回执复核收尾：1187项助理数据 + 152项实际界面，以及185项相关回归通过，共1524项（包含此前1498项及新增26项）。新增重试中断更新旧气泡、编辑原消息后的持久停止反馈、回执身份保护、导入事务失败回滚和并发删除会话检查。原有缺失会话校验保留，强化原子性。类型检查、生产构建通过；模型与通知边界使用替身。说明见 `docs/ASSISTANT-FAILURE-RECEIPT-FOLLOWUP-2026-10-03.md`，复跑命令与下条相同。

2026-10-03 全链路报告整改：1164项助理数据 + 149项界面，以及185项相关回归通过，共1498项。新增83项数据与5项界面，覆盖跨年/月末/闰日重复、创建重复提醒的未来实例、空星期数组、引号授权和补问接续、重复字段定位、无关焦点的重试/重开恢复、失败原因持久展示与安全导入，以及实际待办页日期编辑。类型检查、生产构建通过；未执行真实模型和Android真机验收。说明见 `docs/ASSISTANT-CHAIN-BUG-FIX-2026-10-03.md`。先构建生产前端和 `node scripts/verify/build-secretary.mjs --with-regressions`，再运行 `node scripts/verify/run-secretary.cjs` 与 `node scripts/verify/run-secretary-regressions.cjs secretary-memory character-create moments memory-unified`。

2026-10-03 助理评审整改：1050项数据 + 139项界面；助理记忆76项 + 窄屏4项；界面精修21项；角色创建19项、朋友圈40项、统一记忆46项、记忆注意力64项，共1459项通过。新增共享授权规则、150项固定中文授权语料、V2原话依据强制校验、批量读取/单轮提醒合并、保留记忆的轻量闲聊，以及直接和派生日记来源的收件箱/召回/执行保护。完整实现、兼容说明和多设备未闭合边界见 `docs/ASSISTANT-REVIEW-REMEDIATION-2026-10-03.md`。真实模型工具 `node scripts/eval/run-assistant-live.cjs` 默认零联网；显式 `--live` 才运行60项合成账号样本，配置和门槛见上述文档，尚未执行真实模型评测。

在**真实浏览器 + 真实 IndexedDB**（多数套件还加上**真实渲染组件**与**真实业务流程**）上验证 5.0 的每一项声称。
不是模拟、不是 mock：Phase 1 与 worldE 会先用 **旧的 v15 / v17 schema** 建库写入旧形态数据，
再用应用真实的 `db`（v25）打开，从而触发 Dexie 真实的升级与幂等迁移。

## 运行（推荐：一键全量回归）

来消息通知 UI（2026-10-03）：生产构建后执行 `node scripts/verify/run-notification-ui.cjs`。47 项真实 NotificationCloud 检查覆盖深浅色、两行预览、48px 关闭按钮、320–1024px、真实触摸上扫/回弹、动画接管、逐帧零 React 提交、进入会话路由、键盘/Escape、独立计时、按住/悬停/焦点暂停、账号清理、堆叠补位和减少动态效果。自建并关闭隔离服务，不访问实际账号或发出系统通知。截图位于 `.tmp-preview/notification-ui-20261003/`，说明见 `docs/NOTIFICATION-UI-2026-10-03.md`。

流式气泡 UI（2026-10-03）：生产构建后执行 `node scripts/verify/chat-stream-ui.mjs`。49 项真实 ChatWindow / MessageBubble 检查覆盖共享等待/首字气泡、单个正文末尾光标、追加不重播动画、预览转正式气泡的位置与尺寸、语音文字保留、发送/停止按钮复用与触点、历史阅读、320–1024px、深浅色、桌面动作恢复及系统/应用减少动态效果。新增逐帧滚动、无逐帧 React 提交、触摸接管、键盘焦点/Escape、返回按钮退出交互范围、生成结束时的落点追踪与动画变换释放检查。隔离服务使用模拟 SSE，不调用付费模型；截图保存在 `.tmp-preview/chat-stream-ui/`。说明见 `docs/CHAT-STREAM-UI-2026-10-03.md`。

私聊流式输出（2026-10-03）：先构建生产前端，再执行 `npm run verify:chat-stream`（需要含 Playwright 的测试运行环境，Codex 内置 Node 可用）。44 项真实浏览器、组件和 IndexedDB 检查覆盖首字显示、片段合并、停止、断流、重试、会话/账号切换、长回复滚动及 320–430px 布局。脚本自建并关闭临时服务，模型边界使用测试响应；不访问用户的实际数据库。范围及额外旧套件差异见 `docs/CHAT-STREAMING-2026-10-03.md`。

模型接入与整体精修（2026-10-02）：`node scripts/verify/providers.mjs` 验证 310 项协议和真实辅助功能路由；生产构建后运行 `node scripts/verify/build-models-ui.mjs` / `node scripts/verify/run-models-ui.cjs` 验证 66 项服务商配置界面。`node scripts/verify/run-motion-preferences.cjs` 验证真实减少动态效果开关、持久化和正在运行的动画取消。Vite 预览启动后，`node scripts/verify/run-api-onboarding.cjs` 在隔离浏览器内验证无 DeepSeek 密钥注册、本地模型选择、重启登录和主密钥替换；默认连接 5173，也可通过 `VG_APP_URL` 指定预览地址。所有模型请求使用测试响应，完整范围见 `docs/UI-API-REFINEMENT-2026-10-02.md`。

七种交互专项（2026-10-02）：生产构建后执行 `node scripts/verify/run-advanced-interactions.cjs`，脚本自建并关闭隔离服务。26 项检查覆盖滑出取消、边缘返回撤回、动画接管、局部数字过渡、字号落点与边界、大图方向锁定及下拉关闭。落地场景与平台边界见 `docs/ADVANCED-INTERACTIONS-2026-10-02.md`。

动画精修专项（2026-10-02）：`node scripts/verify/run-modal-motion.cjs`、`node scripts/verify/run-page-motion.cjs`、`node scripts/verify/run-secretary-disclosure.cjs` 使用独立临时服务；设置/助理真实页面动画先构建对应 fixture 并启动 17899 服务，再运行 `run-settings-motion.cjs` / `run-secretary-motion.cjs`。覆盖快速反向、逐帧手势交接、弹窗遮罩衔接、滚动保持、动态尺寸和减少动态效果。实施与限制见 `docs/MOBILE-MOTION-POLISH-2026-10-02.md`。

设置界面专项（2026-10-02）：生产构建后运行 `node scripts/verify/build-settings-ui.mjs`，启动 `node scripts/verify/serve.cjs`，再运行 `node scripts/verify/run-settings-ui.cjs`。55 项检查覆盖真实主题/字号/语音/模型/提醒状态、搜索返回、嵌套窗口、固定保存区、320–430px 和短视口、减少动态效果。截图与结果位于 `.tmp-preview/settings-ui-20261002/`；范围和边界见 `docs/SETTINGS-IMPLEMENTATION-2026-10-02.md`。

```powershell
$env:PATH = "C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64;$env:PATH"
cd F:\VirtuGene-Mobile

# 0) worldD 会验证**真实布局**（滚动容器是否可滚、内容会不会被强拉到底部），
#    因此需要先构建一次真实 CSS（build.mjs 会把它复制成 scripts/verify/verify.css）
& .\node_modules\.bin\vite.cmd build

# 1) 打包全部验收脚本（统一走 build.mjs，它会补上 iife 产物缺少的
#    import.meta.env 与 __APP_VERSION__）
node scripts\verify\build.mjs

# 2) 起一个临时静态服务器（结果打到 stdout，同时按套件落到 .last-result-<suite>.txt）
node scripts\verify\serve.cjs      # 监听 127.0.0.1:17899

# 3) 一键跑完 23 套（每套一个**全新 user-data-dir**：迁移类套件必须从零开始）
powershell -ExecutionPolicy Bypass -File scripts\verify\run-all.ps1
#    只跑几套： -Suites worldA,worldD
#    单套手跑：用无头 Chrome 打开 http://127.0.0.1:17899/worldA.html
```

朋友圈验收还包括 `moments.html`（既有界面与设置 33 项）和
`moments-autonomous.html`（主动发帖、并发幂等、私密隔离、账号隔离、清理与无效模型输出 13 项）。
两套使用真实 IndexedDB；主动发帖套件只把模型 HTTP 边界替换为固定响应。

> `run-all.ps1` 必须保存为 **UTF-8 with BOM**（Windows PowerShell 5.1 否则会把中文注释读成乱码而语法报错）。
> `serve.cjs` 会把 `.css` 以 `text/css` 返回——否则 Chrome 会拒绝应用样式表，worldD 的布局断言会失去意义。

## 覆盖范围

各套件的**实际断言条数**（以脚本打印的 `ok/FAIL` 行为准，均由 `ALL PASS` 全绿）：

| 套件 | 页面 | 断言数 |
|---|---|---|
| Phase 1 数据层升级迁移（v15 → v25） | `index.html` | 83 |
| Phase 2a 世界入口 + 外壳回归 | `phase2a.html` | 48 |
| Phase 2b-0 最小闭环（结算 → 世界事件） | `phase2b0.html` | 43 |
| Phase 2b-1 世界首页接真实内容 | `phase2b1.html` | 32 |
| Phase 2b-2 收藏为共同记忆（含隐私边界回归） | `phase2b2.html` | 77 |
| Phase 2b-3 让角色说得出来（共同记忆进入上下文） | `phase2b3.html` | 45 |
| Phase 2b-4 我的生活三级可见性 + R6 收口（含审核 P1/P2 回归） | `phase2b4.html` | 86 |
| Phase 2b-5 关系网络可解释化（2B） | `phase2b5.html` | 48 |
| Phase 2b-6 R7 裁定：关系数值的唯一来源 | `phase2b6.html` | 30 |
| Phase 3 世界舞台（Scene Director） | `phase3.html` | 72 |
| Phase 3b 舞台后果进入私聊上下文（闭环） | `phase3b.html` | 35 |
| Phase 3c 幕次与选择分支 | `phase3c.html` | 44 |
| **Living World A 意图理解与自由度**（§12–§16 / §95 / §96） | `worldA.html` | 59 |
| **Living World B 多智能体与知识隔离**（§18–§27 / §40 / §97 / §98） | `worldB.html` | 44 |
| **Living World C 结算 / 设定 / 时间线 / 关系 / 隐私 / 撤销**（§28–§46 / §100–§103） | `worldC.html` | 57 |
| **Living World D 世界空间 UI**（§5–§12 / §37 / §66–§70 / §78） | `worldD.html` | 43 |
| **Living World E 失败恢复 / 解析兼容 / 性能 / 迁移**（§51–§55 / §63 / §104 / §106 / §107） | `worldE.html` | 62 |
| **合计** | | **908** |

> 计数口径说明：更早的 2b-0 报告里写的"38 项"与本 README 曾经的"32/44 项"是当时的粗略标签，
> 与脚本实际打印的行数不一致；此处以**实际打印行数**为准（2b-2 报告 §8 已披露这次更正）。
> Living World 落地时，Phase 2a / 2b-0 / 2b-1 / 2b-2 / 2b-4 / Phase 3 的部分断言**随 UI 重做而更新**
> （例如"世界剧场"一级入口按 §77 退出主 UI），逐条差异记在《5.0.0-LIVING-WORLD-FINAL.md》第 21 节。

### Cross-channel character-memory regression

These suites use real IndexedDB and verify scoped recall, listener isolation, revocation, and stale-backup protection. LLM boundaries are replaced by test fixtures; the suites make no network requests.

| Suite | Coverage | Assertions |
|---|---|---:|
| `character-memory.html` | private/group chat, per-actor group generation and disclosure boundaries, Moments, diary participant privacy, todos, world recall, durable extraction, source revision/revocation, claim-source edge granularity, undo, account boundaries, stale backups, spoken-only cooldown, multi-source survival, pinned summary cleanup across private chat and world, private-life recall in one-character world, memory-driven summary invalidation, session deletion cleanup, safe correction matching, per-character world memory and privacy boundary | 139 |
| `memory-continuity.html` | the six cross-mode acceptance scenarios: private→world/group recall with other-actor isolation, older in-progress scene segments retrieved by keyword, seen vs unseen Moments, diary grant/revoke plus the shared-layer diary leak guard, correction/deletion across all modes, long-conversation compression with spoken-memory cooldown, shared-story and block-state stale-backup guards, knowledge-revision restore, account deletion clearing the ledger | 63 |
| `worldG.html` | world state and undo regression | 13 |
| `moments.html` | Moments visibility and interaction | 39 |
| `moments-autonomous.html` | autonomous posts/comments, per-character memory context, public disclosure review, isolation and retries | 14 |

> **出场状态语义（5.2.3 起）**：`entryMemoryMode` 只决定"这场戏的正文从哪开始"，
> 不再决定"这个人记得什么"。
> - `memory`（默认）：带上这段经历与自己的全部过往。
> - `present`：**从此刻开始参与** —— 不继承入场前的本场正文，但仍保有自己的私聊、群聊、
>   日记授权与既有经历（以前它会压掉这些，让同一个角色换个入口就像换了一个人）。
> - `amnesiac`：明确标注的失忆玩法，才连带压掉他自己的过往记忆。
>
> 三个入口（`world-context.ts` / `scene-runtime.ts` / 记忆引用校验）共用
> `world-scene-repo.ts` 的 `participantReadsEntry` 单一判据（按 `enteredAt` 时间戳，
> 不再依赖写入当刻的 `witnessedBy` 快照——那个快照天然包含入场后加入的角色）。

> **已由新套件取代的旧断言**：`phase2a` / `phase2b0` / `phase2b1` / `phase2b2` / `phase3` / `phase3c`
> 是**世界 IA 改版前**的旧验收（世界页文案、旧舞台分支），当前仍是 FAIL；
> 它们要守的行为已由 `worldG`（世界状态与撤销）与 `worldD`（世界空间 UI）覆盖。
> 运行全量前请先看这两组的状态，不要把旧断言的红当成记忆系统回归。

### Living World A–E：公共装置

`world-harness.ts` 提供三样东西，5 套验收共用（避免各写一份而漂移）：

| 装置 | 作用 |
|---|---|
| `installFakeLlm()` | 同时提供**注入式 caller**（单元级，可断言 prompt 内容与调用次数）与**假 HTTP 端点**（`window.fetch` 上的 `chat/completions`，用于走真实 UI 路径），并统计"不该联网"的请求数 |
| `mount / unmount / typeInto / pressEnter` | 真实 React 挂载与真实输入事件（绕过受控组件的 value 缓存） |
| `setDelay(ms)` | 给假 LLM 加人为延迟，用来复现"用户正在向上翻阅时新内容才姗姗来迟"的真实时序（§70） |

### Phase 1：数据层升级迁移

| 验收 | 内容 |
|---|---|
| 1 | 旧数据零丢失：11 张旧表逐表比对行数与**主键集合**完全一致 |
| 2 | 派生数量正确：生命轨迹 / 未完成事件 / 人物共同事件 → 世界事件、认知、关系状态、关系史 |
| 3 | 迁移幂等：重复迁移行数不变、created 全 0、skipped > 0 |
| 4 | 跨用户隔离 |
| 5 | 旧日记一律 `private`，且没有任何角色能看到、没有派生世界事件 |
| 6 | 按角色 / 按对查询（认知、关系史、canMention） |
| 7 | `tsc --noEmit` 与 `vite build`（由命令行单独执行，报告里给出结果） |
| 8 | World 隔离：两个世界的事件 / 共同记忆 / 场景互不可见，清空其一不影响另一 |
| 9 | 关系状态读写：用户↔角色、角色↔角色、按角色反查 |
| 10 | RelationshipEvent → State 同事务更新、零增量不记录、重放幂等、非法输入回滚 |
| 11 | WorldEvent 类型正确（continuity 不得变成 stage；interaction 不得变成 stage） |
| 12 | `selected` 可见性靠 `visibleTo` 限制；且"被允许知道"≠"已经知道"（§62 教授后才获得认知） |
| 附加 | 场景正文独立存储 / SceneState 结构化 / 场景不写入 sessions·messages / 角色删除的四条清理规则 |

### Phase 2a：世界入口 + 外壳回归（`phase2a.html`）

| 组 | 内容 |
|---|---|
| A | 底部一级导航 = 消息｜世界｜角色｜我的（4 个，无手账 tab） |
| B | 真实空状态：真实用户名问候、弱化统计、空状态文案与两个真实动作、**不承诺尚未实现的自动记录** |
| C | 「写下今天」真的打开我的生活（activeView=diary） |
| D | 世界有真实数据：空状态消失、事件计数、最近发生、类型标签、共同记忆区块；**未结束的未完成事项不在「最近发生」重复**（断言限定在区块自己的列表内） |
| D2 | **只有共同记忆**时不再自相矛盾（不出现"已经记下了 0 件事"+空区块） |
| D3 | **读取失败**给出错误态与重试（不是"空世界"），故障注入验证 |
| E | 新建日记默认 `private`，任何角色看不到 |
| F | 外壳回归：四个一级 tab 逐个切换、手账覆盖页导航常驻+高亮世界+可退出、零未捕获错误 |

### Phase 2b-0：最小闭环（`phase2b0.html`）

在**真实结算流程**（`emotionStore.settle`）上跑，只把 LLM 边界打桩，因此不联网，并统计调用次数。

| 组 | 内容 |
|---|---|
| A | 既有结算提取到「约定」→ 世界事件（continuity）+ 该角色认知；普通互动与「记住」**都不写**世界层 |
| B | 关系等阶升级 → 世界事件（relationship，重要度 0.7） |
| C | 普通闲聊（无约定无升级）→ 不写世界层，但 4.x 记忆/生命轨迹照常 |
| D | 同一件约定再次被提起 → 幂等，不产生重复事件 |
| E | 完成未完成事项 → 同一条事件 `resolved` 变 true；编辑标题 → 同步更新 |
| F | **端到端：世界页真的显示这条事件**（新用户聊天后世界不再是空的） |
| G | 删除未完成事件 / 删除角色 → 派生事件一并移除，不留孤儿 |
| H | **全程 AI 调用次数 = 结算次数，零新增调用** |

### Phase 2b-1：世界首页接真实内容（`phase2b1.html`）

| 组 | 内容 |
|---|---|
| P | 纯函数挑选规则：逾期 > 临近 > 最近提起；没有就返回 null；相对时间 4 档 |
| A | 「正在等待你的故事」大卡：真实挑选结果 + 参与者 + 类别 + 真实细节 + 真实动作 |
| B | 「继续这件事」真的进入与该角色的聊天（选中角色 + 切「消息」tab + 推入语义） |
| C | 「未完成的故事」列出**其余**线索；点进去复用 4.x 既有面板 |
| D | 「最近发生」人话类别 + 相对时间，且不暴露任何内部数值 |
| E | 没有等着继续的事时大卡整块隐藏（不放假内容） |
| G | 只有一条线索时「未完成的故事」区块整块隐藏（审核发现的展示瑕疵的回归） |
| F | 世界页全程 AI 调用 = 0 |

### Phase 2b-2：收藏为共同记忆（`phase2b2.html`）

`sharedMemories` 的第一个生产写入路径。用 `window.fetch` 打点：**任何一次联网都算失败**。

| 组 | 内容 |
|---|---|
| P | `splitForMemory` 纯函数：标题截断 / 正文不丢不重 / 多行 / 空白归一化 |
| A | 一个动作写三处（记忆 + `shared_memory` 事件 + 认知），同一事务、幂等 id、零网络 |
| B | 重复收藏不产生第二行；按来源查询支持"已收藏"态 |
| C | 认知边界：另一角色仍不知道；可见性 `selected` 只给该角色 |
| D | 与 4.x 分工：**不写** `memories`、不改消息、不加生命轨迹 |
| E | 世界页端到端：共同记忆区块出现；同一段记忆不在「最近发生」重复 |
| F | 长按菜单（真实 `MessageBubble`）：未收藏 →「收藏为共同记忆」；已收藏 →「已是共同记忆」 |
| G | **端到端（真实 `ChatWindow`）**：长按 → 收藏 → 明确反馈 →「去世界看看」真的进世界页；全程零网络 |
| H | 原子性：世界事件写失败 ⇒ 整笔回滚，不留半写；失败后仍可正常收藏 |
| I | **隐私边界（审核指出的前置修复）**：`listRelevant` 的可见性是**过滤条件**而非评分加分项；private 永不返回；只给别人的 selected 不返回；多人在场时只注入所有人都可见的；空角色列表返回空；与 `listVisibleFor` 口径一致；世界事件与日记走同一份闸门（`lib/world/visibility.ts`） |

### Phase 2b-3：让角色说得出来（`phase2b3.html`）

**真实 `ChatWindow` 里打字 + 回车发送**，只把 LLM 边界（`webApi.chat.send`）打桩并**捕获真实 systemPrompt**，
因此能逐字断言"角色到底看到了什么"；全程 `window.fetch` 打点（任何一次联网都算失败）。

| 组 | 内容 |
|---|---|
| P | 纯函数：溯源契约（完整注入才记录；**被预算截断/丢弃 ⇒ 不记录**，不谎报）+ 共同记忆文案（不含内部字段、最多 3 条、明确禁止编造） |
| A | 真实发送后 systemPrompt 里**确实有**「你和用户一起经历过的事」；私密的、角色不知情的都**不在**；4.x 的长期记忆与未完成事项仍在（扩展而非替换） |
| B | 溯源：assistant 消息记下 `sharedMemoryIds`，「记忆依据」面板如实展示 |
| C | 三道闸门：可见性 + 认知（须 full 且可提起）+ 只挑相关几条（重要度优先、limit 生效、换角色视角） |
| D | 成本：一次召回 0 次网络；两次发送 = 2 次 LLM 调用；全程零联网 |

### Phase 2b-4：我的生活三级可见性 + R6 收口（`phase2b4.html`）

真实 `ChatWindow` 多次发送并逐轮捕获 systemPrompt，用来证明"授权 → 进上下文 / 撤回 → 立即不进"。

| 组 | 内容 |
|---|---|
| P | 纯函数：日记区块文案（含"这是用户主动让你知道的"与禁止暗示知道别的日记）+ 溯源契约（`diaryIds` 只在完整注入时记录） |
| A | 默认 private：不写世界事件、不给任何角色认知、任何角色都看不到 |
| B | 告诉某角色：只给该角色 `full + canMention` 认知，**不写世界事件**；只选人却选空 ⇒ 视为 private |
| C | 加入共同世界：写 `reality` 事件（visibility=world、参与者=你+关联角色）+ 按参与者认知；降级回 private 会移除事件与 `worldEventId` |
| D | **真实两次发送**：授权进 prompt → 撤回后**下一次发送立即不注入**；改授权 A→B：A 立刻失去、B 立刻获得 |
| E | **R6 收口**：settings-store 里已无该键；即使把旧开关强行塞回 state，私密日记仍不进 prompt、授权给别人的也不进、授权给当前角色的照常在 |
| F | 回收站：软删除不进上下文（即使授权还在）；恢复后可再进；彻底删除收回认知 |
| G | 角色被删除：从 `visibleTo` 摘掉、认知消失、授权对象全没了 ⇒ 自动回到仅自己 |
| H | 世界页：加入共同世界后出现在「最近发生」并标为人话类别「你的生活」 |
| I | UI（真实组件）：三级可见性控件（默认「仅自己可见」→ 点角色 → 文案变「只告诉了 星遥」）+ 总览与「收回」入口 |
| J | 成本：每次发送 1 次 LLM；日记闸门本身 0 网络；并按**调用栈归因**证明没有一次请求来自本阶段新增代码 |
| K | **审核 P1/P2 回归**：私密日记的**情绪**不泄露（私密/撤回后/授权给别人时 prompt 都不含"低落的心情"，授权后才生效）；同一区块在 prompt 里**只出现一次**（含编译器层面的 key 去重）；心情联动只认"今天"的日记 |

### Phase 2b-5：关系网络可解释化（2B，`phase2b5.html`）

在真实结算管线里制造一次等阶升级，验证"现在的关系 + 为什么会这样"两条链路，并断言**页面不出现任何内部数值**。

| 组 | 内容 |
|---|---|
| P | 纯函数：分面语义分档（0 = 没有记录，不显示"信任：无"）、文案不含数字、配对标题（你 ↔ 角色 / 角色 ↔ 角色）、原因倒序与过滤、有无可解释记录 |
| A | 4.x 等阶升级 → 关系变化史写入**可读原因**（幂等、关联世界事件）；普通互动**不写**；**R7 不变量**：世界层不写任何数值（好感度仍只有 `CharacterState` 一个来源） |
| B | 角色 ↔ 角色状态与变化可读；`listStatesByWorld` / `listEventsByWorld` 一次读回；跨用户/跨世界隔离 |
| C | 真实渲染 `MobileRelationsPage`：等阶 + 真实计数 + 原因与相对时间 + 角色之间的人话分面；空状态如实；读取失败给出错误态与重试；**不出现好感度/分面数字/内部字段名** |
| D | 外壳：世界页「关系网络」入口 → 覆盖页；底部导航保持可见且高亮「世界」；可退出 |
| E | 纪律：零网络、零 AI（页面渲染不触发结算），世界层仍没有任何"好感度数值"被写进来 |

### Phase 2b-6：R7 裁定（`phase2b6.html`）

裁定"关系数值的唯一来源"：**用户 ↔ 角色 的好感度只有 4.x `CharacterState.affinity`**；
世界层不再保存这个数字，只保留 4.x 没有的四个分面，且分面**只能通过带原因的事件变化**。

| 组 | 内容 |
|---|---|
| P | 分面集合 = trust/dependency/conflict/familiarity（**没有 affinity**） |
| A | 状态行不含好感度；分面照常按事件变化并夹到 0~100；**写 affinity 直接抛错**（`applyEvent` / `overrideFacets` 都是）；抛错后状态不变 |
| B | 早期开发版写过的"好感度快照"被**幂等清理**（四个分面保留、被清理行数如实统计、再跑不重复清理）；4.x 好感度不受影响 |
| C | 旧备份导入**剥掉**遗留 `affinity`，不会把第二个数值来源搬回来 |
| D | 端到端：真实结算后好感度只在 `CharacterState` 上涨，世界层状态不被改动，关系史留下可读原因，关系页照常可解释 |
| E | 纪律：零网络、只发生 1 次既有结算调用 |

### Phase 3：世界舞台（Scene Director，`phase3.html`）

LLM 边界（`llmChat`）**可注入**，因此可以逐轮数"花了几次调用"，并逐字检查提示里带了什么。

| 组 | 内容 |
|---|---|
| P | 纯函数：导演 JSON 解析（旁白/对白、名字与 id 都认、**未知发言人丢弃**、张力夹取、非 JSON 不猜）+ 结算校验（affinity 丢弃、缺原因丢弃、场外的人丢弃、数值夹到 ±10、未完成事件只接受在场角色、**不接受模型指定认知**） |
| A | 开场：**0 次调用**、结构化状态就位、只写一条 system 提示、不污染 sessions/messages |
| B | 推演一轮：**恰好 1 次调用** → 1 旁白 + 2 对白（未知发言人被丢）、index 有序、说话人映射正确、结构化状态更新、第二轮提示带上前文 |
| C | 结束结算：**1 次调用** → `stage` 世界事件（参与者/可见性/可回溯）+ 共同记忆（互相引用）+ 关系变化（带原因、affinity 被挡）+ 未完成事件（带 `sourceSceneId` 并派生 continuity 事件）+ 认知只给在场角色；**已结束的场景再次结算 = 0 次调用 + 如实报错** |
| D | 先离开（暂停）：**0 次调用**、无 stage 事件、无共同记忆；删除场景连同正文消失 |
| E | 首选模型没给出可用内容 ⇒ 自动尝试备用大模型；全部模型都失败才如实报错、**只保留用户真实动作**、不伪造状态；jsonMode 失败会先降级重试一次 |
| F | 打通：剧场页渲染（0 次调用）、世界页「最近发生」出现这场戏、关系页把它讲成原因且不暴露数值 |
| G | 角色被删除：场景正文保留、只摘掉参与者；世界事件保留历史、摘掉引用 |
| H | 纪律：零网络；调用总数 = 4 次推演 + 1 次结算 + 1 次降级重试 = 6 |

### Phase 3b：舞台后果进入私聊上下文（`phase3b.html`）

闭环：**一起经历 → 记入世界 → 角色在聊天里能自然提起**。两个 LLM 边界分别打桩（舞台推演 + 私聊发送）。

| 组 | 内容 |
|---|---|
| P | `buildSceneContext`：无戏不留空区块、含标题/地点/时间/摘要、最多 2 场、不含内部字段、明确"亲身在场"并禁止编造 |
| C | 闭环第一步：真实演完一场戏（1 轮推演 + 1 次结算 = 2 次调用），戏已结束并挂上舞台事件 |
| A | 三道闸门：在场角色能召回 / **没在场的一无所知** / 还在演的戏不召回 / 认知被收回即失忆、补回即恢复 / 事件改 private 即不召回 / limit 生效 |
| B | 真实 ChatWindow：prompt 出现「你们一起经历过的事（世界舞台）」且内容正确；**旁观者 prompt 里没有**；溯源记录 `sceneIds` |
| D | 不重复注入：舞台区块与摘要各出现 1 次；这次经历**只由舞台区块呈现**（共同记忆区块不重复讲一遍） |
| E | 预算与溯源：完整注入才记录 `sceneIds`；截断/丢弃都不记录；同一轮可同时记录共同记忆/日记/舞台 |
| F | 溯源面板：出现「你们一起演过的戏」并列出标题与地点 |

### Phase 3c：幕次与选择分支（`phase3c.html`）

幕次推进用**本地规则**（0 次调用、可解释）；选择分支必须"真"（2~3 个合法选项，否则降级成旁白）。
真实 UI 路径用一个**假 LLM 端点**（命中 `chat/completions` 时按 OpenAI JSON 形态返回）来验收，因此既走真实
`MobileStagePage` → `llmChat`，又不需要联网。

| 组 | 内容 |
|---|---|
| P | 幕次规则：正文太少即使张力拉满也不翻幕 / 张力到位+够长 ⇒ 翻（reason=tension）/ 太长 ⇒ 兜底翻（reason=pace）/ 不满足 ⇒ 不翻 / 到最后一幕不再翻 / 只统计本幕 / system 不算正文；选项校验：2~3 个采纳、1 个⇒null、空重复清理、超 3 截断、超长截断；非法选择**降级成旁白** |
| A | 真实推演：含选择的轮次仍 1 次调用；选择提示落库（`meta.options`）；点选项仍 1 次调用；被标记 `chosen`（UI 不再可点）；选择本身记成一条 `choice` 条目可回看；选择成为下一拍的输入 |
| B | 翻幕：阈值未到 ⇒ 仍在第一幕；张力到位 ⇒ 真翻到第二幕、张力归零、写下可见标记、新条目归第二幕；翻幕本身不花钱（该轮仍 1 次）；正文不落聊天 |
| C | 真实组件：显示当前幕次；已选过的选择显示为"你选的内容"且**不再显示选项按钮**；新的选择按钮可点；点完变成已选内容、按钮消失；每次只多 1 次调用 |
| D | 结算：正文里含用户的选择；结算仍 1 次调用；结算提示里包含了选择分支的正文 |
| E | 纪律：零计划外网络；调用总数 = A2 + B2 + C2 + D1 = 7 |

`*.bundle.js` 是构建产物，不需要提交（仓库里只保留 `*.ts` / `*.html` / `serve.cjs` / `build.mjs`）。

### 2026-09-26 记忆整改回归（memory-audit-20260926.html）

32 条隔离检查，含真实 ChatWindow 发送后的 systemPrompt、真实星域结算、真实记忆提炼 worker。
检查晚加入/离场/重入/结算后的个人见证权限、星域原话进入私聊、旧授权日记、角色本人动态、
纠正和遗忘不回流、旧版本异步摘要拒写、精确来源及旧格式的保守依赖处理、长星域普通追问。
模型边界打桩，真实网络禁止；真实用户数据库不参与。

构建：`node scripts/verify/build.mjs`；启动：`node scripts/verify/serve.cjs`。
运行 `run-all.ps1 -Suites memory-audit-20260926 -Chrome <本机 Edge 或 Chrome 可执行文件>`。
原 character-memory 两组独立证据夹具现在明确标记 independent；未标注的批次来源不能被当作独立证据。

### 记忆最终检查（memory-final.html）

39 条真实数据库检查：跨世界、跨四种模式的亲历原话召回；旧私聊、群聊、动态与点赞；
逐条日记和待办授权；撤回及删除立即生效；钉住记忆优先；来源去重；跨账号隔离。
另外 memory-continuity 验证普通追问不会主动读取尚未看过的动态，用户的朋友圈时间窗保持有效。
运行 `run-all.ps1 -Suites memory-final,memory-continuity,memory-audit-20260926`。

### 角色界面检查（character-ui.html）

通过 build.mjs 构建，再运行 `run-all.ps1 -Suites character-ui`。
使用真实 React 组件与数据库检查角色列表、编辑入口、搜索、管理菜单和错误状态。

### 创建角色检查（character-create.html）

19 条真实组件和数据库检查：四步流程、单字名字、关系入库、创建不导入旧记忆、模型试聊不写聊天记录、
保存失败重试只创建一次、导入幂等、跨账号/撤回过滤、编辑不重复追加互动边界。
试聊请求使用假端点，真实网络不参与。运行 `run-all.ps1 -Suites character-create,character-ui,character-scroll,character-memory,memory-final`。

### 头像关系星图（relation-map.html）

45 项布局与真实 React 组件检查：零名字/等级文字、同尺寸头像、人物居中、角色间真实连线、三人经历的完整关系对、
分页访问超过十二位角色、零头像重叠、有限路径及稳定路由、加载错误与重试。
运行 `run-all.ps1 -Suites relation-map,character-ui,character-scroll`。

### 古月娜性格调整（guyuena-care.html）

12 项真实数据库检查：预设和已有副本同步关心规则、直接相信自称舞麟、对家人与其他人的差别、
保留用户个性化设定、重复启动不重复追加。快照核对聊天、摘要、记忆、ledger 和关系状态完全不变。

### 手指交互（physical-ui.html）

先构建 Vite，再运行 `node scripts/verify/build-physical-ui.mjs`。此页面挂载真实筛选、标签、字号刻度、卡片、消息气泡与聊天输入组件；仅原生录音/识别接口被替换，不读取用户实际数据。

在一个 PowerShell 窗口运行 `$env:VERIFY_PORT='17901'; node scripts/verify/serve.cjs`，再用本机 Codex 自带 Node 运行 `node scripts/verify/run-physical-ui.cjs`（需要同运行时内的 Playwright 和本机 Chrome）。

23 项检查覆盖多选与计数、删除/插入竞争、标签联想、中文输入法、容器收缩、卡片拖动不误开、字号实时生效/吸附/保存、录音松手/取消/拒绝权限/异步启动/切页互斥、草稿保留、320–430px 布局与减少动态设置。

Android 真机仍需检查首次授权、按住说话/上滑取消、真实麦克风电平、松手转写、切后台，以及系统键盘上方的字号刻度；浏览器原生接口替身不证明这些设备行为已通过。

### 统一记忆与星域时间（memory-unified.html）

46 项真实数据库、提示词与私聊组件发送检查：跨入口/跨世界的个人事实、约定和已知事件；全听众的知情交集与撤权；群聊共同见证和已授权日记；停止默认物件生成与旧存档背景注入；精确日期、中文时间、三天后及两小时后的连续推进；光线、冻结时钟和新片段时间延续；旧舞台时间约束；真实 ChatWindow 发送中统一记忆仅注入一次。模型调用使用替身。

运行 `node scripts/verify/build.mjs` 后，使用 `run-all.ps1 -Suites memory-unified,memory-attention,memory-final,memory-continuity,character-memory,worldA,worldB,worldE,worldF`。

并行检查可使用独立端口：服务器设置 `VERIFY_PORT`，运行器传相同的 `-Port`，默认均为 17899。

### 私人秘书（secretary.html）

2026-10-03 记待办失败整改：1081项数据与144项实际界面检查、185项相关回归通过。新增31项数据与5项界面检查使用未补齐依据的原始模型响应，覆盖缺/错位置、逐字原话定位、缺字段接续、取消零写入、失败项重新规划、成功项不重放、来源编辑停止、连接错误说明和回执同步。见 `docs/ASSISTANT-TODO-FAILURE-FIX-2026-10-03.md`；模型与原生通知仍使用替身。

2026-10-03 最新功能续做：875项数据与139项界面通过，新增多事项同轮选择与补充、分项取消零写入、未选不默认套入第一项、同聊天及跨聊天剩余补问、结果卡取消接续及旧组刷新。界面精修21项、记忆与窄屏80项、默认三组回归105项通过，共1220项。多事项新增28项数据与5项界面检查；记忆回归也有扩展，总数不直接作功能增量。实现及复跑见 `docs/ASSISTANT-MULTI-OPERATION-2026-10-03.md`；真实模型和Android真机仍未验收。

2026-10-02 收件箱续办：847项数据与134项界面通过，新增收件箱暂停事项选择、跨聊天续办、来源/任期保护、补问中的记录模式和重复/优先级改口、一次多字段补齐及日期冲突保留。界面精修21项、记忆与窄屏64项、默认三组回归105项通过，共1171项。实现及复跑见 `docs/ASSISTANT-CONTINUATION-2026-10-02.md`。

2026-10-02 本次质量整改续做：733项真实数据库和128项实际界面检查通过，加默认105项回归、60项助理记忆与4项窄屏检查，共1030项。覆盖控制优先与取消零写入、暂停恢复、重复字段和改口、日期依据、待办/日记/草稿/查询的持久接续、多事项和依赖重试、真实列表序号修改、来源和目标版本、v30增量检索及旧历史128条分批回填、原生通知接口替身的安排/取消/替换/失败恢复、当前版本回执、按需展开与用户自选主动帮助。完整实现和限制见 `docs/ASSISTANT-QUALITY-REFORM-PROGRESS.md`。用户暂不要求完整验收；真实模型、Android 真机、系统键盘与长历史设备压测均不计作通过。

下列较早轮次的数量保留为历史记录；当前运行器以最终 `ALL PASS` 统计为准。

回复真实性收尾：问号不能绕过过滤，实际持久化聊天消息与已执行收据一致；假提醒/保存/发布/完成声明、无操作承诺、含“已经”的情绪句、省略主语记事、叫一声的明确提醒、缺日期/时间/事项的具体补问、连续补齐、否定和只读、多个独立事项，均有真实数据库或聊天组件验收。当前460项数据、117项UI及默认105项回归通过；`node scripts/verify/run-secretary-regressions.cjs secretary-memory`另通过60项记忆与4项窄屏检查，总计746项。模型使用替身，未验证真实模型与 Android 通知。截图 `secretary-truthful-reply.png`。

自然表达与状态反馈整改：补测三种无需“待办”关键词的明确记事说法、那个挪到后天的真实单项续办、否定/查询/日记范围、模型一句回应保留、虚假成功与通知承诺过滤、日记重锁、各操作状态标签，以及实际创建卡片的已添加与待办未完成同时展示。当前433项数据与115项UI，默认回归105项，共653项；模型使用替身，不代表真实模型自然表达、通知或速度验证。

先运行 `node node_modules/typescript/bin/tsc --noEmit` 和 `node node_modules/vite/bin/vite.js build`，再运行 `node scripts/verify/build-secretary.mjs --with-regressions`。

使用同运行时包含 Playwright 的 Node 和本机 Chrome，运行 `node scripts/verify/run-secretary.cjs`。运行器自行启动临时端口服务；460 项真实数据库检查与117项组件/界面检查覆盖用户命名、新旧引导、v29头像迁移、唯一工作区、解雇与聘用、版本冲突、旧任期迟到回复拦截、记录保留、草稿及事项手动交接、旧备份防复活与新聘用同步、14类操作、连续补充、序号指代、否定指令、受众与隐私锁、失败重试、自动恢复、真实记录跳转、五档性格及偏好、十套二次元头像、办事收件箱、在职改名、空缺时禁止发送、历任记录与手机布局。只替换模型 HTTP 响应，不读取用户实际数据。结果写入 `.last-result-secretary.txt`，截图包含 `secretary-review-choices.png`、`secretary-review-progress.png`、`secretary-steps.png`、`secretary-work-preferences.png`、`secretary-capabilities.png`、`secretary-personality.png`、`secretary-employment.png`、`secretary-inbox.png`、`secretary-daily-review.png`、`secretary-home.png` 与 `secretary-home-workspace.png`。

内部能力扩展覆盖：日记/朋友圈所有者与原作者隔离、回收站与删除过滤、关键词和日期、只读查询不补建 occurrence、锁定/解锁立即更新已挂载摘要、来源编辑隐藏旧摘要、误选写入工具时只读请求不会保存或发布、修改未来周期系列、保留未指定字段、改名与清空备注、优先级、每月/间隔天数重复、提前提醒和旧通知取消、过去的单次提醒先补充时间、一年以上的未来重复安排、取消整项及撤销、候选歧义与版本冲突、8个内部页面白名单与直达卡片、缺失时间/重复间隔补充、备份恢复不执行、能力目录及窄屏布局。

2026-10-02 办事习惯与连续修改：格式/文风进入真实规划请求、默认优先级与已请求的提醒实际写入、明确值优先、不默认新增提醒、任务快照与连续补充保持原设置、简单修改不再调用模型、中文提前分钟、原创建收据保留、改名及备注保留空格、缺时间卡片补充、相对日期改期、否定与多个目标不误改、后续编辑版本冲突、撤销单次修改、旧设置页冲突与重新读取、换助理保留、备份与独立偏好时间戳合并、非法导入回滚、账号隔离、重开保存及320/390/430px界面。该轮专项423项，加默认三组回归105项，合计528项。

2026-10-02 待办步骤：实际清单创建、规范化去重追加并保留旧状态、无需模型的连续完成/恢复、名称匹配与明确序号、模型不能跳过重名步骤、父待办/步骤两层独立选择、源请求撤回与记录版本变化、只建议及否定指令、错误父待办工具拦截、父待办不自动完成、撤销仅恢复清单且后续编辑不覆盖、超限整项回滚、重复系列不误记为每日完成、明确转单次、步骤不补建实例与重排提醒、查询真实进度、备份清单与恢复收据不执行、跨账号隔离、实际聊天和卡片按钮及实时进度刷新。该轮专项475项，加默认三组回归105项，合计580项。

2026-10-02 按需整理与办事进展：旧请求与归档格式兼容、输出范围校验与固定顺序、未选类型过滤、执行和恢复再次拦截、仅勾选步骤不能生成当日事实、真实父待办/当前步骤/次日安排分离、历史日期及重复系列不引用当前步骤、旧长清单的真实计数、只读预览不补建实例、来源步骤修改后采用失败、选择范围随备份恢复、至少选择一种、实际单类型生成、每组列表展开、实时刷新、原待办跳转、日记重锁/解锁及账号切换、320/390/430px无横向溢出。当前专项518项，加默认三组回归105项，合计623项；截图新增 `secretary-review-choices.png` 和 `secretary-review-progress.png`。

每日整理覆盖：日记主动勾选、日期校验、个人事实与角色剧情隔离、按真实完成日期归类、预览不补建 occurrence、生成不写入生活记录、编辑后逐项采用、固定次日日期、重复采用及同名待办拦截、原文保留与撤销、来源变化拒绝、日记重新锁定后衍生内容隐藏、待办页补建记录兼容、账号/任期隔离、备份恢复不执行、重新聘用后手动交接，以及320/390/430px布局。

独立体系覆盖：首页保留一张助理工作台卡片、角色搜索期间入口可用、真实数量与只读计数、完成待办和修改请求后刷新、空缺时保留记录、新用户聘用、账号切换清除姓名及计数、专属办事菜单、旧角色编辑入口转助理管理、群聊及星域仓库拒绝助理、旧混合星域生成／结算停止、普通角色自主移动仍可提交、普通角色发布与删除保护、停止角色式主动消息与声线推断、角色记忆提炼及旧任务隔离、朋友圈自动互动和日记授权边界。

涉及角色与星域权限时，可运行 `node scripts/verify/build-secretary.mjs --with-regressions --with-domain-regressions`，随后运行 `node scripts/verify/run-secretary-regressions.cjs character-create moments memory-unified worldF worldG worldA worldC character-memory memory-final memory-continuity`。回归依次为19、40、46、28、13、59、57、141、47、77项，共527项；上一轮体系分离时加助理专项326项合计853项通过。本轮只重新运行与内部能力扩展相关的默认三组回归。运行器等待最终报告，阶段进度不作为完成结果。

运行 `node scripts/verify/run-secretary-regressions.cjs` 验证原有角色创建（19项）、朋友圈（40项）和统一记忆（46项）；结果写入对应 `.last-result-*.txt`。真实模型生成质量及 Android 系统通知仍需实际账号与设备验证。

### 助理连续记忆（secretary-memory.html）

2026-10-03 召回优化：本套件现有76项数据/请求/组件检查，加4项窄屏检查。新增无关事实过滤、冷却不从旧原话绕回、短句重新提起、表达偏好、否定式遗忘、重复任务回执去重、实际记录和日期实例生成期间变化、原请求撤回及日记重锁。复跑命令不变；说明见 `docs/ASSISTANT-MEMORY-OPTIMIZATION-2026-10-03.md`。以下60项为首轮记录。

2026-10-02 补问连续对话整改：助理专项638项数据、122项界面，默认回归105项及助理记忆60项/窄屏4项通过，共929项。新增真实输入框的零操作补问接续、跨会话/重开/暂停、完整来源版本链、导入不激活，以及四种回复模式的虚假闹钟声明对抗。实现范围及限制见 `docs/ASSISTANT-QUALITY-REFORM-PROGRESS.md`；模型使用替身，未认定真实模型及真机提醒验收完成。

构建 `node scripts/verify/build-secretary.mjs --with-regressions --with-domain-regressions` 后，运行 `node scripts/verify/run-secretary-regressions.cjs secretary-memory memory-unified memory-attention memory-final memory-continuity character-memory character-create`，并运行原有 `node scripts/verify/run-secretary.cjs`。

新增60条真实数据库、模型请求与React交互检查，以及4项320–430px布局检查：原话证据与修订、无需模型的明确记住、自动提炼、拒绝记录与引用/虚构过滤、跨会话召回、更正/忘记与旧同步防复活、来源删除/改写、任务和步骤实际进度、未发布草稿、日记衍生资料锁定与解锁、旧交流检索、重新聘用延续、继承与账号隔离、迟到回复拦截、实际纠正和忘记按钮、数据库重开。截图 `secretary-memory.png`；模型响应仍使用替身。维护说明见 `docs/ASSISTANT-MEMORY-2026-10-02.md`。

### 星域设置与触控

2026-10-03 流畅度收尾：生产构建后执行 `node scripts/verify/run-touch-fluidity.cjs`，独立服务器验证 31 项真实组件行为，覆盖侧滑无逐帧 React 提交、速度判断、边界阻尼、中途接管、捕获交接、键盘、减少动态效果和历史阅读位置。完整聊天入口另由 `run-secretary-motion.cjs` 验证；记录见 `docs/UI-FINAL-2026-10-03.md`。

`node scripts/verify/build-settings-ui.mjs` 同时构建手机预览和生产桌面平台分支；启动 `node scripts/verify/serve.cjs` 后运行 `node scripts/verify/run-settings-motion.cjs`。覆盖触点柔光、滑出取消/滑回确认、松手清理、浏览器实际触摸滚动、48px 热区、键盘操作、快速进退、滚动恢复、敏感页禁留影、原生折叠、减少动态效果，以及桌面深浅色布局。截图位于 `.tmp-preview/settings-motion-20261002/`，说明见 `docs/STARFIELD-SETTINGS-TOUCH-2026-10-02.md`。

### 助理界面精修

2026-10-02 最新收尾：821项助理数据、131项实际界面、21项界面精修、60项助理记忆/4项窄屏，以及角色创建19项、朋友圈40项、统一记忆46项、记忆关注64项，共1206项通过。新增否定控制词误写、暂停恢复、跨聊天内联继续、自然序号选择、明确字段负面标题、切换账号后的迟到原生调度补偿、主动协助实际展示/每日限额/显式延后验收。先构建Vite再构建验收资产，避免旧CSS影响真实布局；复跑与剩余实测门槛见 `docs/ASSISTANT-QUALITY-FINAL-2026-10-02.md`。以下各轮数字为历史记录。

2026-10-02 质量整改契约：新增情境枚举、本地五性格回应和共享收据读模型。当前助理582项数据与120项界面检查，加105项默认回归、60项助理记忆及4项窄屏检查，共871项通过；类型检查与生产构建通过。模型使用替身；完整阶段进展及未验收项见 `docs/ASSISTANT-QUALITY-REFORM-PROGRESS.md`。

完成 renderer 构建和 `node scripts/verify/build-secretary.mjs` 后，运行 `node scripts/verify/run-secretary-ui-polish.cjs`。运行器使用自有临时服务器与隔离数据，21条检查覆盖320/390/430/768px、首页默认条目尺寸、收件箱分类滚动、工作台记录入口与长表单固定操作、习惯选择反复修改及保存重开、每日整理选项、浅色兼容和减少动画模式，以及浏览器实际使用本地中文字体和离线后的按钮字形。验收 CSS 和 WOFF2 会同步到运行器，不依赖在线字体。深色实际截图写入 `.tmp-preview/secretary-ui-polish-20261002/`。设计与验证记录见 `docs/ASSISTANT-UI-POLISH-2026-10-02.md` 和 `docs/ASSISTANT-TYPOGRAPHY-2026-10-02.md`。
