# DeepSeek Flash 统一接入（2026-10-04）

所有 `provider: deepseek` 请求统一使用官方滚动别名 `deepseek-flash`，当前对应 DeepSeek V4.1 Flash。官方说明它原生支持图片，旧 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 对应模型已下线。来源：[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[思考参数](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。

## 接入与兼容

- `server/deepseek-policy.mjs` 为客户端与网关共用的模型/生成策略，不包含密钥。默认根地址保留 OpenAI 兼容的 `https://api.deepseek.com/v1`，已保存的代理地址仍生效。
- 客户端只展示一项 Flash，原生图片能力不能被旧配置覆盖。全局、角色、会话中旧 Chat、Reasoner、V4 Flash、Pro、实验视觉及其他 DeepSeek 选择，在解析与实际请求边界统一到 Flash；不改写会话历史。其他服务商的模型 ID 保持原样。
- 网关 `/v1/chat`、`/v1/chat/stream`、`/v1/aux` 均固定使用 Flash。旧 `DEEPSEEK_DEFAULT_MODEL` 环境变量和客户端提交的其他模型名不能改变托管模型。
- 普通请求使用思考模式 `reasoning_effort: low`，避免供应商默认 `high` 消耗短回复预算；不发送思考模式下被忽略的 temperature。图片、JSON 和显式恢复请求关闭思考。只减少无必要等待，未测量真实供应商首字延迟。
- 连接测试与账号密钥校验实际发送最多 16 输出 tokens 的 Flash 请求，使用设置中的地址；不再以模型目录可读作为生成成功。鉴权、余额、限流、超时仍分别反馈；空正文不能通过测试。配置界面说明少量测试费用。
- 私聊最多进行一次同模型恢复，保留原图片上下文；已显示正文的流式中断继续保留已收到内容。网关辅助请求空正文明确报错，不伪造 `{}` 成功。
- 费用估算沿用人民币高峰、未命中缓存单价（输入 2 元/百万、输出 8 元/百万）；缓存和空闲时段折扣以平台账单为准。

## 部署

更新客户端构建与网关。网关部署时，**必须把 `server/deepseek-policy.mjs` 与 `gateway.mjs` 放在同一目录**，再重启网关服务。现有 systemd 的 `/opt/virtugene/gateway.mjs` 布局可保留，旁边增加 `deepseek-policy.mjs`。类型文件 `.d.mts` 仅供开发，不是网关运行依赖。

本轮只修改并验证工作区代码，没有发布 APK 或修改线上网关。

## 验证

- `node scripts/verify/providers.mjs`：363 项真实浏览器协议/选择/辅助路由检查，包括旧选择接续、目录去重、原生识图、图片恢复、JSON 思考关闭、真实生成形态的连接测试及错误映射。
- `node scripts/verify/gateway-stream.mjs`：31 项本地 mock 上游 + 真实网关检查，覆盖所有托管入口、旧部署变量、旧会话选择、图像、辅助空回复、断流与取消。
- `node scripts/verify/world-stream.mjs`：19 项流式检查。
- `node scripts/verify/chat-stream.mjs`：44 项真实聊天、组件与 IndexedDB 回归。
- `node scripts/verify/build-models-ui.mjs` 后 `node scripts/verify/run-models-ui.cjs`：72 项配置界面检查，包括唯一 Flash 选项、旧 Pro 高亮接续与未保存地址的真实请求形态。
- TypeScript 类型检查与 Vite 生产构建通过。
- 启动隔离的 Vite 开发服务后，`VG_APP_URL` 指向该服务执行 `node scripts/verify/run-api-onboarding.cjs`：13 项真实应用登录/绑定密钥检查；测试确认绑定密钥会发出 Flash 极短请求。

上述供应商边界均使用隔离测试响应；未使用真实付费密钥验证供应商服务。
