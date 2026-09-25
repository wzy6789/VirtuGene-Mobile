# 记忆系统彻查报告：「记忆随人走 + 无论什么模式都要互通」

- **审查日期**：2026-09-25
- **审查对象**：`F:\VirtuGene-Mobile`（Capacitor Android 端）
- **代码基线**：HEAD = `12c3b40`（GitHub 渠道回退后的状态）**+ 工作树未提交改动**（见 §0.2）
- **审查方式**：4 路并行只读审计（写入侧 / 召回侧 / 权限与失效链路 / 测试覆盖）+ 关键结论逐条第一手复核；**未执行任何写库脚本、未做真机运行时验证**
- **纪律**：本次**没有改动任何产品代码**。本报告本身是新增文件，未提交。

---

## 0. 总览

### 0.1 六条结论

1. **「不越权」基本成立。** 所有跨模式召回都是**每轮实时重读源表、重跑权限闸门**，没有一条建立在"信任当初的沉淀结果"上。用户自建角色 id 一律随机 UUID（`chat-store.ts:534-545`），预设共享 id 被 `createdBy === userId` 挡在记忆主体之外（`character-memory.ts:45-48`）。未发现可证明的串号 / 越权召回路径。
2. **「互通」是单向、且默认关闭的。** 只有**私聊 / 群聊**会沉淀成持久 `memories` 行；朋友圈 / 日记 / 待办 / 星域**只在自己那张表里**，进入对话需要**你主动问起**（关键词正则 + 显式授权 + 必填 `worldId` 三重闸门）。它们不会"自然地"出现在日常闲聊里。
3. **主动消息（proactive）不召回任何记忆。** `chat-store.ts:498` 直接走 `ipc.proactive.generate`，整条链路没有 `recallCharacterMemory`。角色"主动想起你"这件事目前不存在。
4. **【高】日记「加入共同世界」绕过了日记专属闸门，进入多人共享的世界提示词**（`world-context.ts:181`、`world-autonomy.ts:187`），可经旁白落成场景正文扩散给未授权的角色。**同类问题（共享提示词混入个人私有记忆）在工作树这一轮里已在群聊和朋友圈被修掉，星域共享层漏了**——见 §5-H1。
5. **「记忆随人走」在换设备 / 备份恢复这条路上不闭合。** 已知 4 个中危缺口：`characterKnowledge` 导入版本比较导致恢复后静默丢认知；`sharedStoryEvents` / `momentContacts` / `characterLifeEvents` 无墓碑，删除与屏蔽会被旧备份复活；跨账号局域网同步被自身归属守卫拒绝。见 §5-M1…M5。
6. **记忆账本（claims / evidence / knowledge）目前"只写不读"。** 全仓唯一读取点是记忆档案弹窗（`MemoryArchiveModal.tsx:44` 的 `claimsKnownBy` / `jobStatusForCharacter`）。没有任何 prompt 注入路径读账本；撤回能即时生效靠的是**实时闸门**，不是账本。`memoryLedgerRepo.revokeSource`（`memory-ledger-repo.ts:331-350`）是死代码。

### 0.2 审计时的代码状态（事后补记）

审计开始时工作树**不是干净的**：30 个文件修改 + 2 个新文件，落盘时间 2026-09-25 14:05–16:05，
是一整轮**记忆隐私与召回正确性加固**（`spokenMemoryIds`、朋友圈评论私有上下文 + 披露审查、
群聊按 actor 分片、置顶会话摘要清理、会话摘要失效仓库化）。

- 该轮已于审计结束后作为 `41c031e` 提交（`memory: 记忆隐私与召回正确性加固`），
  配套验证：`character-memory` 137 断言、`moments-autonomous` 14、`worldB` 44 全绿。
- **本报告的所有结论都以"该轮之后的工作树内容"为准**，也是随后那轮改造的起点。
- 期间新增的 `src/lib/memory-disclosure.ts`、`src/db/session-summary-repo.ts` 属于那一轮。

> 报告正文（§1–§9）保持审计当时的原貌，未随修复回改；
> §11 记录每一项发现后来的处置结果。

---

## 1. 事实基线：记忆到底存在哪

系统里**并存三套"知识"结构**，这是理解一切行为的前提：

| 结构 | 表 | 谁写 | 谁读 | 性质 |
|---|---|---|---|---|
| A. 记忆行 | `memories`（+ `sessions.summary`） | 提取 job（私聊/群聊消息） | **召回主路径**、记忆档案 UI | 唯一能"主动"进对话的东西 |
| B. 记忆账本 | `memoryClaims` / `memoryEvidence` / `memoryKnowledge` / `memoryJobs` / `memoryUsage` | `memoryRepo` 每次写入时镜像同步（v25 迁移从 `memories` 重建） | **只有记忆档案弹窗** | 审计/溯源用，**不进 prompt** |
| C. 世界认知 | `characterKnowledge`（+ `worldEvents` / `sharedMemories`） | 世界写入器 / 结算 / 日记授权 | 星域召回、世界 recall | 与 A/B 平行，靠 `eventId`/`worldId` 关联 |

**结论**：所谓"记忆互通"，实际是 **A 表 + 各模式源表实时重读** 的合成结果；B 目前不参与对话；C 是星域内部的独立体系。三套之间的关联靠内容匹配（`findClaim(userId, kind, content)`）而不是稳定 id，这是后面若干缺口的根因。

---

## 2. 写入矩阵：谁会产生"持久记忆"

| 来源 | 会写 `memories`？ | 落点 | 触发条件 |
|---|---|---|---|
| 私聊消息 | ✅ | `memories` + 账本 | 提取 job：`session.userId` 匹配、`role==='user'`、revision 一致、无墓碑、`character.createdBy===userId`（`memory-jobs.ts:11-24/53-89/131-133`） |
| 群聊消息 | ✅ | 同上 | 额外要求 job 的每个 `characterIds` 都在 **在场快照** `message.witnessedBy` 里（`memory-jobs.ts:69`，快照来自 `message-repo.ts:74-79`） |
| 朋友圈动态/互动 | ❌ | `moments` / `momentViews` / `momentReactions` | 只在被**其他模式召回**时才写账本 evidence（`character-memory.ts:368`） |
| 日记 | ❌ | `diaries` + （共享时）`worldEvents` + `characterKnowledge` | 同上 |
| 待办 | ❌ | `todos` / `todoOccurrences` | 同上 |
| 星域（共同记忆/场景/脉冲/事实） | ❌（自有表） | `sharedMemories` / `worldScenes` / `worldEvents` / `worldFacts` / `characterKnowledge` | 结算与授权流程 |
| 用户「收藏为共同记忆」 | ❌ | `sharedMemories` | `world-writer.ts:238-305`，**不校验消息归属**，信任调用方（目前仅私聊可达） |
| 主动消息 | ❌ | 只写 `messages` | 无召回、无沉淀 |

**一句话**：只有聊天（私聊/群聊）是"记忆的生产者"；其余模式都是"被动资料源"。

---

## 3. 召回矩阵：每个模式实际能看到什么

| 场景 | 入口 | 允许来源（默认） | 闸门 |
|---|---|---|---|
| 私聊 | `ChatWindow.tsx:977` | **`['group','moment']`**；命中正则才扩到 `['group','moment','todo','diary']`（有 sceneWorldId 时再加 `world`）| `explicitCrossChannelRecall` 正则（`ChatWindow.tsx:976`）+ 各源自身闸门 |
| 群聊·共享导演 | `group-store.ts:129` | `['world','moment','todo']`，`audience=全体成员` | `audience.every(...)` + `isVisibleToEveryCharacter` |
| 群聊·单个 actor | `group-store.ts:132` | `['chat','group','world','moment','todo','diary']`，`audience=[自己]` | 只给本人；共享层拿不到（有断言守护） |
| 朋友圈·自主评论 | `moments-repo.ts:61-70` | 全来源 + 私有生活事件 | 生成后过 `reviewPublicComment` 语义审查 + `containsPrivateMemoryEcho` 字面回声兜底，不通过就降级重写 |
| 星域·actor | `world-context.ts:251`、`scene-runtime.ts:62` | 全来源（`entryMemoryMode!=='present'`） | 按角色分片；`present` 模式不带入 |
| 星域·共享层（导演/旁白/编排器） | `world-context.ts:181`、`world-autonomy.ts:187` | `visibility==='world'` 的世界事件 | **只有 visibility 一道闸门 → 见 §5-H1** |
| 主动消息 | `chat-store.ts:498` | **无** | — |

**逐源闸门（简表）**

- 私聊召回：`audience.length===1` + `getByCharacter(characterId,userId)` + 只留 `status==='active'`（`character-memory.ts:55-73`，`memory-engine.ts:101`）
- 群聊召回：当前 `group.characterIds` 全体覆盖 **且** `witnessedBy` 命中（`character-memory.ts:75-80`）
- 朋友圈：deleted / private / `isBlocked` / 时间窗 / `audienceCharacterIds`，屏蔽在 `character-memory.ts:132` 直接整体跳过；互动还要求有 `momentViews`（追问时放宽并显式标注）
- 日记：必须**显式追问** + `listVisibleFor` + `listMentionableDiaryIds` + **`worldId` 必填**（缺省 fail-closed，`character-memory.ts:184-201`）
- 待办：`visibility==='selected'` + `visibleTo` 覆盖全员 + 非 deleted/cancelled（`todo-repo.ts:179-184`、`character-memory.ts:264-278`）
- 星域：`ownerFor(worldId→userId)` + `isVisibleToEveryCharacter`（空列表恒 false）+ 认知 `full && canMention` 三道
- 世界事件（日记型）：`isMentionableDiaryEvent` 要求 日记未删 + world + `worldEventId` 对得上 + `characterId` 匹配 + 认知 `full && canMention`（`world-event-repo.ts:45-57`）

---

## 4. 「记忆随人走」判定

| 通道 | 判定 | 证据 |
|---|---|---|
| 同一账号、同设备、跨模式（聊↔圈↔记↔办↔域） | ✅ 通 | 实时重读源表 + 实时闸门；不依赖沉淀结果 |
| 私聊 → 群聊（个人记忆不污染群） | ✅ 通 | 共享导演只拿 `['world','moment','todo']`（`group-store.ts:129`）；有断言 `shared group director sees no actor-private memories` |
| 私聊 → 星域单角色 | ✅ 通 | 单角色世界能拿到私聊摘要/关系/心情/生活；有 4 条断言守护 |
| 星域 → 私聊 | ✅ 通 | `scene-recall` + `world-recall`；撤回可见性即刻生效（有断言） |
| 朋友圈 → 召回 | ✅ 通 | 含"仅自己可见覆盖直接追问"断言 |
| 主动消息 → 记忆 | ❌ 不通 | 无召回（§5-M5） |
| 私聊 → 朋友圈公开评论 | ⚠️ 半通（本轮已加披露审查） | 语义审查 fail-closed + 字面回声兜底，但语义改写仍有残留风险 |
| 备份导出/导入（同账号换设备） | ⚠️ 半通 | 墓碑合并单调、逐表 `blocksImport`，但 3 个漏点 + 1 个反向过度拦截（§5-M1/M2/M3） |
| 局域网跨账号同步 | ❌ 不通 | 被自身归属守卫拒绝（§5-M4） |
| 换角色（删除重建 / 新角色） | ❌ 不通（设计如此） | 新角色只导入 ≤12 条用户记忆并标注「用户创建你时主动分享的背景（不是你亲历）」（`memory-repo.ts:228-256`），且标 `legacy`，被 `claimsKnownBy` 的墓碑映射跳过 |
| 注销 → 彻底清除 | ⚠️ 半通 | 注销**不清理账本 5 张表与待办/群/联系人**（§5-L3），且没有任何验收套件跑过 `deleteAccount()` |

---

## 5. 问题清单

> 每条都给触发路径、影响、证据 `file:line`。标 **[未复核]** 的条目来自委派审计的静态阅读，未由我逐行再确认。

### 🔴 H1【高】日记「加入共同世界」绕过日记专属闸门，进入多人共享的世界提示词

**触发**：日记 → 「🌍 共同世界」（`DiarySharing.tsx:113`）→ 进星域或触发脉冲。

**链路**
1. `setDiarySharing` 建世界事件：`visibility:'world'`、`summary = diary.content.slice(0,200)`、**不设 `visibleTo`**（`diary-visibility.ts:113-131`，正文截断在 120-126 行）。
2. `isVisibleToCharacter` 靠 `date/content/title` 三字段识别"日记型主体"（`visibility.ts:34-41`）；WorldEvent 只有 `title/summary` → **对任意角色恒 true**。
3. 两处共享层只按 `visibility==='world'` 取事件、**不调用 `isMentionableDiaryEvent`**：
   - `world-context.ts:181` → `renderEventLayer`（`world-context.ts:376-382`）→ `renderWorldBrief`（`:403-414`）→ **Director**（`world-director.ts:205`）/ **Narrator**（`world-narrator.ts:74`）/ **Settlement**（`world-settlement.ts:471`）
   - `world-autonomy.ts:187` → `:206` **世界编排器** prompt
4. Narrator 旁白会落成场景正文（`world-turn.ts:589-599`），`appendEntry` 的 `witnessedBy = scene.characterIds`（`world-scene-repo.ts:268-271`）→ 扩散到所有在场 actor（`world-actor.ts:143`），并进入私聊"进行中星域"召回（`scene-recall.ts:107-115`）。

**影响**：只授权给**一个**角色的日记正文前 200 字，会进入多人共享 prompt，并可能以旁白形式被其他角色"说出来"。这与 `diary-repo.ts:67-70` 的自述口径和 `visibility.ts:36-39` 的注释（"日记不是对共享本地世界的所有角色群发公告"）直接冲突。

**为什么这轮没被发现**：工作树这一轮已经把**群聊共享导演**和**朋友圈评论**的同类问题修掉了（并且加了断言），星域共享层漏了。现有断言覆盖的是 `listVisibleToCharacter` / `findRelevantHistory` 这两条**召回**路径（`scripts/verify/character-memory.ts` 的 `world diary stays hidden from characters without diary participation and knowledge`），**没有覆盖共享 prompt 路径**。

**建议**：把"世界层可公开事件"收敛成一个函数（如 `listPublicWorldEvents(worldId,userId)`），内部对 `sourceType==='diary'` 的事件要求该事件**不是**日记授权产物或已失去所有个人授权；或在 `diary-visibility.ts` 写事件时改为 `visibility:'selected', visibleTo:[characterId]`，让它天然进不了 `visibility==='world'` 的共享层（同时补一条"共享层不得含日记正文"的断言）。

---

### 🟠 M1【中】导入时 `characterKnowledge` 用 `?? 0` 比版本 → 恢复备份后静默丢认知

`sync.ts:555-561` 用 `k.sourceRevision ?? 0` 去比 `worldEvent` 的 `superseded` 墓碑（墓碑 revision 来自事件旧 `updatedAt`，`world-event-repo.ts:203-213`）；而**所有授予认知的 upsert 都不写 `sourceRevision`**（`world-writer.ts:120/183/300`、`scene-runtime.ts:479`、`world-canvas.ts:264`、`world-settlement.ts:309`），并且 `syncContinuityThreadToWorld` 每次都会 update 事件（`world-writer.ts:177-182`）。

**影响**：新设备恢复备份后，角色**静默失去**该世界事件的认知（"记忆没随人走"，而且没有任何提示）。这是"过度拦截"方向的反向 bug。

**建议**：授予认知时写 `sourceRevision`；或导入侧对 `characterKnowledge` 改用"存在即可导入 + 以墓碑 sourceId 精确拦截"的策略，并对缺失 revision 的行 fail-open（认知本身不是隐私泄漏面）。

---

### 🟠 M2【中】共同事件完全无失效机制 + 导入无条件写入

- `MemorySourceTombstone['sourceType']` 没有 `sharedStoryEvent`（`db/index.ts:960`）。
- `sharedEventRepo.remove` 只 delete（`:126-128`）。
- `sync.ts:477-482` 裸 `put`，**不查墓碑**。
- 这些事件会直接进私聊 prompt（`ChatWindow.tsx:608` → `chat-context.ts:341-357`）。

**影响**：删除/改写过的共同事件会从旧备份**复活**，并重新进入私聊上下文。

---

### 🟠 M3【中】屏蔽角色不失效已派生记忆；`blocked` 状态可被旧备份抹掉

- `block()`（`moments-repo.ts:796-812`）只写 `momentContacts` + 取消 queued job，**没有任何墓碑 / claim / knowledge 失效**；即时停止召回靠实时闸门（`character-memory.ts:132`）——这一条是有效的（有断言 `blocking immediately revokes recall`）。
- 但 `momentContacts` **无墓碑类型**（`db/index.ts:960`），导入是**整行覆盖**（`sync.ts:691-693`）。

**影响**："先 muted 后 block，再用只含 muted 的旧包恢复"会丢掉 `blocked` 字段 → 屏蔽失效。已进入账本的知识也不因屏蔽而撤回。

---

### 🟠 M4【中】跨账号局域网同步被自身归属守卫拒绝

`sync-store.ts:67-91` 的 remap 只覆盖 5 张表，`importSyncData` 于是会在 `sync.ts:216-227` 检测到两个 userId 并报 `'同步数据缺少唯一账号归属信息…'`。

**影响**：fail-closed（不会串号，这点是对的），但"跨设备记忆随人走"实际不可用。

---

### 🟠 M5【中】主动消息完全不召回记忆

`chat-store.ts:498` → `ipc.proactive.generate` → `src/lib/ai/proactive-chat.ts`（全文件无 `recallCharacterMemory`）。

**影响**：角色主动开口时，看不到任何记忆/关系/世界状态，"主动想起你"的体验缺失；也意味着主动消息不可能"带出"跨模式记忆——这既是互通缺口，也是目前最安全的一条路径。

---

### 🟡 L1【低】置顶记忆不随来源消息删除/编辑失效

`memory-repo.ts:137`（注释声明是**有意设计**：独立置顶事实保留）与 `:157`：`shouldSupersede = isAggregateSummary || (!memory.pinned && remainingIds.length === 0)`。置顶非聚合记忆的来源全删后仍 `status:'active'`、`sourceMessageIds:undefined`，继续被注入；且此路径**不写 `memory` 墓碑**，导入侧挡不住（`sync.ts:424-432`）。

工作树这一轮已经处理了**置顶会话摘要**这一类（`retireDetachedPinnedSessionSummaries`，`memory-repo.ts:121-135`，有断言守护），但普通置顶事实仍是开口。

### 🟡 L2【低】场景正文删除/改写无墓碑

`world-scene-repo.ts:352-354`、`:363-367` 只 delete/put，不写墓碑；对应 `memory-ledger-repo.ts:288-297` 的判定因此可能放过旧正文。

### 🟡 L3【低】注销账号残留 + 套件从未跑过 `deleteAccount()`

`chat-store.ts:677-709` 删了 memories / moments / diaries / continuity / sharedEvents / world / tombstones / users，但**没有清** `memoryClaims` / `memoryEvidence` / `memoryKnowledge` / `memoryJobs` / `memoryUsage`、`todos` / `todoOccurrences`、`groups`、`momentContacts`。

另外：全仓验收套件**没有一处调用 `deleteAccount()`**；`phase1.ts:357` 那条 `'注销清理后世界层为空'` 实际是在套件**自己调用 `worldRepo.clearForUser` 之后**做的断言，名字有误导性。

### 🟡 L4【低】`memoryLedgerRepo.revokeSource` 是死代码

`memory-ledger-repo.ts:331-350` 全仓零调用。失效完全依赖"每条删除路径都记得写墓碑"，缺少兜底。

### 🟡 L5【低】若干查询缺 userId 维度

`knowledge-repo.ts:68-84/123-130`、`world-undo.ts:154`、`emotion-store.ts:152-160`。当前调用方都先做了归属校验，所以暂时不可利用；属于"防御纵深"缺口。

---

## 6. 被证伪的说法（记录下来，避免以后重复怀疑）

- ❌ **"群聊会把老消息写给新入群的成员"** → **不成立**。`group-store.ts:241` 过滤 `witnessedByAll(message, members)`，而 `witnessedByAll`（`group-store.ts:92-94`）是严格的 `message.witnessedBy?.includes(id)`，**没有**"缺失快照就放行"的兜底；所有消息写入都经 `messageRepo.create`（`message-repo.ts:75-77`），因此 `witnessedBy` 恒为在场快照。补一条：验收套件里有 `late joiner cannot inherit old memory` 与 `legacy messages fail closed` 两条断言守护。
- ❌ **"记忆账本在跨模式召回中被读取"** → 不成立，见 §0.1-6。

---

## 7. 测试覆盖现状

**目前真的在守记忆系统的套件**（工作树实测结果，`.last-result-*.txt` 16:12–16:13）：

| 套件 | 结果 | 说明 |
|---|---|---|
| `character-memory` | **ALL PASS（137 断言）** | 主力套件：私聊/群聊/朋友圈/日记/待办/星域召回、按 actor 分片、披露边界、提取幂等、来源改版与撤回、claim-source 粒度、墓碑、跨账号边界、旧备份、口说冷却、多来源存活、置顶摘要清理、单角色世界复用私聊上下文、隐私边界 |
| `moments-autonomous` | ALL PASS（14） | 含"评论可参考本人记忆 + 语义/字面披露审查" |
| `worldG` | ALL PASS（13） | 世界 IA 回归（世界 A–E 的替代者） |
| `moments` | ALL PASS（39→） | 朋友圈可见性与互动 |
| `phase1` / `index` | ALL PASS | 基础链路 |
| `worldA–worldF`、`phase2b3/4/5/6`、`phase3b` | ALL PASS | — |
| **`phase2a`(21 FAIL) `phase2b0`(3) `phase2b1`(17) `phase2b2`(3) `phase3`(10) `phase3c`(10)** | ❌ **FAIL** | 全是**世界 IA 改版前的旧断言**（世界页文案/入口、旧舞台分支等），失败原因是"预期文案 vs 新 UI"，不是记忆系统回归。`worldG` 是它们的替代套件 |

**受影响的覆盖缺口**（对应 §5 的问题）：

| 缺口 | 现状 |
|---|---|
| H1 日记内容进入共享世界 prompt | **无任何断言**（现有断言只覆盖召回路径 `listVisibleToCharacter` / `findRelevantHistory`） |
| M1 `characterKnowledge` 恢复丢认知 | 无断言 |
| M2 `sharedStoryEvents` 逐表导入拦截 | 无断言（`sync.ts` 漏点本身也没有保护性断言） |
| M3 `momentContacts` 整行覆盖 | 无断言 |
| M4 跨账号局域网同步 | 无断言 |
| M5 主动消息召回 | 无断言（因为功能不存在） |
| L3 `deleteAccount()` 全表清理 | **无任何套件调用 `deleteAccount()`** |
| L1 普通置顶事实 | 有部分断言（置顶摘要）；普通置顶事实的来源删除无断言 |

**另需注意（不属于记忆系统，但会误导"全绿"判断）**：`scripts/verify/README.md` 的合计断言数与 `run-all.ps1` 的统计口径这一轮已修正；但 phase2a/2b*/3/3c 的失败**没有在 README 里标注为已废弃**，容易被误读成"全部 ALL PASS"。

---

## 8. 我没能验证的部分（诚实清单）

1. 桌面端 / 服务端（`server/`、`F:\VirtuGene`）的 `/sync/import` 归属校验**不在本仓库**，未审。
2. 全部结论来自**静态阅读 + 现有套件的断言名**，未做真机运行时验证，也未跑写库脚本（按"先不改代码"的要求）。
3. `clearWorld` / `clearForWorld` 源码中无调用方，但不能排除动态调用。
4. "移出群是否应当撤销已派生的个人记忆"属**产品裁定**：`group-store.ts:768-773` 只改 `characterIds`，不写墓碑也不失效 claim。目前的语义是"他确实在场过，所以记忆保留，只是不再从群聊这条渠道召回"。我倾向于**保持现状**（撤销会与"他真的经历过"冲突），但需要你拍板。
5. 「收藏为共同记忆」（`world-writer.ts:238-305`）不校验消息归属，目前只有私聊入口可达；如果以后开放更多入口需要重新评估。

---

## 9. 建议的修复批次

**P0（隐私，一个用户就能踩到）**
1. H1：星域共享层过滤日记型世界事件（或让日记授权事件不再是 `visibility:'world'`）→ 补一条"共享 prompt 不含私有日记正文"的断言。
2. M3：给 `momentContacts` 加墓碑类型 + 导入改为字段级合并（`blocked` 只增不减）。

**P1（"记忆随人走"闭合）**
3. M1：`characterKnowledge` 写入 `sourceRevision`，或导入改为 fail-open + 精确墓碑拦截。
4. M2：新增 `sharedStoryEvent` 墓碑类型 + `sharedEventRepo.remove` 写墓碑 + 导入查墓碑。
5. M4：`sync-store` remap 覆盖全部表，或明确把"跨账号同步"标记为不支持并从 UI 移除。
6. L3：`deleteAccount()` 清账本 5 张表 + 待办 + 群 + 联系人；在验收套件里真跑一次 `deleteAccount()` 并断言全表为空。

**P2（体验与纵深）**
7. M5：主动消息接入"轻量召回"（只取关系 + 1–2 条高相关记忆，budget 很小），并受同样的闸门约束。
8. L1/L2/L4：墓碑兜底（统一在 repo 层写墓碑）、清理死代码、给缺 userId 的查询补维度。
9. 测试：把 `phase2a/2b0/2b1/2b2/phase3/phase3c` 明确标注为「已由 worldG 取代」，或者干脆归档，避免"全绿"误读。

---

## 10. 一句话总结

权限闸门是**每轮实时重算 + 来源快照**，跨用户隔离得住，**"不越权"大体成立**；
但记忆在两条路上没有真正"随人走"——**备份恢复**（认知静默丢失、共同事件与屏蔽状态会被复活）与**跨设备同步**（被守卫拒绝），
并且**星域共享提示词仍然拿得到只授权给单个角色的日记正文**（同类问题在工作树这一轮已在群聊/朋友圈修掉，星域漏了）。

---

*本报告为只读审计产物，未修改任何产品代码。所有 `file:line` 对应 2026-09-25 工作树状态（HEAD `12c3b40` + 未提交改动）。*

---

## 11. 处置结果（审计之后的改造轮，2026-09-25）

这一节记录 §5 每一条发现**后来怎么处理**的，以及为"记忆随人走 + 全模式互通"做的结构改造。
实现提交与验证方式见文末。

### 11.1 结构改造：一个召回服务，一套连续记忆

| 目标 | 实现 |
|---|---|
| 所有模式只走一个召回服务 | `buildCharacterMemoryContext`（`src/lib/character-memory.ts`）成为唯一入口：调用方只传 **角色 / 话题 / 场景 / 听众**（外加预算与排除项）。私聊、群聊（共享导演 + 每个发言者）、星域（每个 actor）、朋友圈自主评论全部改走它；`recallCharacterMemory` 退化为同一条管线的旧签名别名 |
| 来源集合不再由页面决定 | `mode: 'private-chat' \| 'group-chat' \| 'world-scene' \| 'moments-comment'` 决定默认来源；群聊听众 > 1 时只给"所有成员都有权知道"的内容，单个发言者仍取自己的完整档案 |
| 召回意图只有一份判断 | `detectRecallIntent` 取代私聊/群聊/朋友圈各自的正则 |
| 结构化分区，调用方不再拼长期记忆 | 返回值新增 `sections`（profile / episodes / promises / crossChannel / recent / historical）与 `provenance`（`learnedBy`: witnessed / said / viewed / told）；`withCatalog: true` 时另返回 `catalog`（记忆行 / 约定 / 日记 / 共同记忆 / 已结束片段 / 他知道的事件 / 待办），星域因此不再自己去读那 5 张表 |
| 同一事实只占一个区块 | 私聊记忆行 → 画像区块；群聊/日记/待办 → 跨模式区块；星域与朋友圈由页面自己的区块渲染，服务那一份不重复注入（`phase3b` 的"同一件事只在 prompt 里说一次"三条断言继续成立） |
| 摘要作索引、原文作证据 | 私聊：明确追问旧事时由服务调 `recallHistoricalPrivateChat` 回查**原话**（原来这段逻辑在 ChatWindow 里）；星域：新增 `findSceneSegmentHistory`（`scene-recall.ts`）按关键词检索**进行中**片段里较早的正文，最近 12 条不重复注入 |

### 11.2 发现清单的处置

| 编号 | 处置 | 证据 |
|---|---|---|
| **H1 日记正文进入共享世界提示词** | ✅ 已修 | 新增 `isSharedWorldEvent`（`world-event-repo.ts`）：共享层判据 = `visibility==='world'` **且** 不是日记授权的现实记录；`world-context.ts` 与 `world-autonomy.ts` 两处共享层改用它。新套件断言：授权角色仍看得到自己的日记，而 `renderWorldLayer` / `renderWorldBrief` / 其他角色都拿不到正文 |
| **M1 `characterKnowledge` 导入 `?? 0` 导致恢复后静默失忆** | ✅ 已修 | 新增 `knowledgeRepo.grantForEvent`（授予时记录来源版本），8 处授予点全部改用它；`sync.ts` 导入侧只在**确实带版本**时才用 `worldEvent` 墓碑拦截（日记仍 fail-closed） |
| **M2 共同事件无墓碑、导入无条件写入** | ✅ 已修 | `MemorySourceTombstone.sourceType` 增加 `sharedStoryEvent` / `characterLifeEvent`；`sharedEventRepo.remove` 写墓碑；`sync.ts` 两张表都改为"查墓碑 + 版本比较" |
| **M3 屏蔽状态被旧备份整行覆盖** | ✅ 已修 | `sync.ts` 的 `momentContacts` 导入改为 `blocked` / `muted` **并集合并**，旧备份无法抹掉屏蔽 |
| **L1 置顶记忆与来源脱钩后无墓碑** | ✅ 已修 | `invalidateUnpinnedMemoriesForMessages` 在"保留置顶事实但来源已全删"时补写 `memory` 墓碑 |
| **L3 注销残留账本/待办/群组** | ✅ 已修 | `chat-store.deleteAccount` 增补 `memoryClaims/Evidence/Knowledge/Jobs/Usage` + `todos/todoOccurrences/todoReminders` + `groups`；新套件在最后真的跑一次 `deleteAccount()` 并断言这些表为空 |
| **服务端/跨设备：`sync` 归属守卫、局域网同步** | ⏸ 未动 | §5-M4 仍按 fail-closed 拒绝跨账号同步；服务端 `/sync/import` 不在本仓库 |
| **M5 主动消息不召回记忆** | ⏸ 未动（P2，见 §9） | 需要产品口径：主动消息该"想起"多少 |
| **L2 场景正文删除/改写无墓碑** | ⏸ 未动 | 与 §5-L4（`revokeSource` 死代码）一并留待下一轮 |
| **L5 若干查询缺 userId 维度** | ⏸ 未动 | 当前调用方都先做了归属校验，属防御纵深 |

### 11.3 出场状态语义修正（用户口径第 4 条）

`entryMemoryMode` 现在只决定**这场戏的正文从哪开始**：

- `memory`（默认）：这段经历 + 自己的全部过往。
- `present`（**从此刻开始参与**）：不继承入场前的本场正文（`participantReadsEntry` 按 `enteredAt` 时间戳判定），**但仍保有自己的私聊、群聊、日记授权与既有经历**。旧实现会让同一个角色换个入口就像换了一个人。
- `amnesiac`（新）：明确标注的失忆玩法，才压掉他自己的过往记忆。

三个入口（`world-context.ts` / `scene-runtime.ts` / 记忆引用校验）共用 `world-scene-repo.ts` 的
`participantReadsEntry` 单一判据——顺带修掉了旧实现里的口径冲突（`sceneEntriesAvailableToAudience`
原先优先看写入当刻的 `witnessedBy` 快照，而那个快照天然包含入场后加入的角色，与另外两处的时间戳判定相反）。
UI 文案同步改为「带上与你的记忆 / 从此刻开始参与 / 失忆设定」。

### 11.4 验收

新增 `scripts/verify/memory-continuity`（真实 IndexedDB、零网络），逐条实现用户给的 6 条场景，
另加写入侧回归（旧备份复活、屏蔽合并、认知版本恢复、注销清账本），共 **63 条断言 ALL PASS**。
`character-memory` 因 `present` 语义变化更新了 2 条断言并新增 2 条（现 **139 条 ALL PASS**）；
`worldA–worldG`、`moments`、`moments-autonomous`、`phase1`、`index`、`phase2b3–2b6`、`phase3b` 全部 ALL PASS。

`phase2a` / `phase2b0` / `phase2b1` / `phase2b2` / `phase3` / `phase3c` 仍是改造前就红的
**世界 IA 旧断言**（合计 64 条失败，与改造前逐条相同），已在 `scripts/verify/README.md` 标注为
由 `worldG` / `worldD` 取代。
