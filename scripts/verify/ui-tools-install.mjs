import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, '.research/ui-tools-2026-10-14');
await mkdir(out, { recursive: true });
const mode = process.argv[2] || 'browser';
const evidence = { mode, date: new Date().toISOString(), cwd: root, modelCalls: 0, microphoneAccess: false };
const env = { ...process.env, NO_UPDATE_NOTIFIER: '1', CI: '1' };
// Never consume an existing Context7 credential during the anonymous test.
delete env.CONTEXT7_API_KEY;
async function cli(args) {
  const child = spawn(process.execPath, [resolve(root, 'node_modules/@playwright/cli/playwright-cli.js'), ...args], { cwd: root, env, windowsHide: true });
  let output = '';
  child.stdout.on('data', x => { output += x; });
  child.stderr.on('data', x => { output += x; });
  const [code] = await once(child, 'exit');
  evidence.cli ??= [];
  evidence.cli.push({ args, code, output });
  assert.equal(code, 0, output);
  return output;
}
try {
  if (mode === 'context7') {
    const child = spawn(process.execPath, [resolve(root, 'node_modules/@upstash/context7-mcp/dist/index.js'), '--transport', 'stdio'], { cwd: root, env, windowsHide: true });
    const pending = new Map();
    const lines = createInterface({ input: child.stdout });
    let id = 0;
    let stderr = '';
    child.stderr.on('data', x => { stderr += x; });
    lines.on('line', line => {
      try { const message = JSON.parse(line); pending.get(message.id)?.(message); } catch { /* non-protocol output is retained by process stderr */ }
    });
    const request = (method, params) => new Promise((yes, no) => {
      const rid = ++id;
      const timer = setTimeout(() => { pending.delete(rid); no(new Error(`${method} timeout`)); }, 65000);
      pending.set(rid, message => { clearTimeout(timer); pending.delete(rid); yes(message); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n');
    });
    try {
      evidence.initialize = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'virtugene-ui-tool-verification', version: '1.0.0' } });
      assert.ok(evidence.initialize.result?.serverInfo);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      evidence.tools = await request('tools/list', {});
      assert.ok(evidence.tools.result?.tools.some(x => x.name === 'resolve-library-id'));
      if (process.argv.includes('--query')) {
        evidence.query = await request('tools/call', { name: 'resolve-library-id', arguments: { libraryName: 'playwright', query: 'How to take a screenshot of a local test page?' } });
        const text = evidence.query.result?.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || '';
        evidence.queryStatus = evidence.query.error || evidence.query.result?.isError || /Error searching|fetch failed|Invalid API key|Rate limited|sign.in/i.test(text) ? 'failed' : 'passed';
        if (evidence.queryStatus === 'passed' && process.argv.includes('--docs')) {
          assert.ok(text.includes('/microsoft/playwright'));
          evidence.documentation = await request('tools/call', { name: 'query-docs', arguments: { libraryId: '/microsoft/playwright', query: 'Take a screenshot of a local test page using page.screenshot', language: 'JavaScript' } });
          const docs = evidence.documentation.result?.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || '';
          evidence.documentationStatus = evidence.documentation.error || evidence.documentation.result?.isError || !docs || /Error fetching|fetch failed|Invalid API key|Rate limited|sign.in/i.test(docs) ? 'failed' : 'passed';
          if (evidence.documentationStatus === 'failed') evidence.queryStatus = 'failed';
        }
      }
      evidence.credentialUsed = false;
    } finally { child.stdin.end(); lines.close(); child.kill(); evidence.stderr = stderr; }
  } else {
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Isolated UI tools verification</title><style>body{font:18px system-ui;color:#111;background:white;margin:32px}button{font:inherit;padding:12px}</style></head><body><main><h1>Isolated UI tools verification</h1><p>This page uses no model, account, or microphone.</p><button id="counter">Count: 0</button></main><script>let count=0;document.querySelector("button").onclick=e=>e.target.textContent="Count: "+(++count)</script></body></html>';
    const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    evidence.url = url;
    let browser;
    const session = 'virtugene-ui-tools-install-20261014';
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
      const context = await browser.newContext({ permissions: [], serviceWorkers: 'block', viewport: { width: 960, height: 640 } });
      const blocked = [];
      await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : (blocked.push(route.request().url()), route.abort()));
      const page = await context.newPage();
      await page.goto(url);
      await page.getByRole('button', { name: 'Count: 0' }).click();
      assert.equal(await page.locator('#counter').innerText(), 'Count: 1');
      const clean = await new AxeBuilder({ page }).analyze();
      assert.equal(clean.violations.length, 0);
      await page.screenshot({ path: resolve(out, 'browser-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: resolve(out, 'browser-mobile.png') });
      await page.evaluate(() => { const button = document.createElement('button'); document.querySelector('main').append(button); });
      const broken = await new AxeBuilder({ page }).analyze();
      assert.ok(broken.violations.some(x => x.id === 'button-name'));
      evidence.browser = { version: browser.version(), channel: 'msedge', profile: 'fresh ephemeral context', cleanViolations: clean.violations, negativeControlRules: broken.violations.map(x => x.id), blockedExternalRequests: blocked, interactionPassed: true };
      await writeFile(resolve(out, 'axe-clean.json'), JSON.stringify(clean, null, 2));
      await writeFile(resolve(out, 'axe-negative-control.json'), JSON.stringify(broken, null, 2));
      const config = resolve(out, 'cli-test.config.json');
      await writeFile(config, JSON.stringify({ browser: { browserName: 'chromium', isolated: true, launchOptions: { channel: 'msedge', headless: true }, contextOptions: { permissions: [], serviceWorkers: 'block' } }, network: { allowedOrigins: [url] }, outputDir: out }));
      await cli([`-s=${session}`, 'open', url, `--config=${config}`]);
      const title = await cli([`-s=${session}`, 'eval', 'document.title']);
      assert.ok(title.includes('Isolated UI tools verification'));
      await cli([`-s=${session}`, 'screenshot', `--filename=${resolve(out, 'cli-browser.png')}`]);
    } finally {
      if (evidence.cli?.length) await cli([`-s=${session}`, 'close']).catch(error => { evidence.closeError = error.message; });
      await browser?.close();
      await new Promise(yes => server.close(yes));
    }
  }
  evidence.status = evidence.queryStatus === 'failed' ? 'partial: local protocol passed; remote query failed' : 'passed';
  if (evidence.queryStatus === 'failed') process.exitCode = 1;
} catch (error) { evidence.status = 'failed'; evidence.error = error.stack; process.exitCode = 1; }
await writeFile(resolve(out, `verification-${mode}.json`), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
