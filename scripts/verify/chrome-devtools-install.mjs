import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, '.research/ui-tools-2026-10-14');
await mkdir(out, { recursive: true });
const chrome = 'C:\\Users\\34568\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const args = [resolve(root, 'node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'), '--headless', '--isolated', `--executablePath=${chrome}`, '--no-usage-statistics', '--no-performance-crux', '--allowedUrlPattern=http://127.0.0.1:*/*', '--allowedUrlPattern=http://localhost:*/*', `--workspace=${out}`];
const evidence = { date: new Date().toISOString(), cwd: root, args, browser: chrome, applicationModelCalls: 0, microphoneAccess: false, accountAccess: false, currentTurnNativeToolLoaded: false, calls: [] };
const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1', CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' } });
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let id = 0;
let stderr = '';
let server;
const exit = once(child, 'exit');
child.stderr.on('data', x => { stderr += x; });
lines.on('line', line => { try { const x = JSON.parse(line); pending.get(x.id)?.(x); } catch {} });
function request(method, params) {
  return new Promise((yes, no) => {
    const rid = ++id;
    const timer = setTimeout(() => { pending.delete(rid); no(new Error(`${method} timed out`)); }, 60000);
    pending.set(rid, x => { clearTimeout(timer); pending.delete(rid); yes(x); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n');
  });
}
const textOf = x => x.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
async function call(name, arguments_) {
  const response = await request('tools/call', { name, arguments: arguments_ });
  evidence.calls.push({ name, arguments: arguments_, response });
  assert.ok(!response.error && !response.result?.isError, textOf(response) || JSON.stringify(response.error));
  return response;
}
try {
  evidence.initialize = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'virtugene-local-devtools-check', version: '1.0.0' } });
  assert.ok(evidence.initialize.result?.serverInfo);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listed = await request('tools/list', {});
  evidence.tools = listed.result?.tools;
  assert.ok(evidence.tools?.some(t => t.name === 'performance_start_trace'));
  assert.ok(evidence.tools?.some(t => t.name === 'take_screenshot'));
  if (!process.argv.includes('--discover-only')) {
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local DevTools performance verification</title><style>body{font:18px system-ui;background:#fff;color:#111;margin:36px}.dot{width:36px;height:36px;background:#315a96;border-radius:50%;animation:move 1s infinite alternate}@keyframes move{to{transform:translateX(120px)}}</style></head><body><main><h1>Local DevTools performance verification</h1><p>Synthetic animation. No account, model, or microphone.</p><div class="dot" aria-hidden="true"></div></main></body></html>';
    server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'" }); res.end(html); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    evidence.url = `http://127.0.0.1:${server.address().port}/`;
    const opened = await call('new_page', { url: evidence.url, isolatedContext: 'virtugene-devtools-install-only' });
    const pageLine = textOf(opened).split('\n').find(line => line.includes(evidence.url));
    const pageId = Number(pageLine?.match(/^(\d+):/)?.[1]);
    assert.ok(Number.isFinite(pageId), `Page ID not returned: ${textOf(opened)}`);
    evidence.pageId = pageId;
    const screenshot = resolve(out, 'chrome-devtools-local.png');
    await call('take_screenshot', { pageId, format: 'png', filePath: screenshot });
    assert.ok((await stat(screenshot)).size > 1000);
    const trace = resolve(out, 'chrome-devtools-local-trace.json');
    await call('performance_start_trace', { pageId, reload: true, autoStop: true, filePath: trace });
    const parsed = JSON.parse(await readFile(trace, 'utf8'));
    evidence.trace = { path: trace, bytes: (await stat(trace)).size, eventCount: (parsed.traceEvents || parsed).length };
    assert.ok(evidence.trace.eventCount > 0);
    await call('close_page', { pageId });
  }
  evidence.status = 'passed';
} catch (error) { evidence.status = 'failed'; evidence.error = error.stack; process.exitCode = 1; }
finally {
  // MCP stdin EOF invokes its own browser.close(), preserving unrelated browsers.
  child.stdin.end();
  let timer;
  const stopped = await Promise.race([exit.then(([code]) => ({ code })), new Promise(yes => { timer = setTimeout(() => yes({ timeout: true }), 10000); })]);
  clearTimeout(timer);
  evidence.shutdown = stopped;
  if (stopped.timeout) child.kill();
  lines.close();
  if (server) await new Promise(yes => server.close(yes));
  evidence.stderr = stderr;
}
await writeFile(resolve(out, process.argv.includes('--discover-only') ? 'verification-devtools-discovery.json' : 'verification-devtools.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ status: evidence.status, server: evidence.initialize?.result?.serverInfo, toolCount: evidence.tools?.length, url: evidence.url, trace: evidence.trace, shutdown: evidence.shutdown, error: evidence.error, calls: evidence.calls.map(x => ({ name: x.name, isError: x.response.result?.isError, text: textOf(x.response).slice(0,450) })) }, null, 2));
