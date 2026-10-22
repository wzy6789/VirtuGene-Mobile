# 长历史分页完整性与候选内存 · 2026-10-12

## 共用缺陷与实现

原 getPage 使用 createdAt < before，历史召回400条一页、聊天上翻200条一页。多条导入消息共用时间戳时，下一页跳过该时间戳剩下的原话。隔离数据库850条同毫秒记录实测，最早北港约定没有被召回；失败证据 release/global-chat-history-pagination-before-2026-10-12.log。

src/db/message-repo.ts 增加 beforeMessage（createdAt+id）值游标，沿 [sessionId+createdAt+id] 索引取严格之前的消息。已有 before 数字参数仍只按时间严格排除，getPage初次与续页均按同一稳定索引顺序。游标无需原边界行仍存在，已删除边界不会导致不能继续分页。稳定主键次序用于完整读取，不证明同毫秒消息的实际因果先后。

src/db/index.ts 仅增加存储结构34的消息三元索引，原 sessionId、时间二元索引保留；没有 upgrade 改写原记录、没有修改产品6.0.24/66。实际以旧结构33的850条原始记录升级，字段、正文、revision逐条完整比较通过。此小样本升级约24ms；没有测量五万条旧库升级耗时，不能据此推断大型数据库启动耗时。

src/lib/character-history-recall.ts 改用值游标，仍扫描本账号该角色的全部合法私聊，不以窗口裁掉旧来源。排名数组只保留请求的候选数量，每扫描一条更新最优候选；评分及时间优先级保留。最终关联的用户更正与开头原文仍独立追加，不假装整个返回结果永远只有K条。

src/store/chat-store.ts 使用相同游标上翻。等待期间用户切换会话、移除原边界时，旧结果不覆盖当前消息；并发上翻对已显示ID去重，并在当前消息数组上合并而非覆盖期间新消息。此守护针对当前聊天分页，不是完整的扮演身份隔离机制。

## 验证

- 15项真实IndexedDB专项通过：旧结构升级、850条同时间戳完整召回/分页、原记录保持、数字before兼容、跨会话边界、删除游标仍可翻页、真实chat-store完整上翻与并发/切会话、较强旧来源保留、3种规模密集命中。scripts/verify/history-pagination.ts/.mjs；release/global-chat-history-pagination-complete-2026-10-12.log。
- 355项记忆检查通过 release/global-chat-history-pagination-memory-2026-10-12.log。
- 22项实际私聊发送/数据库检查（模型替身）通过 release/global-chat-history-pagination-entry-2026-10-12.log。
- 266项私聊流式、19项世界流式通过 release/global-chat-history-pagination-stream-2026-10-12.log、global-chat-history-pagination-world-stream-2026-10-12.log。
- 类型检查通过 release/global-chat-history-pagination-types-2026-10-12.log。

首次JSON证据提取因PowerShell UTF-16日志解码错误失败，已按文件BOM正确读取后生成证据；不把失败提取记成成功。未重跑付费请求。

## 桌面性能样本

独立桌面Chrome、真实隔离IndexedDB，三组同时间戳密集关键词匹配；每组先写入合成记录，随后跑一次实际 recallHistoricalPrivateChat，候选请求3条。此为合成开发压测，不是 Android、真聊天、全记忆服务或冷启动指标。

| 消息条数 | 单次召回耗时 | 堆读取前字节 | 堆读取后字节 |
| --- | ---: | ---: | ---: |
| 1000 | 11.1ms | 18743918 | 18743918 |
| 10000 | 81ms | 21396551 | 24525457 |
| 50000 | 375.6ms | 30577508 | 54766262 |

数据 docs/GLOBAL-CHAT-HISTORY-PERFORMANCE-2026-10-12.json。堆值为浏览器报告的两个时点，不是峰值，不能宣称内存无增长或旧版与新版节省百分比。旧版无法完整读取同时间戳历史，不能拿漏读的速度做公平性能对照。本次仍逐页读取全部消息，尚未建立主题检索索引，规模增大时仍可能变慢；Android与大型旧库升级实测门槛未完成。

## 用量、记录与未完成

本轮真实模型调用0、token0、无新模型聊天原稿，不更新最佳聊天。只记录合成测试和实测工程指标。索引迁移和测试没有打包、生成APK、发布或更新官网。产品版本保持6.0.24/66，数据库内部结构从33升至34仅用于索引兼容。

下一阶段仍需通用身份/关系来源及跨扮演身份记忆隔离、检索索引与移动设备性能、封存/长对话/跨会话及多入口真实质量评估。当前检查不证明全局人味达标。
