# 星域改造验收状态（5.1.4）

承接上一轮未完成的收尾。这里记录：门槛验收集、修掉的两个接线断点、旧套件分类、版本与打包核对、以及**未完成项**。

---

## 一、门槛验收集（13 套 / 524 条断言，全绿）

```bash
# 前置：node scripts/verify/serve.cjs   （占用 17899）
node scripts/verify/build.mjs
node scripts/verify/run-suite.mjs phase1 worldA worldB worldC worldD worldE worldF worldG character-memory phase2b3 phase2b5 phase2b6 phase3b
node scripts/verify/world-stream.mjs      # BYOK SSE 分片
node scripts/verify/gateway-stream.mjs    # 网关流式 + 私聊仍非流式
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vite/bin/vite.js build
```

| 套件 | 断言 | 覆盖 |
| --- | --- | --- |
| phase1 | 81 | 4.x 旧数据零丢失、幂等迁移、跨用户隔离 |
| worldA–worldF | 283 | 星域统一播放器、旧世界兼容、结算幂等、重试去重、长世界翻页 |
| worldG | 1 行（13 条断言） | 新世界入口信息架构 |
| character-memory | 1 行（38 条断言） | 星域/群聊经历进入私聊记忆、选择性记忆、权限与知识分离 |
| phase2b3 / 2b5 / 2b6 / phase3b | 158 | 日记可见性、世界设置、年表、关系与连续性 |

结果：**PASS 13，FAIL 0，TIMEOUT 0**。类型检查与前端构建均通过。

---

## 二、修掉的两个接线断点（这才是上一轮卡住的真正原因）

### 1. `phase1.html` 不存在 → 被误判成"超时"

`run-suite.mjs` 让浏览器打开 `http://127.0.0.1:17899/phase1.html`，该文件缺失 → 404 → 页面什么都没跑 →
runner 等 150 秒后报 TIMEOUT。**不是 hang，也不是产品问题。** 补上 html 后：`phase1 PASS ok=81 fail=0`。

### 2. `character-memory` 从未真正跑起来 → 被误判成"星域经历进不了私聊记忆"

这个套件有三处缺失：没有 html、没进 `build.mjs`（没有 bundle）、结果文案是
`PASS n assertions…` 而 runner 只认 `ALL PASS` / `N FAILED`。

补齐后：**`character-memory PASS`，38/38 断言通过**，其中直接覆盖：

- `world to private recall`（星域经历能在私聊里被召回）
- `ongoing world memory available before settlement`（未结算的进行中世界记忆也可用）
- `absent character cannot recall live world`（不在场角色召回不到）
- `world visibility withdrawal wins over knowledge`（撤回可见性优先于"知道过"）
- `shared world memory available in group and private`
- 迟到加入者不继承、失败消息不召回、删除源不复活、跨账号隔离

**结论：角色仍然记得共同经历，这不是回归。** 上一轮的判断是装置问题。

---

## 三、旧套件分类（12 套：5 套保留，7 套按口径变更退役）

**没有为了让结果变绿而删除任何断言**：文件与断言原样保留，下面逐条给出原因、证据与替代覆盖。

| 套件 | 结果 | 分类 | 原因与证据 | 现在的替代覆盖 |
| --- | --- | --- | --- | --- |
| phase1 | PASS 81 | 保留 | — | — |
| phase2b3 | PASS 45 | 保留 | — | — |
| phase2b5 | PASS 48 | 保留 | — | — |
| phase2b6 | PASS 30 | 保留 | — | — |
| phase3b | PASS 35 | 保留 | — | — |
| phase2a | 21 FAIL | 口径已变 | 断言测旧世界首页区块（首屏统计 / 最近发生 / 还没做完的事 / 我的生活文案）。现在第一层是「世界 Living World + 朋友圈/日记/待办/星域 四个入口」（`MobileWorldPage.tsx:247-274`），统计与档案在第二层星域页（`:317-321`） | worldG ①–⑫、worldD |
| phase2b1 | 17 FAIL | 口径已变 | 「还没做完的事」不再在世界首屏，改由生活时间线弹层承担（`LifeTimelineModal.tsx:262` → `ContinuityThreadsModal`）；数据层能力与断言在 phase2b2 仍通过 | worldG ⑩⑪、phase2b2 |
| phase2b2 | 3 FAIL | 口径已变 | 「记忆」入口从首页挪到星域页档案 dock（`MobileWorldPage.tsx:319`）；「最近发生」挪进星域场景组件（`WorldSceneConstellation.tsx:117`） | worldG ⑪⑫ |
| phase2b0 | 3 FAIL | 口径已变 | 首屏「此刻」展开后的区块结构与类别文案（「你写下的生活」）已重写 | worldG ⑦⑧、worldD |
| phase2b4 | 2 FAIL | 口径已变 | 同上，首屏段落与展开文案 | worldG、worldD |
| phase3 | 9 FAIL | 契约搬家 | 测的是旧舞台管线 `runSceneTurn`（`scene-runtime.ts:196`）；统一播放器走 `runWorldTurn`（`world-turn.ts:387`），备用模型由角色层决定（`world-actor.ts:221-229` + `deepseek.ts:252`，**能力仍在**）；剧场页/世界页一级入口按任务书 §1 取消 | worldA–worldF、gateway-stream |
| phase3c | 10 FAIL | 产品口径已变 | 幕次与旧选项按钮按任务书 §5 与改造记录移除，改为世界流的自由输入 | worldE、worldF |

---

## 四、版本与打包核对

| 项 | 状态 |
| --- | --- |
| `package.json` | 5.1.4 |
| `src/lib/changelog.ts` | 顶部 5.1.4（5 条：统一播放器 / 世界流式 / 网关星域流式 / 三种结束语义 / 旧世界兼容） |
| `android/app/build.gradle` | **原为 `versionCode 24` + `versionName "5.1.3"`，与上面两处不一致 → 已修为 `25` + `"5.1.4"`** |
| 构建产物 | `android/app/build/outputs/apk/release/app-release.apk` |
| 包内版本 | `versionCode='25' versionName='5.1.4'`（aapt2 实测） |
| 签名 | `CN=Android Debug`，SHA-256 `ef38a01c…40:16`（自 5.0.4 起同一把 → 可覆盖升级，不会丢本地数据） |
| 体积 / 哈希 | 4,085,515 B（3.90 MB） / `bcd81ed1d13d05063aaec5296f1acf50650ce57a549c88e69d0bf2a2f502a687` |
| 线上最新 release | **v5.1.4（2026-09-22 发布）**：资产 `app-release.apk` 4,085,515 B，digest `sha256:bcd81ed1…`，下载回来逐字节一致 |

打包踩坑（已写进 `docs/BUILD-AND-RELEASE.md`）：`scripts/gh-release.mjs` 会**复用已存在的 release APK**，
而本轮开工时磁盘上那个是 5.1.3 的包（`4,084,231 B`）。不先删除就发布，会把 5.1.3 的包发成 5.1.4，
用户会一直看到"有新版本"却始终是 5.1.3。**打包前必须先删旧产物**，发布后要拿线上包回来核对包内 versionName。

---

## 五、未完成 / 未验证（不写成"全部完成"）

1. **Android 真机验收未做**：键盘、返回键、安全区、长世界滚动流畅度、系统"减少动态"生效情况。
   任务书要求分别用 BYOK 与网关账号实测，我没有设备。
2. **首段延迟没有实测数据**：任务书明确"不要承诺固定 2 秒出声"，要求记录
   "发送 → 首段有意义正文出现"的时间与失败率。这一项必须真机测，报告里不能写推测值。
3. **网关流式覆盖范围**：已测网关流式端点（10 条断言）与"私聊仍返回整段、不受影响"，
   但"所有账号都能流式"这一产品结论要按实际账号形态再确认。
4. **7 套旧套件按口径变更退役，需要你认可这个处置**（文件与断言都保留，理由与替代覆盖见上表）。
5. **5.1.4 已发布（2026-09-22）**：包内 `versionCode='25' versionName='5.1.4'`、签名证书未变、
   线上 digest 与本地构建一致、回下载 sha256 一致；真机验收仍未做，功能以线上包为准。

## 六、本轮另外补掉的一个工程隐患

`.gradle-local/`（1.09 GB）等构建残留目录此前**没有被 gitignore**，一次 `git add -A` 就会把 GB 级目录加进版本库。
已在 `.gitignore` 补上 `.gradle-local/`、`.gradle-user/`、`.user-home/`、`.android-user/`、
`.tmp-edge-preview/`、`.tmp-*.png`、`unicode-test*.txt`。

## 七、官网同步（v5.1.4）

版本号从 5.2.0 改回 5.1.4 后，官网 `website/` 与本仓库版本标识已统一：

- 提交 `b71185b`：`website/index.html` 全部 `v5.1.3` → `v5.1.4`（下载按钮 ×2、截图说明、
  界面区导语、Android 版本标签、release tag 链接）、`website/README.md` 下载入口、
  `main.js` / `styles.css` 头部注释；`package.json` / `changelog.ts` / `build.gradle` 一并入库。
- Pages 部署成功（run on `b71185b`），线上核对：`v5.1.4` 出现 8 次、`v5.1.3` 0 次，
  APK 直链 HEAD 200 且 `Content-Length = 4085515`，站内 19 个静态资源全部 200。
- 「约 3.9 MB」与线上资产 4,085,515 B 一致。

**已知待办（诚实性）**：官网图库那句"下面每一张都是当前手机端 v5.1.4 的真实界面"，
但 `world-home.jpg` / `scene.jpg` / `stage.jpg` 三张仍是 5.1.0 时期拍的**星域改造前**版面
（旧的「此刻卡片 + STORY ORBITS 剧情星域 + 消息/世界/角色/我的 底栏」）。
重拍要求：按当前构建在 412×915 dsf=2 下重截，导出 824×1830 JPEG q90，
并同步替换 `website/assets/product/source/*.png`；重拍画面与逐张屏上文字记在本节末尾。

注：`scripts/verify/world{F,G}.html`、`character-memory.html`、`gateway-stream.mjs`
标题里的「5.2.0」是改造期的**内部代号**，正式发版号已统一为 **5.1.4**；套件名与断言未变。
