# 生活助理：收件箱续办与补问中改口

日期：2026-10-02。基于已完成的对话状态与任务焦点，本轮改善旧事项的恢复入口，以及待办尚未创建时的连续设置。按照用户要求，暂不开展完整真实模型和 Android 真机验收。

## 使用变化

- 暂停的无操作补问保留在收件箱“待处理”，首页数量使用同一筛选规则。
- 同任期尚未完成的事项提供“继续这件事”。点击后核对来源和状态，暂停其他当前补问，选中这一件事，并在聊天输入框准备“继续刚才那个”。点击本身不调用模型，不创建日记、待办或朋友圈；实际发送后才恢复，可以在另一聊天继续。
- 完成、取消、已被接续消费的旧上下文、已删改/遗忘的来源、其他账号及旧任期不能借此再次执行。执行中的聊天禁用选择入口，快速重复点击由本地锁隔开；规划提交时再次核对焦点版本。
- 补问卡展示原事项名称与已知日期时间，切换聊天后仍能看出正在处理哪一件事。旧日期继续沿用原请求解释依据。
- 待办补问支持“只记录，不提醒”“不用提醒，只记待办”“关闭提醒”等：保留标题和已知安排，清除提醒要求；标题确实缺少时仍询问标题。提供对应的“只记录，不提醒”按钮，经过真实用户消息发送流程办理。
- 支持补问中的重复和优先级改口，例如“不是每天，改成工作日”“改成紧急”。还可以一次说“明天，下午三点，改成重要，不提醒”，合并到原事项；每段都能本地识别才合并，未知段落交回正常理解。
- 关闭提醒不能替用户解决原先的日期冲突。仍有两个日期待选时保持补问，选择之后才创建。

## 实现位置

- `src/lib/secretary/agent.ts`：`selectSecretaryConversation` 事务化选择、来源与任期核对、暂停原焦点、提交时焦点版本检查。
- `src/lib/secretary/pending-context.ts`：明确设置改口、多字段合并、冲突保留和缺字段重算。
- `src/lib/secretary/inbox.ts`：暂停事项与待处理范围一致。
- `src/components/secretary/SecretaryInboxModal.tsx`、`src/components/chat/ChatWindow.tsx`：收件箱入口、续办草稿、发送期间禁用与失败说明。
- `src/components/chat/SecretaryTaskCards.tsx`：当前事项信息和只记录按钮。

无需新增数据库版本；使用现有任务上下文及工作区焦点。没有改写旧聊天正文，也没有让导入建议自动执行。旧任期的具体操作仍使用原有卡片核对和手动交接。

## 本地验证

| 范围 | 结果 |
| --- | ---: |
| 助理数据与完整流程 | 847项通过 |
| 实际组件与聊天发送 | 134项通过 |
| 界面精修 | 21项通过 |
| 助理记忆及窄屏布局 | 60 + 4项通过 |
| 角色创建、朋友圈、统一记忆回归 | 19 + 40 + 46项通过 |
| 合计 | 1171项通过 |

新增26项数据检查和3项实际界面检查，覆盖选择不写入、跨聊天恢复、切回另一补问、已消费/来源删除/账号/任期拒绝、只记录且无提醒时间、一次多字段、缺标题、日期冲突，以及真实收件箱与输入框操作。收件箱在320/390/430px无横向溢出。TypeScript和Vite生产构建退出0；既有混合导入与大块体积提示仍在。

使用隔离Chrome、IndexedDB和React界面；模型及通知边界仍使用替身。完整真实模型表达、Android通知与设备键盘、长历史设备性能和真实旧备份实验继续保留为未实测门槛，不据本轮结果宣称满分交付。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/verify/build-secretary.mjs --with-regressions
node scripts/verify/run-secretary.cjs
node scripts/verify/run-secretary-ui-polish.cjs
node scripts/verify/run-secretary-regressions.cjs secretary-memory character-create moments memory-unified
```
