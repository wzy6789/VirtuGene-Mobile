# 深色设置、动态效果与模型接入

2026-10-02，基于项目当前 5.3.0 工作区实现。

## 设置与界面

继续使用深色优先的设置体系与本地中文字体；后续已统一为星域深蓝、紫色和青色，见 [星域设置与触控精修](STARFIELD-SETTINGS-TOUCH-2026-10-02.md)。首页保留分类导航，搜索支持常见服务商名称、API 地址、本地模型及动态效果。AI 连接页显示当前默认模型和配置状态，并区分服务商配置与可选的 DeepSeek 账号密钥。

服务商页提供搜索、全部/已配置筛选，以及单个服务商详情：密码输入、API 根地址、启用状态、精确模型 ID、图片能力、获取平台模型、连接检测、取消检测、保存和清除密钥。地址和模型元数据可以持久化；密钥继续使用设备 AES-GCM 加密存储。配置成功与实际连通检测结果分别显示。语音识别设置继续使用独立入口及原有密钥名称。

默认模型和会话模型都使用服务商加模型 ID 识别，支持模型列表查询和手动填写部署 ID。历史会话的固定选择不被全局默认设置覆盖。未配置的服务商不会被会话选择器列为可用；用户选择不会在失败时被悄悄替换成另一家服务商。

账号可以先创建再接入模型。没有 DeepSeek 密钥的本地账号可恢复登录和重新登录。更换 DeepSeek 账号密钥会同时更新密码加密的账号记录和设备恢复存储，异步结果不会更新已经切换的账号。

## 接入范围

| 服务商 | 接口方式 | 官方参考 |
| --- | --- | --- |
| DeepSeek | Chat Completions；保留原有自建网关 | [接口文档](https://api-docs.deepseek.com/) |
| 千问 Qwen | OpenAI 兼容；可更改地区地址 | [百炼兼容接口](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope) |
| 小米 MiMo | OpenAI 兼容 | [平台文档](https://platform.xiaomimimo.com/docs) |
| OpenAI | Chat Completions；推理模型参数处理 | [模型与接口](https://developers.openai.com/api/docs/models) |
| Anthropic Claude | 原生 Messages；原生 SSE | [Messages 与流式事件](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| Google Gemini | 原生 generateContent/streamGenerateContent | [生成接口](https://ai.google.dev/api/generate-content) |
| Kimi / Moonshot | OpenAI 兼容 | [聊天接口](https://platform.moonshot.cn/docs/api/chat) |
| 智谱 GLM | OpenAI 兼容 | [智谱文档](https://docs.bigmodel.cn/) |
| 豆包 / 火山方舟 | OpenAI 兼容；支持精确模型或接入点 ID | [火山方舟接口](https://www.volcengine.com/docs/82379/1298454) |
| MiniMax | OpenAI 兼容 | [兼容接口](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| xAI / Grok | OpenAI 兼容 | [聊天接口](https://docs.x.ai/developers/rest-api-reference/inference/chat) |
| 硅基流动 SiliconFlow | OpenAI 兼容 | [快速开始](https://docs.siliconflow.cn/docs/userguide/quickstart) |
| Groq | OpenAI 兼容 | [兼容说明](https://console.groq.com/docs/openai) |
| OpenRouter | OpenAI 兼容 | [聊天接口](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) |
| 自定义服务 | OpenAI 兼容；支持本机/局域网模型服务 | 以服务实际提供的模型 ID 为准 |

适配的是现有产品使用的文本、结构化回复、流式回复与已声明支持的图片输入。平台模型权限、型号、限流、价格和图片能力以用户账户及平台文档为准。预设不会保证账户可调用。发现模型和手动 ID 可以覆盖后续新增模型；未知价格不推断为免费。

普通聊天、助理结构化请求、群聊、日记辅助、角色生成/融合、声线判定、情绪分析、记忆提取、对话摘要及星域使用选定模型路由。仅配置 Claude、Gemini 或无需密钥的本地服务也能使用这些入口。现有自建网关仍仅代理 DeepSeek；其他服务商通过各自配置接入。

## 流畅度

移除不透明聊天头部、输入区和导航层不必要的模糊计算。弹窗覆盖时暂停背景动效，关闭后继续原进度；应用切到后台时暂停持续动效。

页面快照限制为 900 个元素、1,800 个元素及文字节点、200,000 个字符。超出预算或包含不应复制的内容时使用进入动画，避免长记录克隆造成卡顿。手势方向锁定、返回撤回、动画接管和滚动位置继续保留。

「外观与阅读 → 减少动态效果」持久化，并在第一帧前同步。系统设置同样生效。切换时清理正在运行的页面、弹窗、助理展开、局部数值、标签排列、图片预览和字号回弹动画，停止字号平滑滚动，同时保留必要的操作状态反馈。

## 验证

- TypeScript 类型检查与 Vite 生产构建通过。
- `providers.mjs`：310 项协议和真实功能路由断言，含 Claude/Gemini/本地服务的独立配置、精确 ID、图片、流式中断、超时、取消、错误处理和群聊隐私校验。
- `run-models-ui.cjs`：66 项模型及 API 界面检查，含密钥读回、发现/保存/测试/取消、账号变化、语音密钥隔离与 320px 布局。
- `run-settings-ui.cjs`：55 项真实设置状态与布局检查。
- `run-motion-preferences.cjs`：15 项真实设置开关、持久化、重载、动态效果中途取消、系统偏好与窄屏检查。
- `run-page-motion.cjs` / `run-modal-motion.cjs`：29 / 27 项页面和弹窗交互检查。
- `run-secretary-disclosure.cjs`：7 组实际助理展开、反向、尺寸变化和账号替换检查。
- `run-secretary.cjs`：404 项数据检查和 114 项界面检查通过。
- `run-api-onboarding.cjs`：12 项真实 Vite 应用流程检查，包括无密钥注册、本地模型设置、重启、重新登录及更换账号密钥后的加密恢复。

模型与连接验证使用隔离数据和模拟接口，没有使用真实服务商密钥或付费请求。真实账户连通性需在服务商配置页执行连接检测。没有据此宣称实际手机上的固定帧率。
