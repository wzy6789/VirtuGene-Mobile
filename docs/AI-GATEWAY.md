# VirtuGene AI 网关

移动端生产包不应携带 DeepSeek、Qwen 或 MiMo 的供应商密钥。`server/gateway.mjs` 是一个零依赖的最小网关，用于把供应商密钥放在服务端，并提供请求大小、频率和每日额度限制。

启动：

```powershell
$env:DEEPSEEK_API_KEY = "服务端密钥"
$env:VIRTUGENE_GATEWAY_TOKEN = "部署平台生成的访问令牌"
$env:GATEWAY_CORS_ORIGIN = "https://你的正式域名"
node server/gateway.mjs
```

客户端构建时设置 `VITE_AI_GATEWAY_URL`。正式版本使用登录后签发的短期用户令牌；不得把服务端密钥或共享访问令牌编译进 APK。没有配置网关地址时，应用继续使用本地 BYOK 路径，便于离线开发和迁移旧用户。

健康检查：`GET /health`。

聊天接口：`POST /v1/chat`。网关只接收角色设定、最近消息和当前消息，不接收供应商密钥；服务端返回与现有 `VirtuGeneAPI.chat.send` 兼容的 `content`、`usage`、`modelId` 和 `truncated` 字段。

辅助接口：`POST /v1/aux`，支持 `memory`、`emotion`、`context-settle`、`context-summary` 和 `diary` 五类任务。请求体为 `{ operation, payload }`，服务端只返回对应的 JSON 结果，客户端不需要知道供应商模型和密钥。

## Linux 部署

### Release authentication

For a production build, set a separate signing secret on the server. Do not put
this value into `.env`, source control, or the APK:

```bash
openssl rand -hex 48
```

Add its output to `/etc/virtugene/gateway.env` as `GATEWAY_AUTH_SECRET=...`.
The gateway then provides these TLS-only endpoints:

- `POST /v1/auth/register` requires `{ username, password, adultConfirmed: true }`, creates an adult-only test account and returns a 12-hour access token plus a 30-day refresh token.
- `POST /v1/auth/login` requires the same adult confirmation, verifies the account and issues a new token pair.
- `POST /v1/auth/refresh` accepts a refresh token in `Authorization: Bearer ...` and rotates the access token.
- `DELETE /v1/auth/account` permanently deletes the authenticated gateway account and invalidates its tokens.

Passwords are processed on the HTTPS gateway and stored server-side only as an
individually salted `scrypt` digest. The old `VIRTUGENE_GATEWAY_TOKEN` remains
only for staged migration; remove it after the mobile build has been verified
with user tokens.

聊天响应始终经过服务端安全指令。明确、紧迫的自伤风险会在调用模型前进入固定的现实安全引导。客户端还需要持续显示 AI 内容标识，并在累计使用两小时后提醒休息。

将 `server/gateway.mjs` 上传至 `/opt/virtugene/gateway.mjs`，将 `server/virtugene-gateway.service` 上传至 `/etc/systemd/system/virtugene-gateway.service`。创建 `/etc/virtugene/gateway.env`，其中至少包含 `DEEPSEEK_API_KEY`、`GATEWAY_AUTH_SECRET`、`GATEWAY_CORS_ORIGIN`。`VIRTUGENE_GATEWAY_TOKEN` 仅在迁移期间保留。启用服务：

```bash
systemctl daemon-reload
systemctl enable --now virtugene-gateway
systemctl status virtugene-gateway
```
