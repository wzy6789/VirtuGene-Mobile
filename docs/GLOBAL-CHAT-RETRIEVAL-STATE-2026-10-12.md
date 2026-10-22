# 共用记忆读取状态与真实补问 · 2026-10-12

## 共用问题

既有记忆入口在读取失败时返回同样的空文本/空引用，与成功读取但没有选出资料无法区分。来源规则此前只是通用提示，模型仍把缺少记载说成负向回忆。不能由此断言全部模型问题都来自空文本，但应用确实没有提供这项状态。

## 实现

src/lib/character-memory.ts 在每次实时读取结果增加可选 retrieval 元数据：not-requested、no-match、references、unavailable、denied，附是否明确追问与已选引用数量。字段不持久化、不迁移旧数据、不改变旧text/references/provenance接口。候选引用不是已验证事件，no-match指这次未选出可引用资料，不代表不存在历史。

renderMemoryRetrievalStatus 只对明确追问生成状态段；普通闲聊、未查询、权限拒绝均不输出此段。异常状态明确表示本轮读取失败，而不是没发生。拒绝继续保留空文本，不泄漏另一账号或世界有无资料；多人场合仅请求私聊来源时不能误报已查询。

私聊发送将状态作为100优先级、完整保留的独立区块，与资料引用分开；若预算不足整段省略，不截断语义。现有主动消息、群聊演员、星域/故事片段、朋友圈评论及已存在语音上下文适配调用同一渲染器。群聊公共/私人读取状态在演员提示中分别标识，不进入共享导演；私人状态也不混进私密事实正文，不新增无事实时的披露审查调用。失忆/不携带记忆入口保持不注入。

涉及文件：src/lib/character-memory.ts、src/lib/chat/send-service.ts、src/store/chat-store.ts、src/store/group-store.ts、src/lib/ai/group-chat.ts、src/lib/world/world-context.ts、src/lib/world/scene-runtime.ts、src/db/moments-repo.ts、src/lib/voice-call/context.ts。新元数据不是身份状态机，未解决跨扮演身份归属。

## 验证与范围

- 修改前355套件中的新增第一条状态检查失败，原始证据 release/global-chat-retrieval-state-before-2026-10-12.log。
- 355项记忆检查通过，真实隔离IndexedDB、零网络；覆盖正常空结果/关闭查询/读取异常/权限拒绝/共享听众不允许私聊查找/找到实际原文及候选非事实。release/global-chat-retrieval-state-memory-final-2026-10-12.log。
- 22项实际私聊发送与数据库检查通过（模型替身），包含无匹配、原文候选、普通问候三种真实最终请求，新增状态不增加模型请求。release/global-chat-retrieval-state-entry-2026-10-12.log。
- 3854项表达机制检查通过，新增群聊导演/演员/演员重试状态隔离检查。release/global-chat-retrieval-state-expression-final-2026-10-12.log。
- 266项私聊流式、19项星域流式通过；release/global-chat-retrieval-state-stream-2026-10-12.log、global-chat-retrieval-state-world-stream-2026-10-12.log。
- 类型检查通过 release/global-chat-retrieval-state-types-final-2026-10-12.log。

这些不是全部入口的真实模型质量验收；主动、评论、世界和语音在本轮是适配接线及相关本地回归，不能声称各入口真实表达均达标。语音整体自身仍在其他工作中开发，本轮不宣称可用。

## 一条真实开发补测

既有Flash，同一已参与开发的原创师生角色，独立空会话问“还记得我们上次一起去书店时说好的事吗？”。预算3请求/16000 token/500输出，未增加服务。首答：“说实话，我一时没对上。你给个线索——哪家书店，或者当时说的是书的事还是别的？”没有具体旧回忆或无依据的未发生声明，保留具体补问。但只是一条开发样本，非封存、非长程，不能给全局人味/人格/胜率评分或声称因果已证明。

真实执行2次请求（一次回复、一次后台声音任务），总2056 token，knownUsageCalls=2、unknownUsageCalls=0、pendingCalls=0，读取均完成；账本在最终保存前等到两次已启动请求结算。回复首答无重试。具体完整耗时见原始row.durationMs；非流式桥接未测首字，不作速度改善结论。费用金额未按未核实价格估算。

原始 docs/GLOBAL-CHAT-RETRIEVAL-LIVE-DEV-2026-10-12.json，审计 docs/GLOBAL-CHAT-RETRIEVAL-LIVE-DEV-ASSESSMENT-2026-10-12.json，运行日志 release/global-chat-retrieval-live-2026-10-12.log。原始runner数组遗留一个未选中的心意输入，但版本循环明确只规划和执行本条旧约定探针；审计标记其为未使用模板，未来脚本已只保留本条输入。未覆盖旧证据。

完整单轮开发原稿同步手机版聊天分区“书店旧约定补问-原创开发样本.md”；不替换此前四轮会话、不拼接不同版本，不当作验收通过。

## 尚未完成与发布边界

来源状态让模型看到本次读取结果，仍不是语义事实校验或零虚构保证。跨扮演身份连续记忆、规模性能、未见角色与封存情境、长聊/跨会话、全局质量门槛仍未完成。版本6.0.24/66保持，未打包、发布或更新官网。
