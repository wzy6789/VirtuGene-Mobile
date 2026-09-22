/**
 * 网关流式端点验收（5.2.0）：
 *   node scripts/verify/gateway-stream.mjs
 *
 * 起两个进程：
 * 1. mock 上游（扮演 DeepSeek）：/chat/completions 支持 stream 与非 stream 两种形态；
 * 2. 真实 server/gateway.mjs（DEEPSEEK_BASE_URL 指向 mock）。
 *
 * 断言：
 * - POST /v1/chat 行为不变（整段 JSON，私聊接口不受流式改造影响）；
 * - POST /v1/chat/stream 返回 text/event-stream，逐帧转发内容并以 [DONE] 收尾；
 * - maxTokens / disableThinking 被透传给上游（世界管线需要）；
 * - 上游中途断开：响应立即收尾（客户端据此标记 interrupted，不重发）；
 * - 安全干预在流式端点同样生效（SSE 形态）。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
};
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/* ---------- mock 上游 ---------- */
const upstreamBodies = [];
const upstream = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    upstreamBodies.push(body);
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
      res.write(frame('星'));
      res.write(frame('域'));
      if (String(body.messages?.at(-1)?.content ?? '').includes('cut-test')) {
        // 上游异常断开：没有 [DONE]，连接直接收尾
        res.end();
        return;
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '整段' }, finish_reason: 'stop' }] }));
  });
});
const upstreamPort = await listen(upstream);

/* ---------- 真实网关 ---------- */
const dataDir = mkdtempSync(join(tmpdir(), 'virtugene-gw-'));
const gatewayPort = 18789;
const gateway = spawn(process.execPath, [join(root, 'server', 'gateway.mjs')], {
  env: {
    ...process.env,
    PORT: String(gatewayPort),
    HOST: '127.0.0.1',
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
    GATEWAY_ALLOW_ANONYMOUS: 'true',
    GATEWAY_DATA_DIR: dataDir,
    GATEWAY_RATE_LIMIT: '100',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let gatewayLog = '';
gateway.stdout.on('data', (d) => { gatewayLog += d; });
gateway.stderr.on('data', (d) => { gatewayLog += d; });

const gw = async (path, body) => {
  const response = await fetch(`http://127.0.0.1:${gatewayPort}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response;
};

// 等网关就绪
let ready = false;
for (let i = 0; i < 60; i += 1) {
  try {
    const health = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
    if (health.ok) { ready = true; break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 200));
}
check('网关进程启动', ready, gatewayLog.slice(-400));

if (ready) {
  /* 1) 私聊接口不变：整段 JSON */
  const plain = await gw('/v1/chat', { systemPrompt: 's', message: 'm' });
  const plainJson = await plain.json();
  check('① /v1/chat 仍返回整段 JSON（私聊路径不受影响）', plain.ok === true && plainJson.content === '整段', plainJson);

  /* 2) 流式端点：SSE 转发 + 预算/思考透传 */
  const streamed = await gw('/v1/chat/stream', { systemPrompt: 's', message: 'stream-test', maxTokens: 1200, disableThinking: true });
  const streamedText = await streamed.text();
  const upstreamStream = upstreamBodies.at(-1);
  check('② 流式响应是 text/event-stream', String(streamed.headers.get('content-type')).includes('text/event-stream'), streamed.headers.get('content-type'));
  check('③ 供应商帧被原样转发（含 [DONE]）', streamedText.includes('星') && streamedText.includes('域') && streamedText.includes('[DONE]'));
  check('④ maxTokens / disableThinking 透传给上游', upstreamStream?.max_tokens === 1200 && upstreamStream?.thinking?.type === 'disabled', upstreamStream);
  check('⑤ 上游收到 stream 与 usage 选项', upstreamStream?.stream === true && upstreamStream?.stream_options?.include_usage === true);

  /* 3) 上游中断：响应收尾、不挂起 */
  const cut = await gw('/v1/chat/stream', { systemPrompt: 's', message: 'cut-test' });
  const cutText = await cut.text();
  check('⑥ 上游中途断开：已转发的正文仍在响应里，连接正常收尾', cutText.includes('星') && !cutText.includes('[DONE]'), cutText.slice(0, 120));

  /* 4) 安全干预在流式端点同样生效 */
  const safety = await gw('/v1/chat/stream', { systemPrompt: 's', message: '我不想活了' });
  const safetyText = await safety.text();
  check('⑦ 自伤干预命中：不转发上游、SSE 形态返回干预内容', safetyText.includes('safetyIntervention') && safetyText.includes('[DONE]'), safetyText.slice(0, 160));
  check('⑧ 安全干预没有调用上游', !upstreamBodies.some((b) => String(b.messages?.at(-1)?.content ?? '').includes('我不想活了')));

  /* 5) 老客户端兼容性：旧网关不存在该路径时的语义由客户端回退处理（此处验证 404 仍然明确） */
  const notFound = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/streaming`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('⑨ 未知路径仍是明确的 404', notFound.status === 404);
}

gateway.kill();
upstream.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(failures === 0 ? `ALL PASS gateway stream assertions` : `${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
