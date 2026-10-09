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
const { withChatMessagingPolicy } = await import('../../server/chat-messaging-policy.mjs');
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
};
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/* ---------- mock 上游 ---------- */
const upstreamBodies = [];
let cancelledUpstream = false;
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
      if (String(body.messages?.at(-1)?.content ?? '').includes('stop-test')) {
        res.once('close', () => { cancelledUpstream = true; });
        return;
      }
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
    const empty = String(body.messages?.at(-1)?.content ?? '').includes('empty-aux-test');
    res.end(JSON.stringify({ choices: [{ message: { content: empty ? '' : body.response_format ? '{"text":"辅助"}' : '整段' }, finish_reason: 'stop' }] }));
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
    DEEPSEEK_DEFAULT_MODEL: 'deepseek-v4-pro', // Obsolete deployment config must not override Flash.
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
    body: JSON.stringify({ systemPrompt: 's', ...body }),
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

try {
if (ready) {
  /* 1) 私聊接口不变：整段 JSON */
  const sourceSummary=await gw('/v1/aux',{operation:'context-summary',payload:{previousSummary:'以前角色说过亲眼看锻造。',history:[{role:'assistant',content:'我亲眼看过你锻造。'},{role:'user',content:'其实那天我没锻造。'},{role:'user',content:'这是助理代拟的近况。',userAuthored:false}]}});
  await sourceSummary.text();
  const summaryRequest=upstreamBodies.at(-1);
  check('摘要网关保留角色原话的未核实来源，不把承诺写成完成',summaryRequest.messages[0].content.includes('承诺记为承诺')&&summaryRequest.messages[1].content.includes('角色曾说（未经独立核实'));
  check('摘要网关区分真实用户更正、助理代拟及旧摘要',summaryRequest.messages[1].content.includes('用户原话: 其实那天我没锻造')&&summaryRequest.messages[1].content.includes('不是用户原话')&&summaryRequest.messages[1].content.includes('不是新增证据'));
  const plain = await gw('/v1/chat', { systemPrompt: 's', message: 'm' });
  const plainJson = await plain.json();
  check('① /v1/chat 仍返回整段 JSON（私聊路径不受影响）', plain.ok === true && plainJson.content === '整段', plainJson);
  check('普通聊天默认 Flash / low 思考，无无效 temperature', plainJson.modelId === 'deepseek-flash' && upstreamBodies.at(-1).model === 'deepseek-flash' && upstreamBodies.at(-1).reasoning_effort === 'low' && !('temperature' in upstreamBodies.at(-1)));
  check('网关保留安全约束并只追加一份私聊契约', upstreamBodies.at(-1).messages[0].content.includes('不得声称自己是真实人类') && upstreamBodies.at(-1).messages[0].content.split('[手机私聊表达契约]').length === 2);
  const longVoice = withChatMessagingPolicy('角色身份\n' + '历史背景'.repeat(5700) + '\n[人物声音卡]\n稳定口癖：先说正事\n[/人物声音卡]');
  await gw('/v1/chat', { systemPrompt: longVoice, message: 'voice-tail-test', retryHint: '保留情绪强度' });
  const voiceSystem = upstreamBodies.at(-1).messages[0].content;
  check('网关不截断预算内的尾部声音卡，客户端契约不会重复', voiceSystem.includes('稳定口癖：先说正事') && voiceSystem.split('[手机私聊表达契约]').length === 2 && voiceSystem.split('保留情绪强度').length === 2);
  for (const model of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp', 'deepseek-flash', 'unrelated-model']) {
    const result = await gw('/v1/chat', { message: 'legacy-test', sessionModel: { provider: 'deepseek', model } });
    check(`网关旧会话 ${model} 统一 Flash`, result.ok && (await result.json()).modelId === 'deepseek-flash' && upstreamBodies.at(-1).model === 'deepseek-flash');
  }
  const image = 'data:image/png;base64,aGVsbG8=';
  await gw('/v1/chat', { message: '看图', image, character: { model: { provider: 'deepseek', model: 'deepseek-v4-pro' } } });
  check('网关图片直用 Flash，保留图片且关闭思考', upstreamBodies.at(-1).model === 'deepseek-flash' && upstreamBodies.at(-1).thinking.type === 'disabled' && upstreamBodies.at(-1).messages.at(-1).content[1].image_url.url === image);
  await gw('/v1/chat', { message: '恢复', disableThinking: true });
  check('非流式恢复关闭思考', upstreamBodies.at(-1).thinking.type === 'disabled');
  await gw('/v1/chat', { message: 'Return JSON', structuredOutput: true });
  check('非流式结构化调用 Flash，关闭思考并启用 JSON', upstreamBodies.at(-1).model === 'deepseek-flash' && upstreamBodies.at(-1).thinking.type === 'disabled' && upstreamBodies.at(-1).response_format.type === 'json_object');
  check('结构化操作规划不混入私聊分条协议', !upstreamBodies.at(-1).messages[0].content.includes('[手机私聊表达契约]'));
  for (const operation of ['memory', 'emotion', 'context-settle', 'context-summary', 'diary']) {
    const result = await gw('/v1/aux', { operation, payload: { text: 'fixture' } });
    const body = upstreamBodies.at(-1);
    check(`${operation} 辅助链路 Flash + 非思考 JSON`, result.ok && (await result.json()).text === '辅助' && body.model === 'deepseek-flash' && body.thinking.type === 'disabled' && body.response_format.type === 'json_object');
  }
  const emptyAux = await gw('/v1/aux', { operation: 'diary', payload: { text: 'empty-aux-test' } });
  check('辅助请求空回复明确失败，不伪造空对象成功', emptyAux.status === 502);

  /* 2) 流式端点：SSE 转发 + 预算/思考透传 */
  const streamed = await gw('/v1/chat/stream', { systemPrompt: 's', message: 'stream-test', maxTokens: 1200, disableThinking: true });
  const streamedText = await streamed.text();
  const upstreamStream = upstreamBodies.at(-1);
  check('② 流式响应是 text/event-stream', String(streamed.headers.get('content-type')).includes('text/event-stream'), streamed.headers.get('content-type'));
  check('③ 供应商帧被原样转发（含 [DONE]）', streamedText.includes('星') && streamedText.includes('域') && streamedText.includes('[DONE]'));
  check('④ maxTokens / disableThinking 透传给上游', upstreamStream?.max_tokens === 1200 && upstreamStream?.thinking?.type === 'disabled', upstreamStream);
  check('⑤ 上游收到 stream 与 usage 选项', upstreamStream?.stream === true && upstreamStream?.stream_options?.include_usage === true);
  check('流式入口统一 Flash', upstreamStream?.model === 'deepseek-flash');
  const structuredStream = await gw('/v1/chat/stream', { message: 'Return JSON', structuredOutput: true, sessionModel: { provider: 'deepseek', model: 'deepseek-v4-pro' } });
  await structuredStream.text();
  check('流式结构化请求与非流式思考/JSON口径一致', upstreamBodies.at(-1).model === 'deepseek-flash' && upstreamBodies.at(-1).thinking.type === 'disabled' && upstreamBodies.at(-1).response_format.type === 'json_object');
  const historyImage = await gw('/v1/chat/stream', { message: '再看看', history: [{ role: 'user', content: '图', image }] });
  await historyImage.text();
  check('流式历史图片使用 Flash 原生视觉', upstreamBodies.at(-1).model === 'deepseek-flash' && upstreamBodies.at(-1).thinking.type === 'disabled' && upstreamBodies.at(-1).messages[1].content[1].image_url.url === image);

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

  const cancelled = await gw('/v1/chat/stream', { systemPrompt: 's', message: 'stop-test' });
  const reader = cancelled.body.getReader();
  await reader.read(); await reader.cancel();
  for (let attempt = 0; attempt < 30 && !cancelledUpstream; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  check('⑩ 停止生成会关闭真实网关的上游请求', cancelledUpstream);
}

} finally {
  gateway.kill();
  upstream.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(failures === 0 ? `ALL PASS gateway stream assertions` : `${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
